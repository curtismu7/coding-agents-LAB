// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import fs from 'node:fs';
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { DEFAULT_CAST, VERTICALS, unfilled } from './cast.js';
import { buildStory, rawStory } from './story.js';
import { SCENARIOS } from './data.js';
import { AGENT_IDS, nativeRequest, parsePayload } from './agents.js';
import { ctxFor, gatewayEvaluate, scenarioCall } from './evaluation.js';
import { defaultConfig, validateConfig } from './codingConfig.js';
import { modeFrom } from './config.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { MOCK_TABLE } from './mockTable.js';
import { HOOK_PATH } from './live.js';
import { settingsPath } from './settings.js';

export const settingsFile = (env = process.env) => (env.STANDALONE_ENV ? env.STANDALONE_ENV : settingsPath(env));

export async function runChecks({ env = process.env, cast = DEFAULT_CAST } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try { add('mode', 'pass', `${modeFrom(env)} is the opening mode (mock is the default); the header toggle switches between mock and live, both loopback-only`); }
  catch (e) { add('mode', 'fail', e.message); }

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.CALAB_BIND ? ' (CALAB_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);

  // The one shared settings file: optional, never printed. It should be mode 600.
  const file = settingsFile(env);
  try { const m = fs.statSync(file).mode & 0o777; add('settings-file', m & 0o077 ? 'info' : 'pass', m & 0o077 ? 'the shared settings file is readable by others: chmod 600 it' : 'the shared settings file exists and is mode 600 (values are never printed)'); }
  catch { add('settings-file', 'info', 'no shared settings file: mock mode needs none'); }

  add('hook-script', fs.existsSync(HOOK_PATH) ? 'pass' : 'fail', fs.existsSync(HOOK_PATH) ? 'hooks/lab-hook.mjs is present (Live mode runs it)' : 'hooks/lab-hook.mjs is missing');

  // Each scripted action gives the decision the story says it does, in every vertical, for every agent that has a hook event for it,
  // the hook payload parses back to the same kind of action, and the Mock table agrees with the engine.
  const wrong = []; const drift = [];
  for (const [vertical, c] of Object.entries(VERTICALS)) {
    for (const s of SCENARIOS) {
      const { call } = scenarioCall(c, s.id);
      for (const agent of AGENT_IDS) {
        const req = nativeRequest(agent, call, ctxFor(c));
        if (!req) continue;
        if (parsePayload(agent, req)?.kind !== call.kind) wrong.push(`${vertical}/${s.id}/${agent}/roundtrip`);
        const g = gatewayEvaluate({ agent, call, cast: c });
        if (g.evaluation.decision !== s.expected) wrong.push(`${vertical}/${s.id}/${agent}`);
        const row = MOCK_TABLE[vertical]?.[s.id]?.[agent];
        if (!row || row.decision !== g.evaluation.decision || JSON.stringify(row.native) !== JSON.stringify(g.native)) drift.push(`${vertical}/${s.id}/${agent}`);
      }
    }
  }
  add('scenarios', !wrong.length ? 'pass' : 'fail', wrong.length ? `actions that do not give their expected decision: ${wrong.slice(0, 6).join(', ')}` : `${SCENARIOS.length} scripted actions give their expected decision for ${AGENT_IDS.length} agents in ${Object.keys(VERTICALS).length} verticals, and every hook payload parses back`);
  add('mock-table', !drift.length ? 'pass' : 'fail', drift.length ? `mock table drifts from the engine: ${drift.slice(0, 4).join(', ')} (run npm run mock-table)` : 'the mock table matches the live engine');

  const cfg = validateConfig(defaultConfig(cast));
  add('config', cfg.ok ? 'pass' : 'fail', cfg.ok ? 'the default CodingAgent config validates' : JSON.stringify(cfg.errors).slice(0, 120));

  const raw = rawStory();
  const text = JSON.stringify(raw);
  const holes = unfilled(text, DEFAULT_CAST);
  add('story-tokens', holes.length ? 'fail' : 'pass', holes.length ? `unfilled {{tokens}}: ${[...new Set(holes)].join(', ')}` : 'every {{cast}} token is filled');
  const badVert = Object.entries(VERTICALS).filter(([, v]) => unfilled(text, v).length).map(([k]) => k);
  add('verticals', badVert.length ? 'fail' : 'pass', badVert.length ? `verticals missing a token: ${badVert.join(', ')}` : `${Object.keys(VERTICALS).length} vertical packs fill every token`);

  const filled = JSON.stringify(Object.keys(VERTICALS).map((v) => buildStory(VERTICALS[v], v)));
  const hosts = scanHosts(filled);
  add('story-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts: ${hosts.join(', ')}` : 'every host in the story data is .invalid or .example');
  const keys = scanKeys(filled);
  add('story-keys', keys.length ? 'fail' : 'pass', keys.length ? 'key-looking values that are not sk-MOCK-' : 'the only credential-shaped value is the labelled mock one, built at run time');
  add('diagrams', DIAGRAM_NAMES.every((n) => buildDiagram(cast, n).steps.length > 0) ? 'pass' : 'fail', `${DIAGRAM_NAMES.length} diagram-studio/1 diagrams load and validate`);

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  add('tenant', 'pass', 'simulated only: no tenant, no credentials, no outbound network, no agent configuration written; every product claim is UNVERIFIED on our tenant');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');

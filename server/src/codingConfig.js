// The CodingAgent config and what is generated from it.
//
// Field names Enabled, FailClosed, Agents, Gateways (and the carried AIGuard, AIIntent, Behaviour) are from the console swagger of
// 2026-10-31: definition modelCodingAgentConfig, schema only, behaviour not tested on our tenant. Everything else on this page
// (validation limits, the generated text, which agents count as "found on the device") is lab-invented.
//
// The generated managed-configuration text is DISPLAYED and DOWNLOADABLE ONLY. This module has no file I/O; a test pins that
// nothing in the repo writes to a home directory, /Library or /etc.
import { AGENTS, AGENT_IDS, DOC, ILL, agentById } from './agents.js';
import { isReservedHost } from './safety.js';

export const SWAGGER_NAMES = 'console swagger name, 2026-10-31 (schema only; behaviour not tested on our tenant)';
export const LAB_NAMES = 'lab-invented';
export const CONFIG_FIELDS = [
  { name: 'Enabled', swagger: true, note: 'Off until a tenant asks: it writes managed hook configuration to every developer machine and refuses their tool calls.' },
  { name: 'FailClosed', swagger: true, note: 'Refuse the action when the gateway cannot be reached or the evaluation times out. Default open, because a hook fires on every tool call and failing closed stops all work on a device that loses its tunnel.' },
  { name: 'Agents', swagger: true, note: 'Names of the coding agents to install hooks for. Empty installs for every agent found on the device.' },
  { name: 'Gateways', swagger: true, note: 'Tunnel endpoints a device evaluates hooks against, tried in order.' },
  { name: 'AIGuard', swagger: true, note: 'Carried as in the schema (the same signal configs an agent access key has). The lab does not interpret it.' },
  { name: 'AIIntent', swagger: true, note: 'Carried as in the schema. The lab does not interpret it.' },
  { name: 'Behaviour', swagger: true, note: 'Carried as in the schema. The lab does not interpret it.' },
];
const CARRIED = ['AIGuard', 'AIIntent', 'Behaviour'];
export const MAX_GATEWAYS = 5;

export function defaultConfig(cast) {
  return {
    Enabled: true, FailClosed: false, Agents: {},
    Gateways: [`https://tunnel-1.${cast.castHost}.example/`, `https://tunnel-2.${cast.castHost}.example/`],
  };
}

// Returns { ok, errors: [{field, message}], warnings: [], config }. Never throws.
export function validateConfig(input) {
  const errors = []; const warnings = []; const e = (field, message) => errors.push({ field, message });
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: [{ field: '(config)', message: 'must be an object' }], warnings, config: null };
  const known = new Set(['Enabled', 'FailClosed', 'Agents', 'Gateways', ...CARRIED]);
  // No error ever carries a key, a value or a slice of one that the caller typed: the texts below are fixed.
  if (Object.keys(input).some((k) => !known.has(k))) e('(unknown field)', `an unknown field was sent; the CodingAgent fields are ${[...known].join(', ')}`);
  const config = { Enabled: false, FailClosed: false, Agents: {}, Gateways: [] };
  for (const k of ['Enabled', 'FailClosed']) {
    if (input[k] === undefined) continue;
    if (typeof input[k] !== 'boolean') e(k, 'must be true or false'); else config[k] = input[k];
  }
  if (input.Agents !== undefined) {
    let unknownAgent = false;
    if (input.Agents === null || typeof input.Agents !== 'object' || Array.isArray(input.Agents)) e('Agents', 'must be an object of agent name to true or false');
    else for (const [k, v] of Object.entries(input.Agents)) {
      if (!AGENT_IDS.includes(k)) { if (!unknownAgent) e('Agents', `a name that is not an agent was sent; the agents are ${AGENT_IDS.join(', ')}`); unknownAgent = true; }
      else if (typeof v !== 'boolean') e('Agents', `${k} must be true or false`);
      else config.Agents[k] = v;
    }
  }
  if (input.Gateways !== undefined) {
    if (!Array.isArray(input.Gateways)) e('Gateways', 'must be a list of endpoints');
    else if (input.Gateways.length > MAX_GATEWAYS) e('Gateways', `at most ${MAX_GATEWAYS} endpoints`);
    else {
      const seen = new Set();
      for (const g of input.Gateways) {
        let u = null;
        try { u = typeof g === 'string' && g.length <= 200 && !/['"`$\\\s]/.test(g) ? new URL(g) : null; } catch { u = null; }
        if (!u || u.protocol !== 'https:' || u.username || u.password) e('Gateways', 'each endpoint must be an https URL of at most 200 characters, without credentials, quotes, backslashes or spaces');
        else if (!isReservedHost(u.hostname)) e('Gateways', 'each endpoint must be on an .example or .invalid host (the lab names no real host)');
        else if (seen.has(u.href)) e('Gateways', 'an endpoint is listed twice');
        else { seen.add(u.href); config.Gateways.push(u.href); }
      }
    }
  }
  for (const k of CARRIED) {
    if (input[k] === undefined) continue;
    if (input[k] === null || typeof input[k] !== 'object' || Array.isArray(input[k])) e(k, 'must be an object');
    else if (JSON.stringify(input[k]).length > 4000) e(k, 'is too large (4000 characters at most)');
    else config[k] = input[k];
  }
  if (config.Enabled && !Object.values(config.Agents).some(Boolean) && Object.keys(config.Agents).length) warnings.push('Every named agent is false: nothing is covered. Empty Agents covers every agent found on the device.');
  if (config.Enabled && config.Gateways.length === 0) warnings.push('No Gateways: a device with no tunnel to borrow would fail every hook open.');
  return { ok: errors.length === 0, errors, warnings, config: errors.length ? null : config };
}

// Which agents the config covers. The device inventory is all six (lab-invented: the lab has no real device to inspect).
export function coveredAgents(config) {
  if (!config?.Enabled) return [];
  const named = Object.entries(config.Agents || {});
  if (!named.length) return [...AGENT_IDS];
  return named.filter(([, v]) => v).map(([k]) => k);
}
export const isCovered = (config, agentId) => coveredAgents(config).includes(agentId);

const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
function hookCommand(agentId, config) {
  const gw = config.Gateways.map((g) => ` --gateway ${q(g)}`).join('');
  return `node <LAB_HOOK_PATH> --agent ${agentId}${config.FailClosed ? ' --fail-closed' : ''}${gw}`;
}
const hooksJson = (events, cmd, withMatcher) => JSON.stringify({ hooks: Object.fromEntries(events.map((ev) => [ev, [withMatcher.includes(ev) ? { matcher: '*', hooks: [{ type: 'command', command: cmd }] } : { hooks: [{ type: 'command', command: cmd }] }]])) }, null, 2);

// The managed configuration text for one agent. Returns { agent, path, format, text, status, caveat, note }.
export function generateFor(agentId, config) {
  const a = agentById(agentId); if (!a) return null;
  const cmd = hookCommand(agentId, config);
  const evs = [...new Set(Object.values(a.channels).map((c) => c.event).filter(Boolean))];
  const path = a.managed[0].path; let text; let format = 'json';
  if (agentId === 'claude-code') text = JSON.stringify({ allowManagedHooksOnly: true, ...JSON.parse(hooksJson(evs, cmd, ['PreToolUse', 'PostToolUse'])) }, null, 2);
  else if (agentId === 'cursor') text = JSON.stringify({ version: 1, hooks: Object.fromEntries(evs.map((ev) => [ev, [{ command: cmd }]])) }, null, 2);
  else if (agentId === 'codex') {
    format = 'toml + json';
    text = `# requirements.toml (managed). Hook scripts must live under managed_dir. Location of this file: not documented in the page read.\nmanaged_dir = "<LAB_MANAGED_DIR>"\n\n# hooks.json (same directory)\n${hooksJson(evs, cmd, ['PreToolUse', 'PostToolUse'])}`;
  } else if (agentId === 'copilot') text = JSON.stringify({ version: 1, hooks: Object.fromEntries(evs.map((ev) => [ev, [{ type: 'command', command: cmd }]])) }, null, 2);
  else if (agentId === 'antigravity') text = hooksJson(evs, `${cmd}`, ['PreToolUse', 'PostToolUse']);
  else text = hooksJson(evs, cmd, ['BeforeTool', 'AfterTool']);
  const path0 = agentId === 'copilot' ? '/etc/github-copilot/policy.d/coding-agents-lab.json' : agentId === 'antigravity' ? '~/.gemini/config/hooks.json' : path;
  const pathStatus = agentId === 'antigravity' || agentId === 'codex' ? ILL : DOC;
  return { agent: agentId, path: path0, format, text, pathStatus, bodyStatus: ILL, caveat: a.configCaveat, note: a.managedNote };
}

export function generateAll(config) {
  return coveredAgents(config).map((id) => generateFor(id, config));
}

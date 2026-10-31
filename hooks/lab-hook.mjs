#!/usr/bin/env node
// The lab's hook. An agent runs it as a command hook: the agent's JSON event arrives on stdin, the agent's NATIVE answer goes to
// stdout (exit code 0). The hook never decides anything itself: it asks the lab gateway (POST /api/hook over loopback) and prints
// what comes back in the agent's own allow / deny / ask shape.
//
//   node hooks/lab-hook.mjs --agent claude-code [--gateway URL]... [--fail-closed] [--timeout MS]
//   env (the flags win): LAB_GATEWAYS (comma list, tried in order), LAB_FAIL_CLOSED=1, LAB_DEVICE_CERT_SUBJECT (a MOCK subject),
//   LAB_VERTICAL, LAB_WORKSPACE, LAB_TIMEOUT_MS (clamped to 100-15000, default 3000), LAB_HOOK_VERBOSE=1 (diagnostics on stderr as
//   LAB-TRACE / LAB-GATEWAY / LAB-GAP / LAB-NET lines), TRACEPARENT (continue a W3C trace).
//
// Loopback only, enforced twice: a gateway that is not a loopback URL is skipped as unreachable, redirects are refused, and the
// same netguard the server uses is installed in this process, so a socket or DNS lookup to anywhere else is blocked and counted.
// A long field is cut to its head and tail before posting (server/src/trim.js).
// If no gateway answers, the developer keeps working (FailClosed off) and the gap is written to stderr as a LAB-GAP line, or the
// action is refused in the agent's native shape (FailClosed on, where the agent's hook can refuse).
// If the event cannot be read at all (not JSON, over 1 MB, too complex): FailClosed off = NO OPINION (prints {}, exit 0, the agent
// proceeds); FailClosed on = a refusal in the agent's tool-call deny shape plus exit code 2 (blocking in every agent whose docs
// give exit codes).
// It writes nothing to disk. It never edits any agent's configuration.
import { randomBytes } from 'node:crypto';
import { agentById, parsePayload, respond, unreachableOutcome } from '../server/src/agents.js';
import { redact } from '../server/src/detect.js';
import { identityFrom } from '../server/src/identity.js';
import { installNetguard } from '../server/src/netguard.js';
import { isLoopbackHost } from '../server/src/safety.js';
import { trimPayload } from '../server/src/trim.js';

const guard = installNetguard();
const argv = process.argv.slice(2);
const flag = (name) => { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1] !== undefined) out.push(argv[i + 1]); return out; };
const env = process.env;
const agent = flag('--agent')[0] || env.LAB_AGENT;
const failClosed = argv.includes('--fail-closed') || env.LAB_FAIL_CLOSED === '1';
const verbose = env.LAB_HOOK_VERBOSE === '1';
const timeoutMs = Math.min(Math.max(Number(flag('--timeout')[0] || env.LAB_TIMEOUT_MS) || 3000, 100), 15000);
const certSubject = env.LAB_DEVICE_CERT_SUBJECT || 'CN=unknown,OU=device:unknown,O=(none)';
const fromFlags = flag('--gateway');
const gateways = fromFlags.length ? fromFlags : (env.LAB_GATEWAYS || 'http://127.0.0.1:7150/').split(',').map((s) => s.trim()).filter(Boolean);
const STDIN_LIMIT = 1_000_000;

const diag = (tag, obj) => { if (verbose) process.stderr.write(`${tag} ${JSON.stringify(obj)}\n`); };
const out = (obj) => { process.stdout.write(`${JSON.stringify(obj)}\n`); };
const hostOf = (g) => { try { return new URL(g).host || String(g).slice(0, 40); } catch { return String(g).slice(0, 40); } };

// Returns the text, or null when it is over the limit.
async function readStdin() {
  const chunks = []; let size = 0;
  for await (const c of process.stdin) { size += c.length; if (size > STDIN_LIMIT) { process.stdin.destroy(); return null; } chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

const parent = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(env.TRACEPARENT || '');
const traceId = parent && !/^0+$/.test(parent[1]) ? parent[1] : randomBytes(16).toString('hex');
const traceparent = `00-${traceId}-${randomBytes(8).toString('hex')}-01`;

async function ask(base, body) {
  const u = new URL(base);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('not an http(s) gateway');
  if (!isLoopbackHost(u.hostname)) throw new Error(`not a loopback gateway: ${u.hostname}`);
  const r = await fetch(new URL('/api/hook', u), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', origin: u.origin, traceparent, 'x-workspace': env.LAB_WORKSPACE || 'default', 'x-lab-vertical': env.LAB_VERTICAL || 'finance' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`gateway answered HTTP ${r.status}`);
  return r.json();
}

// The event cannot be read. Fail open = no opinion; FailClosed = refuse in the agent's tool-call deny shape, exit 2.
function unreadable(why) {
  const msg = `The hook could not read this event (${why}).`;
  if (!failClosed) { process.stderr.write(`lab-hook: ${msg} No opinion: the agent proceeds.\n`); out({}); return; }
  const reason = `${msg} This tenant requires a refusal (FailClosed).`;
  process.stderr.write(`lab-hook: ${reason}\n`);
  out(respond(agent, 'shell', 'deny', reason));
  if (agent !== 'antigravity') process.exitCode = 2; // its exit codes are not documented
}

async function main() {
  if (!agentById(agent)) { process.stderr.write(`lab-hook: unknown --agent ${String(agent).slice(0, 30)}\n`); process.exitCode = 1; return; }
  diag('LAB-TRACE', { traceId, traceparent, timeoutMs, failClosed });
  const text = await readStdin();
  if (text === null) return unreadable('over 1 MB');
  let payload;
  try { payload = JSON.parse(text); } catch { return unreadable('not JSON'); }
  const call = parsePayload(agent, payload);
  if (!call) { out({}); return; } // an event the lab does not evaluate: no opinion
  const trimmed = trimPayload(payload);
  if (trimmed === null) return unreadable('too large or too complex to trim');
  const body = { agent, certSubject, payload: trimmed };
  const tried = [];
  for (const g of gateways) {
    try {
      const j = await ask(g, body);
      diag('LAB-GATEWAY', { decision: j.decision, reasonCode: j.reasonCode, reason: j.reason, findings: j.findings, outcome: j.outcome, identity: j.identity, kind: j.kind, decidedBy: j.decidedBy });
      out(j.native ?? {});
      return;
    } catch (e) { tried.push(`${hostOf(g)}: ${String(e.message).slice(0, 80)}`); }
  }
  // No gateway answered.
  const u = unreachableOutcome(agent, call.kind, failClosed);
  const who = identityFrom(certSubject);
  diag('LAB-GAP', { agent, kind: call.kind, identity: who.identity, device: who.device, failClosed, outcome: u.refused ? 'refused' : 'proceeded', reasonCode: u.reasonCode, reason: u.reason, tried, traceparent, summary: redact(call.text ?? call.command ?? call.path ?? `${call.server}/${call.tool}`, 100) });
  out(respond(agent, call.kind, u.native, u.reason));
}
main().catch((e) => { process.stderr.write(`lab-hook: ${String(e.message).slice(0, 120)}\n`); process.exitCode = 1; }).finally(() => diag('LAB-NET', { attempts: guard.attempts }));

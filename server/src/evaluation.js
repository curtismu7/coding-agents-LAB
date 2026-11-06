// The engine around the deterministic rules: the gateway side of one hook call, the Mock table generated from it, the permission
// dialog each agent shows, and the raw hops. The Live path (live.js) runs the real hook script into the same gateway function,
// so Mock and Live cannot drift: a test compares the table with the live engine for every scenario, agent and vertical.
import { AGENT_IDS, agentById, nativeOutcome, nativeRequest, parsePayload, respond, unreachableOutcome, KIND_LABEL } from './agents.js';
import { evaluateCall } from './detect.js';
import { maskText, redact } from './mask.js';
import { SCENARIOS, materialize, mcpAllowFor } from './data.js';
import { VERTICALS, fillDeep } from './cast.js';
import { identityFrom, mockCertSubject } from './identity.js';
import { formatTraceparent } from './trace.js';

export const ctxFor = (cast) => ({ sessionId: 'sess-mock-0001', cwd: `/work/${cast.castRepo}`, email: `${cast.castAgentId}@${cast.castHost}.example`, device: cast.castDevice });
export const policyFor = (cast) => ({ mcpAllow: mcpAllowFor(cast) });

export function scenarioCall(cast, id) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) return null;
  return { scenario: s, call: JSON.parse(materialize(JSON.stringify(fillDeep(s.call, cast)))) };
}

// The arguments of an MCP call as NAMES and TYPES only: {id: number, repo: text(15)}. A value under a name the masker does not know cannot be told from
// ordinary text (a bare secret under "renamed_field"), so no argument value is ever put into the audit, a dialog or a one-line summary. The names are
// masked and cut; at most 8 are listed.
const MAX_ARGS_SHOWN = 8;
function argShape(args) {
  if (args === null || typeof args !== 'object') return '{}';
  if (Array.isArray(args)) return `[list(${args.length})]`;
  const keys = Object.keys(args);
  const kind = (v) => (typeof v === 'string' ? `text(${v.length})` : Array.isArray(v) ? `list(${v.length})` : v === null ? 'null' : typeof v);
  const shown = keys.slice(0, MAX_ARGS_SHOWN).map((k) => `${redact(k, 30)}: ${kind(args[k])}`);
  return `{${shown.join(', ')}${keys.length > MAX_ARGS_SHOWN ? `, ... ${keys.length - MAX_ARGS_SHOWN} more` : ''}}`;
}

// One-line text of a call for the audit and the dialog. Secrets are masked, then the line is cut to 140 characters.
// An MCP call is "server/tool {argument names and types}". A keyword in the server name and its value in the tool name ("password" / "hunter2xyz")
// are two words to a reader, so the pair is masked once with a space between them; if that finds something the line is shown with the space
// (the slash is lost), otherwise the usual slash form is masked and shown.
export function summarize(call) {
  if (call.kind === 'mcp_call' || call.kind === 'tool_result') {
    // a tool result is masked ON ITS OWN first: put behind "server tool returned: " the shared masker no longer sees a table or a JSON pair that starts a line
    const rest = call.kind === 'mcp_call' ? argShape(call.args) : `returned: ${maskText(call.result)}`;
    const spaced = `${call.server} ${call.tool} ${rest}`;
    const masked = maskText(spaced);
    return redact(masked !== spaced ? masked : `${call.server}/${call.tool} ${rest}`, 140);
  }
  return redact(call.kind === 'prompt' ? call.text : call.kind === 'shell' ? call.command : call.path, 140); // masked first, then cut
}

// The gateway's work for a call already parsed from a hook payload.
export function gatewayEvaluate({ agent, call, cast }) {
  const evaluation = evaluateCall(call, policyFor(cast));
  const outcome = nativeOutcome(agent, call.kind, evaluation.decision);
  return { evaluation, outcome, native: respond(agent, call.kind, outcome.native, evaluation.reason) };
}

// The same, from a raw hook payload (what POST /api/hook receives). Returns null when the payload is not an event the lab evaluates.
export function gatewayFromPayload({ agent, payload, cast }) {
  const call = parsePayload(agent, payload);
  return call ? { call, ...gatewayEvaluate({ agent, call, cast }) } : null;
}

// ---- Mock table: decisions only, no call text. -----------------------------------------------------------------------------
export function buildMockTable() {
  const out = {};
  for (const [vertical, cast] of Object.entries(VERTICALS)) {
    out[vertical] = {};
    for (const s of SCENARIOS) {
      out[vertical][s.id] = {};
      const { call } = scenarioCall(cast, s.id);
      for (const agent of AGENT_IDS) {
        if (!nativeRequest(agent, call, ctxFor(cast))) { out[vertical][s.id][agent] = { covered: false, outcome: nativeOutcome(agent, call.kind, 'allow') }; continue; }
        const g = gatewayEvaluate({ agent, call, cast });
        out[vertical][s.id][agent] = { covered: true, decision: g.evaluation.decision, reasonCode: g.evaluation.reasonCode, reason: g.evaluation.reason, findings: g.evaluation.findings.map((f) => ({ id: f.id, effect: f.effect, label: f.label, detail: f.detail })), decidedBy: g.evaluation.decidedBy, outcome: g.outcome, native: g.native };
      }
    }
  }
  return out;
}

// ---- The permission dialog an agent shows. ----------------------------------------------------------------------------------
export function dialogFor({ agent, call, outcome, reason }) {
  const a = agentById(agent); const d = a.dialog;
  const action = `${KIND_LABEL[call.kind]}: ${summarize(call)}`;
  const skin = a.skin || null;
  if (outcome.native === 'deny') return { state: 'denied', title: d.title, heading: d.deny, action, message: reason, buttons: ['OK'], note: outcome.note || null, skin };
  if (outcome.native === 'ask') return { state: 'asks', title: d.title, heading: d.ask, action, message: reason, buttons: d.buttons, note: outcome.note || null, skin };
  return { state: 'proceeds', title: d.title, heading: 'No dialog: the action proceeds', action, message: reason, buttons: [], note: outcome.note || null, skin };
}

// ---- Raw hops with W3C traceparent. ------------------------------------------------------------------------------------------
export function buildHops({ trace, agent, hookRequest, native, evaluation, down, mode }) {
  const a = agentById(agent);
  const ids = [trace.span(), trace.span(), trace.span(), trace.span()];
  const tp = ids.map((id) => formatTraceparent(trace.traceId, id));
  const hops = [
    { n: 1, from: 'agent', to: 'hook', label: `${a.name} writes the event to the hook's stdin`, traceparent: tp[0], request: `stdin of hooks/lab-hook.mjs --agent ${agent}\n${JSON.stringify(hookRequest, null, 2)}`, response: '(the hook reads it, finds the action, and asks the gateway)' },
  ];
  if (down) {
    hops.push({ n: 2, from: 'hook', to: 'gateway', label: 'Hook tries the gateway: unreachable', traceparent: tp[1], request: `POST http://127.0.0.1:1/api/hook (nothing listens)\ntraceparent: ${tp[1]}`, response: 'connection refused (or timed out)' });
  } else {
    hops.push({ n: 2, from: 'hook', to: 'gateway', label: 'Hook posts the event with the device identity', traceparent: tp[1], request: `POST /api/hook (loopback)\ntraceparent: ${tp[1]}\ncontent-type: application/json\n\n{ "agent": "${agent}", "certSubject": "<MOCK certificate subject>", "payload": <the event above> }`, response: `200 OK\ntraceparent: ${tp[1]}` });
    hops.push({ n: 3, from: 'gateway', to: 'rules', label: 'Gateway evaluates with the same detection and policy', traceparent: tp[2], request: `RULES (${mode}, in process)\ntraceparent: ${tp[2]}`, response: evaluation ? `decision: ${evaluation.decision}\nreason code: ${evaluation.reasonCode}\ndecided by: ${evaluation.decidedBy}` : '(no evaluation)' });
  }
  hops.push({ n: hops.length + 1, from: 'hook', to: 'agent', label: down ? 'Hook answers by its own failure policy' : 'Hook prints the agent-native answer', traceparent: tp[3], request: `stdout of the hook (exit code 0)`, response: JSON.stringify(native ?? {}, null, 2) });
  return hops;
}

// Raw hops for the Real path: the lab gateway forwards the event to the live AI Gateway. The request shows the
// A2A JSON-RPC body (the bearer is never in any hop). sent comes from aiguard.sendToAiGuard.
export function buildRealHops({ trace, agent, hookRequest, native, sent, evaluation, mode }) {
  const a = agentById(agent);
  const ids = [trace.span(), trace.span(), trace.span(), trace.span(), trace.span()];
  const tp = ids.map((id) => formatTraceparent(trace.traceId, id));
  return [
    { n: 1, from: 'agent', to: 'hook', label: `${a.name} writes the event to the hook's stdin`, traceparent: tp[0], request: `stdin of hooks/lab-hook.mjs --agent ${agent}\n${JSON.stringify(hookRequest, null, 2)}`, response: '(the hook reads it and asks the lab gateway)' },
    { n: 2, from: 'hook', to: 'gateway', label: 'Hook posts the event with the device identity', traceparent: tp[1], request: `POST /api/hook (loopback)\ntraceparent: ${tp[1]}\ncontent-type: application/json\n\n{ "agent": "${agent}", "certSubject": "<MOCK certificate subject>", "payload": <the event above> }`, response: `200 OK\ntraceparent: ${tp[1]}` },
    { n: 3, from: 'gateway', to: 'aiguard', label: 'The lab gateway forwards the event to the live AI Gateway (Bearer auth, key never shown)', traceparent: tp[2], request: `POST <AIGATEWAY>/message/send\ntraceparent: ${tp[2]}\nauthorization: Bearer <write-only>\n\n${JSON.stringify({ jsonrpc: '2.0', method: 'message/send', params: { metadata: { codingAgent: agent, developer: '<the device certificate subject>', device: '<the device id>' }, message: { role: 'user', parts: [{ kind: 'text', text: '<the event text>' }] } } }, null, 2)}`, response: `HTTP ${sent.status}\n${sent.raw ? sent.raw.slice(0, 800) : '(empty)'}` },
    { n: 4, from: 'gateway', to: 'rules', label: 'The answer is mapped to a decision', traceparent: tp[3], request: `MAPPING (lab-invented)\ntraceparent: ${tp[3]}`, response: evaluation ? `decision: ${evaluation.decision}\nreason code: ${evaluation.reasonCode}\ndecided by: ${evaluation.decidedBy}` : '(no mapping)' },
    { n: 5, from: 'hook', to: 'agent', label: 'Hook prints the agent-native answer', traceparent: tp[4], request: `stdout of the hook (exit code 0)`, response: JSON.stringify(native ?? {}, null, 2) },
  ];
}

export { mockCertSubject, identityFrom, unreachableOutcome };

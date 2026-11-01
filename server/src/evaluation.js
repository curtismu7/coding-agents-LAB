// The engine around the deterministic rules: the gateway side of one hook call, the Mock table generated from it, the permission
// dialog each agent shows, and the raw hops. The Live path (live.js) runs the real hook script into the same gateway function,
// so Mock and Live cannot drift: a test compares the table with the live engine for every scenario, agent and vertical.
import { AGENT_IDS, agentById, nativeOutcome, nativeRequest, parsePayload, respond, unreachableOutcome, KIND_LABEL } from './agents.js';
import { evaluateCall } from './detect.js';
import { maskDeep, maskText, redact } from './mask.js';
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

// One-line text of a call for the audit and the dialog. Secrets are masked, then the line is cut to 140 characters.
// An MCP call is "server/tool args". A keyword in the server name and its value in the tool name ("password" / "hunter2xyz") are two words
// to a reader, so the pair is masked once with a space between them; if that finds something the line is shown with the space (the
// slash is lost), otherwise the usual slash form is masked and shown.
export function summarize(call) {
  if (call.kind === 'mcp_call' || call.kind === 'tool_result') {
    // the arguments are masked BEFORE they are turned into JSON text: JSON writes a control character as the six characters \u0001, which hides it
    const rest = call.kind === 'mcp_call' ? JSON.stringify(maskDeep(call.args ?? {})) : `returned: ${call.result}`;
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
  if (outcome.native === 'deny') return { state: 'denied', title: d.title, heading: d.deny, action, message: reason, buttons: ['OK'], note: outcome.note || null };
  if (outcome.native === 'ask') return { state: 'asks', title: d.title, heading: d.ask, action, message: reason, buttons: d.buttons, note: outcome.note || null };
  return { state: 'proceeds', title: d.title, heading: 'No dialog: the action proceeds', action, message: reason, buttons: [], note: outcome.note || null };
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

export { mockCertSubject, identityFrom, unreachableOutcome };

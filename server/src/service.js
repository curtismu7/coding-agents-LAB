// The two endpoints' logic: the gateway side of a hook call (POST /api/hook) and the evaluate flow behind the UI's Evaluate and
// Gateway down tabs (Mock = table, Live = the real hook script into the real gateway endpoint).
import { agentById, nativeOutcome, nativeRequest, respond, unreachableOutcome, KINDS } from './agents.js';
import { isCovered } from './codingConfig.js';
import { InputError } from './errors.js';
import { DEAD_GATEWAY, runHookScript } from './live.js';
import { SCENARIOS } from './data.js';
import { maskDeep, maskText } from './mask.js';
import { buildHops, ctxFor, dialogFor, gatewayFromPayload, identityFrom, mockCertSubject, scenarioCall, summarize } from './evaluation.js';
import { MAX_SUBJECT } from './identity.js';
import { formatTraceparent, newTrace } from './trace.js';

export const MAX_CUSTOM = 2000;

// A visitor's own action (Live only): bounded, typed, never interpreted as anything but text. Too long is refused whole, never cut.
// The server and tool names of an MCP call are cut to 40 characters; callers that SHOW a call build it from the MASKED text
// (see shownCall), so the cut can never leave half a secret.
export function customCall(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new InputError('bad_custom', 'custom must be an object');
  const { kind } = input; const text = input.text;
  if (!KINDS.includes(kind)) throw new InputError('bad_custom', `kind must be one of ${KINDS.join(', ')}`);
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_CUSTOM) throw new InputError('bad_custom', `text is required (at most ${MAX_CUSTOM} characters)`);
  if (kind === 'prompt') return { kind, text };
  if (kind === 'shell') return { kind, command: text };
  if (kind === 'file_read') return { kind, path: text };
  if (kind === 'mcp_call') { const [server, tool = 'run', ...rest] = text.trim().split(/\s+/); return { kind, server: server.slice(0, 40), tool: tool.slice(0, 40), args: rest.length ? { input: rest.join(' ').slice(0, 500) } : {} }; }
  return { kind, server: 'builtin', tool: 'tool', args: {}, result: text };
}
// The same call, built from the masked text: what every answer shows. Masking sees the whole text, so a keyword in one word and its
// value in the next cannot be separated by the split into server and tool.
export const shownCall = (input) => customCall({ kind: input.kind, text: maskText(input.text) });

// ---- POST /api/hook -----------------------------------------------------------------------------------------------------------
export function handleHook({ ws, body, cast, workspaces, trace, mode = 'live' }) {
  if (body === null || typeof body !== 'object') throw new InputError('bad_request', 'body must be an object');
  const { agent, payload, certSubject } = body;
  if (!agentById(agent)) throw new InputError('unknown_agent', 'agent must be one of the six');
  if (typeof certSubject === 'string' && certSubject.length > MAX_SUBJECT) throw new InputError('bad_cert_subject', `certSubject is at most ${MAX_SUBJECT} characters`);
  const who = identityFrom(typeof certSubject === 'string' ? certSubject : '');
  const g = gatewayFromPayload({ agent, payload, cast });
  if (!g) return maskDeep({ handled: false, native: {}, decision: 'allow', reasonCode: 'IGNORED-EVENT', reason: 'Not an event the lab evaluates.', findings: [], identity: who, traceId: trace.traceId });
  workspaces.addAudit(ws, { agent, kind: g.call.kind, identity: who.identity, device: who.device, decision: g.evaluation.decision, reasonCode: g.evaluation.reasonCode, nativeDecision: g.outcome.native, summary: summarize(g.call), traceId: trace.traceId, mode });
  // Nothing in the answer may carry a raw credential, whatever the event held (the reason can quote an MCP server name).
  return maskDeep({ handled: true, kind: g.call.kind, native: g.native, decision: g.evaluation.decision, reasonCode: g.evaluation.reasonCode, reason: g.evaluation.reason, findings: g.evaluation.findings, decidedBy: g.evaluation.decidedBy, outcome: g.outcome, identity: who, traceId: trace.traceId });
}

// ---- The evaluate flow --------------------------------------------------------------------------------------------------------
function untouched({ agent, why }) { return { covered: false, installed: false, note: why, outcome: { native: 'none', covered: false }, evaluation: null, native: null, dialog: null, gap: null, agent }; }

async function evaluateInner({ mode, cast, vertical, agent, scenario, custom, config, down, ws, workspaces, table, traceparent, port }) {
  if (!agentById(agent)) throw new InputError('unknown_agent', `agent must be one of the six`);
  let call; let shown = null; let scenarioId = null; let lesson = null; let expected = null;
  if (scenario !== undefined) {
    const sc = typeof scenario === 'string' ? scenarioCall(cast, scenario) : null;
    if (!sc) throw new InputError('unknown_scenario', 'unknown scenario');
    call = sc.call; scenarioId = scenario; lesson = sc.scenario.lesson; expected = sc.scenario.expected;
  } else if (custom !== undefined) {
    if (mode !== 'live') throw new InputError('live_required', 'your own action needs Live mode: Mock mode only has tables for the scripted actions');
    call = customCall(custom);
    shown = shownCall(custom); // what the answers show: built from the masked text
  } else throw new InputError('bad_request', 'send a scenario or a custom action');

  const trace = newTrace(traceparent);
  const identity = identityFrom(mockCertSubject(cast));
  const chn = agentById(agent).channels[call.kind];
  const channel = { event: chn.event, status: chn.status, documented: chn.documented, illustrative: chn.illustrative, canBlock: chn.canBlock, canAsk: chn.canAsk };
  const base = { channel, scenario: scenarioId, lesson, expected, agent, agentName: agentById(agent).name, kind: call.kind, call: { ...(shown ?? call), summary: summarize(shown ?? call) }, mode, down: !!down, identity, certSubject: mockCertSubject(cast), traceId: trace.traceId, failClosed: !!config.FailClosed };

  if (!isCovered(config, agent)) {
    return { ...base, ...untouched({ agent, why: !config.Enabled ? 'Enabled is false: no hook is installed on any agent, so nothing is evaluated and the agent is untouched.' : `${agentById(agent).name} is not in Agents: no hook is installed for it, so it is untouched. (A hook only covers agents it is installed into: the endpoint sensor is what finds agents that are not on the list.)` }), hookRequest: null, hops: [] };
  }
  const hookRequest = nativeRequest(agent, call, ctxFor(cast));
  const shownRequest = shown ? nativeRequest(agent, shown, ctxFor(cast)) : hookRequest; // the request panes show this one; the hook script gets the real one
  if (!hookRequest) {
    const o = nativeOutcome(agent, call.kind, 'allow');
    return { ...base, covered: false, installed: true, note: o.note, outcome: o, evaluation: null, native: null, dialog: null, gap: null, hookRequest: null, hops: [] };
  }

  let evaluation = null; let outcome; let native; let gap = null; let hops;
  if (down) {
    const u = unreachableOutcome(agent, call.kind, !!config.FailClosed);
    outcome = { native: u.native, covered: true, refused: u.refused };
    native = respond(agent, call.kind, u.native, u.reason);
    if (mode === 'live') {
      const r = await runHookScript({ agent, payload: hookRequest, certSubject: mockCertSubject(cast), gateways: [DEAD_GATEWAY], failClosed: !!config.FailClosed, vertical, workspace: ws, traceparent: formatTraceparent(trace.traceId, trace.span()) });
      if (!r.gap || !r.native) throw new InputError('live_failed', 'the hook script did not report a gap');
      native = r.native; gap = r.gap;
    } else gap = { agent, kind: call.kind, identity: identity.identity, device: identity.device, failClosed: !!config.FailClosed, outcome: u.refused ? 'refused' : 'proceeded', reasonCode: u.reasonCode, reason: u.reason, summary: summarize(call).slice(0, 100) };
    workspaces.addGap(ws, { ...gap, scenario: scenarioId, mode });
    evaluation = { decision: u.refused ? 'deny' : 'allow', reasonCode: u.reasonCode, reason: u.reason, findings: [], decidedBy: 'the hook\'s failure policy (the gateway was not reached)' };
    hops = buildHops({ trace, agent, hookRequest: shownRequest, native, evaluation, down: true, mode });
  } else if (mode === 'live') {
    const r = await runHookScript({ agent, payload: hookRequest, certSubject: mockCertSubject(cast), gateways: [`http://127.0.0.1:${port}/`], failClosed: !!config.FailClosed, vertical, workspace: ws, traceparent: formatTraceparent(trace.traceId, trace.span()) });
    if (r.code !== 0 || !r.native || !r.gateway) throw new InputError('live_failed', `the hook script failed (exit ${r.code})`);
    native = r.native; outcome = r.gateway.outcome;
    evaluation = { decision: r.gateway.decision, reasonCode: r.gateway.reasonCode, reason: r.gateway.reason, findings: r.gateway.findings || [], decidedBy: r.gateway.decidedBy };
    hops = buildHops({ trace, agent, hookRequest: shownRequest, native, evaluation, down: false, mode });
  } else {
    const row = table?.[vertical]?.[scenarioId]?.[agent];
    if (!row || !row.covered) throw new InputError('no_table_row', 'the mock table has no row for this action');
    evaluation = { decision: row.decision, reasonCode: row.reasonCode, reason: row.reason, findings: row.findings, decidedBy: row.decidedBy };
    outcome = row.outcome; native = row.native;
    workspaces.addAudit(ws, { agent, kind: call.kind, identity: identity.identity, device: identity.device, decision: row.decision, reasonCode: row.reasonCode, nativeDecision: outcome.native, summary: summarize(call), traceId: trace.traceId, mode });
    hops = buildHops({ trace, agent, hookRequest: shownRequest, native, evaluation, down: false, mode });
  }
  const dialog = dialogFor({ agent, call: shown ?? call, outcome, reason: evaluation.reason });
  return { ...base, covered: true, installed: true, hookRequest: shownRequest, evaluation, outcome, native, dialog, gap, hops };
}
// A visitor's own action may carry a real credential: every string in the response (the call, the hook request, the hops, the dialog,
// the reasons) is masked before it leaves. The scripted actions carry only the labelled mock credential, which stays visible (rule 4).
export async function evaluateAction(args) {
  const r = await evaluateInner(args);
  return args.scenario === undefined && args.custom !== undefined ? maskDeep(r) : r;
}
export { SCENARIOS };

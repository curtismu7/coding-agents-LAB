// Spawns the REAL hook script (hooks/lab-hook.mjs) exactly as an agent would: JSON on stdin, native answer on stdout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOOK_PATH, DEAD_GATEWAY, runHookScript } from '../src/live.js';
import { AGENT_IDS, nativeRequest, respond } from '../src/agents.js';
import { VERTICALS } from '../src/cast.js';
import { ctxFor, scenarioCall } from '../src/evaluation.js';
import { mockCertSubject } from '../src/identity.js';
import { withServer } from './helpers.js';

const cast = VERTICALS.finance;
const payloadFor = (agent, scenario) => nativeRequest(agent, scenarioCall(cast, scenario).call, ctxFor(cast));

function rawHook({ args = [], stdin = '', env = {}, cwd }) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [HOOK_PATH, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (code) => resolve({ code, stdout, stderr }));
    c.stdin.end(stdin);
  });
}

test('for each of the six agents: its JSON on stdin, its NATIVE refusal on stdout (exit 0)', async () => {
  await withServer(async (url) => {
    const shapes = {
      'claude-code': (j) => j.hookSpecificOutput.permissionDecision === 'deny' && /rm -rf/.test(j.hookSpecificOutput.permissionDecisionReason),
      cursor: (j) => j.permission === 'deny' && /rm -rf/.test(j.user_message),
      codex: (j) => j.hookSpecificOutput.permissionDecision === 'deny',
      'gemini-cli': (j) => j.decision === 'deny' && /rm -rf/.test(j.reason),
      copilot: (j) => j.permissionDecision === 'deny' && /rm -rf/.test(j.permissionDecisionReason),
      antigravity: (j) => j.decision === 'deny' && /rm -rf/.test(j.reason),
    };
    for (const agent of AGENT_IDS) {
      const r = await runHookScript({ agent, payload: payloadFor(agent, 'destructive-shell'), certSubject: mockCertSubject(cast), gateways: [`${url}/`] });
      assert.equal(r.code, 0, agent);
      assert.ok(shapes[agent](r.native), `${agent}: ${r.stdout}`);
      assert.equal(r.gateway.decision, 'deny');
      assert.deepEqual(r.native, respond(agent, 'shell', 'deny', r.gateway.reason));
    }
  });
});

test('an ask comes back as the agent\'s own ask where it has one, and a refusal where it does not', async () => {
  await withServer(async (url) => {
    const want = { 'claude-code': 'ask', cursor: 'ask', copilot: 'ask', antigravity: 'ask', codex: 'deny', 'gemini-cli': 'deny' };
    for (const agent of AGENT_IDS) {
      const r = await runHookScript({ agent, payload: payloadFor(agent, 'sensitive-read'), certSubject: mockCertSubject(cast), gateways: [`${url}/`] });
      assert.equal(r.gateway.outcome.native, want[agent], agent);
      assert.deepEqual(r.native, respond(agent, 'file_read', want[agent], r.gateway.reason));
    }
  });
});

test('the identity and device in the audit come from the certificate subject the hook was given', async () => {
  await withServer(async (url) => {
    const subject = 'CN=test.person@lab.example,OU=device:LT-0001,O=Lab (MOCK)';
    await runHookScript({ agent: 'claude-code', payload: payloadFor('claude-code', 'benign'), certSubject: subject, gateways: [`${url}/`], workspace: 'w-id' });
    const a = (await (await fetch(`${url}/api/audit`, { headers: { 'x-workspace': 'w-id' } })).json()).audit;
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].identity, a[0].device, a[0].agent, a[0].kind], ['test.person@lab.example', 'LT-0001', 'claude-code', 'shell']);
  });
});

test('the trace continues: TRACEPARENT in, the same trace id in the audit', async () => {
  await withServer(async (url) => {
    const tid = 'a'.repeat(32);
    const r = await runHookScript({ agent: 'cursor', payload: payloadFor('cursor', 'benign'), certSubject: mockCertSubject(cast), gateways: [`${url}/`], workspace: 'w-tr', traceparent: `00-${tid}-${'b'.repeat(16)}-01` });
    assert.equal(r.trace.traceId, tid);
    assert.equal((await (await fetch(`${url}/api/audit`, { headers: { 'x-workspace': 'w-tr' } })).json()).audit[0].traceId, tid);
  });
});

test('gateway unreachable, FailClosed off: the developer keeps working and the gap is reported', async () => {
  for (const agent of AGENT_IDS) {
    const r = await runHookScript({ agent, payload: payloadFor(agent, 'destructive-shell'), certSubject: mockCertSubject(cast), gateways: [DEAD_GATEWAY], failClosed: false });
    assert.equal(r.code, 0, agent);
    assert.deepEqual(r.native, respond(agent, 'shell', 'allow', ''), `${agent} proceeds`);
    assert.deepEqual([r.gap.outcome, r.gap.reasonCode, r.gap.failClosed], ['proceeded', 'GAP-GATEWAY-UNREACHABLE', false]);
    assert.equal(r.gap.identity, 'maya.chen@fabrikam.example');
  }
});

test('gateway unreachable, FailClosed on: refused in the agent\'s native shape, with the reason', async () => {
  for (const agent of AGENT_IDS) {
    const r = await runHookScript({ agent, payload: payloadFor(agent, 'benign'), certSubject: mockCertSubject(cast), gateways: [DEAD_GATEWAY], failClosed: true });
    assert.equal(r.gap.outcome, 'refused', agent);
    assert.deepEqual(r.native, respond(agent, 'shell', 'deny', r.gap.reason));
    assert.match(JSON.stringify(r.native), /FailClosed/);
  }
});

test('FailClosed cannot refuse where the agent\'s hook cannot (Copilot prompt): it proceeds and says why', async () => {
  const r = await runHookScript({ agent: 'copilot', payload: payloadFor('copilot', 'secret-prompt'), certSubject: mockCertSubject(cast), gateways: [DEAD_GATEWAY], failClosed: true });
  assert.deepEqual([r.gap.outcome, r.native], ['proceeded', {}]);
  assert.match(r.gap.reason, /cannot refuse/);
});

test('gateways are tried in order: a dead first one falls through to a live second one', async () => {
  await withServer(async (url) => {
    const r = await runHookScript({ agent: 'claude-code', payload: payloadFor('claude-code', 'destructive-shell'), certSubject: mockCertSubject(cast), gateways: [DEAD_GATEWAY, `${url}/`] });
    assert.equal(r.gap, null);
    assert.equal(r.gateway.decision, 'deny');
  });
});

test('the hook can only reach loopback: a real-looking gateway is skipped as unreachable, never contacted', async () => {
  const r = await runHookScript({ agent: 'claude-code', payload: payloadFor('claude-code', 'benign'), certSubject: mockCertSubject(cast), gateways: ['https://tunnel-1.fabrikam.example/', 'http://192.0.2.1/'], timeoutMs: 500 });
  assert.equal(r.code, 0);
  assert.equal(r.gap.tried.length, 2);
  for (const t of r.gap.tried) assert.match(t, /not a loopback gateway/);
});

test('bad input: not JSON, an unknown agent, an event the lab does not evaluate', async () => {
  const env = { LAB_GATEWAYS: DEAD_GATEWAY };
  const a = await rawHook({ args: ['--agent', 'claude-code'], stdin: 'not json', env });
  assert.equal(a.code, 1); assert.equal(a.stdout, '');
  const b = await rawHook({ args: ['--agent', 'vim'], stdin: '{}', env });
  assert.equal(b.code, 1);
  const c = await rawHook({ args: ['--agent', 'claude-code'], stdin: JSON.stringify({ hook_event_name: 'SessionStart' }), env });
  assert.deepEqual([c.code, JSON.parse(c.stdout)], [0, {}]);
  const d = await rawHook({ args: ['--agent', 'claude-code'], stdin: 'x'.repeat(1_100_000), env });
  assert.equal(d.code, 1);
});

test('the hook writes nothing to disk and edits no configuration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-hook-'));
  try {
    await rawHook({ args: ['--agent', 'claude-code'], stdin: JSON.stringify(payloadFor('claude-code', 'benign')), env: { LAB_GATEWAYS: DEAD_GATEWAY, LAB_HOOK_VERBOSE: '1' }, cwd: dir });
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

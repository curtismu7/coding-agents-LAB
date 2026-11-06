// Real mode end to end: /api/evaluate with mode "real". The gateway is a local loopback stub standing in for
// the live AI Gateway (the same measured answer shapes), so the tests make zero real outbound calls. The
// stub's URL goes into a temp STANDALONE_ENV; the bearer is write-only throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { withServer, post } from './helpers.js';

const COMPLETED = (extra = {}) => ({ jsonrpc: '2.0', id: 'x', result: { kind: 'task', id: 't', status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: 'Done.' }] }], ...extra } });
const BLOCKED = { jsonrpc: '2.0', id: 'x', error: { code: -32600, message: 'request blocked by security policy' } };
const REDACTED = () => COMPLETED({ history: [{ role: 'user', parts: [{ kind: 'text', text: 'key is [REDACTED:data_exfiltration]' }] }] });

// A loopback stub that answers with the given body and records the bearer it saw.
async function withStub(body, fn, { status = 200, failConnect = false } = {}) {
  const seen = { authorization: null, bodies: [] };
  if (failConnect) return fn('http://127.0.0.1:1/a2a', seen); // nothing listens there
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      seen.authorization = req.headers.authorization;
      seen.bodies.push(data);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(typeof body === 'function' ? body(seen.bodies.length) : body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/a2a`;
  try { await fn(url, seen); } finally { server.close(); }
}

const envFileFor = (url) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cag-real-')), '.env');
  fs.writeFileSync(f, `CODING_AGENTS_LAB_AIGATEWAY_URL=${url}\nCODING_AGENTS_LAB_AIGATEWAY_BEARER=sk-orion-test-bearer\n`);
  return f;
};
// The lab process (createApp's callers) reads the shared env through STANDALONE_ENV, but the answer text must
// never carry the bearer either way. The env is passed per request via the config endpoint is NOT possible
// (values come from the file only), so tests set process.env directly and restore it.
function withRealEnv(url, fn) {
  const saved = { url: process.env.CODING_AGENTS_LAB_AIGATEWAY_URL, bearer: process.env.CODING_AGENTS_LAB_AIGATEWAY_BEARER, standalone: process.env.STANDALONE_ENV };
  process.env.CODING_AGENTS_LAB_AIGATEWAY_URL = url;
  process.env.CODING_AGENTS_LAB_AIGATEWAY_BEARER = 'sk-orion-test-bearer';
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

test('real mode: a blocked prompt is denied by the live AI Guard, in the agent-native shape', async () => {
  await withStub(BLOCKED, async (url, seen) => withRealEnv(url, async () => {
    await withServer(async (api) => {
      const r = await (await post(api, '/api/evaluate', { mode: 'real', agent: 'claude-code', scenario: 'hidden-instructions' })).json();
      assert.equal(r.evaluation.decision, 'deny');
      assert.equal(r.evaluation.reasonCode, 'DENY-AIGUARD-BLOCKED');
      assert.match(r.evaluation.reason, /AI Guard service blocked/);
      assert.equal(r.dialog.state, 'denied');
      assert.deepEqual(r.real, { attempted: true, reached: true });
      assert.equal(seen.authorization, 'Bearer sk-orion-test-bearer');
      assert.ok(!JSON.stringify(r).includes('sk-orion-test-bearer'), 'the bearer never reaches the client');
      const hop3 = r.hops.find((h) => h.to === 'aiguard');
      assert.ok(hop3, 'the hops show the forward to the live gateway');
      assert.ok(!hop3.request.includes('sk-orion-test-bearer'));
    });
  }));
});

test('real mode: a redacted completion is a deny (data stopped before the model)', async () => {
  await withStub(REDACTED, async (url) => withRealEnv(url, async () => {
    await withServer(async (api) => {
      const r = await (await post(api, '/api/evaluate', { mode: 'real', agent: 'claude-code', scenario: 'secret-prompt' })).json();
      assert.equal(r.evaluation.decision, 'deny');
      assert.equal(r.evaluation.reasonCode, 'DENY-AIGUARD-REDACTED');
    });
  }));
});

test('real mode: a clean completion allows, and the lab rules ride along as a comparison layer', async () => {
  await withStub(COMPLETED(), async (url) => withRealEnv(url, async () => {
    await withServer(async (api) => {
      const r = await (await post(api, '/api/evaluate', { mode: 'real', agent: 'claude-code', scenario: 'benign' })).json();
      assert.equal(r.evaluation.decision, 'allow');
      assert.equal(r.evaluation.reasonCode, 'ALLOW-AIGUARD-CLEAN');
      assert.ok(Array.isArray(r.evaluation.findings), 'the lab-rule findings are carried beside the real answer');
    });
  }));
});

test('real mode: an unreachable gateway honors FailClosed (gap vs refusal), and the gap is recorded', async () => {
  await withRealEnv('http://127.0.0.1:1/a2a', async () => {
    await withServer(async (api) => {
      const ws = 'w-real-down';
      const open = await (await post(api, '/api/evaluate', { mode: 'real', agent: 'claude-code', scenario: 'benign', config: { Enabled: true, FailClosed: false } }, { 'x-workspace': ws })).json();
      assert.deepEqual([open.evaluation.decision, open.dialog.state], ['allow', 'proceeds']);
      assert.deepEqual(open.real, { attempted: true, reached: false });
      const closed = await (await post(api, '/api/evaluate', { mode: 'real', agent: 'claude-code', scenario: 'benign', config: { Enabled: true, FailClosed: true } }, { 'x-workspace': ws })).json();
      assert.deepEqual([closed.evaluation.decision, closed.dialog.state], ['deny', 'denied']);
      const gaps = (await (await fetch(`${api}/api/gaps`, { headers: { 'x-workspace': ws } })).json()).gaps;
      assert.deepEqual(gaps.map((g) => g.outcome), ['proceeded', 'refused']);
    });
  });
});

test('real mode without configuration: a fixed 400 reason that names the keys, never a value', async () => {
  const saved = { url: process.env.CODING_AGENTS_LAB_AIGATEWAY_URL, bearer: process.env.CODING_AGENTS_LAB_AIGATEWAY_BEARER, standalone: process.env.STANDALONE_ENV, central: process.env.CENTRAL_AGENT_A2A_URL };
  const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cag-real-')), '.env');
  fs.writeFileSync(empty, '');
  process.env.STANDALONE_ENV = empty;
  delete process.env.CODING_AGENTS_LAB_AIGATEWAY_URL;
  delete process.env.CODING_AGENTS_LAB_AIGATEWAY_BEARER;
  delete process.env.CENTRAL_AGENT_A2A_URL;
  try {
    await withServer(async (api) => {
      const r = await post(api, '/api/evaluate', { mode: 'real', agent: 'claude-code', scenario: 'benign' });
      const body = await r.json();
      assert.equal(r.status, 400);
      assert.equal(body.error, 'real_not_configured');
      assert.ok(body.detail.includes('CODING_AGENTS_LAB_AIGATEWAY_URL'));
      assert.ok(!/Bearer\s+\S/.test(body.detail));
    });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('real mode: an unmapped answer shape is a fixed 400, and the raw body is in the hops, never the error', async () => {
  await withStub({ hello: true }, async (url) => withRealEnv(url, async () => {
    await withServer(async (api) => {
      const r = await post(api, '/api/evaluate', { mode: 'real', agent: 'claude-code', scenario: 'benign' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, 'real_unmapped');
    });
  }));
});

test('a credential typed in real mode is absent from every field of the response', async () => {
  const secret = ['sk', 'live9876543210abcdefgh'].join('-');
  await withStub((n) => (n % 2 ? BLOCKED : COMPLETED()), async (url) => withRealEnv(url, async () => {
    await withServer(async (api) => {
      const r = await post(api, '/api/evaluate', { mode: 'real', agent: 'cursor', custom: { kind: 'prompt', text: `deploy with ${secret}` } });
      const text = await r.text();
      assert.ok(r.status === 200 || r.status === 400, `status ${r.status}`);
      assert.ok(!text.includes(secret), `the credential came back: ${text.slice(0, 120)}`);
    });
  }));
});

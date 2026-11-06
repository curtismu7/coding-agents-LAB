// The Real-mode engine: config from the shared settings file, the A2A text, and the answer mapping.
// The mapping was MEASURED on the live gateway (2026-11-06); these tests pin the measured shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aiGuardConfig, jsonRpcUrl, eventText, mapGatewayAnswer, netguardAllowlist, sendToAiGuard, realNotConfiguredReason } from '../src/aiguard.js';

const envFile = (pairs) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cag-real-')), '.env');
  fs.writeFileSync(f, Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n'));
  return f;
};

test('jsonRpcUrl: the family rule (a URL not ending in jsonrpc or rpc gains /jsonrpc)', () => {
  assert.equal(jsonRpcUrl('https://gw.example:8623/agent/a2a'), 'https://gw.example:8623/agent/a2a/jsonrpc');
  assert.equal(jsonRpcUrl('https://gw.example:8623/agent/a2a/'), 'https://gw.example:8623/agent/a2a/jsonrpc');
  assert.equal(jsonRpcUrl('https://gw.example/rpc'), 'https://gw.example/rpc');
});

test('aiGuardConfig reads only the four real keys, from STANDALONE_ENV strictly', () => {
  const f = envFile({ CODING_AGENTS_LAB_AIGATEWAY_URL: 'https://gw.example/a2a', CODING_AGENTS_LAB_AIGATEWAY_BEARER: 'sk-orion-test', CODING_AGENTS_LAB_MODE: 'real' });
  const cfg = aiGuardConfig({ STANDALONE_ENV: f });
  assert.deepEqual({ configured: cfg.configured, host: cfg.host, url: cfg.url }, { configured: true, host: 'gw.example', url: 'https://gw.example/a2a' });
  assert.equal(cfg.bearer, 'sk-orion-test');
});

test('aiGuardConfig falls back to the central A2A keys, and to unconfigured without both', () => {
  const both = envFile({ CENTRAL_AGENT_A2A_URL: 'https://central.example/a2a', CENTRAL_AGENT_A2A_BEARER: 'k1' });
  assert.equal(aiGuardConfig({ STANDALONE_ENV: both }).configured, true);
  const urlOnly = envFile({ CENTRAL_AGENT_A2A_URL: 'https://central.example/a2a' });
  assert.deepEqual([aiGuardConfig({ STANDALONE_ENV: urlOnly }).configured, aiGuardConfig({ STANDALONE_ENV: urlOnly }).hasUrl], [false, true]);
  const none = envFile({});
  assert.equal(aiGuardConfig({ STANDALONE_ENV: none }).configured, false);
});

test('the allowlist is exactly the gateway hostname, empty when unconfigured', () => {
  const f = envFile({ CODING_AGENTS_LAB_AIGATEWAY_URL: 'https://gw.example:8623/a2a', CODING_AGENTS_LAB_AIGATEWAY_BEARER: 'k' });
  assert.deepEqual(netguardAllowlist({ STANDALONE_ENV: f }), ['gw.example']);
  const none = envFile({});
  assert.deepEqual(netguardAllowlist({ STANDALONE_ENV: none }), []);
});

test('eventText: one developer-voice text per kind, capped', () => {
  assert.equal(eventText({ kind: 'prompt', text: 'fix it' }), 'fix it');
  assert.ok(eventText({ kind: 'shell', command: 'ls -la' }).includes('ls -la'));
  assert.ok(eventText({ kind: 'file_read', path: '/w/.env' }).includes('/w/.env'));
  assert.ok(eventText({ kind: 'mcp_call', server: 's', tool: 't', args: { a: 1 } }).includes('s/t'));
  assert.ok(eventText({ kind: 'tool_result', server: 's', tool: 't', result: 'data' }).includes('data'));
  assert.equal(eventText({ kind: 'prompt', text: 'x'.repeat(5000) }).length, 4000);
});

const BLOCKED = { jsonrpc: '2.0', id: 'x', error: { code: -32600, message: 'request blocked by security policy' } };
const COMPLETED = (extra) => ({ jsonrpc: '2.0', id: 'x', result: { kind: 'task', id: 't', status: { state: 'completed' }, ...extra } });

test('mapGatewayAnswer: the measured shapes map to deny/allow', () => {
  const blocked = mapGatewayAnswer({ body: BLOCKED, status: 400 });
  assert.deepEqual({ decision: blocked.decision, reasonCode: blocked.reasonCode, measured: blocked.measured }, { decision: 'deny', reasonCode: 'DENY-AIGUARD-BLOCKED', measured: true });
  assert.equal(mapGatewayAnswer({ body: COMPLETED(), status: 200 }).decision, 'allow');
  const redacted = COMPLETED({ history: [{ role: 'user', parts: [{ kind: 'text', text: 'key is [REDACTED:data_exfiltration]' }] }] });
  assert.equal(mapGatewayAnswer({ body: redacted, status: 200 }).decision, 'deny');
  assert.equal(mapGatewayAnswer({ body: { jsonrpc: '2.0', id: 'x' }, status: 500 }), null);
});

test('sendToAiGuard: posts A2A message/send with the bearer, never in any returned field but the call config', async () => {
  const f = envFile({ CODING_AGENTS_LAB_AIGATEWAY_URL: 'https://gw.example/a2a', CODING_AGENTS_LAB_AIGATEWAY_BEARER: 'sk-orion-test' });
  const cfg = aiGuardConfig({ STANDALONE_ENV: f });
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { status: 200, text: async () => JSON.stringify(COMPLETED()) };
  };
  const r = await sendToAiGuard({ call: { kind: 'prompt', text: 'hello' }, cfg, fetchFn });
  assert.equal(seen[0].url, 'https://gw.example/a2a/jsonrpc');
  assert.equal(seen[0].headers.authorization, 'Bearer sk-orion-test');
  assert.equal(seen[0].body.method, 'message/send');
  assert.equal(r.mapped.decision, 'allow');
  assert.ok(!JSON.stringify(r).includes('sk-orion-test'), 'the bearer never appears in the result');
});

test('the bearer is write-only: realNotConfiguredReason names the keys, never a value', () => {
  assert.ok(realNotConfiguredReason().includes('CODING_AGENTS_LAB_AIGATEWAY_URL'));
  assert.ok(!/\bBearer\s+\S/.test(realNotConfiguredReason()));
});

// The leaks found by earlier sweeps, one test each, at the masker level AND through the HTTP endpoints, the audit and the follow-up state:
//   1. U+1680 (OGHAM SPACE MARK) inside a keyword   2. "login: bob / x"   3. "password - x"   4. four rounds of percent-encoding
//   5. /api/evaluate custom.text and /api/hook payload.prompt echoed in the audit   6. unknown or renamed keys inside payload.tool_input
//   7. /assets and /assets/ answered 200 HTML
// Credential-shaped values are built at run time (the scanners dislike literals).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { maskText } from '../src/mask.js';
import { summarize } from '../src/evaluation.js';

const V = ['hunter2', 'xyz'].join('');
const MARK = '[masked]';

function distDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-named-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}
async function withApp(fn) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile: '/nonexistent/customer.config.json', webDist: distDir() }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}
const post = async (url, p, body, ws) => { const r = await fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
const state = async (url, ws) => (await Promise.all(['/api/audit', '/api/gaps'].map(async (p) => (await fetch(`${url}${p}`, { headers: { 'x-workspace': ws } })).text()))).join('\n');

// Every way the sweeps type a text: as the visitor's own action (all five kinds), as a hook prompt, command, file path, tool result, certificate subject.
async function typeEverywhere(url, ws, text) {
  const answers = [];
  for (const kind of ['prompt', 'shell', 'file_read', 'mcp_call', 'tool_result']) answers.push((await post(url, '/api/evaluate', { mode: 'live', agent: 'claude-code', custom: { kind, text } }, ws)).text);
  answers.push((await post(url, '/api/hook', { agent: 'claude-code', payload: { hook_event_name: 'UserPromptSubmit', prompt: text } }, ws)).text);
  answers.push((await post(url, '/api/hook', { agent: 'claude-code', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: text } } }, ws)).text);
  answers.push((await post(url, '/api/hook', { agent: 'claude-code', payload: { hook_event_name: 'PostToolUse', tool_name: 'mcp__srv__tool', tool_input: {}, tool_response: text } }, ws)).text);
  answers.push((await post(url, '/api/hook', { agent: 'claude-code', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, certSubject: `CN=${text}` }, ws)).text);
  answers.push(await state(url, ws));
  return answers.join('\n');
}

test('1. U+1680 inside a keyword, before the value and in "pass<U+1680>word": masked as text, in every endpoint and in the audit', async () => {
  for (const t of [`pass word=${V}`, `password ${V}`, `pas sword: ${V}`, `my pass word is ${V}`, `to ken ${V}`]) {
    assert.ok(!maskText(t).includes(V), JSON.stringify(t));
    assert.match(maskText(t), /\[masked\]/);
  }
  await withApp(async (url) => {
    const all = await typeEverywhere(url, 'w-named-1680', `pass word=${V}`);
    assert.ok(!all.includes(V)); assert.ok(all.includes(MARK));
  });
});

test('2. "login: bob / X" and "login bob / X": the value after the user name is masked; a one-character value is not a secret and stays', async () => {
  for (const t of [`login: bob / ${V}`, `login bob / ${V}`, `Login: alice/${V}`, `login: bob / ${V} ok`]) assert.ok(!maskText(t).includes(V), JSON.stringify(t));
  assert.equal(maskText('login: bob / x'), 'login: bob / x', 'documented: a value of one character is not taken for a secret');
  await withApp(async (url) => { assert.ok(!(await typeEverywhere(url, 'w-named-login', `login: bob / ${V}`)).includes(V)); });
});

test('3. "password - X" (a dash between the keyword and the value): masked', async () => {
  for (const t of [`password - ${V}`, `password – ${V}`, `password — ${V}`, `pw - ${V}`, `password -${V}`, `the password - ${V} is rotated`]) assert.ok(!maskText(t).includes(V), JSON.stringify(t));
  assert.equal(maskText('password - x'), 'password - x', 'documented: a value of one character is not taken for a secret');
  await withApp(async (url) => { assert.ok(!(await typeEverywhere(url, 'w-named-dash', `password - ${V}`)).includes(V)); });
});

test('4. four rounds of percent-encoding (and five, six) hide nothing', async () => {
  const enc4 = (s) => { let e = s; for (let i = 0; i < 4; i += 1) e = encodeURIComponent(e); return e; };
  for (const plain of [`password=${V}`, `password: ${V}`, `Authorization: Bearer ${V}`, `my password is ${V}`, `token ${V}`]) {
    const four = enc4(plain);
    assert.ok(!maskText(four).includes(V), four);
    assert.ok(!maskText(encodeURIComponent(four)).includes(V), '5 rounds');
    assert.ok(!maskText(encodeURIComponent(encodeURIComponent(four))).includes(V), '6 rounds');
  }
  await withApp(async (url) => { assert.ok(!(await typeEverywhere(url, 'w-named-enc', enc4(`password=${V}`))).includes(V)); });
});

test('5. /api/evaluate custom.text and /api/hook payload.prompt are not echoed in the audit, the gaps or any later read', async () => {
  await withApp(async (url) => {
    const ws = 'w-named-audit';
    const own = await post(url, '/api/evaluate', { mode: 'live', agent: 'claude-code', custom: { kind: 'prompt', text: `use password=${V} now` } }, ws);
    const hook = await post(url, '/api/hook', { agent: 'claude-code', payload: { hook_event_name: 'UserPromptSubmit', prompt: `use password=${V} now` } }, ws);
    const down = await post(url, '/api/evaluate', { mode: 'live', agent: 'cursor', custom: { kind: 'prompt', text: `use password=${V} now` }, down: true }, ws);
    assert.deepEqual([own.status, hook.status, down.status], [200, 200, 200]);
    const read = await state(url, ws);
    assert.ok(!read.includes(V) && !(own.text + hook.text + down.text).includes(V));
    const audit = JSON.parse(await (await fetch(`${url}/api/audit`, { headers: { 'x-workspace': ws } })).text()).audit;
    assert.ok(audit.length >= 2, `${audit.length} audit entries`);
    assert.ok(audit.every((a) => a.summary === 'use [masked] now'), JSON.stringify(audit.map((a) => a.summary)));
  });
});

test('6. unknown and renamed keys inside payload.tool_input: no value reaches the answer, the audit or the summary (names and types only)', async () => {
  const input = { renamed_field: V, 'x-api-k': V, auth_blob: V, whatever: { deeper: V }, list: [V] };
  assert.equal(summarize({ kind: 'mcp_call', server: 'srv', tool: 'tool', args: input }), 'srv/tool {renamed_field: text(10), x-api-k: text(10), auth_blob: text(10), whatever: object, list: list(1)}');
  // documented limit: the NAMES of the arguments are shown (masked by shape), so a secret typed as a bare argument NAME is not found
  assert.equal(summarize({ kind: 'mcp_call', server: 'srv', tool: 'tool', args: { [`password=${V}`]: 1 } }), `srv/tool {${MARK}: number}`);
  await withApp(async (url) => {
    const ws = 'w-named-toolinput';
    const r = await post(url, '/api/hook', { agent: 'claude-code', payload: { hook_event_name: 'PreToolUse', tool_name: 'mcp__srv__tool', tool_input: input } }, ws);
    assert.equal(r.status, 200); assert.ok(!r.text.includes(V));
    const read = await state(url, ws);
    assert.ok(!read.includes(V)); assert.match(read, /renamed_field: text\(10\)/);
    const own = await post(url, '/api/evaluate', { mode: 'live', agent: 'claude-code', custom: { kind: 'mcp_call', text: `srv tool ${V}` } }, ws);
    assert.equal(own.status, 200);
    // the audit and the gaps hold names and types only; the answer to the visitor's OWN action shows the typed arguments, masked by shape (a bare word with no
    // keyword and no key is not found: documented limit)
    assert.ok(!(await state(url, ws)).includes(V));
  });
});

test('7. /assets and /assets/ are JSON 404s, never 200 HTML (a built page is present), and a real asset is still served', async () => {
  await withApp(async (url) => {
    for (const p of ['/assets', '/assets/', '/assets/missing.js']) {
      for (const accept of ['text/html', '*/*', undefined]) {
        const r = await fetch(`${url}${p}`, { headers: accept ? { accept } : {} });
        assert.equal(r.status, 404, `${p} ${accept}`); assert.match(r.headers.get('content-type'), /application\/json/); assert.deepEqual(await r.json(), { error: 'not_found' });
      }
    }
    assert.equal((await fetch(`${url}/assets/app.js`)).status, 200);
  });
});

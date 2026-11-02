// The masking sweep: credential-shaped text is typed into EVERY free-text field, key name, path segment, query, header and error-path input
// of every endpoint, against a REAL server process (so stdout and stderr can be read too). Two probe secrets must be absent from every answer,
// from the state read back afterwards (audit, gaps) and from the server's own stdout and stderr.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(HERE, '../src/index.js');
const SECRETS = ['hunter2xyz', 'abcdefghijklmnop1234'];

// The payload classes. A: controls interleaved; B: keyword and plain space; C: URL userinfo; D: JSON-quoted assignment; E: prefixed keys.
const PAYLOADS = [
  'p\u0001a\u0001s\u0001s\u0001w\u0001o\u0001r\u0001d: hunter2xyz', 'pass\u0000word=hunter2xyz', 'pass\u0085word=hunter2xyz', 'pass\u007fword=hunter2xyz', 'my pa\u0000ss\u0000word is hunter2xyz',
  'tok\u0001en hunter2xyz', 'Bea\u0001rer hunter2xyz', 's\u0001k-abcdefghijklmnop1234',
  'password hunter2xyz', 'pw hunter2xyz', 'token hunter2xyz', 'secret hunter2xyz', 'api key hunter2xyz', 'the key is hunter2xyz', 'my password is hunter2xyz',
  'bob:hunter2xyz@host.example', '//bob:hunter2xyz@host.example', 'https://bob:hunter2xyz@host.example/x',
  '{"password":"hunter2xyz"}', 'password=hunter2xyz', 'Authorization: Bearer hunter2xyz', 'sk-abcdefghijklmnop1234', 'pass\tword=hunter2xyz', 'password%3Dhunter2xyz',
];

let child; let base; let port; const output = []; const everything = [];

async function freePort() {
  for (let p = 7199; p >= 7170; p -= 1) {
    const ok = await new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(true))); });
    if (ok) return p;
  }
  throw new Error('no spare port in 7170-7199');
}

before(async () => {
  port = await freePort();
  child = spawn(process.execPath, [INDEX], { env: { ...process.env, PORT: String(port), STANDALONE_ENV: '/nonexistent/none.env' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => output.push(String(c))); child.stderr.on('data', (c) => output.push(String(c)));
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`server did not start: ${output.join('')}`);
});
after(async () => { if (child) { child.kill('SIGKILL'); await new Promise((r) => child.once('close', r)); } });

const leaks = (s) => SECRETS.filter((x) => s.includes(x));

// One request; asserts no probe secret in the answer (status line, headers and body) and returns the parsed result.
async function hit(label, method, p, { body, headers = {}, raw } = {}) {
  const res = await fetch(`${base}${p}`, { method, headers: { origin: base, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  const head = `${res.status} ${res.statusText} ${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  everything.push(text);
  assert.deepEqual(leaks(`${head}\n${text}`), [], `${label}: ${method} ${p.slice(0, 40)} -> ${res.status} ${text.slice(0, 160)}`);
  let json = null; try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, text, json, res };
}
const evaluate = (label, body, headers) => hit(label, 'POST', '/api/evaluate', { body, headers });

test('sweep: every free-text field of /api/evaluate, in Live, for every kind (call, summary, hook request, dialog, hops)', async () => {
  for (const p of PAYLOADS) {
    for (const kind of ['prompt', 'shell', 'file_read', 'mcp_call', 'tool_result']) {
      const { status, json } = await evaluate(`custom ${kind}`, { mode: 'live', agent: 'claude-code', custom: { kind, text: p } });
      assert.equal(status, 200, `${kind} ${JSON.stringify(p)}`);
      const shown = JSON.stringify([json.call, json.hookRequest, json.dialog, json.hops, json.evaluation, json.native]);
      assert.ok(shown.includes('[masked]') || /\[masked/.test(shown) || p.length < 3, `${kind} ${JSON.stringify(p)} shows no mask at all: ${shown.slice(0, 200)}`);
    }
    await evaluate('custom down', { mode: 'live', agent: 'cursor', custom: { kind: 'prompt', text: p }, down: true });
    await evaluate('custom mock refused', { mode: 'mock', agent: 'cursor', custom: { kind: 'prompt', text: p } });
  }
}, { timeout: 280_000 });

test('sweep: the call text, summary, hook request, dialog and every hop pane show the MASKED text for the exact repros', async () => {
  const { json: r } = await evaluate('repro', { mode: 'live', agent: 'claude-code', custom: { kind: 'prompt', text: 'my password is hunter2xyz' } });
  // CHANGED (shared masker): the keyword is masked together with its value.
  assert.equal(r.call.text, 'my [masked]');
  assert.equal(r.call.summary, 'my [masked]');
  assert.equal(r.hookRequest.prompt, 'my [masked]');
  assert.ok(r.dialog.action.endsWith('my [masked]'));
  assert.ok(r.hops[0].request.includes('my [masked]'));
  const { json: m } = await evaluate('repro mcp', { mode: 'live', agent: 'claude-code', custom: { kind: 'mcp_call', text: 'password hunter2xyz' } });
  assert.equal(m.call.server, '[masked]', 'CHANGED: the whole "password hunter2xyz" pair is masked, so the server name is the mark');
  assert.equal(m.call.tool, 'run');
});

test('sweep: config values and key names in /api/evaluate and /api/config (errors, field names, echoed config, generated text)', async () => {
  const sc = { mode: 'mock', agent: 'claude-code', scenario: 'destructive-shell' };
  for (const p of PAYLOADS) {
    const url = `https://tunnel.example/?q=${encodeURIComponent(p)}`;
    const configs = [
      { Enabled: true, Gateways: [p] }, { Enabled: true, Gateways: [url] }, { Enabled: true, Agents: { [p]: true } }, { [p]: 1 }, { Enabled: true, Agents: { 'claude-code': p } },
      { Enabled: true, Behaviour: { [p]: p } }, { Enabled: true, AIGuard: { a: [p, { [p]: p }] } }, { Enabled: true, AIIntent: { [p]: [p] } }, { Enabled: p }, { FailClosed: p }, p, [p], { Gateways: p },
    ];
    for (const config of configs) {
      await evaluate('evaluate config', { ...sc, config });
      await evaluate('evaluate config live', { mode: 'live', agent: 'claude-code', custom: { kind: 'prompt', text: 'x' }, config: { Enabled: true, Gateways: [p], Agents: { [p]: true }, [p]: 1 } }).then((r) => assert.equal(r.status, 400));
      const { json } = await hit('config', 'POST', '/api/config', { body: { config } });
      assert.ok(json, 'config answers JSON');
    }
    await hit('config body not object', 'POST', '/api/config', { body: [p] });
    await hit('config root key', 'POST', '/api/config', { body: { [p]: p, config: { Enabled: true } } });
  }
});

test('sweep: the other body fields and the query, header and cookie inputs of every endpoint', async () => {
  for (const p of PAYLOADS) {
    const q = encodeURIComponent(p);
    const hdr = (v) => v.replace(/[^\x20-\x7e]/g, ''); // header values cannot carry controls; the rest is still sent
    await evaluate('scenario', { mode: 'mock', agent: 'cursor', scenario: p });
    await evaluate('agent', { mode: 'mock', agent: p, scenario: 'destructive-shell' });
    await evaluate('mode', { mode: p, agent: 'cursor', scenario: 'destructive-shell' });
    await evaluate('vertical', { mode: 'mock', agent: 'cursor', scenario: 'destructive-shell', vertical: p });
    await evaluate('down', { mode: 'mock', agent: 'cursor', scenario: 'destructive-shell', down: p });
    await evaluate('custom kind', { mode: 'live', agent: 'cursor', custom: { kind: p, text: 'x' } });
    await evaluate('custom not object', { mode: 'live', agent: 'cursor', custom: p });
    await evaluate('custom text type', { mode: 'live', agent: 'cursor', custom: { kind: 'prompt', text: [p] } });
    await evaluate('extra keys', { mode: 'mock', agent: 'cursor', scenario: 'destructive-shell', [p]: p, custom: { kind: 'prompt', text: 'x', [p]: p } });
    await evaluate('body array', [p]);
    await evaluate('body string', p);
    await hit('invalid json', 'POST', '/api/evaluate', { raw: `{"a": "${p.replace(/["\\\u0000-\u001f]/g, '')}` , headers: { 'content-type': 'application/json' } });
    await hit('text body', 'POST', '/api/evaluate', { raw: p, headers: { 'content-type': 'text/plain' } });
    await hit('form body', 'POST', '/api/evaluate', { raw: `a=${q}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    for (const [pathPart, method] of [['story', 'GET'], ['diagram', 'GET'], ['sources', 'GET'], ['info', 'GET'], ['audit', 'GET'], ['gaps', 'GET'], ['health', 'GET']]) {
      await hit('query', method, `/api/${pathPart}?vertical=${q}&name=${q}&x=${q}&${q}=${q}`);
      await hit('vertical header', method, `/api/${pathPart}`, { headers: { 'x-lab-vertical': hdr(p) } });
      await hit('workspace header', method, `/api/${pathPart}`, { headers: { 'x-workspace': hdr(p) } });
    }
    await hit('headers', 'GET', '/api/story', { headers: { traceparent: hdr(p), referer: hdr(p), cookie: hdr(p), authorization: hdr(p), 'x-forwarded-for': hdr(p), 'user-agent': hdr(p) } });
    await hit('traceparent evaluate', 'POST', '/api/evaluate', { body: { mode: 'mock', agent: 'cursor', scenario: 'destructive-shell' }, headers: { traceparent: hdr(p), 'x-workspace': hdr(p) } });
    await hit('bad host', 'GET', '/api/story', { headers: { host: `${hdr(p).replace(/\s/g, '')}.invalid` } }).catch(() => null);
    await hit('cross origin', 'POST', '/api/evaluate', { body: {}, headers: { origin: `https://${hdr(p).replace(/[^a-z0-9.@:-]/gi, '')}.example`, 'sec-fetch-site': 'cross-site' } });
    await hit('reset', 'POST', '/api/reset', { body: {}, headers: { 'x-workspace': hdr(p) } });
  }
});

test('sweep: path segments and methods outside and inside /api: always short JSON, never an echo', async () => {
  for (const p of PAYLOADS) {
    const seg = encodeURIComponent(p);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      for (const where of [`/${seg}`, `/api/${seg}`, `/assets/${seg}.js`, `/api/audit/${seg}`, `/api/evaluate/${seg}`, `/${seg}/${seg}`, `/api/story/${seg}`, `/api/health/${seg}`, `/.${seg}`]) {
        const r = await hit('path', method, where, { body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : { a: p } });
        // With a built page, a GET of an extension-less path outside /api is the static app shell (200 HTML, it echoes nothing); otherwise a 4xx JSON answer.
        const segs = decodeURIComponent(where).split('/');
        const shell = r.status === 200 && (method === 'GET' || method === 'HEAD') && !/^\/api(\/|$)/.test(where) && !segs.at(-1).includes('.') && !segs.some((x) => x.startsWith('.'));
        assert.ok(r.status >= 400 || shell, `${method} ${where.slice(0, 30)} -> ${r.status}`);
        if (method !== 'HEAD' && !shell) assert.match(r.res.headers.get('content-type') || '', /application\/json/, `${method} ${where.slice(0, 30)} answers JSON`);
      }
    }
    await hit('bad escape', 'GET', `/%E0%A4%A${seg}`);
    await hit('bad escape api', 'POST', `/api/%E0%A4%A${seg}`, { body: {} });
  }
});

test('sweep: /api/hook, every field the endpoint reads, then the audit and gaps read back', async () => {
  const ws = 'w-sweep-hook';
  for (const p of PAYLOADS) {
    const events = [
      { hook_event_name: 'UserPromptSubmit', prompt: p },
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: p } },
      { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: p } },
      { hook_event_name: 'PreToolUse', tool_name: `mcp__${p}__tool`, tool_input: { [p]: p, nested: [p] } },
      { hook_event_name: 'PreToolUse', tool_name: 'mcp__srv__tool', tool_input: { [p]: p } },
      { hook_event_name: 'PostToolUse', tool_name: 'mcp__srv__tool', tool_input: {}, tool_response: p },
      { hook_event_name: 'PostToolUse', tool_name: 'mcp__srv__tool', tool_input: {}, tool_response: { content: [{ type: 'text', text: p }] } },
      { hook_event_name: p, prompt: p }, { hook_event_name: 'UserPromptSubmit', prompt: { [p]: p } }, { [p]: p },
    ];
    for (const payload of events) {
      for (const certSubject of [undefined, `CN=${p}`, `CN=maya.chen@fabrikam.example,OU=device:${p},O=Lab`, p, `CN=${p},OU=device:${p}`]) {
        const { status } = await hit('hook', 'POST', '/api/hook', { body: { agent: 'claude-code', payload, certSubject, extra: p }, headers: { 'x-workspace': ws } });
        assert.ok(status === 200 || status === 400, `hook status ${status}`);
      }
    }
    for (const agent of [p, 'cursor', 'codex', 'copilot']) await hit('hook agent', 'POST', '/api/hook', { body: { agent, payload: { prompt: p, hook_event_name: 'UserPromptSubmit', hookEventName: 'beforeSubmitPrompt' }, certSubject: p }, headers: { 'x-workspace': ws } });
    await hit('hook not object', 'POST', '/api/hook', { body: [p], headers: { 'x-workspace': ws } });
    await hit('hook cert too long', 'POST', '/api/hook', { body: { agent: 'claude-code', certSubject: `CN=${p}${'x'.repeat(400)}`, payload: events[0] }, headers: { 'x-workspace': ws } });
    // the state read back
    for (const where of ['/api/audit', '/api/gaps']) await hit('read back', 'GET', where, { headers: { 'x-workspace': ws } });
  }
  const audit = (await hit('audit', 'GET', '/api/audit', { headers: { 'x-workspace': ws } })).json;
  assert.ok(audit.audit.length > 0, 'the hook did record audit entries (the sweep is not vacuous)');
  assert.ok(audit.audit.some((a) => /\[masked\]/.test(a.summary)), 'and the summaries show the mask');
  for (const w of ['default', 'w-sweep-eval']) for (const where of ['/api/audit', '/api/gaps']) await hit('read back', 'GET', where, { headers: { 'x-workspace': w } });
});

test('sweep: the server printed nothing that carries a probe secret (stdout and stderr), and the live and mock answers were not empty', () => {
  const printed = output.join('');
  assert.deepEqual(leaks(printed), [], `server output: ${printed.slice(0, 300)}`);
  assert.ok(everything.length > 3000, `${everything.length} answers were checked`);
});

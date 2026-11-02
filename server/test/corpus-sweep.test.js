// The CORPUS sweep: the shared corpus (test/corpus/leaks.json, 3754 probes, copied unchanged from shared-masker 1.4.0) typed into every free-text field, key,
// path segment, query, header and error-path input of every endpoint, against a REAL server process (so stdout and stderr can be read too).
// Every probe goes to two slots (round robin) and the first probe of every family goes to every slot, so each slot sees a spread of every family. The five
// Live slots plus Live "down" (a real hook script is spawned per request) see every 20th probe. The 338 structured probes go to 8 structured slots.
// The probe secret must be absent from every answer (status line, headers, body), from the state read back afterwards and from stdout and stderr.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(HERE, '../src/index.js');

let child; let base; const output = []; const everything = [];
async function freePort() {
  for (let p = 7169; p >= 7160; p -= 1) { // 7170-7199 belong to sweep.test.js, which runs in parallel
    const ok = await new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(true))); });
    if (ok) return p;
  }
  throw new Error('no spare port in 7160-7169');
}
before(async () => {
  const port = await freePort();
  child = spawn(process.execPath, [INDEX], { env: { ...process.env, PORT: String(port), STANDALONE_ENV: '/nonexistent/none.env' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => output.push(String(c))); child.stderr.on('data', (c) => output.push(String(c)));
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`server did not start: ${output.join('')}`);
});
after(async () => { if (child) { child.kill('SIGKILL'); await new Promise((r) => child.once('close', r)); } });

const joinF = (a) => a.join('');
const expandRow = (r) => `${r.fillBefore ? `${'a'.repeat(r.fillBefore)} ` : ''}${joinF(r.input)}${r.fillAfter ? ` ${'a'.repeat(r.fillAfter)}` : ''}`;
const corpusRows = JSON.parse(readFileSync(path.join(HERE, 'corpus/leaks.json'), 'utf8')).map((r) => ({ id: r.id, family: r.family, deep: r.api === 'deep', input: expandRow(r), secret: joinF(r.secret) }));
const CORPUS_SECRETS = new Set();
const sweepFailures = [];
const CW = 'w-corpus-sweep'; const CH = 'w-corpus-hook';
// encodeURIComponent throws on a lone surrogate; a URL cannot carry one anyway, so the URL slots get the well-formed text
const enc = (v) => encodeURIComponent(v.toWellFormed());
const hdr = (v) => v.replace(/[^\x20-\x7e]/g, '');

async function probe(slot, row, method, p, { body, headers = {}, raw } = {}) {
  let res; let text;
  try { res = await fetch(`${base}${p}`, { method, headers: { origin: base, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }); text = await res.text(); } catch { return null; }
  everything.push(text);
  CORPUS_SECRETS.add(row.secret);
  const hay = `${res.status} ${res.statusText} ${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${text}`;
  if (hay.includes(row.secret)) sweepFailures.push(`${slot} ${row.id} ${row.family}: ${method} ${p.slice(0, 30)} -> ${res.status}`);
  return res.status;
}

const evalAt = (slot, body, headers = {}) => (row) => probe(slot, row, 'POST', '/api/evaluate', { body: body(row.input), headers: { 'x-workspace': CW, ...headers } });
const hookAt = (slot, make, extra = {}) => (row) => probe(slot, row, 'POST', '/api/hook', { body: { agent: 'claude-code', payload: make(row.input), ...(extra.cert ? { certSubject: extra.cert(row.input) } : {}), ...(extra.body ? extra.body(row.input) : {}) }, headers: { 'x-workspace': CH } });
const cfgAt = (slot, make) => (row) => probe(slot, row, 'POST', '/api/config', { body: { config: make(row.input) } });
const getAt = (slot, make, headers) => (row) => probe(slot, row, 'GET', make(row.input, enc(row.input)), { headers: headers ? headers(row.input) : {} });
const scMock = { mode: 'mock', agent: 'cursor', scenario: 'destructive-shell' };
const hi = () => ({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
const TEXT_SLOTS = [
  evalAt('eval scenario', (p) => ({ mode: 'mock', agent: 'cursor', scenario: p })), evalAt('eval agent', (p) => ({ mode: 'mock', agent: p, scenario: 'destructive-shell' })),
  evalAt('eval mode', (p) => ({ ...scMock, mode: p })), evalAt('eval vertical', (p) => ({ ...scMock, vertical: p })), evalAt('eval down', (p) => ({ ...scMock, down: p })),
  evalAt('eval custom kind', (p) => ({ mode: 'live', agent: 'cursor', custom: { kind: p, text: 'x' } })), evalAt('eval custom not object', (p) => ({ mode: 'live', agent: 'cursor', custom: p })),
  evalAt('eval custom text type', (p) => ({ mode: 'live', agent: 'cursor', custom: { kind: 'prompt', text: [p] } })), evalAt('eval custom mock refused', (p) => ({ mode: 'mock', agent: 'cursor', custom: { kind: 'prompt', text: p } })),
  evalAt('eval extra keys', (p) => ({ ...scMock, [p]: p, custom: { kind: 'prompt', text: 'x', [p]: p } })), evalAt('eval body array', (p) => [p]), evalAt('eval body string', (p) => p),
  evalAt('eval config Gateways', (p) => ({ ...scMock, config: { Enabled: true, Gateways: [p] } })), evalAt('eval config Agents key', (p) => ({ ...scMock, config: { Enabled: true, Agents: { [p]: true } } })),
  evalAt('eval config Agents value', (p) => ({ ...scMock, config: { Enabled: true, Agents: { 'claude-code': p } } })), evalAt('eval config Behaviour', (p) => ({ ...scMock, config: { Enabled: true, Behaviour: { [p]: p } } })),
  evalAt('eval config AIGuard', (p) => ({ ...scMock, config: { Enabled: true, AIGuard: { a: [p, { [p]: p }] } } })), evalAt('eval config Enabled', (p) => ({ ...scMock, config: { Enabled: p } })),
  evalAt('eval config root key', (p) => ({ ...scMock, config: { [p]: 1 } })), evalAt('eval config string', (p) => ({ ...scMock, config: p })),
  cfgAt('config Gateways', (p) => ({ Enabled: true, Gateways: [p] })), cfgAt('config Gateways url', (p) => ({ Enabled: true, Gateways: [`https://tunnel.example/?q=${enc(p)}`] })), cfgAt('config Agents key', (p) => ({ Enabled: true, Agents: { [p]: true } })),
  cfgAt('config Behaviour', (p) => ({ Enabled: true, Behaviour: { [p]: [p] } })), cfgAt('config AIIntent', (p) => ({ Enabled: true, AIIntent: { [p]: [p] } })), cfgAt('config FailClosed', (p) => ({ FailClosed: p })), cfgAt('config root key', (p) => ({ [p]: 1 })),
  (row) => probe('config body array', row, 'POST', '/api/config', { body: [row.input] }), (row) => probe('config root key outside', row, 'POST', '/api/config', { body: { [row.input]: row.input, config: { Enabled: true } } }),
  (row) => probe('invalid json', row, 'POST', '/api/evaluate', { raw: `{"a": "${row.input.replace(/["\\\u0000-\u001f]/g, '')}`, headers: { 'content-type': 'application/json' } }),
  (row) => probe('text body', row, 'POST', '/api/evaluate', { raw: row.input, headers: { 'content-type': 'text/plain' } }),
  (row) => probe('form body', row, 'POST', '/api/evaluate', { raw: `a=${enc(row.input)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
  (row) => probe('charset', row, 'POST', '/api/evaluate', { raw: '{}', headers: { 'content-type': `application/json; charset=${hdr(row.input)}` } }),
  hookAt('hook prompt', (p) => ({ hook_event_name: 'UserPromptSubmit', prompt: p })), hookAt('hook command', (p) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: p } })),
  hookAt('hook file_path', (p) => ({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: p } })), hookAt('hook mcp server name', (p) => ({ hook_event_name: 'PreToolUse', tool_name: `mcp__${p}__tool`, tool_input: {} })),
  hookAt('hook tool_input key, value and renamed key', (p) => ({ hook_event_name: 'PreToolUse', tool_name: 'mcp__srv__tool', tool_input: { [p]: p, nested: [p], renamed_field: p } })), hookAt('hook tool_response string', (p) => ({ hook_event_name: 'PostToolUse', tool_name: 'mcp__srv__tool', tool_input: {}, tool_response: p })),
  hookAt('hook tool_response content', (p) => ({ hook_event_name: 'PostToolUse', tool_name: 'mcp__srv__tool', tool_input: {}, tool_response: { content: [{ type: 'text', text: p }] } })), hookAt('hook event name', (p) => ({ hook_event_name: p, prompt: p })),
  hookAt('hook prompt object', (p) => ({ hook_event_name: 'UserPromptSubmit', prompt: { [p]: p } })), hookAt('hook payload key', (p) => ({ [p]: p })),
  hookAt('hook certSubject CN', hi, { cert: (p) => `CN=${p}` }), hookAt('hook certSubject OU', hi, { cert: (p) => `CN=maya.chen@fabrikam.example,OU=device:${p},O=Lab` }),
  hookAt('hook certSubject whole', hi, { cert: (p) => p }), hookAt('hook extra key', hi, { body: (p) => ({ [p]: p, extra: p }) }),
  (row) => probe('hook agent', row, 'POST', '/api/hook', { body: { agent: row.input, payload: { prompt: row.input } }, headers: { 'x-workspace': CH } }),
  (row) => probe('hook body array', row, 'POST', '/api/hook', { body: [row.input], headers: { 'x-workspace': CH } }),
  getAt('story query', (p, q) => `/api/story?vertical=${q}&name=${q}&x=${q}&${q}=${q}`), getAt('diagram query', (p, q) => `/api/diagram?name=${q}&vertical=${q}`), getAt('audit query', (p, q) => `/api/audit?x=${q}&${q}=${q}`, () => ({ 'x-workspace': CW })),
  getAt('gaps query', (p, q) => `/api/gaps?x=${q}`, () => ({ 'x-workspace': CW })), getAt('info query', (p, q) => `/api/info?x=${q}`), getAt('sources query', (p, q) => `/api/sources?x=${q}`), getAt('health query', (p, q) => `/api/health?x=${q}`),
  getAt('header x-lab-vertical', () => '/api/story', (p) => ({ 'x-lab-vertical': hdr(p) })), getAt('header x-workspace story', () => '/api/story', (p) => ({ 'x-workspace': hdr(p) })), getAt('header x-workspace audit', () => '/api/audit', (p) => ({ 'x-workspace': hdr(p) })),
  getAt('header traceparent', () => '/api/story', (p) => ({ traceparent: hdr(p) })), getAt('header referer cookie authorization', () => '/api/story', (p) => ({ referer: hdr(p), cookie: hdr(p), authorization: hdr(p) })),
  getAt('header user-agent forwarded', () => '/api/story', (p) => ({ 'user-agent': hdr(p), 'x-forwarded-for': hdr(p) })), getAt('header origin', () => '/api/story', (p) => ({ origin: `https://${hdr(p).replace(/[^a-z0-9.@:-]/gi, '')}.example` })),
  (row) => probe('traceparent evaluate', row, 'POST', '/api/evaluate', { body: scMock, headers: { traceparent: hdr(row.input), 'x-workspace': CW } }),
  (row) => probe('reset workspace', row, 'POST', '/api/reset', { body: {}, headers: { 'x-workspace': hdr(row.input) } }),
  getAt('path 1', (p, q) => `/${q}`), getAt('path api', (p, q) => `/api/${q}`), getAt('path assets', (p, q) => `/assets/${q}.js`), getAt('path audit sub', (p, q) => `/api/audit/${q}`), getAt('path twice', (p, q) => `/${q}/${q}`), getAt('path dot', (p, q) => `/.${q}`), getAt('path bad escape', (p, q) => `/%E0%A4%A${q}`),
  (row) => probe('path PUT', row, 'PUT', `/api/evaluate/${enc(row.input)}`, { body: { a: row.input } }), (row) => probe('path DELETE', row, 'DELETE', `/${enc(row.input)}`, { body: { a: row.input } }),
  (row) => probe('path POST', row, 'POST', `/api/${enc(row.input)}`, { body: { a: row.input } }), (row) => probe('path OPTIONS', row, 'OPTIONS', `/${enc(row.input)}`), (row) => probe('path HEAD', row, 'HEAD', `/api/audit/${enc(row.input)}`),
];
const LIVE_SLOTS = ['prompt', 'shell', 'file_read', 'mcp_call', 'tool_result'].map((kind) => evalAt(`eval live ${kind}`, (p) => ({ mode: 'live', agent: 'claude-code', custom: { kind, text: p } })))
  .concat([evalAt('eval live down', (p) => ({ mode: 'live', agent: 'cursor', custom: { kind: 'prompt', text: p }, down: true }))]);
const deepAt = (slot, make, pathName = '/api/hook') => (row, value) => probe(slot, row, 'POST', pathName, { body: make(value), headers: { 'x-workspace': CH } });
const DEEP_SLOTS = [
  deepAt('deep hook tool_input', (v) => ({ agent: 'claude-code', payload: { hook_event_name: 'PreToolUse', tool_name: 'mcp__srv__tool', tool_input: v } })), deepAt('deep hook tool_response', (v) => ({ agent: 'claude-code', payload: { hook_event_name: 'PostToolUse', tool_name: 'mcp__srv__tool', tool_input: {}, tool_response: v } })),
  deepAt('deep hook payload', (v) => ({ agent: 'claude-code', payload: v })), deepAt('deep hook extra', (v) => ({ agent: 'claude-code', payload: hi(), extra: v })),
  deepAt('deep config', (v) => ({ config: v }), '/api/config'), deepAt('deep evaluate config', (v) => ({ ...scMock, config: v }), '/api/evaluate'), deepAt('deep evaluate extra', (v) => ({ ...scMock, extra: v }), '/api/evaluate'), deepAt('deep config root', (v) => v, '/api/config'),
];

test('corpus sweep: the shared corpus typed into every free-text field, key, path, query, header and error-path input; no probe secret is in any answer', async () => {
  const baseline = (await Promise.all(['/api/story', '/api/sources', '/api/info', '/api/health', '/nope'].map(async (p) => (await fetch(`${base}${p}`)).text()))).join('\n');
  const usable = (r) => r.secret.length >= 8 && !baseline.includes(r.secret) && (r.deep ? r.input.length <= 6000 : r.input.length <= 2000);
  const text = corpusRows.filter((r) => !r.deep && usable(r));
  const deep = corpusRows.filter((r) => r.deep && usable(r));
  assert.ok(text.length >= 3000, `${text.length} usable text probes`); assert.ok(deep.length >= 300, `${deep.length} usable structured probes`);
  const firstOfFamily = new Map(); for (const r of text) if (!firstOfFamily.has(r.family)) firstOfFamily.set(r.family, r);
  let requests = 0;
  for (let k = 0; k < TEXT_SLOTS.length; k += 1) {
    const mine = new Set(text.filter((_, i) => i % TEXT_SLOTS.length === k || (i + 17) % TEXT_SLOTS.length === k));
    for (const r of firstOfFamily.values()) mine.add(r);
    for (const r of mine) { await TEXT_SLOTS[k](r); requests += 1; }
  }
  for (let k = 0; k < LIVE_SLOTS.length; k += 1) for (let i = k; i < text.length; i += 20) { await LIVE_SLOTS[k](text[i]); requests += 1; }
  for (let k = 0; k < DEEP_SLOTS.length; k += 1) for (const r of deep) { await DEEP_SLOTS[k](r, JSON.parse(r.input)); requests += 1; }
  assert.deepEqual(sweepFailures, [], `${sweepFailures.length} leaks in ${requests} requests:\n${sweepFailures.slice(0, 25).join('\n')}`);
  assert.ok(requests > 9000, `${requests} requests were made`);
  assert.ok(TEXT_SLOTS.length >= 70, `${TEXT_SLOTS.length} text slots`);
}, { timeout: 1_800_000 });

test('corpus sweep: the state read back (audit and gaps of every workspace used) carries no probe secret', async () => {
  assert.ok(CORPUS_SECRETS.size > 150, `${CORPUS_SECRETS.size} distinct secrets were used (most probes share a few secret strings)`);
  let checked = 0;
  for (const w of [CW, CH, 'default']) for (const where of ['/api/audit', '/api/gaps']) {
    const t = await (await fetch(`${base}${where}`, { headers: { 'x-workspace': w } })).text();
    checked += t.length;
    const found = [...CORPUS_SECRETS].filter((x) => t.includes(x)).slice(0, 5);
    const where2 = found.length ? JSON.stringify((JSON.parse(t).audit || JSON.parse(t).gaps).filter((e) => JSON.stringify(e).includes(found[0])).slice(0, 2)).slice(0, 900) : '';
    assert.deepEqual(found, [], `${where} of ${w}: ${where2}`);
  }
  const audit = JSON.parse(await (await fetch(`${base}/api/audit`, { headers: { 'x-workspace': CH } })).text());
  assert.ok(audit.audit.length > 0 && checked > 1000, 'the hook recorded audit entries (the read-back is not vacuous)');
});

test('corpus sweep: the server printed no probe secret on stdout or stderr, and a real number of answers was checked', () => {
  const printed = output.join('');
  assert.deepEqual([...CORPUS_SECRETS].filter((x) => printed.includes(x)).slice(0, 5), [], `server output: ${printed.slice(0, 300)}`);
  assert.ok(everything.length > 9000, `${everything.length} answers were checked`);
});

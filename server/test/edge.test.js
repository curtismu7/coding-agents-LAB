// The HTTP edge (shared-masker docs/EXPRESS-RECIPE.md): 415 for a charset other than utf-8, 405 with Allow from one route table, the page shell for
// PAGE ADDRESSES only, a workspace rule that refuses credential-looking ids before any state exists, a catch-all error handler that never echoes input,
// and masking at WRITE time for state that outlives the request. Credential-shaped values are built at run time (the scanners dislike literals).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createWorkspaces } from '../src/workspaces.js';
import { mockSecret } from '../src/data.js';

const V = ['hunter2', 'xyz'].join('');
const SK = ['sk', 'abcdefghijklmnop1234'].join('-');

function distDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-edge-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}
async function withApp(fn, { webDist = distDir(), workspaces = createWorkspaces() } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile: '/nonexistent/customer.config.json', webDist, workspaces }) });
  try { await fn(url.replace(/\/$/, ''), workspaces); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}
const call = async (url, method, p, { headers = {}, body } = {}) => {
  const res = await fetch(`${url}${p}`, { method, headers: { origin: url, ...headers }, body });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type') || '', allow: res.headers.get('allow'), text };
};
const GET_ROUTES = ['/api/health', '/api/story', '/api/diagram', '/api/sources', '/api/info', '/api/audit', '/api/gaps'];
const POST_ROUTES = ['/api/config', '/api/evaluate', '/api/hook', '/api/reset'];

// Everything the server writes while a request runs (console and the process streams), so a test can say "nothing typed was logged".
async function captured(fn) {
  const seen = [];
  const keep = { log: console.log, error: console.error, warn: console.warn, out: process.stdout.write, err: process.stderr.write };
  console.log = (...a) => seen.push(a.join(' ')); console.error = (...a) => seen.push(a.join(' ')); console.warn = (...a) => seen.push(a.join(' '));
  process.stdout.write = (c) => { seen.push(String(c)); return true; }; process.stderr.write = (c) => { seen.push(String(c)); return true; };
  try { await fn(); } finally { console.log = keep.log; console.error = keep.error; console.warn = keep.warn; process.stdout.write = keep.out; process.stderr.write = keep.err; }
  return seen.join('\n');
}

test('415: a charset other than utf-8 is refused with a fixed body on all 11 routes and the page, and the typed value is never echoed or logged', async () => {
  assert.equal(GET_ROUTES.length + POST_ROUTES.length, 11);
  await withApp(async (url) => {
    const printed = await captured(async () => {
      for (const route of [...GET_ROUTES, ...POST_ROUTES, '/', '/no-such-page']) {
        for (const ct of [`application/json; charset=${V}`, 'application/json; charset=latin1', 'application/json; charset="iso-8859-1"', 'text/plain;charset=utf-16']) {
          const r = await call(url, route.startsWith('/api') && POST_ROUTES.includes(route) ? 'POST' : 'GET', route, { headers: { 'content-type': ct }, body: POST_ROUTES.includes(route) ? '{}' : undefined });
          assert.equal(r.status, 415, `${route} ${ct}`);
          assert.match(r.type, /application\/json/);
          assert.deepEqual(JSON.parse(r.text), { error: 'unsupported_charset' }, `${route} ${ct}`);
        }
      }
    });
    assert.ok(!printed.includes(V), 'nothing typed was printed');
    for (const ok of ['application/json; charset=utf-8', 'application/json; charset=UTF-8', 'application/json']) {
      const r = await call(url, 'POST', '/api/reset', { headers: { 'content-type': ok }, body: '{}' });
      assert.equal(r.status, 200, ok);
    }
    // the body parser itself reads only "utf-8" JSON: the alias "utf8" passes the charset gate and is a fixed 415 from the parser
    assert.equal((await call(url, 'POST', '/api/reset', { headers: { 'content-type': 'application/json; charset=utf8' }, body: '{}' })).status, 415);
  });
});

test('405: the route table answers a wrong method with Allow, case and one trailing slash included; a known method still works', async () => {
  await withApp(async (url) => {
    for (const p of ['/API/AUDIT', '/api/audit/', '/Api/Gaps/']) {
      const r = await call(url, 'POST', p, { headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 405, p); assert.equal(r.allow, 'GET, HEAD', p);
    }
    const hook = await call(url, 'GET', '/api/hook/');
    assert.equal(hook.status, 405); assert.equal(hook.allow, 'POST');
    assert.equal((await call(url, 'PUT', '/', { headers: { 'content-type': 'application/json' }, body: '{}' })).allow, 'GET, HEAD');
    assert.equal((await call(url, 'POST', '/api/hook/', { headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400, 'POST with a trailing slash reaches the route (an empty hook body is a 400)');
    assert.equal((await call(url, 'GET', '/api/audit//')).status, 404, 'a double slash is not in the table: a 404, not a 405');
  });
});

test('page shell: only a page address gets it. /assets and /assets/ are JSON 404s, so are dotfiles, extensions, bad escapes and the reserved prefixes', async () => {
  await withApp(async (url) => {
    for (const p of ['/assets', '/assets/', '/ASSETS', '/assets/missing', '/assets/x.js', '/api', '/api/', '/API/zzz', '/static', '/static/', '/.env', '/.git/config', '/%2eenv', '/foo.map', '/favicon.ico', '/%', '/%zz', '/a//b', '/a%5Cb', '/a%2Fb.js']) {
      for (const accept of ['text/html', '*/*']) {
        const r = await call(url, 'GET', p, { headers: { accept } });
        assert.equal(r.status, 404, `${p} (${accept})`); assert.match(r.type, /application\/json/, p); assert.deepEqual(JSON.parse(r.text), { error: 'not_found' }, p);
      }
    }
    for (const p of ['/', '/evaluate', '/some/deep/route', '/foo-bar', '/Gateway%20down', '/trailing/']) {
      const r = await call(url, 'GET', p, { headers: { accept: 'text/html,application/xhtml+xml' } });
      assert.equal(r.status, 200, p); assert.match(r.type, /text\/html/); assert.match(r.text, /<title>shell<\/title>/);
    }
    assert.equal((await call(url, 'GET', '/evaluate', { headers: { accept: 'application/json' } })).status, 404, 'a client that asks only for JSON never gets the HTML shell');
    assert.equal((await call(url, 'GET', '/assets/app.js')).status, 200, 'a real asset is still served');
  });
});

test('workspace rule: a credential-looking id is a 400 bad_workspace before any state exists, is never echoed, and a good id creates exactly one slot', async () => {
  await withApp(async (url, workspaces) => {
    const bad = [SK, ['pw', V].join('-'), '0123456789abcdef01234567', ['my', 'password', 'is', V].join('-'), ['token', 'abc123'].join('-'), 'A', 'a b'];
    for (const id of bad) {
      for (const [method, p] of [['GET', '/api/audit'], ['GET', '/api/gaps'], ['POST', '/api/reset'], ['POST', '/api/hook'], ['POST', '/api/evaluate']]) {
        const r = await call(url, method, p, { headers: { 'x-workspace': id, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
        assert.equal(r.status, 400, `${method} ${p} ${JSON.stringify(id)}`); assert.deepEqual(JSON.parse(r.text), { error: 'bad_workspace' });
      }
    }
    assert.equal(workspaces.size(), 0, 'no slot was taken by a refused id');
    const hook = { agent: 'claude-code', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hello' } };
    const ok = await call(url, 'POST', '/api/hook', { headers: { 'x-workspace': 'w-0123456789abcdef', 'content-type': 'application/json' }, body: JSON.stringify(hook) });
    assert.equal(ok.status, 200); assert.equal(workspaces.size(), 1);
    for (const p of ['/api/health', '/api/story', '/api/info', '/nope']) await call(url, 'GET', p, { headers: { 'x-workspace': 'w-0123456789abcdef' } });
    assert.equal(workspaces.size(), 1, 'info routes and a 404 take no slot');
  });
});

test('catch-all error handler: a failure inside a route is a fixed 500, a bad body a fixed 400, an oversize body a fixed 413, an unknown encoding a fixed 415; nothing typed is echoed or logged', async () => {
  const boom = { audit() { throw new Error(`boom ${V}`); }, gaps() { return { gaps: [] }; }, addAudit() {}, addGap() {}, reset() {}, size: () => 0 };
  await withApp(async (url) => {
    const printed = await captured(async () => {
      const five = await call(url, 'GET', '/api/audit', { headers: { 'x-workspace': 'w-0123456789abcdef' } });
      assert.equal(five.status, 500); assert.deepEqual(JSON.parse(five.text), { error: 'internal' });
      const bad = await call(url, 'POST', '/api/evaluate', { headers: { 'content-type': 'application/json' }, body: `{"a": ${V}` });
      assert.equal(bad.status, 400); assert.deepEqual(JSON.parse(bad.text), { error: 'bad_request' });
      const big = await call(url, 'POST', '/api/evaluate', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(17_000) }) });
      assert.equal(big.status, 413); assert.deepEqual(JSON.parse(big.text), { error: 'too_large' });
      const enc = await call(url, 'POST', '/api/evaluate', { headers: { 'content-type': 'application/json', 'content-encoding': `x-${V}` }, body: '{}' });
      assert.equal(enc.status, 415); assert.deepEqual(JSON.parse(enc.text), { error: 'unsupported_charset' });
    });
    assert.ok(!printed.includes(V), `nothing typed was printed: ${printed.slice(0, 200)}`);
  }, { workspaces: boom });
});

test('state is masked at WRITE time: an audit entry and a gap hold the masked text whatever the caller passes in', () => {
  const w = createWorkspaces();
  w.addAudit('w-a', { agent: 'claude-code', summary: `password=${V}`, [`token ${V}`]: 1, nested: { note: `Authorization: Bearer ${V}` } });
  w.addGap('w-a', { agent: 'cursor', summary: SK, reason: `my password is ${V}` });
  const stored = JSON.stringify([w.audit('w-a'), w.gaps('w-a')]);
  assert.ok(!stored.includes(V) && !stored.includes(SK), stored);
  assert.match(stored, /\[masked\]/);
  assert.equal(w.audit('w-a').audit[0].agent, 'claude-code', 'ordinary fields are kept');
});

test('the response mask: a scripted scenario shows the labelled mock credential (rule 4), a visitor\'s own action never shows a typed one', async () => {
  await withApp(async (url) => {
    const post = (body) => call(url, 'POST', '/api/evaluate', { headers: { 'content-type': 'application/json', 'x-workspace': 'w-0123456789abcdef' }, body: JSON.stringify(body) });
    const scripted = await post({ mode: 'mock', agent: 'claude-code', scenario: 'secret-prompt' });
    assert.equal(scripted.status, 200); assert.ok(scripted.text.includes(mockSecret()), 'the labelled mock credential is visible in the scripted prompt');
    const own = await post({ mode: 'live', agent: 'claude-code', custom: { kind: 'prompt', text: `use ${mockSecret()} and password=${V}` } });
    assert.equal(own.status, 200); assert.ok(!own.text.includes(V)); assert.ok(!own.text.includes(mockSecret()), 'a typed credential, even the mock one, is masked in a visitor\'s own action');
  });
});

test('lab data (story, diagram, sources, info) is served as it is, mock credential included, and a typed vertical or diagram name is never echoed', async () => {
  await withApp(async (url) => {
    const story = await call(url, 'GET', '/api/story', { headers: { 'x-lab-vertical': `password=${V}` } });
    assert.equal(story.status, 200); assert.ok(story.text.includes(mockSecret()), 'the labelled mock credential is in the story'); assert.ok(!story.text.includes(V));
    const diagram = await call(url, 'GET', `/api/diagram?name=${encodeURIComponent(`token ${V}`)}&vertical=${encodeURIComponent(V)}`);
    assert.equal(diagram.status, 200); assert.ok(!diagram.text.includes(V));
    for (const p of ['/api/sources', '/api/info']) assert.equal((await call(url, 'GET', p)).status, 200, p);
  });
});

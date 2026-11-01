// Static files, unknown paths and wrong methods. A missing file is a JSON 404 (never the HTML shell with a 200), a wrong method on a known
// route is a 405 with Allow, and Express's own HTML pages (which echo the path) never appear.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';

function distDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

async function withApp(webDist, fn) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile: '/nonexistent/customer.config.json', webDist }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}
const call = async (url, method, p, init = {}) => {
  const res = await fetch(`${url}${p}`, { method, ...init, headers: { origin: url, ...(init.headers || {}) } });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type') || '', allow: res.headers.get('allow'), text };
};
const isJson404 = (r, label) => { assert.equal(r.status, 404, label); assert.match(r.type, /application\/json/, label); if (r.text) assert.deepEqual(JSON.parse(r.text), { error: 'not_found' }, label); };

test('E: a missing file is a JSON 404, never 200 HTML: the six named paths and other extensions and dotfiles', async () => {
  await withApp(distDir(), async (url) => {
    for (const p of ['/assets/missing.js', '/favicon.ico', '/robots.txt', '/foo.map', '/foo.svg', '/sitemap.xml', '/a/b/c.css', '/.env', '/.git/config', '/assets/.hidden', '/x.', '/%2eenv', '/foo%2Ejs', '/index.html.bak']) {
      isJson404(await call(url, 'GET', p), `GET ${p}`);
      assert.equal((await call(url, 'HEAD', p)).status, 404, `HEAD ${p}`);
    }
  });
});

test('E: the app shell is served for an extension-less, non-dotfile GET, and real files are served', async () => {
  await withApp(distDir(), async (url) => {
    for (const p of ['/', '/evaluate', '/some/deep/route', '/foo-bar', '/Gateway%20down']) {
      const r = await call(url, 'GET', p);
      assert.equal(r.status, 200, p); assert.match(r.type, /text\/html/); assert.match(r.text, /<title>shell<\/title>/);
    }
    const js = await call(url, 'GET', '/assets/app.js');
    assert.equal(js.status, 200); assert.match(js.type, /javascript/);
    assert.equal((await call(url, 'GET', '/index.html')).status, 200);
  });
});

test('E: without a built page, every non-API path is a JSON 404 too', async () => {
  await withApp('/nonexistent/dist', async (url) => {
    for (const p of ['/', '/evaluate', '/assets/x.js', '/robots.txt']) isJson404(await call(url, 'GET', p), p);
  });
});

test('E: a write to the page: 405 with Allow on "/", a JSON 404 anywhere else; the path is never echoed', async () => {
  await withApp(distDir(), async (url) => {
    const root = await call(url, 'POST', '/', { body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(root.status, 405); assert.equal(root.allow, 'GET, HEAD'); assert.match(root.type, /application\/json/);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const r = await call(url, method, '/anything-zzmark-here', { body: method === 'OPTIONS' ? undefined : '{}', headers: { 'content-type': 'application/json' } });
      isJson404(r, `${method} /anything`); assert.ok(!r.text.includes('zzmark'));
      assert.ok(!/Cannot|<pre>|<html/i.test(r.text));
    }
  });
});

const GET_ROUTES = ['/api/health', '/api/story', '/api/diagram', '/api/sources', '/api/info', '/api/audit', '/api/gaps'];
const POST_ROUTES = ['/api/config', '/api/evaluate', '/api/hook', '/api/reset'];

test('E: a wrong method on a known route is a 405 with Allow, for all 11 routes (trailing slash and capitals included)', async () => {
  assert.equal(GET_ROUTES.length + POST_ROUTES.length, 11);
  await withApp(distDir(), async (url) => {
    for (const route of GET_ROUTES) {
      for (const p of [route, `${route}/`, route.toUpperCase().replace('/API/', '/API/')]) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
          const r = await call(url, method, p, { body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? '{}' : undefined, headers: { 'content-type': 'application/json' } });
          assert.equal(r.status, 405, `${method} ${p}`); assert.equal(r.allow, 'GET, HEAD', `${method} ${p}`); assert.match(r.type, /application\/json/); assert.deepEqual(JSON.parse(r.text), { error: 'method_not_allowed' });
        }
      }
      assert.notEqual((await call(url, 'GET', route)).status, 405, `GET ${route} still works`);
      assert.notEqual((await call(url, 'HEAD', route)).status, 405, `HEAD ${route} follows GET`);
    }
    for (const route of POST_ROUTES) {
      for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const r = await call(url, method, route, { body: ['PUT', 'PATCH', 'DELETE'].includes(method) ? '{}' : undefined, headers: { 'content-type': 'application/json' } });
        assert.equal(r.status, 405, `${method} ${route}`); assert.equal(r.allow, 'POST', `${method} ${route}`); assert.match(r.type, /application\/json/);
      }
      assert.notEqual((await call(url, 'POST', route, { body: '{}', headers: { 'content-type': 'application/json' } })).status, 405, `POST ${route} still works`);
    }
  });
});

test('E: an unknown route under /api is a JSON 404 for every method, and errors are short fixed JSON', async () => {
  await withApp(distDir(), async (url) => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) isJson404(await call(url, method, '/api/nope-zzmark', { body: method === 'GET' ? undefined : '{}', headers: { 'content-type': 'application/json' } }), `${method} /api/nope`);
    isJson404(await call(url, 'GET', '/api'), '/api');
    isJson404(await call(url, 'GET', '/api/audit/extra'), '/api/audit/extra');
    const bad = await call(url, 'POST', '/api/evaluate', { body: '{"a": zzmark', headers: { 'content-type': 'application/json' } });
    assert.equal(bad.status, 400); assert.deepEqual(JSON.parse(bad.text), { error: 'bad_request' });
    const big = await call(url, 'POST', '/api/evaluate', { body: JSON.stringify({ a: 'x'.repeat(17_000) }), headers: { 'content-type': 'application/json' } });
    assert.equal(big.status, 413); assert.deepEqual(JSON.parse(big.text), { error: 'payload_too_large' });
    const esc = await call(url, 'GET', '/%E0%A4%A-zzmark');
    assert.ok(esc.status >= 400 && esc.status < 500, `a bad escape is a 4xx (${esc.status})`); assert.match(esc.type, /application\/json/); assert.ok(!esc.text.includes('zzmark'));
  });
});

// One Express app. /api = health, info, story, evaluate, hook, config, audit, gaps, diagram and reset. Server state per workspace id
// (X-Workspace) is the audit trail and the recorded gateway gaps, so one visitor's Reset never touches another's. Both modes are
// loopback-only with zero outbound calls. Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom } from './cast.js';
import { defaultMode, modeOf } from './config.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { InputError } from './errors.js';
import { defaultConfig, generateAll, validateConfig } from './codingConfig.js';
import { MOCK_TABLE } from './mockTable.js';
import { maskDeep } from './mask.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';
import { newTrace } from './trace.js';
import { evaluateAction, handleHook } from './service.js';
import { SOURCES } from './sources.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
// The known API routes and the methods each takes. Anything else under /api is a JSON 404.
const ROUTES = new Map([['/health', ['GET']], ['/story', ['GET']], ['/diagram', ['GET']], ['/sources', ['GET']], ['/info', ['GET']], ['/audit', ['GET']], ['/gaps', ['GET']],
  ['/config', ['POST']], ['/evaluate', ['POST']], ['/hook', ['POST']], ['/reset', ['POST']]]);
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

export function createApp({ health = createHealth(), configFile = CONFIG, workspaces = createWorkspaces(), table = MOCK_TABLE, webDist = WEB_DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  // Wrong method on a known route: 405 with Allow (never a 404 that hides the route, never Express's HTML). HEAD follows GET.
  api.use((req, res, next) => {
    const allowed = ROUTES.get(req.path.replace(/\/+$/, '').toLowerCase());
    if (!allowed || allowed.includes(req.method) || (req.method === 'HEAD' && allowed.includes('GET'))) return next();
    return res.set('Allow', allowed.includes('GET') ? 'GET, HEAD' : allowed.join(', ')).status(405).json({ error: 'method_not_allowed' });
  });
  // A hook event can carry a long tool result; the hook trims every field to its head and tail (trim.js) and the gateway scans the first
  // and last 4000 characters of a field. Everything else is small.
  api.use((req, res, next) => express.json({ limit: req.path === '/hook' ? '256kb' : '16kb' })(req, res, next));
  api.use('/health', health.router);
  const verticalOf = (req) => verticalFrom(req.body?.vertical ?? req.query.vertical ?? req.headers['x-lab-vertical']);
  const castFor = (req) => loadCast(configFile, verticalOf(req));
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  api.get('/story', (req, res) => { noStore(res); res.json(buildStory(castFor(req), verticalOf(req))); });
  api.get('/diagram', (req, res) => { noStore(res); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : 'hook-flow')); });
  // The documentation each "documented" shape was read from: plain text for a presenter to copy. The lab never fetches them.
  api.get('/sources', (_req, res) => { noStore(res); res.json(SOURCES); });
  api.get('/info', (_req, res) => { noStore(res); res.json({ mode: defaultMode(), modes: ['mock', 'live'], simulated: true, release: '2026-11-02', unverified: true }); });

  const ws = (req, res) => { const id = workspaceFrom(req); if (!id) res.status(400).json({ error: 'bad_workspace' }); return id; };
  const failure = (res, next) => (e) => { if (e instanceof InputError) return res.status(400).json({ error: e.code, detail: e.message }); return next(e); };
  const objectBody = (req) => req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body);

  // Validate a CodingAgent config and generate the managed-configuration TEXT for each covered agent. Text only: nothing is written anywhere.
  api.post('/config', (req, res) => {
    noStore(res);
    if (!objectBody(req)) return res.status(400).json({ error: 'bad_request' });
    const v = validateConfig(req.body.config ?? defaultConfig(castFor(req)));
    // The echoed config and the text generated from it are built from the MASKED config (a carried object, or a gateway path, may hold anything typed).
    const shown = maskDeep(v.config);
    return res.json(maskDeep({ ok: v.ok, errors: v.errors, warnings: v.warnings, config: shown, generated: v.ok ? generateAll(shown) : [] }));
  });

  // Evaluate a scripted action (both modes) or a visitor's own (Live only). The config comes with every request and is validated.
  api.post('/evaluate', async (req, res, next) => {
    const id = ws(req, res); if (!id) return;
    noStore(res);
    if (!objectBody(req)) return res.status(400).json({ error: 'bad_request' });
    try {
      const mode = modeOf(req.body.mode);
      if (!mode) return res.status(400).json({ error: 'bad_mode', detail: 'mode must be mock or live' });
      const v = req.body.config === undefined ? validateConfig(defaultConfig(castFor(req))) : validateConfig(req.body.config);
      if (!v.ok) return res.status(400).json({ error: 'bad_config', detail: v.errors.map((e) => `${e.field}: ${e.message}`).join('; ') });
      if (typeof req.body.agent !== 'string') return res.status(400).json({ error: 'unknown_agent', detail: 'agent is required' });
      const out = await evaluateAction({
        mode, cast: castFor(req), vertical: verticalOf(req), agent: req.body.agent, scenario: req.body.scenario, custom: req.body.custom, config: v.config,
        down: req.body.down === true, ws: id, workspaces, table, traceparent: req.headers.traceparent, port: req.socket.localPort,
      });
      res.set('traceparent', out.hops?.[0]?.traceparent || '');
      return res.json({ ...out, workspace: id });
    } catch (e) { return failure(res, next)(e); }
  });

  // The gateway side of the hook script. Loopback only (Host check above); no Origin is sent by a script, which is allowed.
  api.post('/hook', (req, res, next) => {
    const id = ws(req, res); if (!id) return;
    noStore(res);
    if (!objectBody(req)) return res.status(400).json({ error: 'bad_request' });
    try {
      const trace = newTrace(req.headers.traceparent);
      const out = handleHook({ ws: id, body: req.body, cast: castFor(req), workspaces, trace });
      res.set('traceparent', `00-${trace.traceId}-${trace.span()}-01`);
      return res.json(out);
    } catch (e) { return failure(res, next)(e); }
  });

  api.get('/audit', (req, res) => { const id = ws(req, res); if (!id) return; noStore(res); res.json(workspaces.audit(id)); });
  api.get('/gaps', (req, res) => { const id = ws(req, res); if (!id) return; noStore(res); res.json(workspaces.gaps(id)); });
  // Reset clears this workspace's audit trail and recorded gaps only.
  api.post('/reset', (req, res) => { const id = ws(req, res); if (!id) return; noStore(res); workspaces.reset(id); return res.json({ reset: 'ok', workspace: id }); });
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);

  // Outside /api only a GET or HEAD can succeed: a write to the page is 405 (Allow) on "/" and a JSON 404 anywhere else.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    return req.path === '/' ? res.set('Allow', 'GET, HEAD').status(405).json({ error: 'method_not_allowed' }) : res.status(404).json({ error: 'not_found' });
  });
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    // The app shell answers only a GET of an extension-less, non-dotfile path. A missing file (/assets/x.js, /favicon.ico, /robots.txt,
    // /foo.map, /.env) is a JSON 404, never 200 HTML: a broken asset link must fail loudly.
    app.get(/^\/(?!api(?:\/|$)).*/, (req, res, next) => {
      let p; try { p = decodeURIComponent(req.path); } catch { return next(); }
      const parts = p.split('/');
      if (parts.at(-1).includes('.') || parts.some((x) => x.startsWith('.'))) return next();
      return res.sendFile(path.join(webDist, 'index.html'));
    });
  }
  // Everything else is a short JSON 404; Express's own 404 would send HTML that echoes the path.
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // Errors become short JSON with fixed text. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}

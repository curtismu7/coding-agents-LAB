// One Express app. /api = health, info, story, evaluate, hook, config, audit, gaps, diagram and reset. Server state per workspace id
// (X-Workspace) is the audit trail and the recorded gateway gaps, so one visitor's Reset never touches another's. Both modes are
// loopback-only with zero outbound calls. Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
//
// The edge follows shared-masker's docs/EXPRESS-RECIPE.md, in this order: Host check, same-origin writes, response mask (every res.json
// goes through maskDeep, values AND keys), 415 for a charset other than utf-8, 405 with Allow from ONE route table, body parsing, the
// workspace rule (a credential-looking id is a 400 before any state exists), the routes, static files, the page shell for PAGE ADDRESSES
// only, a final JSON 404 and a catch-all error handler. Nothing the visitor typed is ever put into a status, a code or a log line.
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
import { maskDeep, maskText } from './mask.js';
import { buildMethodTable, charsetProblem, isPageAddress, methodNotAllowed } from './shared/hygiene.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';
import { newTrace } from './trace.js';
import { evaluateAction, handleHook } from './service.js';
import { SOURCES } from './sources.js';
import { aiGuardConfig, realNotConfiguredReason } from './aiguard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
// The route table: every known path and the methods it takes. ONE table feeds the 405 answer (with Allow); HEAD follows GET. Anything not
// in it is a JSON 404 (under /api) or the page shell (a page address).
const ROUTES = {
  '/': ['GET'],
  '/api/health': ['GET'], '/api/story': ['GET'], '/api/diagram': ['GET'], '/api/sources': ['GET'], '/api/info': ['GET'], '/api/audit': ['GET'], '/api/gaps': ['GET'],
  '/api/config': ['POST'], '/api/evaluate': ['POST'], '/api/hook': ['POST'], '/api/reset': ['POST'],
};
const METHODS = buildMethodTable(ROUTES);
// A fixed answer: a status and a code the lab wrote. Never anything the visitor sent.
const fail = (res, status, code, headers = {}) => res.set(headers).status(status).json({ error: code });
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

export function createApp({ health = createHealth(), configFile = CONFIG, workspaces = createWorkspaces(), table = MOCK_TABLE, webDist = WEB_DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  // Response mask: everything that leaves through res.json is passed through maskDeep (values and object keys; the input is never mutated).
  // The one exception is an answer the handler marks lab-owned (res.locals.labOwned): a scripted scenario, which is built from the lab's own
  // data and shows the labelled mock credential on purpose (rule 4). Its only visitor-influenced field is masked by hand where it is set.
  app.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => json(res.locals.labOwned ? body : maskDeep(body));
    next();
  });
  // Charset gate: 415 for any charset other than utf-8. charsetProblem returns a FIXED code, so nothing typed is answered or logged.
  app.use((req, res, next) => (charsetProblem(req.headers['content-type']) ? fail(res, 415, 'unsupported_charset') : next()));
  // 405 with Allow, from the route table (case and one trailing slash are normalised; a path that is not in the table is a 404).
  app.use((req, res, next) => {
    const miss = methodNotAllowed(METHODS, req.method, req.path);
    return miss ? fail(res, 405, 'method_not_allowed', { Allow: miss.allow.join(', ') }) : next();
  });

  const api = express.Router();
  // A hook event can carry a long tool result; the hook trims every field to its head and tail (trim.js) and the gateway scans the first
  // and last 4000 characters of a field. Everything else is small.
  api.use((req, res, next) => express.json({ limit: req.path === '/hook' ? '256kb' : '16kb' })(req, res, next));
  api.use('/health', health.router);
  const verticalOf = (req) => verticalFrom(req.body?.vertical ?? req.query.vertical ?? req.headers['x-lab-vertical']);
  const castFor = (req) => loadCast(configFile, verticalOf(req));
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  // The story, the diagrams, the sources and the info are the lab's own data (the vertical is a whitelist, the diagram name an enum, the cast comes from
  // the operator's file): nothing a visitor types is in them, and the story shows the labelled mock credential on purpose (rule 4).
  const labData = (res) => { res.locals.labOwned = true; noStore(res); };
  api.get('/story', (req, res) => { labData(res); res.json(buildStory(castFor(req), verticalOf(req))); });
  api.get('/diagram', (req, res) => { labData(res); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : 'hook-flow')); });
  // The documentation each "documented" shape was read from: plain text for a presenter to copy. The lab never fetches them.
  api.get('/sources', (_req, res) => { labData(res); res.json(SOURCES); });
  api.get('/info', (_req, res) => { labData(res); res.json({ mode: defaultMode(), modes: ['mock', 'live', 'real'], simulated: true, release: '2026-11-02', unverified: true, realAvailable: aiGuardConfig().configured, realReason: realNotConfiguredReason() }); });

  // The workspace rule: an id that is not lowercase letters, digits and hyphens, or that the masker takes for a credential, is refused here,
  // before any state exists for it, and is never echoed.
  const ws = (req, res) => { const id = workspaceFrom(req); if (!id) fail(res, 400, 'bad_workspace'); return id; };
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
      if (!mode) return res.status(400).json({ error: 'bad_mode', detail: 'mode must be mock, live or real' });
      const v = req.body.config === undefined ? validateConfig(defaultConfig(castFor(req))) : validateConfig(req.body.config);
      if (!v.ok) return res.status(400).json({ error: 'bad_config', detail: v.errors.map((e) => `${e.field}: ${e.message}`).join('; ') });
      if (typeof req.body.agent !== 'string') return res.status(400).json({ error: 'unknown_agent', detail: 'agent is required' });
      const out = await evaluateAction({
        mode, cast: castFor(req), vertical: verticalOf(req), agent: req.body.agent, scenario: req.body.scenario, custom: req.body.custom, config: v.config,
        down: req.body.down === true, ws: id, workspaces, table, traceparent: req.headers.traceparent, port: req.socket.localPort,
      });
      res.set('traceparent', out.hops?.[0]?.traceparent || '');
      if (req.body.scenario !== undefined) res.locals.labOwned = true; // a scripted scenario: lab data, the labelled mock credential stays visible
      return res.json({ ...out, workspace: maskText(id) });
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
  app.use('/api', api);

  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    // Real files only: dotfiles are ignored, a directory has no index and no redirect, and anything missing falls through.
    app.use(express.static(webDist, { index: false, dotfiles: 'ignore', fallthrough: true, redirect: false }));
    // The page shell is for PAGE ADDRESSES only: a GET or HEAD, a path isPageAddress accepts (so /assets, /assets/, /favicon.ico, /foo.map, /.env,
    // /% and /%zz are not), from a client that does not rule HTML out. A missing asset is a JSON 404, never a 200 HTML page a script would try to run.
    app.use((req, res, next) => {
      const accept = req.get('accept');
      const wantsHtml = accept === undefined || accept.includes('text/html') || accept.includes('*/*');
      if ((req.method === 'GET' || req.method === 'HEAD') && wantsHtml && isPageAddress(req.path)) return res.sendFile(path.join(webDist, 'index.html'));
      return next();
    });
  }
  // The final JSON 404 (Express's own would send HTML that echoes the path), and the catch-all error handler: the status comes from a short
  // whitelist, the code is fixed, err.message and err.stack are never sent or logged.
  app.use((_req, res) => fail(res, 404, 'not_found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = [400, 413, 415].includes(err?.status) ? err.status : 500;
    const code = { 400: 'bad_request', 413: 'too_large', 415: 'unsupported_charset', 500: 'internal' }[status];
    if (res.headersSent) return res.end();
    return fail(res, status, code);
  });
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}

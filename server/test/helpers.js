import http from 'node:http';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createRunLog } from '../src/runObs.js';
import { createWorkspaces } from '../src/workspaces.js';

// Tests that are not about stdout write no run-observability lines (the lab writes one per decision), so the test log stays readable.
export const silentRunLog = (workspaces) => createRunLog({ workspaces, write: () => {} });

export async function withServer(fn, { configFile = '/nonexistent/customer.config.json', env, runLog, workspaces } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const store = workspaces ?? createWorkspaces();
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile, ...(env ? { env } : {}), workspaces: store, runLog: runLog ?? silentRunLog(store) }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

export const post = (url, path, body, headers = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify(body) });

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

import os from 'node:os';
import path from 'node:path';
import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { modeFrom } from './config.js';

installNetguard(); // before anything else can open a socket

// The one shared settings file (rulebook): ~/Development/.env, or the path in STANDALONE_ENV. Optional; never printed.
try { process.loadEnvFile(process.env.STANDALONE_ENV || path.join(os.homedir(), 'Development', '.env')); } catch { /* no settings file */ }

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[coding-agents-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const mode = modeFrom(process.env); // refuses anything but mock or live
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp() });
console.log(`[coding-agents-lab] simulated lab at ${url} (opens in ${mode} mode; loopback, no outbound network)`);
console.log(`[coding-agents-lab] health: ${url}api/health`);

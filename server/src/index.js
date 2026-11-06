import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { modeFrom } from './config.js';
import { applySharedSettings } from './settings.js';
import { aiGuardConfig, netguardAllowlist } from './aiguard.js';

applySharedSettings(); // the one shared settings file, before the allowlist is computed from it

installNetguard(netguardAllowlist()); // the Real gateway hostname is the ONE allowed outbound; everything else is refused

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[coding-agents-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const mode = modeFrom(process.env); // refuses anything but mock, live or real
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp() });
console.log(`[coding-agents-lab] simulated lab at ${url} (opens in ${mode} mode; loopback${mode === 'real' ? `, real AI Guard at ${aiGuardConfig().url.replace(/\/jsonrpc$/i, '')}` : ', no outbound network'})`);
console.log(`[coding-agents-lab] health: ${url}api/health`);

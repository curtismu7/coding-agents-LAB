// The Live path: run the real hook script (hooks/lab-hook.mjs) as a child process, exactly as an agent would: the agent's JSON on
// stdin, the native answer on stdout. The script posts to this server over loopback. The child gets a tiny, explicit environment.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../hooks/lab-hook.mjs');
// Nothing listens on loopback port 1, so a connection is refused at once: a real "gateway unreachable", no flag involved.
export const DEAD_GATEWAY = 'http://127.0.0.1:1/';

const lines = (stderr, tag) => stderr.split('\n').filter((l) => l.startsWith(`${tag} `)).map((l) => { try { return JSON.parse(l.slice(tag.length + 1)); } catch { return null; } }).filter(Boolean);

export function runHookScript({ agent, payload, certSubject, gateways, failClosed = false, vertical = 'finance', workspace = 'default', traceparent, timeoutMs = 3000, killAfterMs = 12000 }) {
  return new Promise((resolve) => {
    const env = {
      LAB_GATEWAYS: gateways.join(','), LAB_FAIL_CLOSED: failClosed ? '1' : '0', LAB_DEVICE_CERT_SUBJECT: certSubject, LAB_VERTICAL: vertical,
      LAB_WORKSPACE: workspace, LAB_HOOK_VERBOSE: '1', LAB_TIMEOUT_MS: String(timeoutMs), ...(traceparent ? { TRACEPARENT: traceparent } : {}),
    };
    const child = spawn(process.execPath, [HOOK_PATH, '--agent', agent], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let done = false;
    const finish = (code) => {
      if (done) return; done = true; clearTimeout(timer);
      let native = null; try { native = JSON.parse(stdout.trim()); } catch { /* not JSON */ }
      resolve({ code, stdout, stderr, native, gateway: lines(stderr, 'LAB-GATEWAY')[0] || null, gap: lines(stderr, 'LAB-GAP')[0] || null, trace: lines(stderr, 'LAB-TRACE')[0] || null, net: lines(stderr, 'LAB-NET')[0] || null });
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(-1); }, killAfterMs);
    child.stdout.on('data', (c) => { if (stdout.length < 200_000) stdout += c; });
    child.stderr.on('data', (c) => { if (stderr.length < 200_000) stderr += c; });
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

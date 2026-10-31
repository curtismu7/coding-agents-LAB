import test from 'node:test';
import assert from 'node:assert/strict';
import { allPassed, runChecks } from '../src/doctor.js';

test('every doctor check passes on a clean default environment', async () => {
  const checks = await runChecks({ env: { HOME: '/nonexistent' } });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  for (const id of ['node', 'mode', 'bind', 'port-range', 'settings-file', 'hook-script', 'scenarios', 'mock-table', 'config', 'story-tokens', 'verticals', 'story-hosts', 'story-keys', 'diagrams', 'netguard', 'tenant']) assert.ok(checks.some((c) => c.id === id), id);
});

test('a port outside 7150-7199 fails, and a wildcard bind needs the opt-in', async () => {
  assert.equal((await runChecks({ env: { PORT: '5010' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '7100' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '7150', CALAB_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('the mode must be mock or live; mock is the default; a bare MODE (another app\'s) is ignored', async () => {
  assert.equal((await runChecks({ env: { CODING_AGENTS_LAB_MODE: 'prod' } })).find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { CODING_AGENTS_LAB_MODE: 'live' } })).find((c) => c.id === 'mode').level, 'pass');
  const { modeFrom } = await import('../src/config.js');
  assert.equal(modeFrom({}), 'mock');
  assert.equal(modeFrom({ MODE: 'live' }), 'mock');
});

test('the settings file: absent is fine, a world-readable one is flagged, its values are never printed', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-env-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, 'SECRET_THING=hunter2hunter2\n', { mode: 0o644 });
  try {
    const c = (await runChecks({ env: { STANDALONE_ENV: f } })).find((x) => x.id === 'settings-file');
    assert.equal(c.level, 'info'); assert.ok(!JSON.stringify(c).includes('hunter2'));
    fs.chmodSync(f, 0o600);
    assert.equal((await runChecks({ env: { STANDALONE_ENV: f } })).find((x) => x.id === 'settings-file').level, 'pass');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

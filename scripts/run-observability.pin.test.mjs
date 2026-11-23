// Rule 27: the vendored shared/run-observability files match web/src/run-observability/run-observability.sha256 byte for byte.
// They come from curtismu7/AI-DEMO-Standalone shared/run-observability: change them there, re-pin, re-vendor; never edit them here.
// This lab reads no logs (Mock and Live are the lab's own engine, Real is one reply from the AI Gateway shown as a `response` row), so it vendors the core only:
// no server/src/runObservabilityReaders.js, no reader setting anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPin } from './run-observability-checkPin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const CORE = path.join(root, 'server/src/runObservability.js');
const VENDORED_WEB = path.join(root, 'web/src/run-observability');

test('every vendored run-observability file matches its pin, and the core is present', () => {
  assert.deepEqual(checkPin(root), []);
});

test('an edited vendored byte, a missing pin and an unpinned file are each caught', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'cag-pin-'));
  try {
    for (const p of ['web/src/run-observability', 'server/src/runObservability.js']) fs.cpSync(path.join(root, p), path.join(copy, p), { recursive: true });
    assert.deepEqual(checkPin(copy), [], 'an untouched copy is fine');
    const css = path.join(copy, 'web/src/run-observability/run-observability.css');
    fs.appendFileSync(css, ' ');
    assert.ok(checkPin(copy).length > 0, 'one added byte');
    fs.writeFileSync(css, fs.readFileSync(path.join(root, 'web/src/run-observability/run-observability.css')));
    fs.writeFileSync(path.join(copy, 'web/src/run-observability/extra.js'), 'export {};\n');
    assert.ok(checkPin(copy).some((m) => /extra\.js/.test(m)), 'a file beside them that the pin does not name');
    fs.rmSync(path.join(copy, 'web/src/run-observability/extra.js'));
    fs.writeFileSync(path.join(copy, 'server/src/runObservabilityExtra.js'), 'export {};\n');
    assert.ok(checkPin(copy).some((m) => /runObservabilityExtra\.js/.test(m)), 'a second server file with the core\'s name');
    fs.rmSync(path.join(copy, 'server/src/runObservabilityExtra.js'));
    fs.rmSync(path.join(copy, 'web/src/run-observability/run-observability.sha256'));
    assert.ok(checkPin(copy).length > 0, 'no pin file');
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
});

test('this lab reads no logs: no readers file, no server file names a reader or a RUN_OBS_ setting (comments included), and the core has no imports', () => {
  assert.ok(!fs.existsSync(path.join(root, 'server/src/runObservabilityReaders.js')));
  const core = read('server/src/runObservability.js');
  assert.ok(!/^\s*import\s/m.test(core), 'the core has no imports');
  assert.ok(!/ElasticsearchReader|DockerLogReader|readersFromEnv|\bfetch\s*\(|node:http|node:fs/.test(core), 'the core names no reader, no network and no file access, not even in a comment');
  // the core's own "no log reader is configured" message names the setting a lab WITH readers would set: it is the one place, by exact path, and it is vendored
  for (const f of fs.readdirSync(path.join(root, 'server/src')).filter((n) => n.endsWith('.js')).map((n) => path.join(root, 'server/src', n)).filter((p) => p !== CORE)) {
    assert.ok(!/RUN_OBS_|runObservabilityReaders|ElasticsearchReader|DockerLogReader|readersFromEnv/.test(fs.readFileSync(f, 'utf8')), `${path.relative(root, f)} names a log reader`);
  }
});

test('compose, the example settings and the Dockerfile never mount the Docker socket and carry no run-observability setting (nothing reads one)', () => {
  for (const f of ['docker-compose.yml', '.env.example', 'Dockerfile']) {
    assert.ok(!/docker\.sock/.test(read(f)), `${f}: no Docker socket`);
    assert.ok(!/RUN_OBS_/.test(read(f)), `${f}: no reader settings`);
  }
});

test('no lab file outside the vendored files carries the RUN_OBS_ prefix (the web code included; the only exemptions are the core and the vendored web folder, by exact path), and the README says what is not verified', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' || p === VENDORED_WEB ? [] : walk(p);
    return p === CORE ? [] : [p];
  });
  const files = [...walk(path.join(root, 'web/src')), ...walk(path.join(root, 'server/src'))];
  assert.ok(files.some((f) => f.endsWith('runObs.js')) && files.some((f) => f.endsWith('RunObs.jsx')), 'the walk reaches the lab\'s own files');
  for (const f of files) assert.ok(!/RUN_OBS_/.test(fs.readFileSync(f, 'utf8')), `${path.relative(root, f)} carries a RUN_OBS_ name`);
  const readme = read('README.md');
  assert.match(readme, /\*\*Not verified\.\*\* Nothing here was run against a real gateway/);
  assert.match(readme, /An evaluation that ends in an error answer keeps its stdout lines and has no record/);
  assert.match(readme, /Reset clears this workspace's run records/);
});

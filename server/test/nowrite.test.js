// The lab NEVER writes any managed configuration or settings file outside its own repo or container, and never edits a user's
// home or /Library. Generated configuration is displayed and downloadable text only. This pins that in the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = (dir) => fs.readdirSync(path.join(root, dir), { recursive: true }).filter((f) => /\.(m?js|jsx)$/.test(f) && !/node_modules|dist|\.test\./.test(f)).map((f) => path.join(dir, f));
const WRITE = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|chmod|chmodSync|symlink|truncate|writeSync|openSync)\s*\(/;

test('the server and the hook contain no filesystem write at all', () => {
  const hits = [];
  for (const f of [...files('server/src'), ...files('hooks')]) { const m = WRITE.exec(fs.readFileSync(path.join(root, f), 'utf8')); if (m) hits.push(`${f}: ${m[0]}`); }
  assert.deepEqual(hits, []);
});

test('the repo scripts that write files write only inside the repo: they name no home directory, /Library or /etc', () => {
  const hits = [];
  for (const f of files('scripts')) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    if (!WRITE.test(t)) continue; // a script that cannot write may read the shared settings file (doctor.mjs)
    for (const bad of ['homedir', 'process.env.HOME', "'/Library", '"/Library', "'/etc/", '"/etc/', '~/']) if (t.includes(bad)) hits.push(`${f}: ${bad}`);
  }
  assert.deepEqual(hits, []);
});

test('the only home-directory touch in the server is reading the optional shared settings file', () => {
  const t = fs.readFileSync(path.join(root, 'server/src/settings.js'), 'utf8');
  assert.equal((t.match(/homedir\(\)/g) || []).length, 1);
  assert.ok(t.includes('readFileSync(') && t.includes('parseEnv('));
  // sharedEnv.js reads the same shared file for the Real-mode keys (same rule: values never returned or logged).
  const s = fs.readFileSync(path.join(root, 'server/src/sharedEnv.js'), 'utf8');
  assert.equal((s.match(/homedir\(\)/g) || []).length, 1);
  assert.ok(s.includes('readFileSync(') && s.includes('parseEnv('));
  for (const f of files('server/src')) if (!f.endsWith('settings.js') && !f.endsWith('sharedEnv.js')) assert.ok(!/homedir|process\.env\.HOME/.test(fs.readFileSync(path.join(root, f), 'utf8')), f);
});

test('the Web UI offers the generated text as a download of text, and posts nothing that could install it', () => {
  const t = fs.readdirSync(path.join(root, 'web/src/components')).map((f) => fs.readFileSync(path.join(root, 'web/src/components', f), 'utf8')).join('\n');
  assert.ok(t.includes('download='));
  assert.ok(!/showSaveFilePicker|showDirectoryPicker|navigator\.storage\.getDirectory/.test(t));
});

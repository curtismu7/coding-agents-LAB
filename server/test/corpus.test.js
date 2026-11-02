// The shared corpora (server/test/corpus, copied unchanged from shared-masker 1.4.0, commit 9bc664a) run through THIS lab's adapter (src/mask.js), not through
// the shared module directly: whatever the lab changes in the adapter (mark style, opaque values, size limit) is judged by the same rows.
// leaks.json: the secret of every probe must not survive, masking must be idempotent and a cut of the answer must not show the start of the secret.
// ordinary.json: every string must come out unchanged and must not look like a credential.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { looksLikeCredential, maskDeep, maskText } from '../src/mask.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus');
const leaks = JSON.parse(readFileSync(path.join(dir, 'leaks.json'), 'utf8'));
const ordinary = JSON.parse(readFileSync(path.join(dir, 'ordinary.json'), 'utf8'));
const join = (a) => a.join('');
export const expand = (row) => `${row.fillBefore ? `${'a'.repeat(row.fillBefore)} ` : ''}${join(row.input)}${row.fillAfter ? ` ${'a'.repeat(row.fillAfter)}` : ''}`;
const isDeep = (row) => row.api === 'deep';

test('corpus sizes are the shared 1.4.0 sizes: 3754 leak probes (3416 text, 338 structured) and 1926 ordinary strings', () => {
  assert.equal(leaks.length, 3754);
  assert.equal(leaks.filter(isDeep).length, 338);
  assert.equal(ordinary.length, 1926);
});

test('leaks.json: through the lab adapter, the secret of every text probe is gone, the answer is stable and a cut does not show its start', () => {
  const failures = [];
  for (const row of leaks) {
    if (isDeep(row)) continue;
    const input = expand(row);
    const secret = join(row.secret);
    const out = maskText(input);
    if (out.includes(secret)) failures.push(`${row.id} ${row.family}/${row.enc}`);
    else if (!looksLikeCredential(input)) failures.push(`${row.id} ${row.family}/${row.enc} (looksLikeCredential false)`);
    if (maskText(out) !== out) failures.push(`${row.id} ${row.family}/${row.enc} (not idempotent)`);
    if (secret.length >= 6 && out.slice(0, 2000).includes(secret.slice(0, 6))) failures.push(`${row.id} ${row.family}/${row.enc} (prefix survives a cut)`);
  }
  assert.deepEqual(failures, [], `${failures.length} of ${leaks.length} failed:\n${failures.slice(0, 40).join('\n')}`);
});

test('leaks.json: the 338 structured probes lose the secret through the adapter\'s maskDeep, keep a stable answer and leave the input alone', () => {
  const failures = [];
  const deep = leaks.filter(isDeep);
  for (const row of deep) {
    const value = JSON.parse(join(row.input));
    const secret = join(row.secret);
    const snapshot = JSON.stringify(value);
    const out = maskDeep(value);
    if (JSON.stringify(value) !== snapshot) failures.push(`${row.id} input mutated`);
    if (JSON.stringify(out).includes(secret)) failures.push(`${row.id} ${row.family}/${row.enc}`);
    else if (JSON.stringify(maskDeep(out)) !== JSON.stringify(out)) failures.push(`${row.id} ${row.family}/${row.enc} (not stable)`);
  }
  assert.deepEqual(failures, [], failures.slice(0, 40).join('\n'));
});

test('leaks.json: text probes typed as a value AND as an object key lose the secret in maskDeep', () => {
  const failures = [];
  for (const row of leaks) {
    if (isDeep(row)) continue;
    const input = expand(row);
    if (input.length > 5000) continue;
    const secret = join(row.secret);
    if (JSON.stringify(maskDeep({ note: input, list: [input] })).includes(secret) || JSON.stringify(maskDeep({ [input]: 1 })).includes(secret)) failures.push(`${row.id} ${row.family}/${row.enc}`);
  }
  assert.deepEqual(failures, [], failures.slice(0, 20).join('\n'));
});

test('ordinary.json: through the adapter every string stays unchanged and does not look like a credential', () => {
  const changed = [];
  for (const row of ordinary) {
    const input = join(row.input);
    if (row.api === 'deep') { assert.deepEqual(maskDeep(JSON.parse(input)), JSON.parse(input), `${row.id} ${input}`); continue; }
    const out = maskText(input);
    if (out !== input) changed.push(`${row.id} ${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
    if (looksLikeCredential(input)) changed.push(`${row.id} looksLikeCredential true for ${JSON.stringify(input)}`);
  }
  assert.deepEqual(changed, [], `${changed.length} of ${ordinary.length} changed:\n${changed.slice(0, 40).join('\n')}`);
});

test('ordinary.json: the lab\'s detection does not flag ordinary text as a credential, a hidden instruction or a risky command', async () => {
  const { evaluateCall, findSecrets } = await import('../src/detect.js');
  const flagged = [];
  for (const row of ordinary) {
    if (row.api === 'deep') continue;
    const input = join(row.input);
    if (input.length > 8000) continue;
    if (findSecrets(input).length) flagged.push(`${row.id} secret ${JSON.stringify(input.slice(0, 60))}`);
    for (const call of [{ kind: 'prompt', text: input }, { kind: 'tool_result', server: 's', tool: 't', result: input }]) {
      const ev = evaluateCall(call, { mcpAllow: [] });
      if (ev.findings.some((f) => f.id === 'secret-in-prompt' || f.id === 'secret-in-result')) flagged.push(`${row.id} ${call.kind} ${JSON.stringify(input.slice(0, 60))}`);
    }
  }
  assert.deepEqual(flagged, [], `${flagged.length} flagged:\n${flagged.slice(0, 30).join('\n')}`);
});

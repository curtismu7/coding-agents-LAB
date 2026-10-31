import test from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_POST_LIMIT, trimPayload, trimStrings } from '../src/trim.js';
import { parseTraceparent, newTrace } from '../src/trace.js';

test('a long string keeps its head and tail with a marker; short strings and other types are untouched', () => {
  const t = trimStrings({ a: `${'H'.repeat(4000)}${'m'.repeat(50_000)}${'T'.repeat(4000)}`, b: 'short', n: 5, z: null, l: ['x'.repeat(8000)] }, 4000);
  assert.match(t.a, /^H{4000}\n\[\.\.\. 50000 characters omitted by the hook \.\.\.\]\nT{4000}$/);
  assert.deepEqual([t.b, t.n, t.z, t.l[0].length], ['short', 5, null, 8000]);
});

test('trimPayload brings a huge event under the post limit, or reports it as unreadable; deep values do not overflow the stack', () => {
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'x'.repeat(100_000)]));
  const t = trimPayload(many);
  assert.ok(JSON.stringify(t).length <= HOOK_POST_LIMIT);
  assert.equal(trimPayload({ s: 'x'.repeat(900_000) }).s.length < 9000, true);
  const wide = Array.from({ length: 60_000 }, (_, i) => `item-${i}-${'z'.repeat(20)}`);
  assert.equal(trimPayload({ wide }), null);
  let deep = 'x'; for (let i = 0; i < 100_000; i++) deep = { d: deep };
  assert.doesNotThrow(() => trimPayload(deep));
});

test('traceparent: all-zero trace or span ids are refused, a valid one continues', () => {
  assert.equal(parseTraceparent(`00-${'0'.repeat(32)}-${'a'.repeat(16)}-01`), null);
  assert.equal(parseTraceparent(`00-${'a'.repeat(32)}-${'0'.repeat(16)}-01`), null);
  assert.equal(parseTraceparent('00-short-x-01'), null);
  assert.equal(parseTraceparent(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`).traceId, 'a'.repeat(32));
  assert.equal(newTrace(`00-${'0'.repeat(32)}-${'a'.repeat(16)}-01`).parentId, null);
  assert.equal(newTrace(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`).traceId, 'a'.repeat(32));
});

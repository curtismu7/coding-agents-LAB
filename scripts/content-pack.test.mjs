import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPack } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

const root = new URL('..', import.meta.url);
const committed = JSON.parse(fs.readFileSync(new URL('content-pack.json', root), 'utf8'));

test('the pack validates against the schema and its cross-references hold, with the assigned catalog D102', () => {
  assert.deepEqual(validatePack(buildPack()), []);
  assert.equal(buildPack().demo.catalog, 'D102');
});

test('the committed content-pack.json is exactly what the builder makes (no drift)', () => {
  assert.deepEqual(committed, buildPack());
});

test('every scenario has a story and a try-it card', () => {
  const pack = buildPack();
  assert.equal(pack.stories.length, 7);
  for (const s of pack.stories) assert.ok(pack.cards.find((c) => c.story === s.id), s.id);
});

test('a broken pack is caught: unknown term and unknown story', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['nope'];
  pack.cards[1].story = 'ghost';
  const errors = validatePack(pack).join('\n');
  assert.match(errors, /unknown term nope/);
  assert.match(errors, /unknown story ghost/);
});

test('the pack has a Why it matters entry, names no real company, tenant or documentation URL, holds no credential, and marks every claim UNVERIFIED', () => {
  const t = JSON.stringify(buildPack()).toLowerCase();
  for (const w of ['united', 'mileageplus', 'datapower', 'optum', 'uhg', 'benefit']) assert.ok(!t.includes(w), w);
  assert.ok(!/https?:\/\/(?!(localhost|example\.invalid))/.test(t), 'only localhost and .invalid links: documentation URLs live in the README');
  assert.ok(!/\bdoor\b/.test(t), 'say P1 Privilege Agent App, not door');
  assert.ok(!t.includes('sk-mock'), 'no credential-shaped value');
  assert.match(buildPack().cards.find((c) => c.id === 'concept-why-it-matters').description, /TLS-decryption project/);
});

test('every glossary definition of a product claim says it is UNVERIFIED on our tenant', () => {
  for (const g of buildPack().glossary.filter((x) => ['hook', 'managed-configuration', 'native-response', 'same-policy', 'secret-stop', 'device-identity', 'fail-open-closed', 'tls-termination'].includes(x.id))) assert.match(g.definition, /UNVERIFIED on our tenant/, g.id);
});

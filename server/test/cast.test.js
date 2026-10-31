import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CAST, VERTICALS, fill, fillDeep, loadCast, unfilled, verticalFrom } from '../src/cast.js';
import { rawStory } from '../src/story.js';
import { rawDiagram, DIAGRAM_NAMES } from '../src/diagramData.js';
import { SCENARIOS } from '../src/data.js';

test('three vertical packs: finance, health, retail', () => {
  assert.deepEqual(Object.keys(VERTICALS).sort(), ['finance', 'health', 'retail']);
  assert.equal(verticalFrom('nope'), 'finance');
});

test('every {{token}} in the story and diagram data is defined by every vertical pack', () => {
  const text = JSON.stringify([rawStory(), SCENARIOS, ...DIAGRAM_NAMES.map(rawDiagram)]);
  assert.ok(/\{\{cast/.test(text), 'the story really uses tokens');
  for (const [v, cast] of Object.entries(VERTICALS)) assert.deepEqual(unfilled(text, cast), [], v);
});

test('a test would catch an undefined token', () => {
  assert.deepEqual(unfilled('hello {{castBrand}} {{castNope}}', DEFAULT_CAST), ['castNope']);
  assert.equal(fill('{{castNope}}', DEFAULT_CAST), '{{castNope}}');
});

test('fillDeep fills nested data and is not recursive (a very deep value does not overflow the stack)', () => {
  assert.deepEqual(fillDeep({ a: ['{{castBrand}}', { b: '{{castHost}}' }], n: 1, z: null }, DEFAULT_CAST), { a: ['Fabrikam Bank', { b: 'fabrikam' }], n: 1, z: null });
  let deep = '{{castBrand}}'; for (let i = 0; i < 50_000; i++) deep = { x: deep };
  assert.ok(fillDeep(deep, DEFAULT_CAST));
});

test('customer.config.json overrides only brand, agentId and host, and refuses hosts and urls', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ca-')), 'customer.config.json');
  fs.writeFileSync(f, JSON.stringify({ cast: { brand: 'Acme Corp', agentId: 'bot.one', host: 'acme', repo: 'steal' } }));
  const c = loadCast(f, 'retail');
  assert.equal(c.castBrand, 'Acme Corp'); assert.equal(c.castAgentId, 'bot.one'); assert.equal(c.castHost, 'acme');
  assert.equal(c.castRepo, VERTICALS.retail.castRepo, 'the repository is not configurable');
  fs.writeFileSync(f, JSON.stringify({ cast: { brand: 'See https://evil.com', host: 'a.b.c' } }));
  assert.equal(loadCast(f).castBrand, DEFAULT_CAST.castBrand);
  assert.equal(loadCast(f).castHost, DEFAULT_CAST.castHost);
});

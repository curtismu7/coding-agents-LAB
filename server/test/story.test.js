import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CAST, VERTICALS } from '../src/cast.js';
import { buildStory, renderTalkTrackMarkdown } from '../src/story.js';
import { scanHosts, scanKeys } from '../src/safety.js';
import { CLAIM_LABEL, TALK_TRACK } from '../src/data.js';

test('docs/talk-track.md is exactly what the talk-track data renders (no drift), and carries the Why it matters entry', () => {
  const doc = fs.readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8');
  assert.equal(doc, renderTalkTrackMarkdown(DEFAULT_CAST));
  assert.ok(TALK_TRACK.length >= 9);
  const why = TALK_TRACK.find((t) => t.id === 'why-it-matters').say;
  assert.match(why, /bypasses every gateway control/); assert.match(why, /TLS-decryption project/); assert.match(why, /one policy and one audit trail/);
});

test('every banner and the intro say the claims are UNVERIFIED on our tenant, and the claims list carries all seven', () => {
  const s = buildStory(DEFAULT_CAST, 'finance');
  assert.equal(s.claimLabel, CLAIM_LABEL);
  assert.match(s.banner.mock, /UNVERIFIED on our tenant/); assert.match(s.banner.live, /UNVERIFIED on our tenant/);
  assert.deepEqual(s.claims.map((c) => c.id), ['hooks', 'same-policy', 'native', 'secrets', 'identity', 'fail', 'why-hook']);
});

test('the filled story names no non-reserved host and no real-looking key, in any vertical; the only credential is the labelled mock one; never the word "door"', () => {
  for (const [v, cast] of Object.entries(VERTICALS)) {
    const text = JSON.stringify(buildStory(cast, v));
    assert.deepEqual(scanHosts(text), [], v);
    assert.deepEqual(scanKeys(text), [], v);
    assert.ok(text.includes('sk-MOCK-'), 'the mock credential is present in the prompt scenario');
    assert.ok(!/\bdoor\b/i.test(text), `${v}: say "P1 Privilege Agent App", not "door"`);
  }
});

test('no credential-shaped string is committed: the repository holds no sk-MOCK literal, only the parts', () => {
  const src = fs.readFileSync(new URL('../src/data.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('sk-MOCK-'));
});

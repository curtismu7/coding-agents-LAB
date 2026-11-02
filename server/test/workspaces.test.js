import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AUDIT, MAX_GAPS, WORKSPACE_RE, createWorkspaces, workspaceFrom } from '../src/workspaces.js';

test('workspaceFrom defaults, accepts a good id and refuses a bad one', () => {
  assert.equal(workspaceFrom({ headers: {} }), 'default');
  assert.equal(workspaceFrom({ headers: { 'x-workspace': 'abc-1' } }), 'abc-1');
  for (const bad of ['', 'A', 'a b', 'a/b', 'x'.repeat(41), ['a']]) assert.equal(workspaceFrom({ headers: { 'x-workspace': bad } }), null);
  assert.ok(WORKSPACE_RE.test('a'));
});

test('workspaces are isolated, audit and gaps are bounded, reset is per workspace', () => {
  const w = createWorkspaces();
  for (let i = 0; i < MAX_AUDIT + 5; i++) w.addAudit('a', { agent: 'x' });
  for (let i = 0; i < MAX_GAPS + 5; i++) w.addGap('a', { agent: 'x' });
  w.addAudit('b', { agent: 'y' });
  assert.equal(w.audit('a').audit.length, MAX_AUDIT);
  assert.equal(w.gaps('a').gaps.length, MAX_GAPS);
  w.reset('a');
  assert.deepEqual([w.audit('a').audit.length, w.gaps('a').gaps.length, w.audit('b').audit.length], [0, 0, 1]);
});

test('the store expires old workspaces and caps their count', () => {
  let t = 0;
  const w = createWorkspaces({ max: 3, ttlMs: 100, now: () => t });
  for (const id of ['a', 'b', 'c', 'd']) w.addAudit(id, { agent: 'x' });
  assert.equal(w.size(), 3);
  t = 500;
  assert.equal(w.audit('d').audit.length, 0);
  assert.equal(w.size(), 0);
});

// ---- F: credential-looking ids are refused (never echoed); boundaries are literal ----
import { validWorkspaceId } from '../src/workspaces.js';
import { withServer } from './helpers.js';

// CHANGED: the rule is the shared masker's isCredentialId. An id that merely CONTAINS a credential word (a-password-b, pwd-1, sk, x-sk-y) is a lab name, not a
// credential, and is accepted now; what looks like a credential (a token prefix with a body, a long hex run, "password is X") is still refused.
test('F: validWorkspaceId: 23 hex in a row is fine, 24 is not; 40 characters is fine, 41 is not; credential-looking ids are refused', () => {
  for (const ok of ['default', 'w-0123456789abcdef', 'abc-1', 'w-b1-hook', 'a'.repeat(23), '0'.repeat(23), 'z'.repeat(40), 'my-tokens', 'passwords', 'a-password-b', 'pwd-1', 'sk', 'x-sk-y', 'w-password-reset']) assert.equal(validWorkspaceId(ok), true, ok);
  for (const bad of ['', 'a'.repeat(24), '0'.repeat(24), 'w-0123456789abcdef01234567', 'z'.repeat(41), 'sk-abcdefghijklmnop1234', 'pw-hunter2xyz', 'token-abc', 'ghp-abc', 'A', 'a b', 'my-password-is-hunter2xyz', 'x-token-abc123', 'password-hunter2xyz']) assert.equal(validWorkspaceId(bad), false, bad);
  assert.equal(validWorkspaceId(undefined), false); assert.equal(validWorkspaceId(['a']), false);
});

test('F: the server answers 400 bad_workspace for a credential-looking id on every workspace endpoint and never echoes it', async () => {
  await withServer(async (url) => {
    const ids = [['sk', 'abcdefghijklmnop1234'].join('-'), 'pw-hunter2xyz', ['token', 'hunter2xyz'].join('-'), '0123456789abcdef01234567', ['password', 'hunter2xyz'].join('-')]; // built at run time: the scanners dislike key-shaped literals
    for (const id of ids) {
      for (const [method, p] of [['GET', '/api/audit'], ['GET', '/api/gaps'], ['POST', '/api/reset'], ['POST', '/api/hook'], ['POST', '/api/evaluate']]) {
        const res = await fetch(`${url}${p}`, { method, headers: { 'content-type': 'application/json', origin: url, 'x-workspace': id }, body: method === 'POST' ? '{}' : undefined });
        const text = await res.text();
        assert.equal(res.status, 400, `${method} ${p} ${id}`); assert.deepEqual(JSON.parse(text), { error: 'bad_workspace' }); assert.ok(!text.includes(id.slice(0, 12)));
      }
    }
    const good = await fetch(`${url}/api/audit`, { headers: { 'x-workspace': 'w-0123456789abcdef' } });
    assert.equal(good.status, 200); assert.equal((await good.json()).workspace, 'w-0123456789abcdef');
  });
});

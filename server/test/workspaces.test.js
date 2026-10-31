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

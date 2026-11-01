// The certificate subject and the one-line summaries: masked whole before they are split, hashed or cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { identityFrom, mockCertSubject } from '../src/identity.js';
import { summarize } from '../src/evaluation.js';
import { DEFAULT_CAST } from '../src/cast.js';
import { withServer, post } from './helpers.js';

const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

test('the fingerprint hashes the MASKED subject: a typed secret leaves no hash behind; a clean subject hashes as it is', () => {
  const clean = mockCertSubject(DEFAULT_CAST);
  assert.equal(identityFrom(clean).fingerprint, sha16(clean));
  const typed = 'CN=bob,OU=device:password=hunter2xyz,O=Lab';
  const who = identityFrom(typed);
  assert.equal(who.fingerprint, sha16('CN=bob,OU=device:password=[masked],O=Lab'));
  assert.notEqual(who.fingerprint, sha16(typed));
  assert.equal(who.device, 'password=[masked]');
});

test('the subject is masked whole before it is split into CN and OU; control characters are deleted', () => {
  assert.equal(identityFrom('CN=pass\u0001word=hunter2xyz').identity, 'password=[masked]');
  assert.equal(identityFrom('CN=bob@host.example,OU=device:LT-1').identity, 'bob@host.example');
  assert.equal(identityFrom('nothing useful').identity, 'unknown');
});

test('summarize: an MCP pair is masked as two words (server "password", tool "hunter2xyz"), otherwise the slash form stays', () => {
  assert.equal(summarize({ kind: 'mcp_call', server: 'password', tool: 'hunter2xyz', args: {} }), 'password [masked] {}');
  assert.equal(summarize({ kind: 'tool_result', server: 'token', tool: 'hunter2xyz', result: 'ok' }), 'token [masked] returned: ok');
  assert.equal(summarize({ kind: 'mcp_call', server: 'srv', tool: 'tool', args: { a: 1 } }), 'srv/tool {"a":1}');
  assert.equal(summarize({ kind: 'mcp_call', server: 'srv', tool: 'tool', args: { 'p\u0001assword': 'hunter2xyz' } }), 'srv tool {"password":[masked]}', 'a control character in a key is deleted, the value masked; the slash is lost once something was masked');
  assert.equal(summarize({ kind: 'prompt', text: `${'x '.repeat(100)}password=hunter2xyz` }).length, 140, 'cut to 140 after masking');
  assert.equal(summarize({ kind: 'prompt', text: 'password=hunter2xyz' }), 'password=[masked]');
});

test('a hook certSubject of 300 characters is read, 301 is refused whole with a 400 (never cut), and the refusal quotes nothing', async () => {
  await withServer(async (url) => {
    const payload = { hook_event_name: 'UserPromptSubmit', prompt: 'hi' };
    const subject = (n) => `CN=${'a'.repeat(n - 3)}`;
    const ok = await post(url, '/api/hook', { agent: 'claude-code', payload, certSubject: subject(300) }, { 'x-workspace': 'w-cert-ok' });
    assert.equal(ok.status, 200);
    const no = await post(url, '/api/hook', { agent: 'claude-code', payload, certSubject: subject(301) }, { 'x-workspace': 'w-cert-no' });
    assert.equal(no.status, 400);
    const text = await no.text();
    const long = await post(url, '/api/hook', { agent: 'claude-code', payload, certSubject: `CN=hunter2xyz${'a'.repeat(400)}` }, { 'x-workspace': 'w-cert-long' });
    assert.equal(long.status, 400); assert.ok(!(await long.text()).includes('hunter2xyz'));
    assert.deepEqual(JSON.parse(text), { error: 'bad_cert_subject', detail: 'certSubject is at most 300 characters' });
  });
});

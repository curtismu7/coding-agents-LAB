// Masking is a heuristic; these pin the shapes it must catch and the sentences it must leave readable. Numbers in the assertions are literals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MARK, TOO_LONG, cut, maskDeep, maskText, redact } from '../src/mask.js';
import { AGENTS } from '../src/agents.js';
import { VERTICALS } from '../src/cast.js';
import { CONFIG_FIELDS, defaultConfig, generateAll } from '../src/codingConfig.js';
import { DIAGRAM_NAMES, buildDiagram } from '../src/diagramData.js';
import { MOCK_TABLE } from '../src/mockTable.js';
import { SOURCES } from '../src/sources.js';
import { buildStory } from '../src/story.js';

const V = 'hunter2xyz';
const K = 'abcdefghijklmnop1234';
const ZW = '​';

// ---------- A: controls and invisible characters inside a keyword or a value ----------
const SEPARATORS = ['\t', '\n', '\r', ' ', ' '];
const C0_C1 = Array.from({ length: 0xa0 }, (_, c) => c).filter((c) => (c < 0x20 || c >= 0x7f) && !SEPARATORS.includes(String.fromCharCode(c)));

test('A: no C0 or C1 control (except tab, newline and CR) can split a keyword or a value; text with no secret in it is returned as typed, controls included', () => {
  assert.equal(C0_C1.length, 62, '29 C0 controls (not tab, LF, CR) + U+007F + 32 C1 controls');
  for (const c of C0_C1) {
    const ch = String.fromCharCode(c); const hex = c.toString(16);
    assert.equal(maskText(`pass${ch}word=${V}`), MARK, `U+00${hex} inside the keyword`);
    assert.equal(maskText(`password=hunt${ch}er2xyz`), MARK, `U+00${hex} inside the value`);
    assert.equal(maskText(`a${ch}b`), `a${ch}b`, `U+00${hex}: the shared masker finds on a cleaned view and returns the text as typed (it no longer deletes controls from the output)`);
  }
});

test('A: the sweep payloads with controls interleaved are masked', () => {
  const cases = [
    `p\u0001a\u0001s\u0001s\u0001w\u0001o\u0001r\u0001d: ${V}`, `pass\u0000word=${V}`, `pass\u0085word=${V}`, `pass\u007fword=${V}`, `my pa\u0000ss\u0000word is ${V}`,
    `tok\u0001en ${V}`, `Bea\u0001rer ${V}`, `s\u0001k-${K}`,
  ];
  for (const c of cases) { const out = maskText(c); assert.ok(!out.includes(V) && !out.includes(K), `${JSON.stringify(c)} -> ${out}`); assert.ok(out.includes(MARK), c); }
});

test('A: tab, newline, CR, U+2028 and U+2029 inside a keyword are caught too, and a plain multi-line text keeps its lines', () => {
  for (const sep of SEPARATORS) {
    assert.equal(maskText(`pass${sep}word=${V}`), MARK, JSON.stringify(sep));
    assert.equal(maskText(`to${sep}ken ${V}`), MARK, JSON.stringify(sep));
    assert.equal(maskText(`Bearer${sep}${V}`), MARK, JSON.stringify(sep));
    // CHANGED (shared masker): a value ends at whitespace, so the part of a secret AFTER a typed whitespace character is not masked (the old masker took it too). Stated in the README.
    assert.equal(maskText(`password=hunt${sep}er2xyz`), `${MARK}${sep}er2xyz`, `${JSON.stringify(sep)} inside the value ends the value`);
  }
  assert.equal(maskText('line one\nline two\tcol\r\nlast'), 'line one\nline two\tcol\r\nlast');
  assert.equal(maskText(`dc-1\nrack 4\npassword=${V}\n next line`), `dc-1\nrack 4\n${MARK}\n next line`, 'lines around a secret stay');
  assert.equal(maskText(`password=${V}\nnext line`), `${MARK}\nnext line`, 'the old masker also took the first word of the next line; the shared one does not');
});

test('A: zero-width and other invisible characters, fullwidth letters and percent-encoding cannot hide a keyword or a value', () => {
  for (const c of [`pass${ZW}word=${V}`, `to${ZW}${ZW}ken=${V}`, `password­=${V}`, `password=${V.slice(0, 4)}⁠${V.slice(4)}`, `p﻿w: ${V}`, `tok\u{e0020}en=${V}`, `token�=${V}`, `ｐａｓｓｗｏｒｄ＝${V}`]) {
    assert.ok(!maskText(c).includes(V), JSON.stringify(c));
  }
  const enc = (s) => encodeURIComponent(s);
  const one = enc(`password=${V}`); const two = enc(one); const three = enc(two);
  for (const e of [one, two, three]) assert.ok(!maskText(e).includes(V), e);
  assert.ok(!maskText(`%70assword%3D${V}`).includes(V));
  assert.ok(!maskText(`%E0%A4%A password=${V}`).includes(V), 'a malformed escape does not stop the masking');
  assert.equal(maskText('50%25 done'), '50%25 done', 'text with no secret is shown as typed, not decoded');
});

// ---------- B: a keyword and a plain space ----------
test('B: a strong keyword, a plain space and a value of 6+ characters with a digit masks the value', () => {
  for (const k of ['password', 'pw', 'token', 'secret', 'api key', 'db pwd', 'credentials', 'passphrase', 'apikey', 'api-key', 'private key', 'access key', 'client secret', 'session id', 'Passwords', 'TOKENS', 'passwd', 'pwd']) {
    const lead = k === 'db pwd' ? 'db ' : ''; // the shared masker masks the keyword with its value ("pwd" alone is the keyword in "db pwd")
    assert.equal(maskText(`${k} ${V}`), `${lead}${MARK}`, k);
    assert.equal(maskText(`my ${k}   ${V} and more`), `my ${lead}${MARK} and more`, `${k} with several spaces and text after`);
  }
});

test('B: the key is X, key=X, "my password is X" and "the token was X"', () => {
  // CHANGED (shared masker): the keyword is masked together with its value, so the keyword no longer survives next to the mark.
  assert.equal(maskText(`the key is ${V}`), MARK);
  assert.equal(maskText(`key=${V}`), MARK);
  assert.equal(maskText(`Key: ${V}`), MARK);
  assert.equal(maskText(`my_key=${V}`), MARK);
  assert.equal(maskText(`my password is ${V}`), `my ${MARK}`);
  assert.equal(maskText(`the token was ${V}`), `the ${MARK}`);
  assert.equal(maskText(`password+is+${V}`), MARK);
  // CHANGED (shared masker 1.4.0 gap, reported): "api+key+X" (a URL-encoded space) is NOT masked any more; "password+is+X" still is.
  assert.equal(maskText(`api+key+${V}`), `api+key+${V}`, 'documented limit');
});

test('B: the documented false-positive tradeoff: ordinary sentences stay readable', () => {
  for (const ok of [
    'password reset', 'please reset the password policy', 'token bucket refills', 'secret santa', 'the password manager is open', 'Corporate VPC scanner for the secretary', 'the monkey and the turkey',
    'pass the salt', 'passwords and keys rotate monthly', 'rotate the tokens on the first of the month', 'contact mailto:ops@corp.example', 'meeting 12:30 in room 4', 'keyboard layout', 'a key point',
    'Pass-through proxy', 'C++ and a+b', 'tokenizer settings', 'dc-1 / rack 4', 'run npm test and fix the failing test', 'write the token refresh code', 'git status', 'author: nobody', 'bypass the cache',
  ]) assert.equal(maskText(ok), ok, ok);
  // and the price of that rule, stated rather than hidden:
  assert.equal(maskText('password correcthorse'), 'password correcthorse', 'a plain-word value with no digit is NOT masked after a plain space');
  assert.equal(maskText('password abc12'), 'password abc12', 'a value shorter than 6 characters is NOT masked after a plain space');
  assert.equal(maskText('password abc123'), MARK, '6 characters and a digit is the smallest value that is masked');
  assert.equal(maskText('the token is valid'), 'the token is valid');
  assert.equal(maskText('the key is long enough'), 'the key is long enough', 'a weak keyword with "is" takes a value only when it has a digit');
  assert.equal(maskText('this pass was approved'), 'this pass was approved');
  assert.equal(maskText('A prompt carrying a credential is stopped outright'), 'A prompt carrying a credential is stopped outright');
  assert.equal(maskText('the password is required'), 'the password is required', 'FIXED false positive (shared masker): a plain word after "password is" is no longer taken for the value');
  assert.equal(maskText('my secret is correcthorse'), 'my secret is correcthorse', 'the price: only "password is x" takes a value with no digit');
  assert.equal(maskText('my password is correcthorse'), `my ${MARK}`);
  assert.equal(maskText('Look at the key: value pairs'), 'Look at the key: value pairs', 'FIXED false positive (shared masker)');
});

// ---------- C, D: userinfo and JSON ----------
test('C: URL userinfo with and without a scheme', () => {
  // CHANGED (shared masker): the "@" belongs to the masked userinfo, so the mark touches the host.
  assert.equal(maskText(`bob:${V}@host.example`), `${MARK}host.example`);
  assert.equal(maskText(`//bob:${V}@host.example`), `//${MARK}host.example`);
  assert.equal(maskText(`https://bob:${V}@host.example/x`), `https://${MARK}host.example/x`);
  assert.equal(maskText(`ftp://bob@host.example/x`), `ftp://${MARK}host.example/x`);
  assert.equal(maskText('//bob@host.example'), '//bob@host.example', 'CHANGED: a user name with no password after // is no longer masked');
  assert.equal(maskText(`login bob:${V}@10.0.0.5:8080/x`), MARK, 'over-masks: the rest of the token after the keyword goes with it');
  assert.equal(maskText('mail ops@corp.example or mailto:ops@corp.example'), 'mail ops@corp.example or mailto:ops@corp.example');
});

test('D: JSON-quoted assignment as text, nested and with odd quoting', () => {
  // CHANGED (shared masker): the quoted key goes with its value.
  assert.equal(maskText(`{"password":"${V}"}`), `{${MARK}}`);
  assert.equal(maskText(`{ 'client_secret' : '${V}' }`), `{ ${MARK} }`);
  assert.equal(maskText(`{"apiKey": "${V}"}`), `{${MARK}}`);
  assert.equal(maskText(`{"token":{"v":"${V}"}}`), `{${MARK}}`);
  assert.equal(maskText(`{"a":1,"x_password":"${V}","b":2}`), `{"a":1,${MARK},"b":2}`);
  assert.equal(maskText(`credential => ${V}`), MARK);
});

test('headers, bearer, JWT, prefixed tokens, key blocks and long opaque runs', () => {
  for (const c of [`Authorization: token ${V} more`, `Authorization: Bearer ${V}`, `Cookie: sid=${V}; other=1`, `Proxy-Authorization: Basic ${V}`]) {
    const out = maskText(c); assert.ok(!out.includes(V) && !out.includes('more') && !out.includes('other'), `${c} -> ${out}`);
  }
  for (const c of ['Bearer abcdef123456', 'bearer aaaaaaaaaaaaaaaaaaaa', 'eyJhbGciOi.eyJzdWIiOi.sig', 'sk-abcdef1234567890abcd', 'ghp_a1b2c3d4e5f6a7b8c9d0', 'xoxb-1234abcd', 'glpat-abcdefgh1234567890', `${'AKIA'}ABCDEFGHIJKLMNOP`, `${'ASIA'}ABCDEFGHIJKLMNOP`,
    `${'-----BEGIN '}PRIVATE KEY-----\nMIIEvQIBADANBg\n${'-----END '}PRIVATE KEY-----`, `${'-----BEGIN '}PRIVATE KEY-----\ntruncated block with no end`, `${'0123456789abcdef'.repeat(4)}`, `${'a1'.repeat(25)}`]) {
    assert.ok(maskText(c).includes(MARK), c);
  }
  // CHANGED (shared masker): token prefixes need a realistic length; sk-abc123, ghp_abcdef12, glpat-abcdefgh and ASIAABCDEFGHIJKL are too short to be taken for keys.
  for (const short of ['sk-abc123', 'ghp_abcdef12', 'glpat-abcdefgh', 'ASIAABCDEFGHIJKL']) assert.equal(maskText(short), short, short);
  assert.equal(maskText('bearer tokens are short lived'), 'bearer tokens are short lived');
  assert.equal(maskText('trace 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01 ok'), 'trace 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01 ok', 'a traceparent is not a secret');
});

// ---------- bounds ----------
test('masking happens BEFORE the cut to length: a secret after filler is masked, one that straddles the cut is not half kept', () => {
  assert.ok(!redact(`${'x '.repeat(9995)}password=${V}`, 20_000).includes(V));
  assert.equal(redact(`${'x'.repeat(50)} password=${V}`, 68), `${'x'.repeat(50)} ${MARK}`);
  assert.equal(redact(`${'x'.repeat(50)} password=${V}`, 55), `${'x'.repeat(50)} [mas`, 'cut after masking: the end of the marker is lost, never a part of the secret');
  const straddle = redact(`${'x'.repeat(60)} password=${V}`, 70);
  assert.ok(!straddle.includes('hunter') && !straddle.includes('2xyz'), straddle);
  assert.equal(redact('😀'.repeat(100), 59), '😀'.repeat(29), 'the limit counts UTF-16 units and never leaves half a surrogate pair');
  assert.equal(redact('é'.repeat(100), 59), 'é'.repeat(59));
  assert.equal(cut('😀😀', 3), '😀');
  assert.equal(redact('a\n\n  b\t c', 120), 'a b c', 'redact is one line');
});

test('anything over 1 000 000 characters is refused whole, 1 000 000 is checked', () => {
  assert.equal(maskText('a'.repeat(1_000_001)), TOO_LONG);
  assert.equal(maskText(' '.repeat(1_000_000)), ' '.repeat(1_000_000));
  assert.ok(!maskText(`${'a '.repeat(499_000)}password=${V}`).includes(V));
});

test('masking is idempotent, deterministic, and a non-string is read as text', () => {
  for (const c of [`password=${V}`, `Authorization: Bearer ${V}`, 'plain text', `{"password":"${V}"}`, `bob:${V}@host.example`, `p\u0001assword ${V}`]) { const once = maskText(c); assert.equal(maskText(once), once, c); assert.equal(maskText(c), once); }
  assert.equal(maskText(42), '42');
  assert.equal(maskText(null), '');
  assert.equal(maskText(undefined), '');
});

test('adversarial inputs finish: no detector backtracks (a work bound that only separates linear from quadratic)', () => {
  const N = 300_000;
  const inputs = [' '.repeat(N), 'password'.repeat(N / 8), `password${' '.repeat(N)}`, 'a:'.repeat(N / 2), '-----BEGIN X-----'.repeat(N / 17), '://'.repeat(N / 3), `${'a'.repeat(N)}@`, 'token='.repeat(N / 6), '{'.repeat(N), `"${'x'.repeat(N)}`,
    'Bearer '.repeat(N / 7), 'eyJ'.repeat(N / 3), '%'.repeat(N), 'authorization:'.repeat(N / 14), 'pw '.repeat(N / 3), 'password "'.repeat(N / 10), 'a:b@'.repeat(N / 4), `ab:${'c'.repeat(N)}`, 'key is '.repeat(N / 7), '\t'.repeat(N),
    '+'.repeat(N), 'token\t'.repeat(N / 6), 'api key '.repeat(N / 8), `password ${'a'.repeat(N)}`, `pw ${'1'.repeat(N)}`, '//'.repeat(N / 2), 'key is a1 '.repeat(N / 10), `${'a1'.repeat(N / 2)}`, '\n'.repeat(N), 'pass\n'.repeat(N / 5)];
  const t0 = Date.now();
  for (const s of inputs) maskText(s);
  assert.ok(Date.now() - t0 < 120_000, 'a quadratic detector on 300 000 characters needs hours; linear ones need seconds');
});

// ---------- maskDeep: values AND keys ----------
test('maskDeep masks every string and every object key, keeps order and shape, and survives 50 000 levels', () => {
  const v = maskDeep({ [`password=${V}`]: [`x password=${V}`, { b: `sk-${K}` }], n: 1, z: null, t: true });
  assert.equal(JSON.stringify(v), `{"${MARK}":["x ${MARK}",{"b":"${MARK}"}],"n":1,"z":null,"t":true}`);
  assert.deepEqual(Object.keys(maskDeep({ z: 1, a: 2, m: { y: 1, b: 2 } })), ['z', 'a', 'm']);
  let deep = `password=${V}`; for (let i = 0; i < 50_000; i += 1) deep = { x: deep };
  assert.doesNotThrow(() => maskDeep(deep));
});

test('maskDeep keeps two keys that mask alike apart, and a __proto__ key stays an own property', () => {
  const v = maskDeep({ [`password=${V}`]: 1, [`password=${K}`]: 2 });
  assert.deepEqual(Object.keys(v), [MARK, `${MARK}#2`]);
  const p = maskDeep(JSON.parse('{"__proto__":{"polluted":"yes"},"a":1}'));
  assert.deepEqual(Object.keys(p), ['__proto__', 'a']);
  assert.equal(Object.getPrototypeOf(p), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('masking leaves the lab\'s own text alone: agents, mock table, sources, stories, diagrams, config fields and every generated config', () => {
  // the one credential-shaped string in the lab's own text is the labelled mock key (rule 4); it (and the "is" before it) is swapped for plain words here
  const plain = (value) => JSON.parse(JSON.stringify(value).replace(/ is sk-MOCK-[A-Za-z0-9]+/g, ' sits in the vault').replace(/sk-MOCK-[A-Za-z0-9]+/g, 'MOCKKEY'));
  const same = (label, value) => assert.deepEqual(maskDeep(plain(value)), plain(value), label);
  // The mock table is keyed by scenario id and one id, "secret-prompt", holds the word secret AS A KEY, which the shared masker (rightly) treats as a credential name. The table never leaves
  // the server (the API answers only values), so each scenario row is checked on its own.
  same('agents', AGENTS); same('sources', SOURCES); same('config fields', CONFIG_FIELDS);
  for (const [vertical, rows] of Object.entries(MOCK_TABLE)) for (const [scenario, row] of Object.entries(rows)) same(`mock table ${vertical}/${scenario}`, row);
  for (const [vertical, cast] of Object.entries(VERTICALS)) {
    same(`story ${vertical}`, buildStory(cast, vertical));
    for (const name of DIAGRAM_NAMES) same(`diagram ${name} ${vertical}`, buildDiagram(cast, name));
    same(`generated ${vertical}`, generateAll(defaultConfig(cast)));
  }
  assert.equal(Object.keys(VERTICALS).length, 3);
});

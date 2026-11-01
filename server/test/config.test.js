import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_IDS } from '../src/agents.js';
import { DEFAULT_CAST } from '../src/cast.js';
import { CONFIG_FIELDS, coveredAgents, defaultConfig, generateAll, generateFor, isCovered, validateConfig } from '../src/codingConfig.js';

test('the field names are the console swagger names (schema only) and nothing else is claimed as one', () => {
  assert.deepEqual(CONFIG_FIELDS.map((f) => f.name), ['Enabled', 'FailClosed', 'Agents', 'Gateways', 'AIGuard', 'AIIntent', 'Behaviour']);
  assert.ok(CONFIG_FIELDS.every((f) => f.swagger === true));
  assert.deepEqual(Object.keys(defaultConfig(DEFAULT_CAST)), ['Enabled', 'FailClosed', 'Agents', 'Gateways']);
});

test('validation: types, agent names, gateway hosts, duplicates, size', () => {
  assert.equal(validateConfig(defaultConfig(DEFAULT_CAST)).ok, true);
  const bad = (c) => validateConfig(c).errors.map((e) => e.field);
  assert.deepEqual(bad({ Enabled: 'yes' }), ['Enabled']);
  assert.deepEqual(bad({ FailClosed: 1 }), ['FailClosed']);
  assert.deepEqual(bad({ Agents: { vim: true } }), ['Agents']);
  assert.deepEqual(bad({ Agents: { cursor: 'on' } }), ['Agents']);
  assert.deepEqual(bad({ Agents: [] }), ['Agents']);
  assert.deepEqual(bad({ Gateways: ['http://gw.example/'] }), ['Gateways'], 'https only');
  assert.deepEqual(bad({ Gateways: ['https://real-host.com/'] }), ['Gateways'], 'reserved hosts only');
  assert.deepEqual(bad({ Gateways: ['https://u:p@gw.example/'] }), ['Gateways'], 'no credentials');
  assert.deepEqual(bad({ Gateways: ['https://a.example/', 'https://a.example/'] }), ['Gateways'], 'no duplicates');
  assert.deepEqual(bad({ Gateways: Array.from({ length: 6 }, (_, i) => `https://g${i}.example/`) }), ['Gateways']);
  assert.deepEqual(bad({ Gateways: 'x' }), ['Gateways']);
  assert.deepEqual(bad({ Surprise: 1 }), ['(unknown field)']);
  assert.deepEqual(bad({ AIGuard: 'x' }), ['AIGuard']);
  assert.deepEqual(bad({ AIGuard: { big: 'x'.repeat(5000) } }), ['AIGuard']);
  for (const junk of [null, 'x', 5, []]) assert.equal(validateConfig(junk).ok, false);
});

test('warnings, not errors: Enabled with every named agent false, or no gateways', () => {
  assert.ok(validateConfig({ Enabled: true, Agents: { cursor: false } }).warnings.length);
  assert.ok(validateConfig({ Enabled: true, Gateways: [] }).warnings.length);
  assert.equal(validateConfig({ Enabled: false, Gateways: [] }).warnings.length, 0);
});

test('coverage: off covers nothing, empty Agents covers every agent found, named agents cover only the true ones', () => {
  assert.deepEqual(coveredAgents({ Enabled: false, Agents: {} }), []);
  assert.deepEqual(coveredAgents({ Enabled: true, Agents: {} }), AGENT_IDS);
  assert.deepEqual(coveredAgents({ Enabled: true, Agents: { cursor: true, codex: false } }), ['cursor']);
  assert.ok(!isCovered({ Enabled: true, Agents: { cursor: true } }, 'codex'));
});

test('generated managed configuration: text only, parseable, carries the failure policy and the gateways, honest about its status', () => {
  const cfg = { ...defaultConfig(DEFAULT_CAST), FailClosed: true };
  const all = generateAll(cfg);
  assert.equal(all.length, 6);
  for (const g of all) {
    assert.equal(typeof g.text, 'string');
    assert.match(g.text, /--fail-closed/); assert.match(g.text, /tunnel-1\.fabrikam\.example/); assert.ok(g.bodyStatus === 'illustrative' && g.caveat);
    const jsonPart = g.text.slice(g.text.indexOf('{'), g.text.lastIndexOf('}') + 1);
    assert.doesNotThrow(() => JSON.parse(jsonPart), g.agent);
  }
  const claude = JSON.parse(generateFor('claude-code', cfg).text);
  assert.equal(claude.allowManagedHooksOnly, true);
  assert.deepEqual(Object.keys(claude.hooks).sort(), ['PostToolUse', 'PreToolUse', 'UserPromptSubmit']);
  assert.equal(generateFor('claude-code', cfg).path, '/Library/Application Support/ClaudeCode/managed-settings.json');
  assert.equal(generateFor('antigravity', cfg).pathStatus, 'illustrative');
  assert.equal(generateFor('claude-code', cfg).pathStatus, 'documented');
  assert.deepEqual(generateAll({ ...cfg, Agents: { cursor: true } }).map((g) => g.agent), ['cursor'], 'only covered agents get text');
  assert.ok(!/--fail-closed/.test(generateFor('cursor', { ...cfg, FailClosed: false }).text));
});

test('a gateway value cannot break out of the generated command line: quotes, spaces and shell characters are refused', () => {
  for (const g of ["https://a.example/'; rm -rf ~; '", 'https://a.example/x y', 'https://a.example/`id`', 'https://a.example/$(id)', 'https://a.example/\\x']) assert.equal(validateConfig({ Gateways: [g] }).ok, false, g);
  const v = validateConfig({ Gateways: ['https://a.example/x'] });
  assert.ok(generateFor('cursor', v.config).text.includes("--gateway 'https://a.example/x'"));
});

test('the default is open: FailClosed is false by default, in the default config and in an empty one', () => {
  assert.equal(defaultConfig(DEFAULT_CAST).FailClosed, false);
  assert.equal(validateConfig({}).config.FailClosed, false);
  assert.equal(validateConfig({ Enabled: true }).config.FailClosed, false);
});

test('the Copilot policy body carries version 1 (tagged illustrative), the Cursor one too', () => {
  for (const id of ['copilot', 'cursor']) assert.equal(JSON.parse(generateFor(id, defaultConfig(DEFAULT_CAST)).text).version, 1, id);
});

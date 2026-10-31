import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, AGENT_IDS, KINDS, nativeOutcome, nativeRequest, parsePayload, respond, unreachableOutcome } from '../src/agents.js';
import { VERTICALS } from '../src/cast.js';
import { SCENARIOS } from '../src/data.js';
import { SOURCES } from '../src/sources.js';
import { ctxFor, scenarioCall } from '../src/evaluation.js';

test('six agents, each with sources, managed paths and a status and a caveat on every channel', () => {
  assert.deepEqual(AGENT_IDS, ['claude-code', 'cursor', 'codex', 'gemini-cli', 'copilot', 'antigravity']);
  for (const a of AGENTS) {
    assert.ok(a.sources.length > 0 && a.sources.every((s) => SOURCES[s]), `${a.id}: every source id is in sources.js`);
    assert.ok(a.managed.length > 0 && a.managed.every((m) => ['documented', 'illustrative'].includes(m.status) && m.path), a.id);
    assert.ok(a.managedNote && a.configCaveat, a.id);
    for (const k of KINDS) {
      const c = a.channels[k];
      assert.ok(['documented', 'partly', 'illustrative'].includes(c.status), `${a.id}/${k}`);
      assert.ok(c.documented || c.illustrative, `${a.id}/${k} says what is documented or illustrative`);
      assert.equal(c.status === 'documented', !c.illustrative, `${a.id}/${k}: documented means nothing illustrative`);
      assert.equal(c.status === 'illustrative', !c.documented, `${a.id}/${k}`);
      assert.ok(c.caveat.length > 20);
    }
  }
});

test('every request shape is parsed back to the same kind of action, for every agent, vertical and scripted action', () => {
  for (const cast of Object.values(VERTICALS)) {
    for (const s of SCENARIOS) {
      const { call } = scenarioCall(cast, s.id);
      for (const id of AGENT_IDS) {
        const req = nativeRequest(id, call, ctxFor(cast));
        const ev = AGENTS.find((a) => a.id === id).channels[call.kind].event;
        if (!ev) { assert.equal(req, null, `${id} has no event for ${call.kind}`); continue; }
        assert.equal(parsePayload(id, req)?.kind, call.kind, `${id}/${s.id}`);
      }
    }
  }
});

test('Claude Code: native shapes (documented envelope)', () => {
  assert.deepEqual(respond('claude-code', 'shell', 'deny', 'why'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'why' } });
  assert.deepEqual(respond('claude-code', 'file_read', 'ask', 'why').hookSpecificOutput.permissionDecision, 'ask');
  assert.deepEqual(respond('claude-code', 'prompt', 'deny', 'why'), { decision: 'block', reason: 'why' });
  assert.deepEqual(respond('claude-code', 'shell', 'allow', ''), {});
  const r = respond('claude-code', 'tool_result', 'deny', 'why');
  assert.equal(r.decision, 'block'); assert.match(r.hookSpecificOutput.updatedToolOutput, /withheld/);
  const req = nativeRequest('claude-code', { kind: 'shell', command: 'ls' }, ctxFor(VERTICALS.finance));
  assert.deepEqual([req.hook_event_name, req.tool_name, req.tool_input.command], ['PreToolUse', 'Bash', 'ls']);
  assert.equal(nativeRequest('claude-code', { kind: 'prompt', text: 'hi' }, ctxFor(VERTICALS.finance)).hook_event_name, 'UserPromptSubmit');
});

test('Cursor: permission allow/deny/ask with user_message, and continue for prompts', () => {
  assert.deepEqual(respond('cursor', 'shell', 'ask', 'why'), { permission: 'ask', user_message: 'why', agent_message: 'Policy: why' });
  assert.equal(respond('cursor', 'mcp_call', 'deny', 'why').permission, 'deny');
  assert.deepEqual(respond('cursor', 'prompt', 'deny', 'why'), { continue: false, user_message: 'why' });
  assert.deepEqual(respond('cursor', 'prompt', 'allow', ''), { continue: true });
  assert.equal(nativeRequest('cursor', { kind: 'shell', command: 'ls' }, ctxFor(VERTICALS.finance)).hook_event_name, 'beforeShellExecution');
});

test('Codex: no working ask (documented), so an ask degrades to a refusal and says so', () => {
  const o = nativeOutcome('codex', 'file_read', 'ask');
  assert.deepEqual([o.native, o.degraded], ['deny', true]);
  assert.match(o.note, /no working ask/);
  assert.equal(respond('codex', 'shell', 'deny', 'why').hookSpecificOutput.permissionDecision, 'deny');
});

test('Gemini CLI: decision allow/deny with a reason; no ask, so it degrades', () => {
  assert.deepEqual(respond('gemini-cli', 'shell', 'deny', 'why'), { decision: 'deny', reason: 'why' });
  assert.deepEqual(nativeOutcome('gemini-cli', 'mcp_call', 'ask').native, 'deny');
  assert.equal(nativeRequest('gemini-cli', { kind: 'prompt', text: 'x' }, ctxFor(VERTICALS.finance)).hook_event_name, 'BeforeAgent');
});

test('Copilot: permissionDecision with reason; its prompt hook cannot refuse (documented), so a deny cannot be enforced there', () => {
  assert.deepEqual(respond('copilot', 'shell', 'ask', 'why'), { permissionDecision: 'ask', permissionDecisionReason: 'why' });
  const o = nativeOutcome('copilot', 'prompt', 'deny');
  assert.deepEqual([o.native, o.unenforceable], ['allow', true]);
});

test('Antigravity: decision with a reason; no prompt hook, so a prompt is not covered; managed path is not documented', () => {
  assert.deepEqual(respond('antigravity', 'file_read', 'ask', 'why'), { decision: 'ask', reason: 'why' });
  const o = nativeOutcome('antigravity', 'prompt', 'deny');
  assert.deepEqual([o.native, o.covered], ['none', false]);
  assert.equal(AGENTS.find((a) => a.id === 'antigravity').managed[0].status, 'illustrative');
});

test('the documented managed paths are the ones read at build time, and the unverified ones say so', () => {
  const by = (id) => AGENTS.find((a) => a.id === id).managed;
  assert.equal(by('claude-code')[0].path, '/Library/Application Support/ClaudeCode/managed-settings.json');
  assert.equal(by('cursor')[1].path, '/etc/cursor/hooks.json');
  assert.equal(by('copilot')[0].path, '/etc/github-copilot/policy.d/*.json');
  assert.equal(by('gemini-cli')[0].path, '/etc/gemini-cli/settings.json');
  for (const id of ['codex', 'antigravity']) assert.equal(by(id)[0].status, 'illustrative');
});

test('unreachable gateway: fail open proceeds with a gap, fail closed refuses where the hook can refuse', () => {
  assert.deepEqual([unreachableOutcome('claude-code', 'shell', false).native, unreachableOutcome('claude-code', 'shell', false).refused], ['allow', false]);
  assert.deepEqual([unreachableOutcome('claude-code', 'shell', true).native, unreachableOutcome('claude-code', 'shell', true).refused], ['deny', true]);
  const cant = unreachableOutcome('copilot', 'prompt', true);
  assert.deepEqual([cant.native, cant.refused], ['allow', false]);
  assert.match(cant.reason, /cannot refuse/);
});

test('hostile payloads parse to null or a call, never throw', () => {
  for (const id of AGENT_IDS) for (const p of [null, 'x', [], {}, { hook_event_name: 5, tool_name: {}, tool_input: 'x' }, { toolCall: 3 }, { toolName: [] }]) assert.doesNotThrow(() => parsePayload(id, p));
});

test('per-channel truth: what is documented and what is illustrative is stated for each channel, not for the whole agent', () => {
  const st = (id, k) => AGENTS.find((a) => a.id === id).channels[k].status;
  assert.equal(st('claude-code', 'prompt'), 'documented');
  for (const k of ['shell', 'file_read', 'mcp_call']) assert.equal(st('claude-code', k), 'partly', `claude ${k}: the tool name strings are not documented`);
  for (const k of ['file_read', 'mcp_call']) { assert.equal(st('gemini-cli', k), 'partly'); assert.equal(st('copilot', k), 'partly'); assert.equal(st('antigravity', k), 'partly'); }
  assert.match(AGENTS.find((a) => a.id === 'gemini-cli').channels.mcp_call.illustrative, /mcp_context/);
  assert.equal(st('cursor', 'file_read'), 'documented');
  assert.equal(st('cursor', 'tool_result'), 'partly');
  assert.equal(st('codex', 'file_read'), 'partly');
  assert.match(AGENTS.find((a) => a.id === 'claude-code').managedNote, /defer/);
});

test('an ask degrades to a refusal where the agent has no ask: Codex and Gemini shell, Cursor file reads; Claude and Copilot keep it', () => {
  for (const [agent, kind] of [['codex', 'shell'], ['gemini-cli', 'shell'], ['codex', 'mcp_call'], ['gemini-cli', 'file_read'], ['cursor', 'file_read']]) {
    const o = nativeOutcome(agent, kind, 'ask');
    assert.deepEqual([o.native, o.degraded], ['deny', true], `${agent}/${kind}`);
  }
  for (const [agent, kind] of [['claude-code', 'shell'], ['copilot', 'shell'], ['cursor', 'shell'], ['cursor', 'mcp_call'], ['antigravity', 'file_read']]) assert.equal(nativeOutcome(agent, kind, 'ask').native, 'ask', `${agent}/${kind}`);
});

test('Claude PostToolUse: a built-in tool result keeps its tool name; an MCP result is split into server and tool', () => {
  const b = parsePayload('claude-code', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'out' });
  assert.deepEqual([b.kind, b.server, b.tool, b.result], ['tool_result', 'builtin', 'Bash', 'out']);
  const m = parsePayload('claude-code', { hook_event_name: 'PostToolUse', tool_name: 'mcp__srv__do__it', tool_input: {}, tool_response: { content: [{ type: 'text', text: 'hi' }] } });
  assert.deepEqual([m.server, m.tool, m.result], ['srv', 'do__it', 'hi']);
});

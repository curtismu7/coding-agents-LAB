// The six coding agents: where each reads its machine-level managed configuration, which hook events carry which kind of action,
// the request JSON the agent writes to the hook, and the NATIVE answer the hook must print (allow / deny / ask).
//
// SOURCE DISCIPLINE. Every channel carries a status:
//   documented   = read in the vendor's own docs at build time, 2026-10-31 (source ids in sources.js; URLs only in the README).
//   illustrative = the lab's own shape, UNVERIFIED. Shown as an example, never stated as fact.
// A `caveat` says exactly which part is not documented. Nothing here is a Ping API: the Ping side is only the CodingAgent
// config (console swagger, schema only), see config.js.
//
// This module is pure (no I/O). The hook script (hooks/lab-hook.mjs) and the server both import it.

export const KINDS = ['prompt', 'shell', 'file_read', 'mcp_call', 'tool_result'];
export const KIND_LABEL = { prompt: 'Prompt', shell: 'Shell command', file_read: 'File read', mcp_call: 'MCP call', tool_result: 'Tool result' };
export const DOC = 'documented';
export const ILL = 'illustrative';
export const PART = 'partly';

// One channel (one kind of action on one agent). `documented` says what was read in the vendor's docs; `illustrative` says what
// is the lab's own, UNVERIFIED. status: documented (nothing illustrative), partly (both), illustrative (nothing documented).
const ch = (event, canBlock, canAsk, documented, illustrative = '') => ({
  event, canBlock, canAsk, documented, illustrative,
  status: !illustrative ? DOC : !documented ? ILL : PART,
  caveat: [documented && `Documented: ${documented}`, illustrative && `Illustrative, UNVERIFIED: ${illustrative}`].filter(Boolean).join(' '),
});

const wrapPre = (name, permissionDecision, reason) => ({ hookSpecificOutput: { hookEventName: name, permissionDecision, permissionDecisionReason: reason } });
const argsOf = (c) => (c.args && typeof c.args === 'object' ? c.args : {});
const mcpName = (sep, c) => `mcp${sep}${c.server}${sep}${c.tool}`;
const resultText = (c) => String(c.result ?? '');

// ---- Claude Code -----------------------------------------------------------------------------------------------------------
const claudeBase = (e, x) => ({ session_id: x.sessionId, transcript_path: '<transcript path>', cwd: x.cwd, permission_mode: 'default', hook_event_name: e });
const claude = {
  id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic',
  sources: ['claude-code-hooks', 'claude-code-managed-settings'],
  managed: [
    { os: 'macOS', path: '/Library/Application Support/ClaudeCode/managed-settings.json', status: DOC },
    { os: 'Linux and WSL', path: '/etc/claude-code/managed-settings.json', status: DOC },
  ],
  managedNote: 'A managed-settings.d/ drop-in directory is also documented. The key allowManagedHooksOnly makes user, project and plugin hooks inert. The documented permissionDecision values are allow, deny, ask and defer (the lab uses the first three).',
  configCaveat: 'The path and the key allowManagedHooksOnly are documented. The exact hooks block written below (matcher, nested hooks array, type command) was not re-read at build time: illustrative shape, UNVERIFIED.',
  channels: {
    prompt: ch('UserPromptSubmit', true, false, 'stdin field prompt; block with top-level decision "block" and reason. There is no ask for this event.'),
    shell: ch('PreToolUse', true, true, 'the envelope: stdin tool_name, tool_input, tool_use_id; stdout hookSpecificOutput.permissionDecision (allow, deny, ask or defer) with permissionDecisionReason.', 'the tool name Bash and the field tool_input.command.'),
    file_read: ch('PreToolUse', true, true, 'the same envelope.', 'the tool name Read and the field tool_input.file_path.'),
    mcp_call: ch('PreToolUse', true, true, 'the same envelope.', 'the spelling mcp__server__tool of an MCP tool name.'),
    tool_result: ch('PostToolUse', true, false, 'stdin tool_response; output decision "block" with reason, or hookSpecificOutput.updatedToolOutput to replace what the model sees (MCP output is passed through unvalidated). The docs say the tool has already run, so a block only adds the reason beside the result.', 'the content/text layout of the tool_response of an MCP result.'),
  },
  request(kind, c, x) {
    switch (kind) {
      case 'prompt': return { ...claudeBase('UserPromptSubmit', x), prompt: c.text };
      case 'shell': return { ...claudeBase('PreToolUse', x), tool_name: 'Bash', tool_input: { command: c.command }, tool_use_id: 'toolu_mock_0001' };
      case 'file_read': return { ...claudeBase('PreToolUse', x), tool_name: 'Read', tool_input: { file_path: c.path }, tool_use_id: 'toolu_mock_0002' };
      case 'mcp_call': return { ...claudeBase('PreToolUse', x), tool_name: mcpName('__', c), tool_input: argsOf(c), tool_use_id: 'toolu_mock_0003' };
      default: return { ...claudeBase('PostToolUse', x), tool_name: mcpName('__', c), tool_input: argsOf(c), tool_response: { content: [{ type: 'text', text: resultText(c) }] }, tool_use_id: 'toolu_mock_0004' };
    }
  },
  parse(p) {
    const e = p.hook_event_name; const t = String(p.tool_name ?? ''); const i = p.tool_input || {};
    if (e === 'UserPromptSubmit') return { kind: 'prompt', text: p.prompt };
    if (e === 'PreToolUse') {
      if (t === 'Bash') return { kind: 'shell', command: i.command };
      if (t === 'Read') return { kind: 'file_read', path: i.file_path };
      if (t.startsWith('mcp__')) { const [, server, ...rest] = t.split('__'); return { kind: 'mcp_call', server, tool: rest.join('__'), args: i }; }
    }
    if (e === 'PostToolUse') {
      const [, server, ...rest] = t.split('__');
      const r = p.tool_response; const text = Array.isArray(r?.content) ? r.content.map((b) => b?.text ?? '').join('\n') : typeof r === 'string' ? r : JSON.stringify(r ?? '');
      return { kind: 'tool_result', server: server || 'builtin', tool: rest.join('__') || t, args: i, result: text };
    }
    return null;
  },
  respond(kind, d, reason) {
    if (d === 'allow') return {};
    if (kind === 'prompt') return { decision: 'block', reason };
    if (kind === 'tool_result') return { decision: 'block', reason, hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: `[withheld by policy] ${reason}` } };
    return wrapPre('PreToolUse', d, reason);
  },
  dialog: { title: 'Claude Code', ask: 'Claude wants to proceed. A managed hook asks you to confirm.', deny: 'Blocked by a managed hook', buttons: ['Yes', 'No'] },
};

// ---- Cursor ----------------------------------------------------------------------------------------------------------------
const cursorBase = (e, x) => ({ conversation_id: 'conv-mock-0001', generation_id: 'gen-mock-0001', model: '<model>', hook_event_name: e, cursor_version: '<version>', workspace_roots: [x.cwd], user_email: x.email, transcript_path: null });
const cursor = {
  id: 'cursor', name: 'Cursor', vendor: 'Anysphere',
  sources: ['cursor-hooks'],
  managed: [
    { os: 'macOS', path: '/Library/Application Support/Cursor/hooks.json', status: DOC },
    { os: 'Linux and WSL', path: '/etc/cursor/hooks.json', status: DOC },
  ],
  managedNote: 'Enterprise (MDM-managed) hooks.json is the highest-priority level; project and user files rank below it.',
  configCaveat: 'The enterprise hooks.json paths and the event names are documented. The file body (version, hooks map of event to command list) was not re-read: illustrative shape, UNVERIFIED.',
  channels: {
    prompt: ch('beforeSubmitPrompt', true, false, 'stdin prompt and attachments; the answer uses continue (boolean) and user_message. No ask.'),
    shell: ch('beforeShellExecution', true, true, 'stdin command, cwd, sandbox; stdout permission allow, deny or ask with user_message and agent_message.'),
    file_read: ch('beforeReadFile', true, false, 'stdin file_path, content, attachments; stdout permission allow or deny (the page lists no ask for this event, so the lab degrades an ask to a refusal).'),
    mcp_call: ch('beforeMCPExecution', true, true, 'stdin tool_name, tool_input, mcp_server_name and a url or command; stdout permission allow, deny or ask.'),
    tool_result: ch('afterMCPExecution', false, false, 'the event exists.', 'its stdin and stdout shapes (the field result_json is invented). Treated as observe-only: the gap is recorded, the result is not withheld.'),
  },
  request(kind, c, x) {
    switch (kind) {
      case 'prompt': return { ...cursorBase('beforeSubmitPrompt', x), prompt: c.text, attachments: [] };
      case 'shell': return { ...cursorBase('beforeShellExecution', x), command: c.command, cwd: x.cwd, sandbox: false };
      case 'file_read': return { ...cursorBase('beforeReadFile', x), file_path: c.path, content: '<file content>', attachments: [] };
      case 'mcp_call': return { ...cursorBase('beforeMCPExecution', x), tool_name: c.tool, tool_input: argsOf(c), mcp_server_name: c.server, command: '<stdio command>' };
      default: return { ...cursorBase('afterMCPExecution', x), tool_name: c.tool, tool_input: argsOf(c), mcp_server_name: c.server, result_json: resultText(c) };
    }
  },
  parse(p) {
    switch (p.hook_event_name) {
      case 'beforeSubmitPrompt': return { kind: 'prompt', text: p.prompt };
      case 'beforeShellExecution': return { kind: 'shell', command: p.command };
      case 'beforeReadFile': return { kind: 'file_read', path: p.file_path };
      case 'beforeMCPExecution': return { kind: 'mcp_call', server: p.mcp_server_name, tool: p.tool_name, args: p.tool_input };
      case 'afterMCPExecution': return { kind: 'tool_result', server: p.mcp_server_name, tool: p.tool_name, args: p.tool_input, result: typeof p.result_json === 'string' ? p.result_json : JSON.stringify(p.result_json ?? '') };
      default: return null;
    }
  },
  respond(kind, d, reason) {
    if (kind === 'prompt') return d === 'allow' ? { continue: true } : { continue: false, user_message: reason };
    if (d === 'allow') return { permission: 'allow' };
    return { permission: d, user_message: reason, agent_message: `Policy: ${reason}` };
  },
  dialog: { title: 'Cursor', ask: 'Cursor asks before it runs this. A managed hook requested confirmation.', deny: 'Blocked by a managed hook', buttons: ['Allow', 'Reject'] },
};

// ---- Codex -----------------------------------------------------------------------------------------------------------------
const codexBase = (e, x) => ({ session_id: x.sessionId, transcript_path: '<transcript path>', cwd: x.cwd, hook_event_name: e, model: '<model>' });
const codex = {
  id: 'codex', name: 'Codex', vendor: 'OpenAI',
  sources: ['codex-hooks'],
  managed: [
    { os: 'macOS and Linux', path: '(requirements.toml with managed_dir; the file location is not documented in the page read)', status: ILL },
  ],
  managedNote: 'Documented: user hooks in ~/.codex/hooks.json and config.toml, and a managed requirements.toml with managed_dir (macOS, Linux) or windows_managed_dir (Windows). Hook scripts for a managed policy must sit under the managed directory.',
  configCaveat: 'managed_dir is documented; the location of requirements.toml and the hooks file body are illustrative, UNVERIFIED.',
  channels: {
    prompt: ch('UserPromptSubmit', true, false, 'the event name.', 'its prompt field and its block answer.'),
    shell: ch('PreToolUse', true, false, 'tool_name, tool_input.command for Bash; deny via hookSpecificOutput.permissionDecision "deny" with permissionDecisionReason, or exit code 2. "ask" is parsed but not supported yet, so the lab degrades an ask to a refusal.'),
    file_read: ch('PreToolUse', true, false, 'the PreToolUse deny envelope.', 'a read tool: no separate read event is documented.'),
    mcp_call: ch('PreToolUse', true, false, 'the PreToolUse deny envelope.', 'the spelling mcp__server__tool of an MCP tool name.'),
    tool_result: ch('PostToolUse', true, false, 'the event name.', 'its stdin tool_response and its block answer.'),
  },
  request(kind, c, x) {
    const pre = { turn_id: 'turn-mock-0001', tool_use_id: 'call-mock-0001', permission_mode: 'default' };
    switch (kind) {
      case 'prompt': return { ...codexBase('UserPromptSubmit', x), turn_id: 'turn-mock-0001', prompt: c.text };
      case 'shell': return { ...codexBase('PreToolUse', x), ...pre, tool_name: 'Bash', tool_input: { command: c.command } };
      case 'file_read': return { ...codexBase('PreToolUse', x), ...pre, tool_name: 'Read', tool_input: { file_path: c.path } };
      case 'mcp_call': return { ...codexBase('PreToolUse', x), ...pre, tool_name: mcpName('__', c), tool_input: argsOf(c) };
      default: return { ...codexBase('PostToolUse', x), ...pre, tool_name: mcpName('__', c), tool_input: argsOf(c), tool_response: resultText(c) };
    }
  },
  parse(p) {
    const e = p.hook_event_name; const t = String(p.tool_name ?? ''); const i = p.tool_input || {};
    if (e === 'UserPromptSubmit') return { kind: 'prompt', text: p.prompt };
    if (e === 'PreToolUse') {
      if (t === 'Bash') return { kind: 'shell', command: i.command };
      if (t === 'Read') return { kind: 'file_read', path: i.file_path };
      if (t.startsWith('mcp__')) { const [, server, ...rest] = t.split('__'); return { kind: 'mcp_call', server, tool: rest.join('__'), args: i }; }
    }
    if (e === 'PostToolUse') { const [, server, ...rest] = t.split('__'); return { kind: 'tool_result', server: server || 'builtin', tool: rest.join('__') || t, args: i, result: typeof p.tool_response === 'string' ? p.tool_response : JSON.stringify(p.tool_response ?? '') }; }
    return null;
  },
  respond(kind, d, reason) {
    if (d === 'allow') return {};
    if (kind === 'prompt' || kind === 'tool_result') return { decision: 'block', reason };
    return wrapPre('PreToolUse', 'deny', reason);
  },
  dialog: { title: 'Codex', ask: 'Codex has no working ask for this hook (documented), so the request is refused instead.', deny: 'Blocked by a managed hook', buttons: ['OK'] },
};

// ---- Gemini CLI ------------------------------------------------------------------------------------------------------------
const geminiBase = (e, x) => ({ session_id: x.sessionId, transcript_path: '<transcript path>', cwd: x.cwd, hook_event_name: e, timestamp: '2026-10-31T09:00:00Z' });
const gemini = {
  id: 'gemini-cli', name: 'Gemini CLI', vendor: 'Google',
  sources: ['gemini-cli-hooks', 'gemini-cli-hooks-reference'],
  managed: [
    { os: 'Linux', path: '/etc/gemini-cli/settings.json', status: DOC },
    { os: 'macOS and Windows', path: '(system settings path for these systems not documented in the page read)', status: ILL },
  ],
  managedNote: 'Documented: system settings rank below project and user in the page read; the pages also say Gemini CLI was replaced by Antigravity CLI on 2026-06-18, so treat this agent as possibly legacy.',
  configCaveat: 'The Linux system path and the event names are documented. The hooks block body is illustrative, UNVERIFIED.',
  channels: {
    prompt: ch('BeforeAgent', true, false, 'stdin prompt (field tables); decision "deny" blocks the turn, with a required reason.'),
    shell: ch('BeforeTool', true, false, 'stdin tool_name and tool_input; decision "deny" (alias "block") with reason, exit code 2. No ask is documented, so the lab degrades an ask to a refusal.', 'the tool name run_shell_command and the field tool_input.command.'),
    file_read: ch('BeforeTool', true, false, 'the same envelope.', 'the tool name read_file and its field file_path.'),
    mcp_call: ch('BeforeTool', true, false, 'the same envelope, and that an optional mcp_context object exists.', 'the field names inside mcp_context and the spelling of an MCP tool name.'),
    tool_result: ch('AfterTool', true, false, 'stdin tool_response with llmContent and returnDisplay; decision "deny" hides the real output and reason replaces it.'),
  },
  request(kind, c, x) {
    switch (kind) {
      case 'prompt': return { ...geminiBase('BeforeAgent', x), prompt: c.text };
      case 'shell': return { ...geminiBase('BeforeTool', x), tool_name: 'run_shell_command', tool_input: { command: c.command } };
      case 'file_read': return { ...geminiBase('BeforeTool', x), tool_name: 'read_file', tool_input: { file_path: c.path } };
      case 'mcp_call': return { ...geminiBase('BeforeTool', x), tool_name: `mcp_${c.server}_${c.tool}`, tool_input: argsOf(c), mcp_context: { server_name: c.server, tool_name: c.tool } };
      default: return { ...geminiBase('AfterTool', x), tool_name: `mcp_${c.server}_${c.tool}`, tool_input: argsOf(c), tool_response: { llmContent: resultText(c), returnDisplay: resultText(c) }, mcp_context: { server_name: c.server, tool_name: c.tool } };
    }
  },
  parse(p) {
    const e = p.hook_event_name; const t = String(p.tool_name ?? ''); const i = p.tool_input || {};
    if (e === 'BeforeAgent') return { kind: 'prompt', text: p.prompt };
    const mc = p.mcp_context;
    if (e === 'BeforeTool') {
      if (t === 'run_shell_command') return { kind: 'shell', command: i.command };
      if (t === 'read_file') return { kind: 'file_read', path: i.file_path };
      if (mc) return { kind: 'mcp_call', server: mc.server_name, tool: mc.tool_name, args: i };
    }
    if (e === 'AfterTool') return { kind: 'tool_result', server: mc?.server_name || 'builtin', tool: mc?.tool_name || t, args: i, result: String(p.tool_response?.llmContent ?? '') };
    return null;
  },
  respond(kind, d, reason) { return d === 'allow' ? { decision: 'allow' } : { decision: 'deny', reason }; },
  dialog: { title: 'Gemini CLI', ask: 'Gemini CLI has no ask for this hook (not documented), so the request is refused instead.', deny: 'Tool call blocked by a system hook', buttons: ['OK'] },
};

// ---- GitHub Copilot --------------------------------------------------------------------------------------------------------
const copilot = {
  id: 'copilot', name: 'GitHub Copilot', vendor: 'GitHub',
  sources: ['copilot-hooks-config'],
  managed: [
    { os: 'Linux and macOS', path: '/etc/github-copilot/policy.d/*.json', status: DOC },
    { os: 'Windows', path: 'C:\\ProgramData\\GitHub\\Copilot\\policy.d\\*.json', status: DOC },
  ],
  managedNote: 'Documented: admin-installed policy hooks are machine-wide and apply to the Copilot CLI only; the cloud agent reads only repository hook files.',
  configCaveat: 'The policy.d directories and event names are documented. The file body is illustrative, UNVERIFIED.',
  channels: {
    prompt: ch('userPromptSubmitted', false, false, 'camelCase stdin (sessionId, timestamp, cwd, prompt). This event has no allow or deny field; modifiedPrompt is honoured only by SDK hooks and a config-file hook\'s output is dropped, so the hook can observe the prompt (alert and audit) but cannot stop it.'),
    shell: ch('preToolUse', true, true, 'camelCase stdin (sessionId, timestamp, cwd, toolName, toolArgs); stdout permissionDecision allow, deny or ask with permissionDecisionReason. In autopilot or the cloud agent an ask is treated as a deny.', 'the tool name bash and the field toolArgs.command.'),
    file_read: ch('preToolUse', true, true, 'the same envelope.', 'the tool name view and the field toolArgs.path.'),
    mcp_call: ch('preToolUse', true, true, 'the same envelope.', 'the spelling server-tool of an MCP tool name.'),
    tool_result: ch('postToolUse', false, false, 'the event name.', 'its stdin and stdout shapes. Observe-only.'),
  },
  request(kind, c, x) {
    switch (kind) {
      case 'prompt': return { sessionId: x.sessionId, timestamp: 1793437200000, cwd: x.cwd, prompt: c.text };
      case 'shell': return { sessionId: x.sessionId, timestamp: 1793437200000, cwd: x.cwd, toolName: 'bash', toolArgs: { command: c.command } };
      case 'file_read': return { sessionId: x.sessionId, timestamp: 1793437200000, cwd: x.cwd, toolName: 'view', toolArgs: { path: c.path } };
      case 'mcp_call': return { sessionId: x.sessionId, timestamp: 1793437200000, cwd: x.cwd, toolName: `${c.server}-${c.tool}`, toolArgs: argsOf(c) };
      default: return { sessionId: x.sessionId, timestamp: 1793437200000, cwd: x.cwd, toolName: `${c.server}-${c.tool}`, toolArgs: argsOf(c), toolResult: { textResultForLlm: resultText(c) } };
    }
  },
  // The camelCase form carries no event name, so the kind is read from the fields themselves (prompt, toolResult, toolName).
  parse(p) {
    if ('prompt' in p) return { kind: 'prompt', text: p.prompt };
    if ('toolResult' in p) { const [server, ...rest] = String(p.toolName ?? '').split('-'); return { kind: 'tool_result', server: server || 'builtin', tool: rest.join('-') || p.toolName, args: p.toolArgs || {}, result: String(p.toolResult?.textResultForLlm ?? '') }; }
    const t = String(p.toolName ?? ''); const a = p.toolArgs || {};
    if (t === 'bash') return { kind: 'shell', command: a.command };
    if (t === 'view') return { kind: 'file_read', path: a.path };
    if (t.includes('-')) { const [server, ...rest] = t.split('-'); return { kind: 'mcp_call', server, tool: rest.join('-'), args: a }; }
    return null;
  },
  respond(kind, d, reason) { return d === 'allow' ? {} : { permissionDecision: d, permissionDecisionReason: reason }; },
  dialog: { title: 'GitHub Copilot', ask: 'Copilot asks you to approve this tool call (a managed hook requested it).', deny: 'Denied by a policy hook', buttons: ['Approve', 'Deny'] },
};

// ---- Antigravity -----------------------------------------------------------------------------------------------------------
const agBase = (x) => ({ conversationId: 'conv-mock-0001', workspacePaths: [x.cwd], transcriptPath: '<transcript path>', modelName: '<model>', stepIdx: 1 });
const antigravity = {
  id: 'antigravity', name: 'Antigravity', vendor: 'Google',
  sources: ['antigravity-hooks'],
  managed: [
    { os: 'all', path: '(no machine-level managed path is documented; the documented files are .agents/hooks.json in a workspace and ~/.gemini/config/hooks.json for one user)', status: ILL },
  ],
  managedNote: 'Documented: hooks.json in the customization directory, global at ~/.gemini/config/hooks.json. A managed or enterprise path is NOT documented in the page read, which does not match the deck claim of machine-level managed configuration: confirm with Ping before presenting it.',
  configCaveat: 'The global hooks.json location and the PreToolUse event are documented. Using it as a managed location is illustrative, UNVERIFIED.',
  channels: {
    prompt: ch(null, false, false, 'no user-prompt event is listed (events: SessionStart, PreToolUse, PostToolUse, PreInvocation, PostInvocation, Stop), so a prompt is not seen by a hook.'),
    shell: ch('PreToolUse', true, true, 'stdin toolCall {name, args}, stepIdx and common fields; stdout decision (allow, auto_approve, deny, ask, force_ask, deny_unless_prior_grant) with an optional reason.', 'the tool name run_command (it comes from a third-party integration, not the docs) and the arg name command.'),
    file_read: ch('PreToolUse', true, true, 'the same envelope.', 'the tool name view_file and its arg path.'),
    mcp_call: ch('PreToolUse', true, true, 'the same envelope.', 'the spelling server/tool of an MCP tool name.'),
    tool_result: ch('PostToolUse', false, false, 'the event name.', 'its fields and its answer. Observe-only.'),
  },
  request(kind, c, x) {
    switch (kind) {
      case 'shell': return { ...agBase(x), toolCall: { name: 'run_command', args: { command: c.command } } };
      case 'file_read': return { ...agBase(x), toolCall: { name: 'view_file', args: { path: c.path } } };
      case 'mcp_call': return { ...agBase(x), toolCall: { name: `${c.server}/${c.tool}`, args: argsOf(c) } };
      case 'tool_result': return { ...agBase(x), toolCall: { name: `${c.server}/${c.tool}`, args: argsOf(c) }, toolResult: resultText(c) };
      default: return null;
    }
  },
  parse(p) {
    const n = String(p.toolCall?.name ?? ''); const a = p.toolCall?.args || {};
    if ('toolResult' in p) { const [server, ...rest] = n.split('/'); return { kind: 'tool_result', server, tool: rest.join('/'), args: a, result: String(p.toolResult ?? '') }; }
    if (n === 'run_command') return { kind: 'shell', command: a.command };
    if (n === 'view_file') return { kind: 'file_read', path: a.path };
    if (n.includes('/')) { const [server, ...rest] = n.split('/'); return { kind: 'mcp_call', server, tool: rest.join('/'), args: a }; }
    return null;
  },
  respond(kind, d, reason) { return d === 'allow' ? { decision: 'allow' } : { decision: d, reason }; },
  dialog: { title: 'Antigravity', ask: 'Antigravity asks you to approve this step (a hook requested it).', deny: 'Blocked by a hook', buttons: ['Approve', 'Reject'] },
};

export const AGENTS = [claude, cursor, codex, gemini, copilot, antigravity];
export const AGENT_IDS = AGENTS.map((a) => a.id);
export const agentById = (id) => AGENTS.find((a) => a.id === id) || null;

// The hook payload an agent writes to stdin for one normalized action, or null when the agent has no event for it.
export function nativeRequest(agentId, call, ctx) {
  const a = agentById(agentId);
  if (!a || !a.channels[call.kind]?.event) return null;
  return a.request(call.kind, call, ctx);
}

// The inverse: a normalized call from an agent's hook payload, or null for an event the lab does not evaluate.
export function parsePayload(agentId, payload) {
  const a = agentById(agentId);
  if (!a || payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  try { return a.parse(payload) || null; } catch { return null; }
}

// What the agent can actually do with an engine decision on one kind of action.
//   engine: allow | alert | ask | deny. Returns the native decision the hook prints and why it may differ from the engine's.
export function nativeOutcome(agentId, kind, engine) {
  const a = agentById(agentId); const ch = a?.channels[kind];
  if (!ch || !ch.event) return { native: 'none', covered: false, note: `${a?.name || agentId} exposes no hook event for this kind of action, so the gateway never sees it.` };
  if (engine === 'deny') {
    if (ch.canBlock) return { native: 'deny', covered: true };
    return { native: 'allow', covered: true, unenforceable: true, note: `${a.name}'s hook for this event cannot refuse (documented). The action proceeds; the finding is an alert in the audit trail.` };
  }
  if (engine === 'ask') {
    if (ch.canAsk) return { native: 'ask', covered: true };
    if (ch.canBlock) return { native: 'deny', covered: true, degraded: true, note: `${a.name} has no working ask for this hook, so the lab returns a refusal instead (lab-invented fallback).` };
    return { native: 'allow', covered: true, unenforceable: true, note: `${a.name}'s hook for this event can neither ask nor refuse. Alert only.` };
  }
  return { native: 'allow', covered: true };
}

// The agent-native response JSON for a native decision. `none` and `allow` of an observe-only channel print the empty answer.
export function respond(agentId, kind, nativeDecision, reason) {
  const a = agentById(agentId);
  if (!a || nativeDecision === 'none') return {};
  return a.respond(kind, nativeDecision, String(reason ?? '').slice(0, 300));
}

// The gateway cannot be reached (or timed out). FailClosed refuses where the agent's hook can refuse; otherwise the action proceeds
// and the gap is recorded. Used by the lab's hook script and by the Mock path, so both behave the same.
export function unreachableOutcome(agentId, kind, failClosed) {
  const a = agentById(agentId); const ch = a?.channels[kind];
  const reason = 'The coding-agent gateway could not be reached and this tenant requires a refusal (FailClosed).';
  if (failClosed && ch?.event && ch.canBlock) return { native: 'deny', refused: true, reasonCode: 'DENY-GATEWAY-UNREACHABLE', reason };
  return {
    native: 'allow', refused: false, reasonCode: 'GAP-GATEWAY-UNREACHABLE',
    reason: failClosed ? `FailClosed is set, but ${a?.name || agentId}'s hook for this event cannot refuse (documented), so the action proceeds.` : 'The gateway could not be reached. The developer keeps working; the gap is recorded for review.',
  };
}

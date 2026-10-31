// The lab's deterministic detection, standing in for "the same gateway, policies and detection as your LLM and MCP traffic".
// Everything here is LAB-INVENTED (rule ids, effects, thresholds): the deck only says secrets, risky tool arguments and hidden
// instructions are evaluated. Deterministic only: no model, no score, no network. Text is capped, then scanned with fixed
// patterns or a linear tokenizer; no regular expression is ever built from user input and none has nested quantifiers.
//
// Effects: block (the agent is told no), ask (the developer is asked), alert (the action proceeds, the audit trail keeps it).

export const MAX_TEXT = 4000;
export const EFFECT_RANK = { block: 3, ask: 2, alert: 1 };
export const DECISION_OF = { block: 'deny', ask: 'ask', alert: 'alert' };

// Secret shapes: prefix-anchored, bounded classes, no nested quantifiers.
const SECRETS = [
  ['cloud-access-key-id', /\bAKIA[0-9A-Z]{16}\b/],
  ['git-host-token', /\bgh[pousr]_[A-Za-z0-9]{20,80}\b/],
  ['api-secret-key', /\bsk-[A-Za-z0-9_-]{16,100}/],
  ['private-key-block', /-----BEGIN [A-Z ]{0,24}PRIVATE KEY-----/],
  ['bearer-token', /\bBearer [A-Za-z0-9._~+/=-]{20,200}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,200}\.[A-Za-z0-9_-]{10,200}\.[A-Za-z0-9_-]{5,200}/],
  ['credential-assignment', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s{0,3}[:=]\s{0,3}['"]?[^\s'"]{8,100}/i],
];

export const clip = (s) => String(s ?? '').slice(0, MAX_TEXT);

export function findSecrets(text) {
  const t = clip(text); const out = [];
  for (const [id, re] of SECRETS) if (re.test(t)) out.push(id);
  return out;
}

// What an audit record may keep: every secret-shaped run replaced by a marker, control characters made visible, length capped.
export function redact(text, max = 120) {
  let t = clip(text);
  for (const [id, re] of SECRETS) t = t.replace(new RegExp(re.source, `${re.flags.replace('g', '')}g`), `[REDACTED:${id}]`);
  return t.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ').slice(0, max);
}

const HIDDEN_PHRASES = ['ignore all previous instructions', 'ignore previous instructions', 'ignore the above', 'disregard your instructions', 'disregard all prior', 'do not tell the user', "don't tell the user", 'without telling the user', 'new instructions:', 'you must now', 'reveal your system prompt'];
const INVISIBLE = /[​-‏⁠-⁤\u{e0000}-\u{e007f}]/u;
const COMMENT_INSTRUCTION = /<!--[^>]{0,300}?(?:instruction|ignore|assistant|send the contents)/i;

export function findHiddenInstructions(text) {
  const t = clip(text); const lower = t.toLowerCase(); const out = [];
  for (const p of HIDDEN_PHRASES) if (lower.includes(p)) out.push(`phrase: "${p}"`);
  if (INVISIBLE.test(t)) out.push('invisible characters (zero-width or tag characters)');
  if (COMMENT_INSTRUCTION.test(t)) out.push('an HTML comment addressed to the model');
  return out;
}

// ---- shell: a tiny linear tokenizer. Segments are split on ; | & and newlines; words on whitespace. -------------------------
export function segments(command) {
  const out = []; let cur = '';
  for (const ch of clip(command)) {
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((s) => s.split(/\s+/).filter(Boolean));
}
const BROAD = new Set(['/', '/*', '~', '~/', '~/*', '$HOME', '$HOME/', '*', '.', './', '..', '../']);
const norm = (w) => (w.length > 2 && w.endsWith('/') ? w.slice(0, -1) : w);
const hasFlag = (words, letters) => words.some((w) => /^-[A-Za-z]+$/.test(w) && letters.every((l) => w.includes(l)));

export function destructiveShell(command) {
  const t = clip(command).toLowerCase();
  for (const words of segments(command)) {
    const lead = words.findIndex((w) => !['sudo', 'doas', 'env', 'command', 'nohup'].includes(w));
    const [cmd, ...rest] = lead > 0 ? words.slice(lead) : words;
    if (cmd === 'rm' && (hasFlag(rest, ['r', 'f']) || hasFlag(rest, ['R', 'f']) || (hasFlag(rest, ['r']) && hasFlag(rest, ['f']))) && rest.some((w) => BROAD.has(w) || BROAD.has(norm(w)))) return 'rm -rf on the home directory, the root or a wildcard';
    if (cmd && cmd.startsWith('mkfs')) return 'formats a filesystem';
    if (cmd === 'dd' && rest.some((w) => w.startsWith('of=/dev/'))) return 'dd writing to a device';
    if (cmd === 'chmod' && hasFlag(rest, ['R']) && rest.includes('777') && rest.some((w) => BROAD.has(w))) return 'recursive chmod 777 on a broad path';
  }
  if (t.includes('drop database') || t.includes('drop table')) return 'drops a database object';
  if (t.includes(':(){')) return 'a fork bomb';
  return null;
}

export function pipeToShell(command) {
  const segs = segments(command);
  let fetchSeen = false;
  for (const [cmd] of segs) {
    if (cmd === 'curl' || cmd === 'wget') fetchSeen = true;
    else if (fetchSeen && (cmd === 'sh' || cmd === 'bash' || cmd === 'zsh')) return true;
  }
  // Pipes are separators above, so a "curl ... | sh" is a curl segment followed by an sh segment.
  return false;
}

const EXFIL_TOOLS = new Set(['curl', 'wget', 'nc', 'ncat', 'scp', 'sftp', 'ftp']);
const DATA_SOURCES = new Set(['cat', 'base64', 'env', 'printenv', 'tar', 'zip', 'gzip']);
export function chainedExfil(command) {
  const c = clip(command);
  if (!/[;|&`]|\$\(/.test(c)) return false; // shell metacharacters
  const segs = segments(c);
  const hasTool = segs.some(([w]) => EXFIL_TOOLS.has(w));
  const hasSource = segs.some(([w, ...r]) => DATA_SOURCES.has(w) || r.some((x) => x === '@-' || x === '--data-binary'));
  return hasTool && hasSource && segs.length > 1;
}

// ---- file paths ---------------------------------------------------------------------------------------------------------------
const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker']);
const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', '.npmrc', '.netrc', '.pgpass', 'credentials', 'shadow']);
const SENSITIVE_EXT = ['.pem', '.key', '.p12', '.pfx'];
export function sensitivePath(path) {
  const parts = clip(path).split('/').filter(Boolean);
  if (!parts.length) return null;
  const base = parts[parts.length - 1].toLowerCase();
  if (parts.slice(0, -1).some((p) => SENSITIVE_DIRS.has(p.toLowerCase()))) return `inside a credentials directory (${parts.find((p) => SENSITIVE_DIRS.has(p.toLowerCase()))})`;
  if (SENSITIVE_NAMES.has(base)) return `a credentials file (${base})`;
  if (SENSITIVE_EXT.some((e) => base.endsWith(e))) return 'a key or certificate file';
  return null;
}

const F = (id, effect, label, detail) => ({ id, effect, label, detail });

// Evaluate one normalized call. policy.mcpAllow is the lab's list of MCP servers the tenant approved (lab-invented).
export function evaluateCall(call, policy = { mcpAllow: [] }) {
  const f = [];
  const k = call.kind;
  if (k === 'prompt') {
    const s = findSecrets(call.text);
    if (s.length) f.push(F('secret-in-prompt', 'block', 'A credential in a prompt', `The prompt carries a credential (${s.join(', ')}). It is stopped before it reaches the model provider.`));
  } else if (k === 'shell') {
    const d = destructiveShell(call.command);
    if (d) f.push(F('destructive-command', 'block', 'A destructive command', `The command ${d}.`));
    if (pipeToShell(call.command)) f.push(F('pipe-to-shell', 'ask', 'Download piped into a shell', 'The command downloads a script and runs it without reading it.'));
    if (chainedExfil(call.command)) f.push(F('shell-chain-exfil', 'alert', 'A chained command that sends data out', 'Shell metacharacters chain a data source into an upload tool. It proceeds; the audit trail keeps it.'));
    const s = findSecrets(call.command);
    if (s.length) f.push(F('secret-in-arguments', 'alert', 'A credential in tool arguments', `The command carries a credential (${s.join(', ')}). It proceeds; the audit trail keeps a redacted copy.`));
  } else if (k === 'file_read') {
    const p = sensitivePath(call.path);
    if (p) f.push(F('sensitive-path', 'ask', 'A read of a sensitive path', `The path is ${p}.`));
  } else if (k === 'mcp_call') {
    if (!(policy.mcpAllow || []).includes(String(call.server))) f.push(F('unlisted-mcp-server', 'ask', 'An MCP server the tenant has not approved', `The MCP server "${clip(call.server).slice(0, 40)}" is not on the tenant's approved list.`));
    const s = findSecrets(JSON.stringify(call.args ?? {}));
    if (s.length) f.push(F('secret-in-arguments', 'alert', 'A credential in tool arguments', `The arguments carry a credential (${s.join(', ')}). It proceeds; the audit trail keeps a redacted copy.`));
  } else if (k === 'tool_result') {
    const h = findHiddenInstructions(call.result);
    if (h.length) f.push(F('hidden-instructions', 'block', 'Hidden instructions in a tool result', `The result contains text addressed to the model (${h.slice(0, 3).join('; ')}).`));
    const s = findSecrets(call.result);
    if (s.length) f.push(F('secret-in-result', 'alert', 'A credential in a tool result', `The result carries a credential (${s.join(', ')}).`));
  }
  const top = f.reduce((m, x) => (EFFECT_RANK[x.effect] > EFFECT_RANK[m] ? x.effect : m), 'alert');
  const decision = f.length ? DECISION_OF[top] : 'allow';
  const lead = f.find((x) => x.effect === top);
  const reasonCode = f.length ? `${decision === 'deny' ? 'DENY' : decision === 'ask' ? 'ASK' : 'ALERT'}-${lead.id.toUpperCase()}` : 'ALLOW';
  return { decision, reasonCode, findings: f, reason: lead ? lead.detail : 'Nothing risky found.', decidedBy: f.length ? 'deterministic rules' : 'none' };
}

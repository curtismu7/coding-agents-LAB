// The lab's deterministic detection, standing in for "the same gateway, policies and detection as your LLM and MCP traffic".
// Everything here is LAB-INVENTED (rule ids, effects, thresholds): the deck only says secrets, risky tool arguments and hidden
// instructions are evaluated. Deterministic only: no model, no score, no network. Text is windowed, then scanned with fixed
// patterns or a linear tokenizer; no regular expression is ever built from user input and none has nested quantifiers.
//
// Effects: block (the agent is told no), ask (the developer is asked), alert (the action proceeds, the audit trail keeps it).
//
// KNOWN LIMITS (also in the README): a field longer than 8000 characters is scanned as its first 4000 and last 4000 characters,
// so something only in the middle is not seen; obfuscation (variables, base64, `eval` of built strings, aliases, scripts that
// delete things) defeats the shell rules; the tokenizer does not understand quoting or subshell contents beyond the cases listed;
// secrets are recognised by shape only, so an unlabelled password in prose is not found; only the English hidden-instruction
// phrases listed here are known.

export const WINDOW = 4000; // characters kept from each end of a long field
export const MAX_TEXT = WINDOW * 2; // a field up to this long is scanned whole
export const EFFECT_RANK = { block: 3, ask: 2, alert: 1 };
export const DECISION_OF = { block: 'deny', ask: 'ask', alert: 'alert' };

// Head and tail of a long text, so a hook that trims a huge field and a direct post are scanned alike.
export const scanWindow = (s) => { const t = String(s ?? ''); return t.length <= MAX_TEXT ? t : `${t.slice(0, WINDOW)}\n${t.slice(-WINDOW)}`; };
// Zero-width, bidi and BOM characters removed, so a credential split by one is still found.
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿\u{e0000}-\u{e007f}]/gu;
const plain = (s) => scanWindow(s).replace(INVISIBLE_CHARS, '');

// Secret shapes: prefix-anchored, bounded classes, no nested quantifiers. A letter or digit may not touch either end, but an underscore
// or hyphen may (so a key embedded in an identifier such as mcp__<key>__tool is still found and masked).
const SECRETS = [
  ['cloud-access-key-id', /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/],
  ['git-host-token', /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,80}(?![A-Za-z0-9])/],
  ['chat-token', /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,100}/],
  ['api-secret-key', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,100}/],
  ['private-key-block', /-----BEGIN [A-Z ]{0,24}PRIVATE KEY-----/],
  ['bearer-token', /(?<![A-Za-z0-9])bearer [A-Za-z0-9._~+/=-]{20,200}/i],
  ['jwt', /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{10,200}\.[A-Za-z0-9_-]{10,200}\.[A-Za-z0-9_-]{5,200}/],
  ['credential-assignment', /(?<![A-Za-z0-9])(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s{0,3}[:=]\s{0,3}['"]?[^\s'"]{8,100}/i],
];

export function findSecrets(text) {
  const t = plain(text); const out = [];
  for (const [id, re] of SECRETS) if (re.test(t)) out.push(id);
  return out;
}

// Every secret-shaped run replaced by a marker. Not shortened: used on whole response objects (maskDeep) and by redact().
export function maskSecrets(text) {
  let t = String(text ?? '');
  if (t.length > 20_000) t = `${t.slice(0, 10_000)}\n[... omitted ...]\n${t.slice(-10_000)}`;
  t = t.replace(INVISIBLE_CHARS, '');
  for (const [id, re] of SECRETS) t = t.replace(new RegExp(re.source, `${re.flags.replace('g', '')}g`), `[REDACTED:${id}]`);
  return t;
}

// What an audit record may keep: secrets masked, control characters made visible, length capped.
export function redact(text, max = 120) {
  return maskSecrets(scanWindow(text)).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ').slice(0, max);
}

// A copy of any JSON-like value with every string masked. Iterative (a hostile value cannot overflow the stack).
export function maskDeep(value) {
  const root = { v: value }; const out = { v: undefined };
  const work = [[root, out, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop(); const x = src[key];
    if (typeof x === 'string') dst[key] = maskSecrets(x);
    else if (x === null || typeof x !== 'object') dst[key] = x;
    else { const copy = Array.isArray(x) ? [] : {}; dst[key] = copy; for (const k of Object.keys(x).reverse()) work.push([x, copy, k]); } // reversed: keys keep their order
  }
  return out.v;
}

const HIDDEN_PHRASES = ['ignore all previous instructions', 'ignore previous instructions', 'ignore the above', 'disregard your instructions', 'disregard all prior', 'do not tell the user', "don't tell the user", 'without telling the user', 'new instructions:', 'you must now', 'reveal your system prompt'];
const INVISIBLE_FLAG = /[​-‏‪-‮⁠-⁤⁦-⁩\u{e0000}-\u{e007f}]/u;
const COMMENT_INSTRUCTION = /<!--[^>]{0,300}?(?:instruction|ignore|assistant|send the contents)/i;

export function findHiddenInstructions(text) {
  const t = scanWindow(text); const out = [];
  const lower = t.replace(INVISIBLE_CHARS, '').toLowerCase().split(/\s+/).join(' ');
  for (const p of HIDDEN_PHRASES) if (lower.includes(p)) out.push(`phrase: "${p}"`);
  if (INVISIBLE_FLAG.test(t) || t.indexOf('﻿', 1) !== -1) out.push('invisible or direction-changing characters (zero-width, bidi, tag)');
  if (COMMENT_INSTRUCTION.test(t)) out.push('an HTML comment addressed to the model');
  return out;
}

// ---- shell: a tiny linear tokenizer. Segments are split on ; | & and newlines; words on whitespace. -------------------------
// Each segment remembers the separator run that preceded it, so "curl | sh" (a pipe) is not "curl ; sh".
export function splitSegments(command) {
  const out = []; let cur = ''; let run = '';
  const flush = () => { if (cur.trim()) { out.push({ words: cur.trim().split(/\s+/), sep: run }); run = ''; } cur = ''; };
  for (const ch of scanWindow(command)) {
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') { flush(); run += ch; } else cur += ch;
  }
  flush();
  return out;
}
export const segments = (command) => splitSegments(command).map((s) => s.words);

const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'nohup', 'time', 'exec', 'nice', 'builtin']);
const WRAPPER_ARG_OPTS = new Set(['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-n', '-U']); // sudo options that take a value
const unquote = (w) => w.replace(/^["']+|["']+$/g, '');
// The command a segment really runs: wrappers (sudo -u root, env X=1, nohup ...) and a path prefix (/bin/rm) removed.
export function realCommand(words) {
  let i = 0;
  while (i < words.length && WRAPPERS.has(unquote(words[i]).split('/').pop())) {
    i++;
    while (i < words.length && (words[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) { if (WRAPPER_ARG_OPTS.has(words[i]) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++; i++; }
  }
  if (i >= words.length) return { name: '', rest: [] };
  return { name: unquote(words[i]).split('/').pop(), rest: words.slice(i + 1) };
}

const BROAD = new Set(['/', '/*', '~', '~/', '~/*', '$HOME', '$HOME/', '$HOME/*', '${HOME}', '${HOME}/', '${HOME}/*', '*', '.', './', './*', '..', '../']);
const isBroad = (w) => { const u = unquote(w); return BROAD.has(u) || BROAD.has(u.length > 2 && u.endsWith('/') ? u.slice(0, -1) : u); };
const hasShort = (rest, letters) => rest.some((w) => /^-[A-Za-z]+$/.test(w) && letters.some((l) => w.includes(l)));
const hasLong = (rest, name) => rest.includes(`--${name}`);

export function destructiveShell(command) {
  const t = scanWindow(command).toLowerCase();
  for (const words of segments(command)) {
    const { name: cmd, rest } = realCommand(words);
    if (cmd === 'rm' && (hasShort(rest, ['r', 'R']) || hasLong(rest, 'recursive')) && rest.some(isBroad)) return 'rm -r (a recursive delete) on the home directory, the root or a wildcard';
    if (cmd.startsWith('mkfs')) return 'formats a filesystem';
    if (cmd === 'dd' && rest.some((w) => w.startsWith('of=/dev/'))) return 'dd writing to a device';
    if (cmd === 'chmod' && (hasShort(rest, ['R']) || hasLong(rest, 'recursive')) && rest.includes('777') && rest.some(isBroad)) return 'recursive chmod 777 on a broad path';
  }
  if (t.includes('drop database') || t.includes('drop table')) return 'drops a database object';
  if (t.includes(':(){')) return 'a fork bomb';
  return null;
}

const FETCHERS = new Set(['curl', 'wget']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'source', '.', 'eval']);
const SUBST = ['<(curl', '<(wget', '$(curl', '$(wget', '`curl', '`wget'];
export function pipeToShell(command) {
  const segs = splitSegments(command);
  let prevFetch = false;
  for (const { words, sep } of segs) {
    const { name, rest } = realCommand(words);
    if (prevFetch && sep === '|' && SHELLS.has(name)) return true;
    if (SHELLS.has(name) && SUBST.some((s) => rest.join(' ').includes(s))) return true; // bash <(curl ...), sh -c "$(curl ...)"
    prevFetch = FETCHERS.has(name);
  }
  return false;
}

const EXFIL_TOOLS = new Set(['curl', 'wget', 'nc', 'ncat', 'scp', 'sftp', 'ftp']);
const DATA_SOURCES = new Set(['cat', 'base64', 'env', 'printenv', 'tar', 'zip', 'gzip']);
export function chainedExfil(command) {
  const c = scanWindow(command);
  if (!/[;|&`]|\$\(/.test(c)) return false; // shell metacharacters
  const cmds = segments(c).map(realCommand);
  const hasTool = cmds.some(({ name }) => EXFIL_TOOLS.has(name));
  const hasSource = cmds.some(({ name, rest }) => DATA_SOURCES.has(name) || rest.some((x) => x === '@-' || x === '--data-binary'));
  return hasTool && hasSource && cmds.length > 1;
}

// ---- file paths ---------------------------------------------------------------------------------------------------------------
const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker']);
const SENSITIVE_NAMES = new Set(['.env', 'id_rsa', 'id_ed25519', 'id_ecdsa', '.npmrc', '.netrc', '.pgpass', '.git-credentials', 'credentials', 'shadow', 'application_default_credentials.json']);
const SENSITIVE_EXT = ['.pem', '.key', '.p12', '.pfx'];
const TEMPLATE_SUFFIX = ['.example', '.sample', '.template', '.dist'];
export function sensitivePath(path) {
  const parts = scanWindow(path).split(/[\\/]/).filter(Boolean);
  if (!parts.length) return null;
  const base = parts[parts.length - 1].toLowerCase();
  const dir = parts.slice(0, -1).find((p) => SENSITIVE_DIRS.has(p.toLowerCase()));
  if (dir) return `inside a credentials directory (${dir})`;
  if (SENSITIVE_NAMES.has(base)) return `a credentials file (${base})`;
  if (base.startsWith('.env.') && !TEMPLATE_SUFFIX.some((s) => base.endsWith(s))) return `an environment file (${base})`;
  if (SENSITIVE_EXT.some((e) => base.endsWith(e))) return 'a key or certificate file';
  return null;
}

const F = (id, effect, label, detail) => ({ id, effect, label, detail });
const shortName = (s) => redact(String(s ?? ''), 40);

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
    if (!(policy.mcpAllow || []).includes(String(call.server))) f.push(F('unlisted-mcp-server', 'ask', 'An MCP server the tenant has not approved', `The MCP server "${shortName(call.server)}" is not on the tenant's approved list.`));
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

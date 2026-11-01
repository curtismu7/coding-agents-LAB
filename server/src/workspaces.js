// Rule 13: a workspace id keeps one visitor's state apart from another's. Server state per workspace is the audit trail of
// evaluations (who ran what on which laptop) and the recorded gateway gaps, both bounded in count, size and age.
// The browser sends its id in X-Workspace (default "default").
export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';
export const MAX_AUDIT = 50;
export const MAX_GAPS = 50;

// An id is lowercase letters, digits and hyphens, 1 to 40. It is echoed in answers, so it must not become a place to park a secret:
// an id with 24 or more hex characters in a row (a hash or key) or with a hyphen-separated part that names a credential or starts a
// token (sk-..., pw-..., ghp-..., token-..., password-...) is refused (400 bad_workspace) and never echoed. The page makes a new id
// and asks again (web/src/workspace.js applies the same rule to a saved id; a test compares the two on a table).
const CREDENTIAL_PARTS = new Set(['sk', 'pk', 'rk', 'pw', 'pwd', 'pass', 'passwd', 'password', 'passphrase', 'secret', 'token', 'apikey', 'bearer', 'glpat', 'ghp', 'gho', 'ghu', 'ghs', 'xoxa', 'xoxb', 'xoxp', 'xoxr', 'xoxs', 'akia', 'asia']);
export function validWorkspaceId(raw) {
  if (typeof raw !== 'string' || !WORKSPACE_RE.test(raw)) return false;
  if (/[0-9a-f]{24,}/.test(raw)) return false;
  return !raw.split('-').some((part) => CREDENTIAL_PARTS.has(part)) && !raw.startsWith('eyj');
}

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  return validWorkspaceId(raw) ? raw : null;
}

export function createWorkspaces({ max = 500, ttlMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const map = new Map(); // id -> { audit, gaps, at }; insertion order = oldest first
  const fresh = () => ({ audit: [], gaps: [], at: now() });
  const sweep = () => {
    const t = now();
    for (const [id, v] of map) { if (t - v.at > ttlMs) map.delete(id); else break; }
    while (map.size > max) map.delete(map.keys().next().value);
  };
  const touch = (id) => { const v = map.get(id) || fresh(); v.at = now(); map.delete(id); map.set(id, v); sweep(); return v; };
  return {
    audit(id) { sweep(); return { workspace: id, audit: map.get(id)?.audit ?? [] }; },
    gaps(id) { sweep(); return { workspace: id, gaps: map.get(id)?.gaps ?? [] }; },
    addAudit(id, entry) { const v = touch(id); v.audit = [...v.audit, { ...entry, at: new Date(now()).toISOString() }].slice(-MAX_AUDIT); },
    addGap(id, gap) { const v = touch(id); v.gaps = [...v.gaps, { ...gap, at: new Date(now()).toISOString() }].slice(-MAX_GAPS); },
    reset(id) { map.delete(id); },
    size() { return map.size; },
  };
}

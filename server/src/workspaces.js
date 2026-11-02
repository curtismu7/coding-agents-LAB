// Rule 13: a workspace id keeps one visitor's state apart from another's. Server state per workspace is the audit trail of
// evaluations (who ran what on which laptop) and the recorded gateway gaps, both bounded in count, size and age.
// The browser sends its id in X-Workspace (default "default").
import { isCredentialId, maskDeep } from './mask.js';
import { safeWorkspaceId } from './shared/hygiene.js';

export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';
export const MAX_AUDIT = 50;
export const MAX_GAPS = 50;

// An id is "default" or "w-" and lowercase letters, digits and hyphens (1 to 40 characters in all). It is echoed in answers, so it must not become a
// place to park a secret: the shared masker's isCredentialId refuses what looks like a credential (a long hex or alphanumeric run, a token prefix such
// as sk- / pw- / ghp- / token- / password-, anything the masker would mask) and the shared safeWorkspaceId refuses a credential word with a secret glued
// to it or following it (w-passwordhunter2xyz, w-password-abc123). A refused id is a 400 bad_workspace and is never echoed. The page makes a new id and
// asks again (web/src/workspace.js). A lab name that merely contains a credential word (w-password-reset) is fine.
export function validWorkspaceId(raw) {
  if (typeof raw !== 'string' || !WORKSPACE_RE.test(raw) || isCredentialId(raw)) return false;
  return raw === DEFAULT_WORKSPACE || safeWorkspaceId(raw) !== null;
}

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  return validWorkspaceId(raw) ? raw : null;
}

// State is masked at WRITE time (addAudit, addGap): what is stored is what may be shown, whatever a caller passes in.
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
    addAudit(id, entry) { const v = touch(id); v.audit = [...v.audit, { ...maskDeep(entry), at: new Date(now()).toISOString() }].slice(-MAX_AUDIT); },
    addGap(id, gap) { const v = touch(id); v.gaps = [...v.gaps, { ...maskDeep(gap), at: new Date(now()).toISOString() }].slice(-MAX_GAPS); },
    reset(id) { map.delete(id); },
    size() { return map.size; },
  };
}

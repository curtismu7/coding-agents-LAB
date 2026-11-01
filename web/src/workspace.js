// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
const KEY = "ca.workspace";
let memo = null;

// Tests only: forget the id held in memory so the next call picks a new one.
export const forgetWorkspace = () => { memo = null; };

// The server's rule (server/src/workspaces.js validWorkspaceId): lowercase letters, digits and hyphens, 1 to 40; not 24 or more hex
// characters in a row; no hyphen-separated part that names a credential or starts a token (sk-, pw-, ghp-, token-, password-, ...).
// A test compares this copy with the server's own check on a table of ids.
const CREDENTIAL_PARTS = new Set(["sk", "pk", "rk", "pw", "pwd", "pass", "passwd", "password", "passphrase", "secret", "token", "apikey", "bearer", "glpat", "ghp", "gho", "ghu", "ghs", "xoxa", "xoxb", "xoxp", "xoxr", "xoxs", "akia", "asia"]);
export function validWorkspaceId(s) {
  if (typeof s !== "string" || !/^[a-z0-9-]{1,40}$/.test(s) || /[0-9a-f]{24,}/.test(s) || s.startsWith("eyj")) return false;
  return !s.split("-").some((part) => CREDENTIAL_PARTS.has(part));
}

// "w-" and 16 hex characters: always holds a letter (the w), never 24 hex in a row.
export function freshId() {
  const bytes = new Uint8Array(8);
  (window.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return `w-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function workspaceId({ renew = false } = {}) {
  if (memo && !renew) return memo;
  if (!renew) { try { const saved = window.sessionStorage.getItem(KEY); if (saved && validWorkspaceId(saved)) return (memo = saved); } catch { /* blocked */ } }
  memo = freshId();
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

// One call to the lab. If the server refuses the id (400 bad_workspace: an id saved by an older page, or edited by hand), the page
// makes a new id and asks once more: the refusal happens before anything runs, so asking again is safe. Never a loop.
export async function workspaceFetch(url, opts = {}) {
  const send = () => fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });
  const r = await send();
  if (r.status !== 400) return r;
  let refused = false;
  try { refused = (await r.clone().json())?.error === "bad_workspace"; } catch { /* not JSON */ }
  if (!refused) return r;
  workspaceId({ renew: true });
  return send();
}

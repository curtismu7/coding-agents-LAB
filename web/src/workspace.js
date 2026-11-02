// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
const KEY = "ca.workspace";
let memo = null;

// Tests only: forget the id held in memory so the next call picks a new one.
export const forgetWorkspace = () => { memo = null; };

// The page keeps and sends only the ids it generates itself ("w-" and 16 hex characters, see freshId). A saved id of any other shape is replaced at
// once. Credential detection is the server's job (isCredentialId in server/src/workspaces.js): it answers 400 bad_workspace and workspaceFetch asks again
// with a new id. A test checks that every id the page generates passes the server's rule.
export const validWorkspaceId = (s) => typeof s === "string" && /^w-[0-9a-f]{16}$/.test(s);

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

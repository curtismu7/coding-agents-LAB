// The workspace id: generated ids hold a letter and pass the server's rule; a saved or refused id never bricks the tab (new id, one retry).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validWorkspaceId as serverValid } from "../../server/src/workspaces.js";
import { forgetWorkspace, freshId, validWorkspaceId, workspaceFetch, workspaceId } from "./workspace";

// CHANGED: the page no longer has its own list of credential words. It keeps only the ids it generates (w- and 16 hex characters); the server's rule
// (isCredentialId) is the only credential check and a refusal makes the page generate a new id. Every id the page accepts must pass the server's rule.
const GOOD = ["w-0123456789abcdef", "w-ffffffffffffffff", "w-a000000000000000"];
const BAD = ["", "default", "A", "a b", "a/b", "abc-1", "w-b1-hook", "w-sweep-hook", "z".repeat(41), "sk-abcdefghijklmnop1234", "pw-hunter2xyz", "token-abc", `${GOOD[0]}`.slice(0, -1), `${GOOD[0]}0`, `${GOOD[0].slice(0, -1)}g`, GOOD[0].toUpperCase(), `${GOOD[0]}01234567`, "w-0000000000000000", "hunter2xyz\n"];

describe("workspace id", () => {
  it("the page keeps only the ids it generates, and the server accepts every one of them", () => {
    for (const id of GOOD) { expect(validWorkspaceId(id), id).toBe(true); expect(serverValid(id), id).toBe(true); }
    for (const id of BAD) expect(validWorkspaceId(id), JSON.stringify(id)).toBe(false);
    expect(GOOD.length).toBe(3); expect(BAD.length).toBe(19);
    for (const nonString of [undefined, null, 5, ["a"], {}]) { expect(validWorkspaceId(nonString)).toBe(false); expect(serverValid(nonString)).toBe(false); }
  });

  it("2000 generated ids all hold a hex letter, are 18 characters, and pass the server's rule; a draw of 16 digits gets a letter", () => {
    const real = window.crypto.getRandomValues.bind(window.crypto);
    window.crypto.getRandomValues = (a) => { a.fill(0); return a; }; // every byte 0: 16 zero digits
    try { expect(freshId()).toBe("w-a000000000000000"); expect(serverValid(freshId())).toBe(true); } finally { window.crypto.getRandomValues = real; }
    for (let i = 0; i < 2000; i += 1) {
      const id = freshId();
      expect(id).toMatch(/[a-z]/); expect(id).toHaveLength(18); expect(id).toMatch(/^w-[0-9a-f]{16}$/);
      expect(serverValid(id)).toBe(true);
    }
  });
});

describe("workspaceFetch", () => {
  const realFetch = globalThis.fetch;
  let calls;
  const answer = (list) => { let i = 0; globalThis.fetch = async (u, init) => { calls.push(init.headers["x-workspace"]); return list[Math.min(i++, list.length - 1)](); }; };
  const refuse = () => new Response(JSON.stringify({ error: "bad_workspace" }), { status: 400, headers: { "content-type": "application/json" } });
  const ok = () => new Response("{}", { status: 200 });
  beforeEach(() => { calls = []; forgetWorkspace(); window.sessionStorage.clear(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("a saved id the page's rule refuses is replaced at once, and the replacement is saved under ca.workspace", () => {
    window.sessionStorage.setItem("ca.workspace", "sk-abcdefghijklmnop1234");
    const id = workspaceId();
    expect(id).not.toBe("sk-abcdefghijklmnop1234"); expect(validWorkspaceId(id)).toBe(true);
    expect(window.sessionStorage.getItem("ca.workspace")).toBe(id);
    forgetWorkspace(); window.sessionStorage.setItem("ca.workspace", "w-0123456789abcdef");
    expect(workspaceId()).toBe("w-0123456789abcdef"); // a good saved id is kept
  });

  it("a 400 bad_workspace makes a new id and asks once more; a second refusal, another 400 and a non-JSON 400 are returned as they are", async () => {
    answer([refuse, ok]);
    const first = workspaceId();
    const r = await workspaceFetch("/api/reset", { method: "POST", body: "{}" });
    expect(r.status).toBe(200); expect(calls).toHaveLength(2); expect(calls[0]).toBe(first); expect(calls[1]).not.toBe(first);
    expect(window.sessionStorage.getItem("ca.workspace")).toBe(calls[1]);
    calls = []; answer([refuse, refuse, ok]);
    expect((await workspaceFetch("/api/audit")).status).toBe(400); expect(calls).toHaveLength(2); // one retry, never a loop
    calls = []; answer([() => new Response(JSON.stringify({ error: "bad_mode" }), { status: 400 }), ok]);
    expect((await workspaceFetch("/api/audit")).status).toBe(400); expect(calls).toHaveLength(1);
    calls = []; answer([() => new Response("not json", { status: 400 }), ok]);
    expect((await workspaceFetch("/api/audit")).status).toBe(400); expect(calls).toHaveLength(1);
    calls = []; answer([ok]);
    expect((await workspaceFetch("/api/audit")).status).toBe(200); expect(calls).toHaveLength(1);
  });
});

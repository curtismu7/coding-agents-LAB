// The lab's own states around the shared panel: loading (never the previous record), no run, an alert for any answer that is not a record, the mode the record
// was made in, and no request when nothing changed. fetch is replaced by a script; the real route is exercised by the server tests and App.test.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import RunObs from "./RunObs";
import { setJsonView } from "./JsonPane.jsx";
import { mockRecord, realRecord } from "../run-observability/fixtures";
import { forgetWorkspace } from "../workspace";

const realFetch = globalThis.fetch;
let calls = [];
let answers = {};
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, clone() { return this; } });
const url = (mode, id) => `/api/run-observability?mode=${mode}&runId=${id}`;
const began = (runId, mode = "mock") => ({ runId, began: true, mode });
beforeEach(() => {
  setJsonView("raw"); forgetWorkspace(); calls = []; answers = {};
  globalThis.fetch = vi.fn(async (u) => {
    calls.push(String(u));
    const a = answers[String(u)] ?? answers["*"];
    if (typeof a === "function") return a();
    if (a instanceof Error) throw a;
    return a ?? ok({ record: null, message: "no answer scripted" });
  });
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

describe("Mock and Live", () => {
  it("shows the panel for the run the server named, says what the lanes hold, and asks once", async () => {
    answers[url("mock", "ev-1")] = ok({ record: mockRecord });
    const { rerender } = render(<RunObs mode="mock" obs={began("ev-1")} />);
    expect(screen.getByTestId("ro-loading")).toHaveTextContent("Collecting this run's logs");
    await screen.findByTestId("run-observability");
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/Simulated/);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/lab's engine computed.*Counts are rows, not decisions.*MOCK certificate subject.*no OBO token.*not Privilege/s);
    expect(screen.getByTestId("ro-streams")).toHaveTextContent(/its stdout.*nowhere today/s);
    expect(screen.queryByText(/Re-read/)).toBeNull(); // this lab reads no logs
    rerender(<RunObs mode="mock" obs={{ ...began("ev-1") }} />); // the same run again (a state refresh) asks nothing new
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual([url("mock", "ev-1")]);
  });

  it("Live is the lab's own engine: the panel's simulated source, and a note that says the script, the gateway and the rules are all the lab's", async () => {
    answers[url("live", "ev-2")] = ok({ record: mockRecord });
    render(<RunObs mode="live" obs={began("ev-2", "live")} />);
    await screen.findByTestId("run-observability");
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/Simulated/);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/real hook script into the lab's own loopback gateway.*every row is simulated and none is read from a product.*route of its own process/s);
  });

  it("never shows the previous run while the next one loads, even when the answer for the next one is late", async () => {
    answers[url("mock", "ev-1")] = ok({ record: mockRecord });
    const second = gate();
    answers[url("mock", "ev-2")] = () => second.p.then(() => ok({ record: { ...mockRecord, runId: "ev-2" } }));
    const { rerender } = render(<RunObs mode="mock" obs={began("ev-1")} />);
    await screen.findByTestId("run-observability");
    rerender(<RunObs mode="mock" obs={began("ev-2")} />);
    expect(screen.getByTestId("ro-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("run-observability")).toBeNull();
    await new Promise((r) => setTimeout(r, 60)); // the head of the next request is still waiting
    expect(screen.queryByTestId("run-observability")).toBeNull();
    second.open();
    await screen.findByTestId("run-observability");
    expect(calls).toEqual([url("mock", "ev-1"), url("mock", "ev-2")]);
  });

  it("asks again in the page's new mode for the same run, and the lab's note about another mode is shown instead of a record", async () => {
    answers[url("mock", "ev-1")] = ok({ record: mockRecord });
    answers[url("live", "ev-1")] = ok({ record: null, message: "That run was made in mock mode and the page is in live mode, so it is not shown. Run it again." });
    const { rerender } = render(<RunObs mode="mock" obs={began("ev-1")} />);
    await screen.findByTestId("run-observability");
    rerender(<RunObs mode="live" obs={began("ev-1")} />);
    expect(screen.queryByTestId("run-observability")).toBeNull();
    expect(await screen.findByTestId("ro-no-run")).toHaveTextContent(/made in mock mode and the page is in live mode/);
    expect(calls).toEqual([url("mock", "ev-1"), url("live", "ev-1")]);
  });

  it("a route answer that is not a record is an alert, never a stuck note and never an empty run: an HTTP error, HTML, nothing, a list, a string, an object without a record, a record that is not one, an unreachable lab", async () => {
    const shapes = [
      [ok({ error: "bad_mode", message: "mode must be mock, live or real." }, 400), /mode must be mock, live or real/],
      [{ ok: false, status: 502, json: async () => { throw new Error("html"); }, clone() { return this; } }, /The lab answered 502/],
      [{ ok: true, status: 200, json: async () => { throw new Error("html"); } }, /not a run record/], // a 200 page
      [ok(null), /not a run record/], [ok([]), /not a run record/], [ok("hello"), /not a run record/], [ok({}), /not a run record/], [ok({ nothing: true }), /not a run record/],
      [ok({ record: [] }), /not a run record/], [ok({ record: "x" }), /not a run record/], [ok({ record: {} }), /not a run record/],
      [new TypeError("fetch failed"), /Could not reach the lab \(fetch failed\)/],
    ];
    for (const [a, text] of shapes) {
      answers[url("mock", "ev-1")] = a;
      const { unmount } = render(<RunObs mode="mock" obs={began("ev-1")} />);
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.queryByTestId("ro-table")).toBeNull();
      expect(screen.queryByTestId("ro-lab-note")).toBeNull();
      expect(screen.queryByTestId("ro-loading")).toBeNull();
      unmount();
    }
  });

  it("a record made in the other mode is refused on screen (the server's answer and the page's mode differ)", async () => {
    answers[url("mock", "ev-1")] = ok({ record: realRecord });
    render(<RunObs mode="mock" obs={began("ev-1")} />);
    expect(await screen.findByTestId("ro-mismatch")).toHaveTextContent(/real mode but the page is in mock mode/);
  });
});

describe("Real", () => {
  it("shows the run as Real with the Real note: one reply the lab received, the developer simulated even in Real, the lab's own computations not rows", async () => {
    answers[url("real", "ev-3")] = ok({ record: realRecord });
    render(<RunObs mode="real" obs={began("ev-3", "real")} />);
    await screen.findByTestId("run-observability");
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/Real:/);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/only the hop to the live AI Gateway.*not a log line.*MOCK certificate subject, simulated even in Real.*not rows here.*no reply has no row and no pass/s);
    expect(screen.queryByText(/Re-read/)).toBeNull();
  });
});

describe("no run", () => {
  it("an evaluation that began no run says so, asks nothing and shows no older record", async () => {
    answers[url("mock", "ev-1")] = ok({ record: mockRecord });
    const { rerender } = render(<RunObs mode="mock" obs={began("ev-1")} />);
    await screen.findByTestId("run-observability");
    rerender(<RunObs mode="mock" obs={{ runId: null, began: false, mode: "mock" }} />);
    expect(screen.getByTestId("ro-no-run")).toHaveTextContent(/No run was recorded: nothing reached the engine/);
    expect(screen.queryByTestId("run-observability")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("an evaluation that ran but kept no record is an alert, and an answer with no run information is an alert too", async () => {
    const { rerender } = render(<RunObs mode="mock" obs={{ runId: null, began: true, mode: null }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/did not keep a record of it/);
    for (const obs of [undefined, null, {}, "x", { began: "yes" }]) {
      rerender(<RunObs mode="mock" obs={obs} />);
      expect(screen.getByRole("alert")).toHaveTextContent(/no run information/);
    }
    expect(calls).toEqual([]);
  });

  it("a run the lab no longer keeps is a note, not a record", async () => {
    answers[url("real", "ev-9")] = ok({ record: null, message: "There is no record of that run: Reset cleared it, newer runs pushed it out, or it never began." });
    render(<RunObs mode="real" obs={began("ev-9", "real")} />);
    expect(await screen.findByTestId("ro-no-run")).toHaveTextContent(/Reset cleared it/);
    await waitFor(() => expect(calls).toHaveLength(1));
  });
});

// Rule 27: the shared run-observability panel for this lab, with the lab's own states around it. The server says which run an evaluation began (the `obs`
// field of its answer); this asks for that run's record in the page's CURRENT mode and never shows any other record while it waits. Nothing is re-read on a
// timer: this lab reads no logs, so a re-read could find nothing new.
import { useEffect, useState } from "react";
import RunObservability from "../run-observability/RunObservability.jsx";
import { workspaceFetch } from "../workspace";

// Where this lab's run leaves logs and where they can stream (the README says the same).
export const LOG_STREAMS = [
  { product: "Coding Agents LAB (this lab's container)", lives: "its stdout: one line per decision the lab makes or reply it receives (an agent id, a step, a result, a rule id, the mode and a run id), never typed text, a credential or a gateway address", streams: "nowhere today: the family log collector's source list does not name this container, so it would need an entry first. The SIEM time would then be Docker's wall-clock time for the line, a little after the time the lab stamped" },
  { product: "Privilege AI Gateway (Real)", lives: "its own log, and for the hosted gateway the Privilege SIEM index ping-siem-events-v2", streams: "the Privilege SIEM export. This lab does not read it, so a Real record holds only the reply the lab received" },
];

const TITLE = "What each layer logged for this run";
const Note = ({ testId, role, children }) => (
  <div className="obs">
    <section className="ro" data-testid={testId} aria-label={TITLE}>
      <h2>{TITLE}</h2>
      <p className="ro-muted" role={role}>{children}</p>
    </section>
  </div>
);

// One line under the panel, true for every kind of run the page can make (an evaluation, a gateway-down evaluation, your own action).
const NOTE = {
  mock: "These rows are what the lab's engine computed for this evaluation (it read its recorded table, or on the Gateway down tab applied its own failure policy); none is read from a product log. Each time is when the lab stamped the event, the same time as its stdout line. Counts are rows, not decisions: one evaluation gives several. Person is a MOCK certificate subject: the lab has no sign-in. Agent is a simulated agent and hook: there is no OBO token. Privilege holds the lab's own deterministic rules, a stand-in for Privilege's Coding Agents / AI Guard (lab-invented, UNVERIFIED), not Privilege. In Mock nothing is sent to a gateway, and the lab never runs the action it judges, so there is no agent gateway or resource row.",
  live: "Live runs the real hook script into the lab's own loopback gateway, but the script, that gateway and its rules are all the lab's: every row is simulated and none is read from a product. Each time is when the lab stamped the event (the gateway's decision when it made it, the hook script's answer or failure policy when the script exited), the same time as its stdout line. Counts are rows, not decisions. Person is a MOCK certificate subject. Agent is a simulated agent and its hook script: there is no OBO token. Privilege holds the lab's own rules, a stand-in for Privilege's Coding Agents / AI Guard (lab-invented, UNVERIFIED), not Privilege; the lab's gateway is a route of its own process and has no row of its own. The lab never runs the action it judges, so there is no resource row.",
  real: "Real is only the hop to the live AI Gateway: each row is the reply the lab received, not a log line, and there is at most one (an AI Guard verdict is Privilege; any other JSON-RPC error is information in the agent gateway lane, because the lab cannot tell a gateway decision from a tool error; an HTTP 401, 403 or 5xx is information in the same lane: a credential check or a fault, not a policy decision, whatever the body says). The developer is a MOCK certificate subject, simulated even in Real, and the agent is simulated, so those lanes say not logged. The lab also runs its own rules beside the reply (Evaluate tab) and applies its own failure policy when the gateway is not reached: those are the lab's own computations, written to stdout, and are not rows here. A call that got no reply has no row and no pass.",
};

// What the lab's answer said about the run, before anything is fetched. `began: false` is the server's word that nothing reached the engine.
function waiting(obs) {
  if (obs === null || typeof obs !== "object" || typeof obs.began !== "boolean") return { id: "ro-no-run", role: "alert", text: "The lab's answer carried no run information, so there is no record to show." };
  if (!obs.began) return { id: "ro-no-run", text: "No run was recorded: nothing reached the engine (the agent is untouched, or it has no hook event for this action), so there is nothing to log." };
  if (!obs.runId) return { id: "ro-no-run", role: "alert", text: "The evaluation ran, but the lab did not keep a record of it (the server log says why)." };
  return null;
}

// The answer to one request for a record, as { record, message }. Anything that is not a record (a page, nothing, a list, a string, an object without a record)
// is an error record: it is never read as an empty run and never leaves the panel stuck.
async function fetchRecord(url) {
  const bad = (error, message) => ({ record: { error, message } });
  try {
    const r = await workspaceFetch(url, { headers: { accept: "application/json" } });
    let body = null;
    try { body = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) return bad(typeof body?.error === "string" ? body.error : `http_${r.status}`, typeof body?.message === "string" ? body.message : `The lab answered ${r.status}.`);
    if (body !== null && typeof body === "object" && !Array.isArray(body) && "record" in body) {
      const rec = body.record;
      if (rec === null) return { record: null, message: typeof body.message === "string" ? body.message : "There is no run to show." };
      if (typeof rec === "object" && !Array.isArray(rec) && (typeof rec.error === "string" || Array.isArray(rec.rows))) return { record: rec };
    }
    return bad("bad_answer", "The lab's answer was not a run record.");
  } catch (e) {
    return bad("unreachable", `Could not reach the lab (${String(e?.message || e).slice(0, 120)}).`);
  }
}

export default function RunObs({ mode, obs }) {
  const source = mode === "real" ? "real" : "mock"; // Live is the lab's own engine: simulated rows, the panel's "mock" source
  const wait = waiting(obs);
  const key = wait ? null : `${mode}|${obs.runId}`;
  const [answer, setAnswer] = useState(null); // { key, record, message }: the answer to the request for `key`
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    fetchRecord(`/api/run-observability?mode=${encodeURIComponent(mode)}&runId=${encodeURIComponent(obs.runId)}`).then((a) => { if (live) setAnswer({ key, ...a }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- a new run or a new mode asks again; nothing else does

  if (wait) return <Note testId={wait.id} role={wait.role}>{wait.text}</Note>;
  if (!answer || answer.key !== key) return <Note testId="ro-loading">Collecting this run's logs…</Note>; // never the previous record
  if (answer.record === null) return <Note testId="ro-no-run">{answer.message}</Note>;
  return (
    <div className="obs">
      <RunObservability record={answer.record} source={source} streams={LOG_STREAMS} />
      {!answer.record.error && <p className="ro-muted" data-testid="ro-lab-note">{NOTE[mode]}</p>}
    </div>
  );
}

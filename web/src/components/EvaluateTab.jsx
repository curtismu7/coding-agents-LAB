import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, postJson } from "../api";
import { visible } from "../safeText";
import { AuditTable, ClaimTag, Dialog, Findings, Hops, Json, Verdict } from "./Bits";

export function ResultView({ r }) {
  if (!r.installed) return <p className="panel" data-state="warn" data-testid="untouched">{visible(r.note)}</p>;
  if (!r.covered) return <p className="panel" data-state="warn" data-testid="not-covered">{visible(r.note)}</p>;
  return (
    <div className="stack" data-testid="result">
      <div className="cols">
        <section className="panel" aria-label="The request the hook sends">
          <h3 className="panel__sub">1. What {r.agentName} writes to the hook</h3>
          <p className="muted">Identity and device come from the machine certificate. Here it is a MOCK subject: <code data-testid="cert">{visible(r.certSubject)}</code> (fingerprint {r.identity.fingerprint}).</p>
          <Json value={r.hookRequest} label="hook request" testId="hook-request" />
          <p data-testid="who">Who: <b>{visible(r.identity.identity)}</b> on device <b>{visible(r.identity.device)}</b></p>
        </section>
        <section className="panel" aria-label="The evaluation">
          <h3 className="panel__sub">2. The gateway&apos;s evaluation</h3>
          <Verdict evaluation={r.evaluation} />
          <Findings findings={r.evaluation.findings} />
        </section>
      </div>
      <div className="cols">
        <section className="panel" aria-label="The native response">
          <h3 className="panel__sub">3. {r.agentName}&apos;s native response (stdout of the hook)</h3>
          <p>Engine decision <span className="tag">{r.evaluation.decision}</span> becomes native <span className="tag" data-testid="native-decision">{r.outcome.native}</span></p>
          {r.outcome.note && <p className="muted" data-testid="outcome-note">{visible(r.outcome.note)}</p>}
          <Json value={r.native} label="native response" testId="native-response" />
        </section>
        <section className="panel" aria-label="The permission dialog">
          <h3 className="panel__sub">4. What the developer sees in {r.agentName}</h3>
          <Dialog dialog={r.dialog} />
        </section>
      </div>
      <Hops hops={r.hops} traceId={r.traceId} />
    </div>
  );
}

const KINDS = [["prompt", "Prompt"], ["shell", "Shell command"], ["file_read", "File read (a path)"], ["mcp_call", "MCP call (server tool input)"], ["tool_result", "Tool result"]];

export default function EvaluateTab({ story, mode, config, resetSignal }) {
  const [agent, setAgent] = useState(story.agents[0].id);
  const [scenario, setScenario] = useState(story.scenarios[0].id);
  const [custom, setCustom] = useState({ kind: "prompt", text: "" });
  const [useCustom, setUseCustom] = useState(false);
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [audit, setAudit] = useState([]);
  const seq = useRef(0);
  const live = mode === "live";
  const customOn = useCustom && live;
  const sc = story.scenarios.find((s) => s.id === scenario);

  const run = useCallback((c) => {
    const mine = ++seq.current;
    const body = { mode, agent, vertical: story.vertical, config, ...(c ? { custom: c } : { scenario }) };
    postJson("/api/evaluate", body).then(({ ok, body: b }) => {
      if (mine !== seq.current) return;
      if (ok) { setRes(b); setError(null); getJson("/api/audit").then((j) => { if (mine === seq.current) setAudit(j.audit); }, () => {}); } else { setRes(null); setError(`${b.error}: ${b.detail || ""}`); }
    }, () => { if (mine === seq.current) setError("request failed"); });
  }, [mode, agent, scenario, story.vertical, config]);

  useEffect(() => { setRes(null); if (!customOn) run(null); }, [run, customOn, resetSignal]);
  useEffect(() => { setAudit([]); }, [resetSignal]);

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">Evaluate an action through an agent&apos;s hook <ClaimTag label={story.claimLabel} /></h2>
        <p className="muted" data-testid="evaluate-mode-note">{live ? "Live: the real hook script (hooks/lab-hook.mjs) is run with the agent's JSON on stdin, posts it over loopback to this server and prints the native answer. Nothing leaves this machine." : "Mock: the decision and the native answer come from a table generated from the same engine. Switch to Live to run the real hook script and to type your own action."}</p>
        <h3 className="panel__sub">Agent</h3>
        <div className="seg" role="group" aria-label="Agent">
          {story.agents.map((a) => <button key={a.id} type="button" aria-pressed={agent === a.id} onClick={() => setAgent(a.id)} data-testid={`ev-agent-${a.id}`}>{a.name}</button>)}
        </div>
        <h3 className="panel__sub">Action</h3>
        <div className="seg" role="group" aria-label="Action">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={!customOn && scenario === s.id} onClick={() => { setUseCustom(false); setScenario(s.id); }} data-testid={`sc-${s.id}`}>{s.title}</button>)}
        </div>
        {!customOn && <p className="lesson" data-testid="lesson">{sc.lesson} <span className="tag">{story.kindLabel[sc.kind]}</span></p>}
        {!customOn && <Json value={sc.call} label="the action" testId="action" />}
        <details open={customOn}>
          <summary>Your own action {live ? "" : "(Live mode only)"}</summary>
          {!live ? <p className="muted" data-testid="custom-needs-live">Mock mode only has tables for the scripted actions. Switch to Live to type your own: it is judged by the real rules, and nothing leaves the machine.</p> : (
            <form className="form" onSubmit={(e) => { e.preventDefault(); setUseCustom(true); run(custom); }}>
              <label>Kind of action
                <select value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value })} data-testid="custom-kind">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <label>Text (at most 2000 characters; shown as text, never run)
                <textarea rows={3} value={custom.text} maxLength={2000} onChange={(e) => setCustom({ ...custom, text: e.target.value })} data-testid="custom-text" />
              </label>
              <button type="submit" className="primary" data-testid="custom-run" disabled={!custom.text.trim()}>Run through the hook</button>
            </form>
          )}
        </details>
      </section>
      {error && <p className="field-error" role="alert" data-testid="eval-error">Could not run ({visible(error)}).</p>}
      {res ? <ResultView r={res} /> : !error && <p className="muted">{customOn ? "Type an action and press Run." : "Loading..."}</p>}
      <section className="panel">
        <AuditTable audit={audit} caption="Audit trail of this workspace: who ran what on which laptop (prompt text redacted)" />
      </section>
    </div>
  );
}

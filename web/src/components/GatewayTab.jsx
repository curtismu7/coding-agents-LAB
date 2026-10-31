import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, postJson } from "../api";
import { visible } from "../safeText";
import { ClaimTag, SourceTag } from "./Bits";
import { ResultView } from "./EvaluateTab";

function GapTable({ gaps }) {
  return (
    <div className="scroll"><table className="tbl tbl--wide" data-testid="gaps">
      <caption>Recorded gaps in this workspace (for review)</caption>
      <thead><tr><th>When</th><th>Developer</th><th>Device</th><th>Agent</th><th>Action</th><th>Outcome</th></tr></thead>
      <tbody>
        {gaps.length === 0 && <tr><td colSpan={6} className="muted">No gap recorded yet.</td></tr>}
        {[...gaps].reverse().map((g, i) => (
          <tr key={`${g.at}-${i}`}><td>{visible(String(g.at).slice(11, 19))}</td><td>{visible(g.identity)}</td><td>{visible(g.device)}</td><td>{visible(g.agent)}</td><td>{visible(g.kind)}: {visible(g.summary)}</td>
            <td><span className="tag" data-state={g.outcome === "refused" ? "bad" : "warn"} data-testid="gap-outcome">{g.outcome}</span> <code>{visible(g.reasonCode)}</code></td></tr>
        ))}
      </tbody>
    </table></div>
  );
}

export default function GatewayTab({ story, mode, config, setConfig, resetSignal }) {
  const [agent, setAgent] = useState(story.agents[0].id);
  const [scenario, setScenario] = useState("destructive-shell");
  const [down, setDown] = useState(true);
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [gaps, setGaps] = useState([]);
  const seq = useRef(0);
  const refresh = useCallback(() => getJson("/api/gaps").then((j) => setGaps(j.gaps), () => {}), []);
  useEffect(() => { setRes(null); setGaps([]); refresh(); }, [resetSignal, refresh]);

  const run = () => {
    const mine = ++seq.current;
    postJson("/api/evaluate", { mode, agent, scenario, down, vertical: story.vertical, config }).then(({ ok, body }) => {
      if (mine !== seq.current) return;
      if (ok) { setRes(body); setError(null); refresh(); } else { setRes(null); setError(`${body.error}: ${body.detail || ""}`); }
    }, () => { if (mine === seq.current) setError("request failed"); });
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">When the gateway cannot be reached <ClaimTag label={story.claimLabel} /></h2>
        <p data-testid="fail-claim">{story.claims.find((c) => c.id === "fail").claim}</p>
        <div className="toggles">
          <button type="button" aria-pressed={down} onClick={() => setDown((v) => !v)} data-testid="down-toggle">{down ? "Gateway: unreachable" : "Gateway: reachable"}</button>
          <button type="button" aria-pressed={!!config.FailClosed} onClick={() => setConfig({ ...config, FailClosed: !config.FailClosed })} data-testid="failclosed-toggle">FailClosed: {config.FailClosed ? "true (refuse)" : "false (keep working)"}</button>
          <SourceTag swagger />
        </div>
        <p className="muted">FailClosed is the CodingAgent field of that name ({story.swaggerNames}). Default open: a hook fires on every tool call, so failing closed stops all work on a laptop that loses its tunnel. {mode === "live" ? "Live: the hook script really tries a loopback port nothing listens on." : "Mock: the same failure policy, from the table of outcomes."}</p>
        <h3 className="panel__sub">Agent</h3>
        <div className="seg" role="group" aria-label="Agent">
          {story.agents.map((a) => <button key={a.id} type="button" aria-pressed={agent === a.id} onClick={() => setAgent(a.id)} data-testid={`gw-agent-${a.id}`}>{a.name}</button>)}
        </div>
        <h3 className="panel__sub">Action</h3>
        <div className="seg" role="group" aria-label="Action">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={scenario === s.id} onClick={() => setScenario(s.id)} data-testid={`gw-sc-${s.id}`}>{s.title}</button>)}
        </div>
        <p><button type="button" className="primary" onClick={run} data-testid="gw-run">Run the action</button></p>
      </section>
      {error && <p className="field-error" role="alert" data-testid="gw-error">Could not run ({visible(error)}).</p>}
      {res && (
        <section className="stack" data-testid="gw-result">
          {res.gap
            ? <p className="panel" data-state={res.gap.outcome === "refused" ? "bad" : "warn"} data-testid="gap-line">{res.gap.outcome === "refused" ? "Refused" : "Proceeded"}: {visible(res.gap.reason)}</p>
            : <p className="panel" data-state="ok" data-testid="gap-line">The gateway answered; no gap.</p>}
          <ResultView r={res} />
        </section>
      )}
      <section className="panel"><GapTable gaps={gaps} /></section>
    </div>
  );
}

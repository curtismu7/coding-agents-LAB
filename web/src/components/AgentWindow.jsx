import { useEffect, useRef, useState } from "react";
import { visible } from "../safeText";

// A little window that looks and behaves like each dev environment, running its hook for real:
// the visitor presses the agent's own UI affordance (a terminal key, an IDE button), the window
// "writes" the event JSON to the hook's stdin (typewriter), then shows the native answer inside
// the same chrome. The hook run itself happens server-side in Live/Real on the Evaluate tab;
// here the request and the native answers come from the story data (the same engine), so this
// window is the look-and-feel rehearsal, honest about that in its footer.
//
//   agent   : the story's agent view (skin, channels with request + per-decision responses)
//   kind    : which action kind is selected on the tab
//   compact : smaller type for a side-by-side layout
const CYCLE = ["allow", "ask", "deny"]; // the states the visitor cycles through where the agent supports them

export default function AgentWindow({ agent, kind, compact = false }) {
  const ch = agent.channels.find((c) => c.kind === kind);
  const skin = agent.skin || { kind: "terminal", title: agent.name, marker: ">", note: "" };
  const decisions = ch?.responses ? Object.keys(ch.responses) : [];
  const [phase, setPhase] = useState("idle"); // idle | typing | answered
  const [decision, setDecision] = useState(decisions.includes("deny") ? "deny" : decisions[0]);
  const [typed, setTyped] = useState("");
  const [speed, setSpeed] = useState("fast"); // fast | slow | off (off = paste whole)
  const timer = useRef(null);

  useEffect(() => { setPhase("idle"); setTyped(""); }, [agent.id, kind]);
  useEffect(() => () => clearInterval(timer.current), []);

  const target = ch?.request ? JSON.stringify(ch.request, null, 2) : "";
  const answer = ch?.responses?.[decision] ?? {};

  const typeIt = () => {
    if (phase === "typing") { clearInterval(timer.current); setPhase("idle"); setTyped(""); return; }
    setTyped(""); setPhase("typing");
    if (speed === "off") { setTyped(target); setPhase("answered"); return; }
    let i = 0; const step = speed === "fast" ? 24 : 7;
    timer.current = setInterval(() => {
      i += step;
      setTyped(target.slice(0, i));
      if (i >= target.length) { clearInterval(timer.current); setTimeout(() => setPhase("answered"), 350); }
    }, 30);
  };

  const cycleDecision = () => {
    const i = decisions.indexOf(decision);
    setDecision(decisions[(i + 1) % decisions.length]);
  };

  const stateTag = phase === "answered" ? (decision === "allow" ? "proceeds" : decision === "deny" ? "denied" : "asks") : "idle";
  return (
    <div className={`term skin-${agent.id} ${phase === "answered" ? `term--${stateTag}` : ""} ${compact ? "term--compact" : ""}`} data-testid="agent-window" data-agent={agent.id}>
      <div className="term__bar">
        <span className="term__dots"><i /><i /><i /></span>
        <span className="term__title">{skin.title}</span>
        <span className="term__spacer" />
        {phase === "answered" && decisions.length > 1 && (
          <button type="button" className="term__btn" onClick={cycleDecision} data-testid="aw-cycle" title="Show the next decision the hook could print">{decision} ↻</button>
        )}
      </div>
      <div className="term__body" data-testid="aw-body">
        {!ch?.event ? (
          <p>{agent.name} has no hook event for this kind of action — nothing to emulate here (the matrix above says so).</p>
        ) : phase === "idle" ? (
          <p className="muted">Ready. The hook command is armed for <b>{ch.event}</b>.</p>
        ) : (
          <pre className="term__json" data-testid="aw-request">{visible(typed)}{phase === "typing" && <span className="cursor">▌</span>}</pre>
        )}
        {phase === "answered" && (
          <div className="term__answer" data-testid="aw-answer">
            <div className="term__answerlabel"><span className="promptmark">{skin.marker}</span> hook answered — native {decision}:</div>
            <pre>{visible(JSON.stringify(answer, null, 2))}</pre>
          </div>
        )}
      </div>
      <div className="term__foot">
        <button type="button" className="primary" onClick={typeIt} disabled={!ch?.event} data-testid="aw-run">
          {phase === "typing" ? "Stop" : phase === "answered" ? "Run again" : skin.kind === "card" ? "Trigger the hook" : "Run the hook (Enter)"}
        </button>
        <label className="term__speed">speed{" "}
          <select value={speed} onChange={(e) => setSpeed(e.target.value)} data-testid="aw-speed" aria-label="Typewriter speed">
            <option value="fast">fast</option>
            <option value="slow">slow</option>
            <option value="off">paste whole</option>
          </select>
        </label>
        <span className="muted term__note">{skin.note} A rendering from the same engine, not the product UI.</span>
      </div>
    </div>
  );
}

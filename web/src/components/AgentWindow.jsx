import { useEffect, useRef, useState } from "react";
import { visible } from "../safeText";

// A little window that looks and behaves like each dev environment, running its hook for real:
// the visitor picks a prompt from the dropdown (the same scripted actions the Evaluate tab
// drives), presses the agent's own UI affordance, the window "writes" that event JSON to the
// hook's stdin (typewriter), then shows the native answer inside the same chrome. The hook run
// itself happens server-side in Live/Real on the Evaluate tab; here the request and the native
// answers come from the story data (the same engine), so this window is the look-and-feel
// rehearsal, honest about that in its footer.
//
//   agent   : the story's agent view (skin, channels, scenarioRequests)
//   kind    : which action kind is selected on the tab (prefills the dropdown)
//   compact : smaller type for a side-by-side layout
const CYCLE = ["allow", "ask", "deny"]; // the states the visitor cycles through where the agent supports them

export default function AgentWindow({ agent, kind, compact = false }) {
  const ch = agent.channels.find((c) => c.kind === kind);
  const skin = agent.skin || { kind: "terminal", title: agent.name, marker: ">", note: "" };
  const runnable = (agent.scenarioRequests || []).filter((s) => s.request);
  const [picked, setPicked] = useState(() => (runnable.find((s) => s.kind === kind) || runnable[0])?.id || "");
  const [phase, setPhase] = useState("idle"); // idle | typing | answered
  const [typed, setTyped] = useState("");
  const [speed, setSpeed] = useState("fast"); // fast | slow | off (off = paste whole)
  const timer = useRef(null);

  useEffect(() => {
    const pre = runnable.find((s) => s.kind === kind);
    if (pre) setPicked(pre.id);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPhase("idle"); setTyped(""); }, [agent.id, picked]);
  useEffect(() => () => clearInterval(timer.current), []);

  const pickedSc = runnable.find((s) => s.id === picked);
  const target = pickedSc ? JSON.stringify(pickedSc.request, null, 2) : "";
  // The expected decision of the picked scenario, as the hook's native answer (from the channel's
  // canned responses when it has one, else derived: deny for an expected-deny action).
  const decisionFor = (sc) => {
    const ch2 = agent.channels.find((c) => c.kind === sc.kind);
    const want = sc.expected === "deny" ? "deny" : sc.expected === "ask" ? "ask" : "allow";
    if (want === "ask" && !ch2?.canAsk) return "deny";
    if (want !== "allow" && !ch2?.canBlock) return "allow"; // documented: the hook cannot refuse
    return want;
  };
  const decision = pickedSc ? decisionFor(pickedSc) : "allow";
  const answer = pickedSc ? (agent.channels.find((c) => c.kind === pickedSc.kind)?.responses?.[decision] ?? {}) : {};

  const typeIt = () => {
    if (phase === "typing") { clearInterval(timer.current); setPhase("idle"); setTyped(""); return; }
    setTyped(""); setPhase("typing");
    if (speed === "off" || !target) { setTyped(target); setPhase("answered"); return; }
    let i = 0; const step = speed === "fast" ? 24 : 7;
    timer.current = setInterval(() => {
      i += step;
      setTyped(target.slice(0, i));
      if (i >= target.length) { clearInterval(timer.current); setTimeout(() => setPhase("answered"), 350); }
    }, 30);
  };

  const cycleDecision = () => {
    const opts = ch?.responses ? Object.keys(ch.responses) : ["allow"];
    const i = opts.indexOf(decision);
    setDecisionOverride(opts[(i + 1) % opts.length]);
  };
  const [decisionOverride, setDecisionOverride] = useState(null);
  const shownDecision = decisionOverride && pickedSc && agent.channels.find((c) => c.kind === pickedSc.kind)?.responses?.[decisionOverride] ? decisionOverride : decision;
  const shownAnswer = decisionOverride && pickedSc && agent.channels.find((c) => c.kind === pickedSc.kind)?.responses?.[shownDecision] ? agent.channels.find((c) => c.kind === pickedSc.kind)?.responses?.[shownDecision] : answer;

  const stateTag = phase === "answered" ? (shownDecision === "allow" ? "proceeds" : shownDecision === "deny" ? "denied" : "asks") : "idle";
  const kindsInScenarios = [...new Set(runnable.map((s) => s.kind))];
  const [category, setCategory] = useState(null); // null = follow the tab's kind
  const activeCategory = category ?? kind;
  const categoryPrompts = runnable.filter((s) => s.kind === activeCategory);
  const CATEGORY_LABEL = { prompt: "Prompt", shell: "Shell command", file_read: "File read", mcp_call: "MCP call", tool_result: "Tool result" };
  return (
    <div className={`term skin-${agent.id} ${phase === "answered" ? `term--${stateTag}` : ""} ${compact ? "term--compact" : ""}`} data-testid="agent-window" data-agent={agent.id}>
      <div className="term__bar">
        <span className="term__dots"><i /><i /><i /></span>
        <span className="term__title">{skin.title}</span>
        <span className="term__spacer" />
        {phase === "answered" && agent.channels.find((c) => c.kind === pickedSc?.kind)?.responses && Object.keys(agent.channels.find((c) => c.kind === pickedSc?.kind)?.responses || {}).length > 1 && (
          <button type="button" className="term__btn" onClick={cycleDecision} data-testid="aw-cycle" title="Show the next decision the hook could print">{shownDecision} ↻</button>
        )}
      </div>
      <div className="term__pick">
        <label className="term__picklabel">Category{" "}
          <select value={activeCategory} onChange={(e) => { setCategory(e.target.value); const first = runnable.find((s) => s.kind === e.target.value); if (first) { setPicked(first.id); setDecisionOverride(null); setPhase("idle"); setTyped(""); } }} data-testid="aw-category">
            {kindsInScenarios.map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k] || k}</option>)}
          </select>
        </label>
        {pickedSc && <span className={`tag ${pickedSc.expected === "allow" ? "" : "warn"}`} data-testid="aw-expected">expected: {pickedSc.expected}</span>}
      </div>
      <div className="term__promptlist" role="group" aria-label="Preset prompts for the selected category" data-testid="aw-prompts">
        {categoryPrompts.map((s) => (
          <button key={s.id} type="button" className={`prompt-choice ${picked === s.id ? "prompt-choice--on" : ""}`} data-testid={`aw-prompt-${s.id}`}
            onClick={() => { setPicked(s.id); setDecisionOverride(null); setPhase("idle"); setTyped(""); }}>{s.title}</button>
        ))}
      </div>
      <div className="term__body" data-testid="aw-body">
        {!pickedSc ? (
          <p className="muted">{agent.name} has no hook event for this kind of action — nothing to emulate here (the matrix above says so).</p>
        ) : phase === "idle" ? (
          <p className="muted">Ready. The hook command is armed for <b>{agent.channels.find((c) => c.kind === pickedSc.kind)?.event}</b>.</p>
        ) : (
          <pre className="term__json" data-testid="aw-request">{visible(typed)}{phase === "typing" && <span className="cursor">▌</span>}</pre>
        )}
        {phase === "answered" && pickedSc && (
          <div className="term__answer" data-testid="aw-answer">
            <div className="term__answerlabel"><span className="promptmark">{skin.marker}</span> hook answered — native {shownDecision}:</div>
            <pre>{visible(JSON.stringify(shownAnswer, null, 2))}</pre>
          </div>
        )}
      </div>
      <div className="term__foot">
        <button type="button" className="primary" onClick={typeIt} disabled={!pickedSc} data-testid="aw-run">
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

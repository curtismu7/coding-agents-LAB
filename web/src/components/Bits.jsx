import { visible } from "../safeText";

// Raw JSON or text, rendered as text only (never markup). Control and bidi characters are shown as visible escapes.
export function Json({ value, label, testId }) {
  return <pre className="json" tabIndex={0} aria-label={label} data-testid={testId}>{visible(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>;
}

// Every product claim carries this tag. It is on every tab, and in presenter mode too.
export function ClaimTag({ label }) {
  return <span className="tag" data-state="warn" data-testid="claim-tag">{label || "Ping release claim, UNVERIFIED on our tenant"}</span>;
}

// documented = read in the vendor's docs at build time; illustrative = the lab's own shape, UNVERIFIED; partly = both (the caveat says which).
const STATUS_TEXT = { documented: "documented", partly: "partly documented, partly illustrative", illustrative: "illustrative, UNVERIFIED" };
export function StatusTag({ status }) {
  return <span className="tag" data-state={status === "documented" ? "ok" : "warn"} data-testid="shape-status">{STATUS_TEXT[status] || status}</span>;
}

// What is documented and what is illustrative about one agent's hook channel, shown beside every result.
export function ChannelNote({ channel }) {
  return (
    <div className="muted" data-testid="channel-note">
      <StatusTag status={channel.status} /> hook event <code>{channel.event}</code>.
      {channel.documented && <span> <b>Documented:</b> {visible(channel.documented)}</span>}
      {channel.illustrative && <span> <b>Illustrative, UNVERIFIED:</b> {visible(channel.illustrative)}</span>}
    </div>
  );
}

export function SourceTag({ swagger }) {
  return <span className="tag" data-state={swagger ? "ok" : "none"}>{swagger ? "console swagger name" : "lab-invented"}</span>;
}

const WORD = { allow: "ALLOW", alert: "ALERT (proceeds)", ask: "ASK THE DEVELOPER", deny: "DENY" };
export function Verdict({ evaluation }) {
  const d = evaluation.decision;
  return (
    <div className="verdict" data-decision={d} data-testid="verdict" role="status">
      <div className="verdict__word" data-testid="verdict-word">{WORD[d] || d}</div>
      <div>Reason code: <span className="verdict__code" data-testid="reason-code">{visible(evaluation.reasonCode)}</span></div>
      <div>{visible(evaluation.reason)}</div>
      <div className="muted">Decided by: {visible(evaluation.decidedBy)}</div>
    </div>
  );
}

export function Findings({ findings }) {
  if (!findings.length) return <p className="muted" data-testid="no-findings">No rule fired.</p>;
  return (
    <div className="scroll"><table className="tbl tbl--wide" data-testid="findings">
      <thead><tr><th>Rule</th><th>Effect</th><th>Why</th></tr></thead>
      <tbody>{findings.map((f) => <tr key={f.id}><td><code>{f.id}</code></td><td><span className="tag" data-state={f.effect === "block" ? "bad" : "warn"}>{f.effect}</span></td><td>{visible(f.detail)}</td></tr>)}</tbody>
    </table></div>
  );
}

// The permission dialog an agent shows, drawn from the decision. Display only: nothing here is clickable.
export function Dialog({ dialog }) {
  return (
    <div className="dialog" data-state={dialog.state} data-testid="dialog">
      <div className="dialog__title">{dialog.title}</div>
      <div className="dialog__heading" data-testid="dialog-heading">{dialog.heading}</div>
      <div className="dialog__action">{visible(dialog.action)}</div>
      <div className="dialog__reason" data-testid="dialog-reason">{dialog.state === "proceeds" ? "" : visible(dialog.message)}</div>
      {dialog.buttons.length > 0 && <div className="dialog__buttons">{dialog.buttons.map((b) => <span key={b} className="dialog__button">{b}</span>)}</div>}
      {dialog.note && <div className="muted" data-testid="dialog-note">{visible(dialog.note)}</div>}
    </div>
  );
}

// The dialog dressed as the real client: a terminal window (Claude Code, Codex, Gemini CLI) or an
// editor notification card (Cursor, Copilot, Antigravity). Same content as Dialog; the chrome is
// per-agent (skin from the agent data, keyed by the agent's id). The "developer sees" claim stays
// honest: it is a rendering of the native answer in that client's shape, not a product screenshot.
const SKIN_CLASS = { "claude-code": "claude", cursor: "cursor", codex: "codex", "gemini-cli": "gemini", copilot: "copilot", antigravity: "antigravity" };
export function AgentDialog({ dialog, agentId }) {
  const skin = dialog.skin || null;
  if (!skin || !SKIN_CLASS[agentId]) return <Dialog dialog={dialog} />;
  const stateClass = dialog.state === "denied" ? "term--denied" : dialog.state === "asks" ? "term--asks" : "term--proceeds";
  return (
    <div className={`term ${stateClass} skin-${SKIN_CLASS[agentId]}`} data-testid="dialog" data-state={dialog.state}>
      <div className="term__bar"><span className="term__dots"><i /><i /><i /></span> {skin.title}</div>
      <div className="term__body">
        {skin.kind === "card" && dialog.state !== "proceeds" ? (
          <div className="card">
            <div className="card__title">{dialog.heading}</div>
            <div>{visible(dialog.action)}</div>
            <div>{visible(dialog.message)}</div>
            {dialog.buttons.length > 0 && <div className="dialog__buttons">{dialog.buttons.map((b) => <span key={b} className="dialog__button">{b}</span>)}</div>}
          </div>
        ) : (
          <>
            <div><span className="promptmark">{skin.marker}</span> {visible(dialog.action)}</div>
            {dialog.state !== "proceeds" && <div>⎿ {dialog.heading} — {visible(dialog.message)}</div>}
            {dialog.buttons.length > 0 && <div className="dialog__buttons">{dialog.buttons.map((b) => <span key={b} className="dialog__button">{b}</span>)}</div>}
          </>
        )}
        {dialog.note && <div className="muted" data-testid="dialog-note">{visible(dialog.note)}</div>}
        <div className="muted">{skin.note}</div>
      </div>
    </div>
  );
}

export function Hops({ hops, traceId }) {
  return (
    <details className="hops" data-testid="hops">
      <summary>Raw hops with traceparent{traceId ? ` (trace ${traceId.slice(0, 8)}...)` : ""}</summary>
      {hops.map((h) => (
        <div key={h.n}>
          <h4 className="hops__title">{h.n}. {h.label}</h4>
          <Json value={h.request} label={`hop ${h.n} request`} />
          <Json value={h.response} label={`hop ${h.n} response`} />
        </div>
      ))}
    </details>
  );
}

export function AuditTable({ audit, caption }) {
  return (
    <div className="scroll"><table className="tbl tbl--wide" data-testid="audit">
      <caption>{caption}</caption>
      <thead><tr><th>Developer</th><th>Device</th><th>Agent</th><th>Action</th><th>Decision</th></tr></thead>
      <tbody>
        {audit.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet: run an action.</td></tr>}
        {[...audit].reverse().slice(0, 8).map((a, i) => <tr key={`${a.at}-${i}`}><td>{visible(a.identity)}</td><td>{visible(a.device)}</td><td>{visible(a.agent)}</td><td>{visible(a.kind)}: {visible(a.summary)}</td><td><code>{visible(a.reasonCode)}</code></td></tr>)}
      </tbody>
    </table></div>
  );
}

import { visible } from "../safeText";

// Raw JSON or text, rendered as text only (never markup). Control and bidi characters are shown as visible escapes.
export function Json({ value, label, testId }) {
  return <pre className="json" tabIndex={0} aria-label={label} data-testid={testId}>{visible(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>;
}

// Every product claim carries this tag. It is on every tab, and in presenter mode too.
export function ClaimTag({ label }) {
  return <span className="tag" data-state="warn" data-testid="claim-tag">{label || "Ping release claim, UNVERIFIED on our tenant"}</span>;
}

// documented = read in the vendor's docs at build time; illustrative = the lab's own shape, UNVERIFIED.
export function StatusTag({ status }) {
  const doc = status === "documented";
  return <span className="tag" data-state={doc ? "ok" : "warn"} data-testid="shape-status">{doc ? "documented" : "illustrative, UNVERIFIED"}</span>;
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

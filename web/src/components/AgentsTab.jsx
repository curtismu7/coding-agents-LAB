import { useEffect, useState } from "react";
import { getJson } from "../api";
import { ClaimTag, Json, StatusTag } from "./Bits";
import { visible } from "../safeText";

const cell = (c) => (!c.event ? "no hook event" : c.canBlock && c.canAsk ? "deny or ask" : c.canBlock ? "deny" : "observe only");
const mark = (c) => (c.status === "documented" ? "" : c.status === "partly" ? " (partly illustrative)" : " (illustrative)");

export default function AgentsTab({ story }) {
  const [agentId, setAgentId] = useState(story.agents[0].id);
  const [kind, setKind] = useState("shell");
  const agent = story.agents.find((a) => a.id === agentId);
  const ch = agent.channels.find((c) => c.kind === kind);
  const [sources, setSources] = useState({});
  useEffect(() => { getJson("/api/sources").then(setSources, () => {}); }, []);
  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">Six agents, each through its own hook <ClaimTag /></h2>
        <p data-testid="agents-claim">{story.claims[0].claim}</p>
        <p className="muted" data-testid="legend">
          Source discipline: every shape below is tagged <span className="tag" data-state="ok">documented</span> (read in the vendor&apos;s own documentation at build time, 2026-10-31; the sources are listed in the README) or <span className="tag" data-state="warn">illustrative, UNVERIFIED</span> (the lab&apos;s own example; never stated as fact), or <span className="tag" data-state="warn">partly documented</span> (the envelope is documented, a field or tool name is not). A matrix cell without a note is fully documented. The caveat under each says which part is which.
        </p>
        <div className="scroll"><table className="tbl" data-testid="matrix">
          <caption>What each agent&apos;s hook can do with each kind of action</caption>
          <thead><tr><th>Agent</th>{story.kinds.map((k) => <th key={k}>{story.kindLabel[k]}</th>)}</tr></thead>
          <tbody>{story.agents.map((a) => (
            <tr key={a.id}><th scope="row">{a.name}</th>{a.channels.map((c) => <td key={c.kind} data-state={!c.event ? "none" : c.canBlock && c.status === "documented" ? "ok" : "warn"}>{cell(c)}{mark(c)}</td>)}</tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="panel">
        <div className="seg" role="group" aria-label="Agent">
          {story.agents.map((a) => <button key={a.id} type="button" aria-pressed={agentId === a.id} onClick={() => setAgentId(a.id)} data-testid={`agent-${a.id}`}>{a.name}</button>)}
        </div>
        <h2 className="panel__title">{agent.name} <span className="muted">({agent.vendor})</span></h2>
        <h3 className="panel__sub">Machine-level managed configuration</h3>
        <div className="scroll"><table className="tbl" data-testid="managed-paths">
          <thead><tr><th>System</th><th>Path</th><th>Status</th></tr></thead>
          <tbody>{agent.managed.map((m) => <tr key={m.os}><td>{m.os}</td><td><code>{visible(m.path)}</code></td><td><StatusTag status={m.status} /></td></tr>)}</tbody>
        </table></div>
        <p>{agent.managedNote}</p>
        <p className="muted" data-testid="config-caveat">{agent.configCaveat}</p>
        <div className="muted" data-testid="sources">Sources (plain text, copy from here; the lab never fetches them):
          <ul className="plain">{agent.sources.map((id) => <li key={id}><code>{id}</code>: <code data-testid={`source-${id}`}>{sources[id] || "(loading)"}</code></li>)}</ul>
        </div>

        <h3 className="panel__sub">One kind of action</h3>
        <div className="seg" role="group" aria-label="Kind of action">
          {story.kinds.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`kind-${k}`}>{story.kindLabel[k]}</button>)}
        </div>
        <p>
          Hook event: <code data-testid="event">{ch.event || "none"}</code> <StatusTag status={ch.status} />{" "}
          <span className="tag" data-state={ch.canBlock ? "ok" : "warn"}>{ch.canBlock ? "can refuse" : "cannot refuse"}</span>{" "}
          <span className="tag" data-state={ch.canAsk ? "ok" : "warn"}>{ch.canAsk ? "can ask" : "no ask"}</span>
        </p>
        <p className="muted" data-testid="channel-caveat">{ch.documented && <span><b>Documented:</b> {ch.documented} </span>}{ch.illustrative && <span><b>Illustrative, UNVERIFIED:</b> {ch.illustrative}</span>}</p>
        {ch.request ? (
          <div className="cols">
            <div><h3 className="panel__sub">What the agent writes to the hook (stdin)</h3><Json value={ch.request} label="request" testId="agent-request" /></div>
            <div>
              <h3 className="panel__sub">What the hook prints (stdout), native</h3>
              {Object.entries(ch.responses).map(([d, r]) => <div key={d}><span className="tag" data-state={d === "deny" ? "bad" : d === "ask" ? "warn" : "ok"}>{d}</span><Json value={r} label={`${d} response`} testId={`resp-${d}`} /></div>)}
            </div>
          </div>
        ) : <p className="field-error" data-testid="no-event">{agent.name} has no hook event for this kind of action, so a hook never sees it. This is a coverage gap: the endpoint sensor is what still finds it.</p>}
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { postJson } from "../api";
import { ClaimTag, Json, SourceTag, StatusTag } from "./Bits";
import { visible } from "../safeText";

const dl = (text) => `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;

// The editable CodingAgent config. The form edits a draft; the draft is validated by the server on every change, and only a VALID
// draft becomes the config every tab uses (an invalid one leaves the last valid config in force). The generated managed
// configuration is TEXT ONLY: shown and downloadable, never written anywhere by the lab.
export default function ConfigTab({ story, config, setConfig, resetSignal }) {
  const named = Object.keys(config.Agents).length > 0;
  const [gwText, setGwText] = useState(config.Gateways.join("\n"));
  const [jsonText, setJsonText] = useState(JSON.stringify(config, null, 2));
  const [jsonError, setJsonError] = useState(null);
  const [check, setCheck] = useState({ ok: true, errors: [], warnings: [], generated: [] });
  const seq = useRef(0);

  useEffect(() => { setGwText(config.Gateways.join("\n")); setJsonText(JSON.stringify(config, null, 2)); }, [resetSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate a candidate; accept it as the config only when valid.
  // passive: only show the validation result (used when the tab opens); it never replaces what the visitor is typing.
  const propose = (next, passive = false) => {
    const mine = ++seq.current;
    postJson("/api/config", { config: next, vertical: story.vertical }).then(({ body }) => {
      if (mine !== seq.current) return;
      setCheck({ ok: body.ok, errors: body.errors || [], warnings: body.warnings || [], generated: body.generated || [] });
      if (body.ok && !passive) { setConfig(body.config); setJsonText(JSON.stringify(body.config, null, 2)); setJsonError(null); }
    }, () => setCheck({ ok: false, errors: [{ field: "(request)", message: "the server did not answer" }], warnings: [], generated: [] }));
  };
  useEffect(() => { propose(config, true); }, [story.vertical, resetSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAgent = (id, on) => { const next = { ...config, Agents: { ...config.Agents, [id]: on } }; propose(next); };
  const setScope = (all) => propose({ ...config, Agents: all ? {} : Object.fromEntries(story.agents.map((a) => [a.id, true])) });
  const applyGateways = (text) => { setGwText(text); propose({ ...config, Gateways: text.split("\n").map((s) => s.trim()).filter(Boolean) }); };
  const applyJson = () => { try { propose(JSON.parse(jsonText)); setJsonError(null); } catch { setJsonError("That is not valid JSON."); } };

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">CodingAgent config <ClaimTag label={story.claimLabel} /></h2>
        <p className="muted" data-testid="config-source">Field names Enabled, FailClosed, Agents and Gateways: <b>{story.swaggerNames}</b>. Everything else here (validation limits, the generated text, "found on the device") is lab-invented.</p>
        <div className="cols">
          <div className="form">
            <label className="check"><input type="checkbox" checked={config.Enabled} onChange={(e) => propose({ ...config, Enabled: e.target.checked })} data-testid="cfg-enabled" /> Enabled <SourceTag swagger /></label>
            <p className="muted">{story.configFields[0].note} The product default is OFF until a tenant asks; this lab opens it ON so the demo has something to show.</p>
            <label className="check"><input type="checkbox" checked={config.FailClosed} onChange={(e) => propose({ ...config, FailClosed: e.target.checked })} data-testid="cfg-failclosed" /> FailClosed <SourceTag swagger /></label>
            <p className="muted">{story.configFields[1].note}</p>
            <fieldset className="fieldset">
              <legend>Agents <SourceTag swagger /></legend>
              <div className="seg" role="group" aria-label="Agents scope">
                <button type="button" aria-pressed={!named} onClick={() => setScope(true)} data-testid="cfg-scope-all">Every agent found on the device (empty)</button>
                <button type="button" aria-pressed={named} onClick={() => setScope(false)} data-testid="cfg-scope-named">Only the agents named below</button>
              </div>
              {named && story.agents.map((a) => <label key={a.id} className="check"><input type="checkbox" checked={!!config.Agents[a.id]} onChange={(e) => setAgent(a.id, e.target.checked)} data-testid={`cfg-agent-${a.id}`} /> {a.name}</label>)}
              <p className="muted">{story.configFields[2].note}</p>
            </fieldset>
            <label>Gateways, one per line (tried in order) <SourceTag swagger />
              <textarea rows={3} value={gwText} onChange={(e) => applyGateways(e.target.value)} data-testid="cfg-gateways" aria-describedby="gw-help" />
            </label>
            <p className="muted" id="gw-help">https, an .example or .invalid host, at most 5. These are the endpoints the generated text would carry; the lab&apos;s own hook only ever reaches loopback.</p>
            <p className="muted">{story.configFields.slice(4).map((f) => f.name).join(", ")}: <SourceTag swagger /> carried as in the schema, not interpreted by the lab.</p>
          </div>
          <div>
            <h3 className="panel__sub">Validation</h3>
            {check.ok ? <p data-testid="cfg-valid"><span className="tag" data-state="ok">valid</span> This config is in force on every tab.</p> : (
              <div className="field-error" role="alert" data-testid="cfg-errors">
                <p>Not valid, so the last valid config stays in force:</p>
                <ul className="plain">{check.errors.map((e, i) => <li key={i}><code>{visible(e.field)}</code>: {visible(e.message)}</li>)}</ul>
              </div>
            )}
            {check.warnings.length > 0 && <ul className="plain" data-testid="cfg-warnings">{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            <h3 className="panel__sub">The config as JSON (edit, then Apply)</h3>
            <textarea rows={9} value={jsonText} onChange={(e) => setJsonText(e.target.value)} data-testid="cfg-json" aria-label="Config JSON" />
            <button type="button" onClick={applyJson} data-testid="cfg-apply">Apply JSON</button>
            {jsonError && <p className="field-error" role="alert">{jsonError}</p>}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Generated managed configuration (text only)</h2>
        <p className="muted" data-testid="text-only">This is TEXT. The lab never writes a configuration or settings file anywhere: not in your home directory, not under /Library or /etc. Copy it or download it; installing it is up to whoever owns the machine.</p>
        {check.generated.length === 0 && <p className="muted" data-testid="nothing-generated">{config.Enabled ? "No agent is covered, so there is nothing to generate." : "Enabled is false: no hook is installed on any agent, so nothing is generated."}</p>}
        {check.generated.map((g) => (
          <article key={g.agent} className="gen" data-testid={`gen-${g.agent}`}>
            <h3 className="panel__sub">{story.agents.find((a) => a.id === g.agent).name}</h3>
            <p>Path: <code>{visible(g.path)}</code> <StatusTag status={g.pathStatus} /> Body: <StatusTag status={g.bodyStatus} /></p>
            <p className="muted">{g.caveat}</p>
            <Json value={g.text} label={`${g.agent} configuration text`} />
            <a className="download" href={dl(g.text)} download={`${g.agent}-managed-config.txt`} data-testid={`dl-${g.agent}`}>Download as text</a>
          </article>
        ))}
      </section>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu";
import ShelfLink from "./components/ShelfLink";
import AgentsTab from "./components/AgentsTab";
import EvaluateTab from "./components/EvaluateTab";
import GatewayTab from "./components/GatewayTab";
import ConfigTab from "./components/ConfigTab";
import DiagramTab from "./components/DiagramTab";
import TalkTrack from "./components/TalkTrack";
import { getJson, resetWorkspace, setMode } from "./api";

export const TABS = [
  { id: "agents", label: "Agents" },
  { id: "evaluate", label: "Evaluate" },
  { id: "gateway", label: "Gateway down" },
  { id: "config", label: "Config" },
  { id: "diagram", label: "Diagram" },
  { id: "talk", label: "Talk track" },
];
// The banner is never blank and never claims one mode before it knows: until the story answers it says both, honestly.
const TAIL = "Every product claim is a Ping release claim, UNVERIFIED on our tenant (release 2026-11-02). The agents, the device identity and the actions stay simulated, and no agent configuration is written anywhere.";
export const BANNER_UNKNOWN = `SIMULATED, MOCK, LIVE or REAL mode. ${TAIL}`;
const PRESENTER_TALK = { agents: ["say-first", "managed", "emulation"], evaluate: ["native", "secrets", "identity"], gateway: ["fail"], config: ["managed", "triton"], diagram: ["why-hook"] };
const MODE_KEY = "ca.mode";

const tabFromHash = () => { const h = window.location.hash.replace("#", ""); return TABS.some((t) => t.id === h) ? h : "agents"; };
const savedMode = () => { try { const m = window.localStorage.getItem(MODE_KEY); return m === "live" || m === "mock" || m === "real" ? m : null; } catch { return null; } };

const THEME_KEY = "codingagents.theme";
const FONT_KEY = "codingagents.font";
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
function initialTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") return t; } catch { /* storage blocked */ }
  return "auto";
}
function initialFont() {
  try { const f = localStorage.getItem(FONT_KEY); if (f === "S" || f === "M" || f === "L") return f; } catch { /* storage blocked */ }
  return "M";
}

export default function App() {
  const [vertical, setVertical] = useState("finance");
  const [story, setStory] = useState(null);
  const [mode, setModeState] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(tabFromHash());
  const [presenter, setPresenter] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const [realAvailable, setRealAvailable] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [fontStep, setFontStep] = useState(initialFont);
  const pickTheme = (next) => {
    try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };
  // The picker only sets data-theme; the shared stylesheet does the rest ("auto" follows the system setting).
  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { applyFontSize(fontStep); try { localStorage.setItem(FONT_KEY, fontStep); } catch { /* not remembered */ } }, [fontStep]);
  const tabsRef = useRef(null);

  useEffect(() => { getJson("/api/info").then((i) => { setModeState((m) => m || savedMode() || i.mode); setRealAvailable(i.realAvailable === true); }, () => setModeState((m) => m || savedMode() || "mock")); }, []);
  // Rule 19: Real is disabled with the server's reason while the AI Gateway settings are incomplete.
  const realWhy = "Real mode is not configured: set CODING_AGENTS_LAB_AIGATEWAY_URL (or CENTRAL_AGENT_A2A_URL) and its bearer in the shared settings file and restart the lab. The bearer is never shown.";
  useEffect(() => {
    getJson(`/api/story?vertical=${encodeURIComponent(vertical)}`).then((j) => { setStory(j); setConfig((c) => c || structuredClone(j.defaultConfig)); setError(null); }, (e) => setError(e.message));
  }, [vertical]);
  useEffect(() => {
    const on = () => setTab(tabFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const applyMode = (m) => { setModeState(m); try { window.localStorage.setItem(MODE_KEY, m); } catch { /* storage blocked */ } };
  // Rule 19: the Mock/Real toggle POSTs the source to the server's runtime mode, then reloads the story data.
  // A refusal (Real without the AI Gateway settings, the 409 body) is data, not an exception; it is shown as an error.
  const switchSource = useCallback(async (source) => {
    if (source === mode) return;
    const r = await setMode(source);
    if (!r.ok) { setError(r.body?.message || r.body?.detail || `Could not switch to ${source}.`); return; }
    // "real" maps to the engine's "live" mode word (the real hook script on loopback): the tabs read
    // mode === "live" to run the hook script path; the server's own source word stays "real".
    applyMode(source === "real" ? "live" : "mock");
    setRealAvailable(r.body?.realAvailable === true);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = (id) => { setTab(id); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };

  // Keep the active tab fully in view in the scrolling tab strip (375px).
  useEffect(() => {
    const strip = tabsRef.current; const el = document.getElementById(`tab-${tab}`);
    if (!strip || !el) return;
    const left = el.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 8);
  }, [tab]);

  useEffect(() => {
    const on = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const reset = useCallback(async () => {
    const ok = await resetWorkspace().catch(() => false);
    setConfig(story ? structuredClone(story.defaultConfig) : null);
    setResetSignal((n) => n + 1);
    setResetMsg(ok ? "Reset: your workspace's audit trail and recorded gaps are cleared, the config is back to default and the diagram is back in place." : "Reset failed on the server; the view was reset.");
  }, [story]);

  const onKeyTab = (e, i) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const banner = story && mode ? story.banner[mode] : BANNER_UNKNOWN;
  const ready = story && mode && config;
  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header>
        <p className="banner" role="status" data-state={mode === "live" || mode === "real" ? "live" : "mock"} data-testid="banner">{banner}</p>
        <div className="head">
          <div>
            <h1 className="head__title">Coding Agents LAB</h1>
            {!presenter && story && <p className="head__intro">{story.intro}</p>}
          </div>
          <div className="head__tools">
            <TopMenu
              mode={{ value: mode === "real" || mode === "live" ? "real" : "mock", onChange: switchSource, realAvailable, realHint: realWhy }}
              vertical={{ value: vertical, onChange: setVertical, options: story ? story.verticals : ["finance"] }}
              theme={{ value: theme, onChange: pickTheme }}
              fontSize={{ value: fontStep, onChange: setFontStep }}
              present={{ active: presenter, onToggle: () => setPresenter((v) => !v) }}
              talkTrack={{ active: tab === "talk", onToggle: () => select("talk") }}
              help={{ href: "https://github.com/curtismu7/coding-agents-LAB#readme" }}
              onReset={reset}
            >
              <ShelfLink />
            </TopMenu>
            <span className="chip" data-testid="mode">Mode: {mode || "..."}{mode === "real" ? " (live AI Guard)" : mode === "live" ? " (local engine, loopback)" : mode === "mock" ? " (tables)" : ""}</span>
          </div>
        </div>
      </header>
      <main>
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        <div role="tablist" aria-label="Lab sections" className="tabs" ref={tabsRef}>
          {TABS.map((t, i) => (
            <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              onClick={() => select(t.id)} onKeyDown={(e) => onKeyTab(e, i)}>{t.label}</button>
          ))}
        </div>
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {error ? <p className="app-error" role="alert">Could not load the lab ({error}). Is the server running?</p> : !ready ? <p className="muted">Loading...</p> : (
            <>
              {presenter && tab !== "talk" && (
                <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
                  {story.talkTrack.filter((t) => (PRESENTER_TALK[tab] || []).includes(t.id)).map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
                </aside>
              )}
              {tab === "agents" && <AgentsTab story={story} />}
              {tab === "evaluate" && <EvaluateTab key={vertical} story={story} mode={mode} config={config} resetSignal={resetSignal} />}
              {tab === "gateway" && <GatewayTab key={vertical} story={story} mode={mode} config={config} setConfig={setConfig} resetSignal={resetSignal} />}
              {tab === "config" && <ConfigTab story={story} config={config} setConfig={setConfig} resetSignal={resetSignal} />}
              {tab === "diagram" && <DiagramTab vertical={vertical} resetSignal={resetSignal} />}
              {tab === "talk" && <TalkTrack talk={story.talkTrack} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "A simulation of how coding agents (Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot and Antigravity) run a local security hook, and what a gateway behind the hook can decide. The agents, the device identity and the actions stay simulated, and no agent configuration is written anywhere.",
      "Live mode (owner-run, still local) runs a real hook script as a child process exactly as an agent would: the agent's JSON on stdin, the allow, deny or ask on stdout. It POSTs the event over loopback only. Live never leaves loopback and never touches a tenant."
    ]
  },
  {
    heading: "Measured vs simulated vs UNVERIFIED",
    body: [
      "MEASURED: the hook shapes were read in each vendor's own documentation at build time (2026-10-31) and tagged documented; the lab also emulates a fake Cursor client locally, which is tagged measured.",
      "SIMULATED: the six agents' behaviour, the gateway's detection rules (known gaps are listed in the README — shell quoting tricks, paraphrases and middle-of-field secrets are not seen), and every decision in Mock mode.",
      "UNVERIFIED: every product claim is a Ping release claim, UNVERIFIED on our tenant (release 2026-11-02). The banner on every tab says so."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Tabs: Agents, Evaluate, Gateway down, Config, Diagram, Talk track.",
      "Agents: pick one of the six agents, then one kind of action; you see the managed configuration it reads, the request it writes to the hook, and the hook's native answer. Evaluate: pick an Agent and one of the Action buttons, then Run through the hook; you see the gateway's evaluation and the same answer drawn as the agent's own permission dialog. Gateway down: toggle Gateway: reachable / Gateway: unreachable and FailClosed true (refuse) / false (keep working), then Run the action.",
      "Config: edit the CodingAgent config (Enabled, FailClosed, Agents, Gateways) and Apply JSON; the generated managed-configuration text is display-and-download only. Diagram: ReactFlow with Simulate, Pause/Resume, Next and Reset positions and walkthrough."
    ]
  },
  {
    heading: "Mode honesty",
    body: "The header badge shows the mode: Mock (tables), Live (local engine, loopback) or Real (live AI Guard, owner-only). Until the server answers, the banner honestly says 'SIMULATED, MOCK, LIVE or REAL mode'. Switching to Real needs the AI Gateway settings; if they are missing the button is disabled with the server's reason, and a refused switch stays in the old mode and says why."
  },
  {
    heading: "Masking, and what to type",
    body: "Anything you type is masked on the way out — a heuristic, not a guarantee. Do not type a real credential into a lab: some shapes (short tokens, bare words) are not masked."
  }
];

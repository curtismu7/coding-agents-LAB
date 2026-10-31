# Coding Agents LAB

A simulation of "Coding Agents": inspection inside Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot and Antigravity, at the agent itself, through each agent's own hook interface.

Tier: Demo
Repo: https://github.com/ping-sandbox/coding-agents-LAB
Catalog: D102

**Tier: Demo.** Source: the Ping ID4AI Workforce H2 2026 deck, slide 49 (release 2026-11-02). **Every product claim is a Ping release claim, UNVERIFIED on our tenant.** Nothing here calls a real gateway, identity provider or tenant, nothing leaves your machine, and the lab never writes any agent configuration anywhere.

## What is simulated

**Mock mode (default).** Everything runs offline in one process. The decision and the agent-native answer for each scripted action come from a table generated from the lab's own engine (`server/src/mockTable.json`; a doctor check and a test fail if it drifts). The "gateway", the policies and the detection are the lab's deterministic rules, which are lab-invented. The developer's identity and device come from a MOCK certificate subject.

**Live mode (owner-run, still local).** A real hook script, `hooks/lab-hook.mjs`, runs as a child process exactly as an agent would run it: the agent's JSON on stdin, the agent's native allow, deny or ask on stdout. In between it POSTs the event over loopback to this server, which is the "gateway". You can type your own prompt, command, path, MCP call or tool result and watch the whole chain. Live never leaves loopback and never touches a tenant. The banner says which mode you are in.

What it shows:

1. **Agents.** The six agents: the machine-level managed configuration path each reads, the hook event for each kind of action, the request JSON the agent writes to the hook, and the native allow, deny or ask the hook prints. Every shape is tagged **documented** (read in the vendor's own documentation at build time, 2026-10-31) or **illustrative, UNVERIFIED** (the lab's own example). A matrix shows where an agent's hook cannot refuse (GitHub Copilot's prompt hook) or has no event at all (Antigravity has no prompt hook), and where there is no working ask (Codex, Gemini CLI).
2. **Evaluate.** Pick an agent and one of seven actions (a prompt carrying a credential, a destructive shell command, a chained command that sends data out, a read of a sensitive path, an MCP call to an unapproved server, a tool result carrying hidden instructions, an ordinary command) across three vertical packs. You see the request the hook gets, the evaluation (deny, ask or alert, with the rule and the reason), the native response and the same answer drawn as that agent's permission dialog, then the audit trail: who ran what on which laptop.
3. **Gateway down.** A toggle for the gateway being unreachable. With FailClosed false the action proceeds and a gap is recorded; with FailClosed true it is refused in the agent's own shape. The gap list is shown.
4. **Config.** An editable CodingAgent config (Enabled, FailClosed, Agents, Gateways) with validation, and the generated managed-configuration text for each covered agent. The text is displayed and downloadable only.
5. **Diagram.** ReactFlow, drawn from diagram-studio/1 data loaded by name: movable boxes, Simulate, speed, Reset (restores box positions). Two diagrams: hook, gateway and native answer; and why a hook and where it stops.
6. **Talk track,** with a "Why it matters" entry. Also in `docs/talk-track.md`.

### Known limits of the detection rules

The rules are the lab's own deterministic stand-ins, not Ping's detection. They are deliberately simple, and these are known gaps rather than surprises:

- For any one field the gateway scans the first 4000 and the last 4000 characters; the hook trims a longer field to those two ends before posting. Something only in the middle of a very long field is not seen. (Nothing above 8000 characters in one field is ever read in full.)
- Shell rules read a small tokenizer, not a shell: variables, aliases, base64, `eval` of a built string, scripts that delete things, heredocs and quoting tricks defeat them. They do see through `sudo`/`env`/`nohup` wrappers, absolute command paths, long flags, `$HOME`, `curl | sudo bash`, `bash <(curl ...)` and `sh -c "$(curl ...)"`.
- Secrets are recognised by shape (AWS-style access key ids, GitHub and Slack tokens, `sk-` keys, private key blocks, bearer tokens, JWTs, and `password`/`secret`/`api_key`/`access_token` assignments of 8 or more characters). An unlabelled password in prose, a short password, or a split-up key is not found; a key split by zero-width characters is.
- Hidden instructions are a fixed English phrase list (whitespace and case normalised), invisible or direction-changing characters (zero-width, bidi, tag; a byte-order mark only when not first), and an HTML comment addressed to the model. Other languages and paraphrases are not seen.
- Sensitive paths are a fixed list of names, directories and extensions (`.env` and `.env.*` except templates, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `*.pem`, `*.key`, and a few more). A path reached through a symlink or a renamed copy is not.
- A credential in a tool argument or result is an alert, never a refusal; a credential in a prompt blocks. That split is lab-invented.
- The approved MCP server list and which agents are "found on the device" are lab policy, not a product fact.

Field names: `CodingAgent` has `Enabled`, `FailClosed`, `Agents`, `Gateways` (and carries `AIGuard`, `AIIntent`, `Behaviour`, which the lab does not interpret). They come from the Privilege console swagger of 2026-10-31, definition `modelCodingAgentConfig`: schema only, which proves the names exist, not how the product behaves. Everything else (the rules, reason codes, which agents count as found on the device, the mock certificate format, the validation limits, the fallbacks) is lab-invented and tagged so.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form. Mock mode works with no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/ping-sandbox/coding-agents-LAB.git
cd coding-agents-LAB
npm ci
npm run build
npm start
```

Open http://localhost:7150/. Or in one step: `./scripts/run.sh` (installs and builds if needed, runs the doctor, starts).

## Settings file

All standalone apps read one settings file, `~/Development/.env`, which must be mode 600. `STANDALONE_ENV` overrides its path. This lab needs none of it. It parses the file (`util.parseEnv`) and takes exactly one optional key; no other key from the file ever enters the server's environment:

- `CODING_AGENTS_LAB_MODE` (optional): `mock` (default) or `live`, the mode the page opens in. The header toggle switches per visit. A bare `MODE` in the shared file is ignored, because it may belong to another app.

The shared file holds no `PORT`: the lab keeps its port default in code. Admin or worker credentials never belong in that file (they live in `~/.config/demo-kit/provisioning.json`), and this lab uses none. The doctor reports whether the file exists and its mode, and never prints a value.

## Ports, and what to do if the port is taken

```
Ports: coding-agents-LAB listens on 7150 (set with PORT, default 7150).
Port range for this app: 7150-7199.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:7150 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
```

Other variables: `VITE_PORT` (Vite dev server, default 7151, `npm run dev -w web`), `HOST_PORT` (Docker host port, default 7150). Keep all of them inside 7150-7199.

## Mock and live modes

The header has a **Mock / Live** toggle on every page, and the banner and the mode chip show the same mode. Mock reads the table. Live spawns the real hook script for every evaluation and lets you type your own action. The Gateway down tab uses a real unreachable loopback port in Live and the same failure policy from the table in Mock.

## Health, doctor and reset

```
npm run doctor   # 17 checks; PORT=7159 npm run doctor to use a spare port
npm run reset    # clears the default workspace's audit trail and recorded gaps (the UI Reset also restores the config and the diagram)
```

`GET /api/health` returns `demo-health/1`. The workspace id comes in `X-Workspace`; every hop carries a W3C `traceparent`. Presenter mode: press `P` (Esc leaves); the simulation banner stays. `npm run mock-table`, `npm run talk-track` and `npm run content-pack` regenerate the generated files. See `docs/safety.md`.

## Docker (optional)

```
HOST_PORT=7150 docker compose up --build -d
```

The container publishes to 127.0.0.1 only (a test pins it). Use OrbStack, not Docker Desktop. `CODING_AGENTS_LAB_MODE=live` opens the page in Live mode.

## Tests

```
npm test    # server (node --test), web (vitest, drives the UI against the real server), scripts
```

The shared checks are run by hand, because the scripts are not shipped into this repo's CI: `bash <AI-DEMO-Standalone>/scripts/check-drift.sh .`, `bash <AI-DEMO-Standalone>/scripts/check-css.sh .` and `node <demo-kit-base>/scripts/conformance.mjs . --new`. Conformance reports two rule-18 FAILs on purpose: the deferred SE k8s manifests, and a heuristic that greps for `process.env.MODE` (this lab reads `CODING_AGENTS_LAB_MODE` instead, because the shared settings file is read by every app).

On Node 26: 165 tests pass (122 server, 22 web, 21 scripts).

## Troubleshooting

- **The page says "Could not load the lab".** The server is not running, or it is on another port. Start it (`npm start`) and check `PORT`.
- **Port is taken.** See "Ports, and what to do if the port is taken" above.
- **`npm start` refuses to start.** Run `npm run doctor`; the first failing line says why (Node older than 26, a port outside 7150-7199, a missing hook script).
- **Live mode says the hook script failed.** The script needs `node` on the machine that runs the server; run `node hooks/lab-hook.mjs --agent claude-code < /dev/null` to see its message.
- **The mock table is out of date after an engine change.** Run `npm run mock-table`; the doctor and a test tell you when it drifts.

## Sources

The shapes tagged "documented" were read at build time (2026-10-31) in the vendors' own documentation. The app names none of these URLs; it refers to them by id.

- claude-code-hooks: https://code.claude.com/docs/en/hooks
- claude-code-managed-settings: https://code.claude.com/docs/en/managed-settings
- cursor-hooks: https://cursor.com/docs/agent/hooks
- codex-hooks: https://learn.chatgpt.com/docs/hooks
- gemini-cli-hooks: https://geminicli.com/docs/hooks/
- gemini-cli-hooks-reference: https://geminicli.com/docs/hooks/reference/
- copilot-hooks-config: https://docs.github.com/en/copilot/reference/hooks-configuration
- antigravity-hooks: https://antigravity.google/docs/hooks

Things the documentation said that the lab keeps visible rather than hiding: Codex parses an "ask" for PreToolUse but does not support it yet (the lab degrades an ask to a refusal and says so). Gemini CLI documents no "ask" (same fallback), and its pages say it was replaced by Antigravity CLI on 2026-06-18. GitHub Copilot's prompt hook cannot allow or deny (the lab records an alert and says it cannot enforce). Antigravity documents no user-prompt hook and **no machine-level managed path** (only a workspace `.agents/hooks.json` and a per-user `~/.gemini/config/hooks.json`), which does not match the deck's claim of machine-level managed configuration: confirm with Ping before presenting it. Not re-read at build time, and therefore tagged illustrative: the body of each generated managed-configuration file, and the tool-name strings (`Bash`, `Read`, `run_shell_command`, `run_command`, and so on).

## Ownership

- Owner: the Ping demo family owner (Demo tier).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.

## Not done

No SE k8s build (deferred by the owner, 2026-10-31). No catalog id yet. Every product claim stays UNVERIFIED until it is measured on a tenant that has the release.

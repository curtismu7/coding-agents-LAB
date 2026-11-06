# Coding Agents LAB

A simulation of "Coding Agents": inspection inside Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot and Antigravity, at the agent itself, through each agent's own hook interface.

Tier: Demo
Repo: https://github.com/curtismu7/coding-agents-LAB
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
- Secrets are found by the shared masker (shared-masker 1.4.0, see below), so what counts as a credential is what gets masked: key and token shapes (AWS-style key ids, GitHub and Slack tokens, `sk-` keys, JWTs, bearer values, private key blocks, long opaque runs with a digit), `password=x` style assignments, and plain language such as `my password is x`, `password hunter2xyz` and `password - hunter2xyz`. A finding names the masker's rule (`assignment`, `phrase`, `prefix-token`, `pem`, `bearer`, `jwt`, `header` ...), not a lab-invented id. A bare word with no keyword and no shape, a short password, or a plain-language password without a digit is not found. Ordinary sentences are not findings: a test runs all 1926 ordinary strings of the shared corpus through the rules and none is flagged.
- Hidden instructions are a fixed English phrase list (whitespace and case normalised), invisible or direction-changing characters (zero-width, bidi, tag; a byte-order mark only when not first), and an HTML comment addressed to the model. Other languages and paraphrases are not seen.
- Sensitive paths are a fixed list of names, directories and extensions (`.env` and `.env.*` except templates, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `*.pem`, `*.key`, and a few more). A path reached through a symlink or a renamed copy is not.
- A credential in a tool argument or result is an alert, never a refusal; a credential in a prompt blocks. That split is lab-invented.
- The approved MCP server list and which agents are "found on the device" are lab policy, not a product fact.

Field names: `CodingAgent` has `Enabled`, `FailClosed`, `Agents`, `Gateways` (and carries `AIGuard`, `AIIntent`, `Behaviour`, which the lab does not interpret). They come from the Privilege console swagger of 2026-10-31, definition `modelCodingAgentConfig`: schema only, which proves the names exist, not how the product behaves. Everything else (the rules, reason codes, which agents count as found on the device, the mock certificate format, the validation limits, the fallbacks) is lab-invented and tagged so.

### Masking of typed text (a heuristic)

Anything you type that the lab shows back is masked on the way out: the call, its one-line summary, the hook request, the dialog, every hop pane, the reasons, the audit trail, the gap records, the echoed config, the generated configuration text and the identity read from a certificate subject. Every answer goes through one response mask (`maskDeep`: values and object keys) and the audit and gap stores are masked when they are written. Text is masked before it is cut to length (a secret after thousands of filler characters, or one that straddles a cut, cannot survive). The server never prints typed text. **This is a heuristic. Do not type a real credential into a lab.**

The masker is the family's shared one: `server/src/shared/mask.js` and `hygiene.js` are copied unchanged from shared-masker 1.4.0 (commit 9bc664a); `server/src/mask.js` is a thin adapter that keeps the old names (`maskText`, `maskDeep`, `redact`, `cut`) and says what the lab writes itself that merely looks like a secret (a W3C `traceparent`, a `traceId`, a reason code such as `DENY-SECRET-IN-PROMPT` and the fixed mock session id are left alone, but only when the VALUE has the exact shape the lab generates, so a typed value under the same name is masked as usual). Scripted scenarios and the lab-data endpoints (story, diagram, sources, info) are not masked because they are lab data and show the labelled mock credential `sk-MOCK-...` on purpose (rule 4); their only typed field, the workspace id, is.

What it catches: keywords with a value after `=`, `:`, `=>`, a dash or a space (`password=x`, `password: x`, `password - x`, `password hunter2xyz`, `login: bob / x`), plain language (`my password is x`), JSON and YAML as text, `Authorization:` and `Cookie:` lines, `Bearer x`, URL userinfo, JWTs, `sk-`, `ghp_`, `xox*`, `AKIA`/`ASIA` ids, private key blocks and long opaque runs with a digit. A keyword cannot be hidden by controls or invisible characters, by any Unicode space (including U+1680) or up to three separators inside it (`pass word=x`), by look-alike letters from other alphabets, or by percent-encoding, HTML entities and escapes (decoded repeatedly, not only three rounds). The shared corpus is run through the adapter: 3754 leak probes (the secret must not survive, the answer must be stable) and 1926 ordinary strings (must come out unchanged). A sweep then types the same corpus into every free-text field, key, path segment, query, header and error-path input of every endpoint of a real server process (15124 requests) and asserts the secret is absent from every answer, from the audit and gaps read back, and from stdout and stderr.

The false-positive trade-off, and what changed from the lab's earlier masker: the shared masker asks for more evidence before it masks a value. `the password is required`, `password reset`, `token bucket`, `secret santa` and `Look at the key: value pairs` stay readable (the earlier masker masked the first and the last). After a plain space a keyword takes a value only when it is at least 6 characters and has a digit, so `password abc12` and `password correcthorse` are NOT masked. What the shared masker still over-masks: the keyword goes with its value (`my password is x` becomes `my [masked]`), `login bob:x@host:8080/p` loses everything after the keyword, and a credential-named object KEY forces everything under it (a key called `secret-prompt` masks its whole subtree, which is why the mock table, keyed by scenario id, is checked row by row).

What it **still misses** (measured, not guessed): a bare word or number with no keyword and no recognisable shape; a value that contains a typed space, tab or line break is masked only up to that character (`password=hunt er2xyz` leaves `er2xyz`; the earlier masker took the whole line); `api+key+x` (a URL-encoded space) is not masked although `password+is+x` is; a second keyword inside the value of the first (`password hunter2xyz,password hunter3xyz` leaves the second value, and `password hunter2xyz/password hunter3xyz` is not masked at all: shared-masker 1.4.0 gaps, named in the adoption report; the lab parses a certificate subject into its pieces and masks each value on its own because of the first); keys and tokens shorter than the shapes ask for (`sk-abc123`, `ghp_abcdef12`); a name typed as an MCP argument NAME (the summary and the audit show argument names, masked by shape, and types such as `text(10)`, but never a value); a secret in a language or format the patterns do not know. Input over one million characters is refused whole, not scanned. Detection and masking are the same rules now, so what is masked in an answer is also what the gateway reports as a credential.

### Status codes and paths

The edge follows the shared Express recipe, in this order: Host check, same-origin writes, response mask, charset gate, 405 table, body parser, workspace rule, routes, static files, page shell, final 404, error handler. A `Content-Type` charset other than utf-8 is `415 {"error":"unsupported_charset"}` on every route, with the typed value neither answered nor logged. A wrong method on a known route is `405 {"error":"method_not_allowed"}` with `Allow`, from ONE route table (case and one trailing slash are normalised; HEAD follows GET; a write to `/` is a 405 with `Allow: GET, HEAD`). The page shell is served only for page addresses: a GET or HEAD of an extension-less, non-dotfile path outside `/api`, `/assets` and `/static`, from a client that does not rule HTML out; `/assets`, `/assets/`, `/assets/missing.js`, `/favicon.ico`, `/robots.txt`, `/foo.map` and every dotfile are `{"error":"not_found"}` (Express's own HTML page, which echoes the path, never appears). A body that is not JSON is `400 bad_request`, one over the limit `413 too_large`, an unsupported encoding `415`, and anything unexpected `500 internal`: fixed codes, never the message of the error. A workspace id (`X-Workspace`) is `default` or `w-` and a lab name; the shared `isCredentialId` and `safeWorkspaceId` refuse one that looks like a credential (`sk-...`, 24 or more hex characters in a row, `w-passwordhunter2xyz`) with `400 {"error":"bad_workspace"}` before any state exists for it, and it is never echoed; the page then makes a new id and asks once more, so a stored refused id cannot brick a tab. A lab name that merely contains a credential word (`w-password-reset`) is fine; `w-secret-handling-4` is refused because the masker flags it; `w-my-key-is-hunter2xyz` is NOT recognised (a hyphenated phrase is not a pattern the masker knows; the page only ever sends the `w-` and 16 hex characters it generated). Config validation errors use fixed text and never quote a key or value you sent (`(unknown field)` stands for an unknown key); a Gateways endpoint with a query string, a fragment or credentials is refused. A `certSubject` over 300 characters on `/api/hook` is refused with 400 (`bad_cert_subject`), never cut; one that is not a one-line `CN=`, `OU=`, `O=` ... list is read as `unknown`. The browser console logs the deliberate 4xx answers (a refused id, an invalid config) as network errors; they are expected.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form. Mock mode works with no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/curtismu7/coding-agents-LAB.git
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

The header has a **Mock / Live / Real** toggle on every page, and the banner and the mode chip show the same mode. Mock reads the table. Live spawns the real hook script for every evaluation and lets you type your own action. Real sends the hook event to the tenant's live AI Gateway (Privilege AI Guard in the decision path; see the Settings file section). The Gateway down tab uses a real unreachable loopback port in Live and the same failure policy from the table in Mock.

## The intent encoder (Triton) beside the lab

The Privilege console's Coding Agents page carries an AIIntent signal: it sends the action's text to an **encoder endpoint** and reads back a vector. We measured the console probing the NVIDIA Triton inference-server wire (KServe v2: `/v2`, `/model_info`, `/get_worker_address`) against whatever endpoint is configured, so the lab ships a matching server. Run it from anywhere with Docker (OrbStack):

```bash
# triton-repo/ ships with this repo (the model repo: config.pbtxt + model.py)
docker run -d --name triton-encoder -p 127.0.0.1:8597:8000 -p 127.0.0.1:8598:8001 \
  -v <this-repo>/triton-repo:/models nvcr.io/nvidia/tritonserver:24.10-py3 \
  tritonserver --model-repository=/models --strict-model-config=false
# then, in the console's encoder field, enter the lab's own demo domain (the one the
# shelf hands out - this README names no lab host by convention) with this port:
#   <the lab domain>:8597
```

The model, `intent-encoder`, answers `POST /v2/models/intent-encoder/infer` with TEXT in and a 384-dim FP32 EMBEDDING out. **The model is a lab stand-in**: a deterministic hashed character-trigram vector, not a trained intent encoder — it proves the wire shape (KServe v2) without a GPU or a model download. What Privilege does with the vector is UNVERIFIED. The server publishes on loopback only; the lab's domain (the one the shelf hands out) resolves to 127.0.0.1 on this Mac. The lab itself never calls Triton, and no page text names the host (the safety rule reserves hosts in shipped text).

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

On Node 26: 237 tests pass (190 server, 26 web, 21 scripts). The server count includes the shared corpus tests (6 tests over 3754 leak probes and 1926 ordinary strings, run in `corpus.test.js`) and the corpus sweep (`corpus-sweep.test.js`, about two minutes: 15124 requests to a real server process).

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

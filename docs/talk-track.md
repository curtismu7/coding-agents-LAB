# Talk track

<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->

> Ping release claim, UNVERIFIED on our tenant: every product claim here comes from the Ping ID4AI Workforce H2 2026 deck, slide 49 (release 2026-11-02).

## Say this first

Everything on this page is simulated, and every product claim is a Ping release claim, unverified on our tenant: the 2026-11-02 release is not there yet. The idea is the shape of the control: inspect a coding agent at the agent, with the agent's own hook, and answer in the agent's own language.

## Why a hook

A coding agent reads the repository, follows instructions in files, calls internal tools and holds the developer's credentials, yet its traffic bypasses the gateway. The usual fix is to terminate TLS: a certificate on every developer machine and a decryption policy. A hook avoids all of it. The cost is coverage: a hook only protects agents it is installed into, which is why the endpoint sensor still looks for the ones that are not on the list.

## Nothing for a developer to install

Each agent reads a machine-level managed configuration, so the control travels with the laptop and stays in force however the developer opens their editor. The Config tab generates that text for each agent and only shows it. The lab never writes a configuration file anywhere. One honest catch: the Agents tab says which paths and shapes are in the vendor's documentation and which are illustrative.

## Answers in the agent's own language

The decision comes back as that agent's native allow, deny or ask, so a refusal lands in the developer's normal permission dialog with the reason. Not an error. Run the same action against each of the six agents on the Evaluate tab and watch the shape change. Where an agent has no ask, or its hook cannot refuse a prompt, the lab says so rather than hiding it.

## Secrets stop before they leave

A prompt carrying a credential is stopped outright, so it never reaches the model provider. Risky tool arguments are different: they raise an alert and stay in the audit trail without interrupting local work. Block where it is clearly wrong, alert where interrupting would cost more than it saves.

## Who ran what, on which laptop

Every evaluation carries the developer and the device, taken from the machine's certificate. In the lab the certificate subject is a mock string; the audit list on the Evaluate tab shows the person and the device for each action. Prompts are kept redacted.

## Never in the way of a working developer

If the gateway is briefly unreachable the developer keeps working and the gap is recorded for review. That is the default: a hook fires on every tool call, so failing closed stops all work on a laptop that loses its tunnel. A regulated tenant can set FailClosed and get a refusal instead. Flip the switch on the Gateway down tab and run an action both ways.

## Why it matters

The challenge: a coding agent reads the repository, takes instructions from files in it, calls internal tools and holds the developer's credentials, yet bypasses every gateway control, so prompts and source leave uninspected. Technically: prompts, shell commands, file reads, MCP calls and tool results are evaluated at the agent, through its own hook interface. For the business: source code and credentials stop leaving through coding agents without a TLS-decryption project, with one policy and one audit trail.

## Mock and Live

Mock is a table. Live is real: a hook script reads the agent's JSON on stdin, posts it over loopback to this server and prints the agent's native answer, so you can type your own action and watch the whole chain. Still nothing leaves the machine.

## Real enforcement

Real mode sends the hook event out of this machine to the tenant's live AI Gateway, where Privilege's AI Guard is in the decision path. A credential in the prompt comes back redacted by the gateway's data-loss policy and the lab maps that to a deny; an outright policy block maps to a deny too; a clean answer allows. The mapping is lab-invented; the deny itself is the gateway's own. Expect roughly twenty seconds per call: the live gateway is slow.

## The intent encoder (Triton) and how Privilege uses it

The console's Coding Agents page also carries an AIIntent signal: Privilege resolves an intent for the action by sending its text to an encoder endpoint and reading back a vector. That endpoint speaks the NVIDIA Triton inference-server wire (KServe v2) - we measured the console probing /v2, /model_info and /get_worker_address against whatever endpoint is set. This lab ships one: a Triton server (nvcr.io/nvidia/tritonserver, CPU) beside the lab, with a model named intent-encoder whose POST /v2/models/intent-encoder/infer takes a TEXT input and returns a 384-dim EMBEDDING (the exact address is in the README - this page names no real host). The model itself is a lab stand-in - a deterministic hashed character-trigram vector, not a trained intent encoder - so the wire shape can be exercised without a GPU or a model download. What Privilege does with the vector (thresholds, which intents it distinguishes) is product behaviour we have not tested: UNVERIFIED.

## Emulating the agents (no client install needed)

None of this needs the real editor. Each agent is a small JSON protocol: the editor writes one event object on the hook's stdin and reads one native answer from stdout, so a fake client is one script away. We measured that the gateway does not verify which client is calling - enforcement is on the content - so emulating any agent is a wire exercise, not a security exercise, and we say so rather than pretend otherwise. Pick an agent on the Evaluate tab and the lab speaks its exact dialect: Claude Code's UserPromptSubmit/PreToolUse with permissionDecision, Cursor's beforeShellExecution/beforeSubmitPrompt with permission + user_message, Codex, Gemini CLI, Copilot and Antigravity likewise, each with the shape its vendor documents (the Agents tab says which parts are documented and which are illustrative). To try one by hand: echo the JSON you see in the hook request pane into the lab's hook script with --agent <id>, and the native answer prints on stdout. Real editors do the same thing; they just write those bytes themselves. The agent's claimed identity (developer, device) rides with the event to the gateway either way.

## What is not proven

None of the product behaviour here has been run on our tenant. The field names Enabled, FailClosed, Agents and Gateways come from the console schema of 2026-10-31, schema only. The detection rules, reason codes, the device certificate format and the per-agent shapes marked illustrative are the lab's own. Antigravity's documentation lists no machine-level managed path, which does not match the deck: confirm with Ping before presenting it.

## The seven actions on the Evaluate tab

1. **A prompt that carries a credential** (deny by the rules). The developer pasted a credential into the prompt. The hook stops the prompt before it is sent, so the credential never reaches the model provider. The audit keeps a redacted copy.
2. **A destructive shell command** (deny by the rules). An agent "cleaning up a cache" is about to delete the home directory. The decision returns in the agent's own deny shape, so the refusal shows in the permission dialog with the reason.
3. **A chained command that sends data out** (alert by the rules). Shell metacharacters chain a data source into an upload tool. This is a risky tool argument: it raises an alert and stays in the audit trail, and the developer is not interrupted.
4. **A file read of a sensitive path** (ask by the rules). The agent wants to read the developer's cloud credentials. The policy asks: the developer sees the question in the agent's own permission dialog, with the reason.
5. **An MCP call to a server the tenant has not approved** (ask by the rules). The agent calls an MCP server that is not on the approved list. The same gateway that governs MCP traffic elsewhere asks before the call goes out.
6. **A tool result carrying hidden instructions** (deny by the rules). A tool result contains text addressed to the model, hidden in a comment. Evaluated on the way back in, it is withheld. This is prompt injection through a file or an issue, the agent-side case a network gateway never sees.
7. **An ordinary command** (allow by the rules). Nothing risky. The hook says nothing, the agent carries on, and the evaluation is still in the audit trail with the developer and the device.

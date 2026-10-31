// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
// Documentation URLs are NOT in the pack: they are listed in README.md (Sources). The pack uses .invalid placeholders.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const UNV = 'Ping release claim, UNVERIFIED on our tenant.';

export function buildPack() {
  const story = buildStory(DEFAULT_CAST, 'finance');
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = {
    'secret-prompt': ['hook', 'native-response', 'secret-stop'], 'destructive-shell': ['hook', 'native-response', 'deterministic-rules'], 'shell-chain': ['alert-vs-block', 'audit-trail'],
    'sensitive-read': ['native-response', 'ask'], 'mcp-unlisted': ['same-policy', 'ask'], 'hidden-instructions': ['hidden-instructions', 'deterministic-rules'], benign: ['audit-trail', 'device-identity'],
  };
  const why = story.talkTrack.find((t) => t.id === 'why-it-matters').say;
  return {
    schema: 'demo-content-pack/1',
    id: 'coding-agents-lab',
    title: 'Coding Agents LAB',
    version,
    demo: { id: 'coding-agents-lab', name: 'Coding Agents LAB', catalog: 'D0', baseUrl: 'http://localhost:7150', doctor: '/api/health', tags: ['coding-agents', 'hooks', 'claude-code', 'cursor', 'codex', 'gemini-cli', 'copilot', 'antigravity', 'simulated'] },
    glossary: [
      { id: 'hook', term: 'Agent hook', definition: `A command the coding agent runs before or after an action, with the event as JSON on stdin and the answer as JSON on stdout. Each agent has its own hook interface. ${UNV}`, aliases: ['hook interface', 'command hook'] },
      { id: 'managed-configuration', term: 'Machine-level managed configuration', definition: `The file an agent reads for policy set by an administrator rather than by the developer, so the control travels with the laptop and stays in force however the editor is opened. Nothing for a developer to install. In this lab the generated text is displayed and downloadable only. ${UNV}`, aliases: ['managed settings'] },
      { id: 'native-response', term: 'Native allow, deny or ask', definition: `The decision returned in the shape that agent understands, so a refusal appears in the developer's normal permission dialog with the reason, not as an error. ${UNV}`, aliases: ['permission dialog'] },
      { id: 'same-policy', term: 'The same policy, not a second product', definition: `Prompts, shell commands, file reads, MCP calls and tool results are evaluated by the same gateway, policies and detection as LLM and MCP traffic: one place to author, one audit trail. ${UNV}`, aliases: [] },
      { id: 'secret-stop', term: 'Secrets stopped before they leave', definition: `A prompt carrying a credential is stopped outright so it never reaches the model provider. Risky tool arguments raise an alert and stay in the audit trail without interrupting local work. ${UNV}`, aliases: [] },
      { id: 'alert-vs-block', term: 'Alert versus block', definition: 'A block refuses; an alert lets the action proceed and keeps it in the audit trail. In this lab a credential in a prompt blocks, a credential in a tool argument alerts (lab-invented rule split).', aliases: [] },
      { id: 'ask', term: 'Ask', definition: 'The developer is asked in the agent\'s own permission dialog. Some agents have no working ask for a hook (Codex, documented) or none documented (Gemini CLI); the lab degrades the ask to a refusal and says so.', aliases: [] },
      { id: 'deterministic-rules', term: 'Deterministic rules', definition: 'The lab\'s detection: patterns and a small tokenizer for secrets, shell metacharacters, destructive commands, sensitive paths, unapproved MCP servers and hidden instructions. No model, no score. The rule set is lab-invented.', aliases: [] },
      { id: 'hidden-instructions', term: 'Hidden instructions', definition: 'Text in a tool result, file or issue addressed to the model, for example in a comment or in invisible characters. Evaluated as the result comes back in.', aliases: ['prompt injection'] },
      { id: 'device-identity', term: 'Identity and device from the certificate', definition: `Every evaluation carries the developer's identity and device, taken from the machine's certificate, so the audit says who ran what on which laptop. The lab uses a MOCK certificate subject. ${UNV}`, aliases: ['named identity'] },
      { id: 'audit-trail', term: 'Audit trail', definition: 'One record per evaluation: developer, device, agent, kind of action, decision and a redacted copy of the text.', aliases: [] },
      { id: 'fail-open-closed', term: 'Fail open and FailClosed', definition: `If the gateway is briefly unreachable the developer keeps working and the gap is recorded for review (the default). A regulated tenant can set FailClosed to get a refusal instead. FailClosed, Enabled, Agents and Gateways are console swagger names, 2026-10-31, schema only. ${UNV}`, aliases: ['FailClosed', 'gap'] },
      { id: 'tls-termination', term: 'TLS termination (the alternative)', definition: `Inspecting a coding agent otherwise means a certificate on every developer machine and a decryption policy. A hook avoids both, but only covers agents it is installed into, which is why the endpoint sensor still finds the ones that are not on the list. ${UNV}`, aliases: ['decryption'] },
    ],
    sources: [
      { id: 'deck-slide-49', title: 'Ping ID4AI Workforce H2 2026 deck, slide 49: Coding Agents', url: 'https://example.invalid/ping-id4ai-workforce-h2-2026-deck', kind: 'deck', use: 'The coding-agents release claims.', status: 'read', checked: '2026-10-31' },
      { id: 'console-swagger', title: 'Privilege console swagger, 2026-10-31 (schema only)', url: 'https://example.invalid/privilege-console-swagger', kind: 'schema', use: 'Field names for the CodingAgent config. It proves names exist, not behaviour.', status: 'read', checked: '2026-10-31' },
      { id: 'agent-hook-docs', title: 'The six agents\' own hook documentation (listed in README.md, Sources)', url: 'https://example.invalid/agent-hook-docs', kind: 'vendor-docs', use: 'Which shapes are documented; the rest are marked illustrative.', status: 'read', checked: '2026-10-31' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Action ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: '/#evaluate' }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'try-agents', label: 'Agents: paths, events and native shapes', description: 'Six agents, which shapes are documented and which are illustrative.', group: 'try-it', action: { type: 'route', href: '/#agents' }, terms: ['hook', 'managed-configuration'] },
      { id: 'try-gateway', label: 'Gateway down: fail open or FailClosed', description: 'Flip the switch and run an action both ways; the gap list records it.', group: 'try-it', action: { type: 'route', href: '/#gateway' }, terms: ['fail-open-closed'] },
      { id: 'try-config', label: 'Config: the generated managed configuration', description: 'Editable CodingAgent config and the text for each agent. Text only.', group: 'try-it', action: { type: 'route', href: '/#config' }, terms: ['managed-configuration', 'fail-open-closed'] },
      { id: 'concept-why-it-matters', label: 'Why it matters', description: why, group: 'concept', action: { type: 'route', href: '/#talk' }, terms: ['same-policy', 'tls-termination'] },
      { id: 'concept-diagram', label: 'Diagrams', description: 'Two diagrams: hook, gateway and the native answer; and why a hook and where it stops.', group: 'concept', action: { type: 'route', href: '/#diagram' }, terms: ['hook', 'tls-termination'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}

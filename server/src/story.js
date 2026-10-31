import { fillDeep, VERTICALS } from './cast.js';
import { AGENTS, KINDS, KIND_LABEL, nativeRequest, respond } from './agents.js';
import { BANNER, CLAIMS, CLAIM_LABEL, FIELD_SOURCE, FIELD_SOURCE_LAB, INTRO, RELEASE, SCENARIOS, TALK_TRACK, TITLE, mcpAllowFor } from './data.js';
import { CONFIG_FIELDS, SWAGGER_NAMES, defaultConfig } from './codingConfig.js';
import { ctxFor, scenarioCall } from './evaluation.js';
import { identityFrom, mockCertSubject } from './identity.js';

export const rawStory = () => ({ title: TITLE, intro: INTRO, banner: BANNER, claims: CLAIMS, scenarios: SCENARIOS, talkTrack: TALK_TRACK });

const SAMPLE = { prompt: 'secret-prompt', shell: 'destructive-shell', file_read: 'sensitive-read', mcp_call: 'mcp-unlisted', tool_result: 'hidden-instructions' };

// One agent as the Agents tab shows it: paths, events, and per kind the request the hook gets and the native answers it can print.
function agentView(a, cast) {
  const channels = KINDS.map((kind) => {
    const ch = a.channels[kind];
    const row = { kind, label: KIND_LABEL[kind], event: ch.event, canBlock: ch.canBlock, canAsk: ch.canAsk, status: ch.status, documented: ch.documented, illustrative: ch.illustrative, caveat: ch.caveat };
    if (!ch.event) return { ...row, request: null, responses: {} };
    const { call } = scenarioCall(cast, SAMPLE[kind]);
    const responses = { allow: respond(a.id, kind, 'allow', '') };
    if (ch.canAsk) responses.ask = respond(a.id, kind, 'ask', 'Reads a sensitive path (example reason).');
    if (ch.canBlock) responses.deny = respond(a.id, kind, 'deny', 'Blocked by policy (example reason).');
    return { ...row, request: nativeRequest(a.id, call, ctxFor(cast)), responses };
  });
  return { id: a.id, name: a.name, vendor: a.vendor, managed: a.managed, managedNote: a.managedNote, configCaveat: a.configCaveat, sources: a.sources, channels, dialog: a.dialog };
}

// The story with the cast filled in. The mock credential in the prompt scenario is built at run time (data.js).
export function buildStory(cast, vertical) {
  const s = fillDeep(rawStory(), cast);
  const subject = mockCertSubject(cast);
  return {
    title: s.title, intro: s.intro, release: RELEASE, claimLabel: CLAIM_LABEL, banner: s.banner, claims: s.claims,
    fieldSource: FIELD_SOURCE, fieldSourceLab: FIELD_SOURCE_LAB, swaggerNames: SWAGGER_NAMES, configFields: CONFIG_FIELDS,
    defaultConfig: defaultConfig(cast), mcpAllow: mcpAllowFor(cast),
    scenarios: SCENARIOS.map((sc) => { const x = scenarioCall(cast, sc.id); return { id: sc.id, title: x.scenario.title, kind: sc.kind, expected: sc.expected, lesson: fillDeep(sc.lesson, cast), call: x.call }; }),
    agents: AGENTS.map((a) => agentView(a, cast)), kinds: KINDS, kindLabel: KIND_LABEL,
    certSubject: subject, identity: identityFrom(subject),
    talkTrack: s.talkTrack, cast, vertical, verticals: Object.keys(VERTICALS),
  };
}

// docs/talk-track.md is generated from the same data the UI reads (`npm run talk-track`); a test fails if they drift.
export function renderTalkTrackMarkdown(cast) {
  const s = buildStory(cast, 'finance');
  const parts = ['# Talk track', '', '<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->', '', `> ${s.claimLabel}: every product claim here comes from the Ping ID4AI Workforce H2 2026 deck, slide 49 (release ${s.release}).`, ''];
  for (const t of s.talkTrack) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## The seven actions on the Evaluate tab', '');
  s.scenarios.forEach((sc, i) => parts.push(`${i + 1}. **${sc.title}** (${sc.expected} by the rules). ${sc.lesson}`));
  return `${parts.join('\n')}\n`;
}

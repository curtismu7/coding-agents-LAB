// The lab's masker: a thin adapter over the canonical shared masker (shared/mask.js, shared-masker 1.4.0, commit 9bc664a). This file holds no
// detector of its own. It keeps the names the rest of the lab imports (MARK, TOO_LONG, MAX_RAW, maskText, maskDeep, redact, cut) and says,
// in one place, what the lab writes itself that merely LOOKS like a secret.
//
// THIS IS A HEURISTIC (see the README, "Known limits"). Do not type a real credential into a lab. Anything the visitor types that the lab
// shows back is masked on the way out, and ALWAYS before it is cut to length.
import { createMasker } from './shared/mask.js';

export const MARK = '[masked]';
export const TOO_LONG = '[masked: text too long to check]';
export const MAX_RAW = 1_000_000;

const OWN = Object.assign(Object.create(null), {
  traceparent: /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
  traceId: /^[0-9a-f]{32}$/,
  reasonCode: /^(?:ALLOW|(?:DENY|ASK|ALERT|GAP|IGNORED)-[A-Z]{2,20}(?:-[A-Z]{2,20}){0,5})$/,
});

// The one fixed mock session id of the hook events the lab shows (evaluation.js ctxFor), whatever the agent calls the field (session_id, sessionId ...).
const MOCK_SESSION = /^sess-mock-\d{4}$/;

const masker = createMasker({
  markStyle: 'plain', // exactly [masked]: many tests and the README spell it
  tooLongText: TOO_LONG,
  maxLength: MAX_RAW,
  // What the LAB writes itself and that merely looks like a secret: the W3C trace headers, the trace id of a hop and the reason code of a decision
  // (DENY-SECRET-IN-PROMPT). A visitor can type a key of any name, so a name alone is never enough: the value must also have the exact shape the lab
  // generates (a typed value of any other shape under the same name is masked as usual).
  opaque: (key, _path, value) => typeof value === 'string' && (MOCK_SESSION.test(value) || OWN[key]?.test(value) === true),
});

export const { maskText, maskDeep, looksLikeCredential, isCredentialId } = masker;

// Cut to `max` characters (whole code points). Always after masking.
export function cut(text, max) {
  if (text.length <= max) return text;
  const t = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}

// One line for an audit record or a one-line summary: masked first, whitespace collapsed, then cut.
export function redact(text, max = 120) {
  return cut(maskText(String(text ?? '')).replace(/\s+/g, ' ').trim(), max);
}

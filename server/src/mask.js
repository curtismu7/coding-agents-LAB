// Masking for anything a visitor types that this lab shows back (the call, the hook request, the hops, the dialog, the audit trail, a
// config echo, an identity). Typed text can carry a real credential, so every answer is masked on the way out, and ALWAYS before it is
// cut to length (a secret placed after many filler characters must not survive by being cut off first, or kept by being cut in half).
//
// THIS IS A HEURISTIC: it recognises common shapes, not every secret. Do not type a real credential into a lab.
// It over-masks on purpose ("the password is required" becomes "the password is [masked]": the word after "password is" is taken for the value).
// What it still misses: a bare word with no keyword and no recognisable shape; letters from another alphabet that look like Latin ones
// (a Cyrillic a or Greek o inside "password" is not folded: NFKC does not unify them); a keyword split by an ordinary space or another
// letter ("pass word=x"); a plain-space value that has no digit ("password correcthorse") or is shorter than 6 characters, and "the secret is correcthorse" (only "password is x" takes a value without a digit); the weak
// keywords pass, auth, cookie, signature and key when nothing ("=", ":", "is", "was") follows them.
//
// Steps: NFKC; delete default-ignorable, format (Cf) and U+FFFD characters AND every C0/C1 control character except tab, newline and
// carriage return (those three cannot split a keyword: see below); percent-decode up to three rounds (each round followed by the same
// normalisation); then the detectors below find the ranges to mask. Tab, LF, CR, U+2028 and U+2029 are separators, so the detectors run
// three times: on the text as typed, on the text with those separators deleted (so "pass<TAB>word=x" is caught while a plain multi-line
// text keeps its lines), and with every "+" read as a space ("password+is+x"). The ranges of all three looks are merged on the text as typed.
//
// KEYWORD + PLAIN SPACE: "password hunter2xyz" is masked, "password reset" is not. The value after a strong keyword and plain whitespace
// must be at least 6 characters and contain a digit. That keeps ordinary sentences readable ("password policy", "token bucket", "secret
// santa"), at the price of missing a plain-word secret ("password correcthorse"). After "=" or ":" any value is masked; after "password is" / "password was" too; after "token is", "secret is", "key is" and the like a value needs a digit.
//
// Every regular expression is linear or bounded (no unbounded quantifier inside another); a test feeds 400 000 characters of the nastiest
// shapes. Input over MAX_RAW characters is refused whole (replaced by a marker), never cut.
export const MARK = '[masked]';
export const TOO_LONG = '[masked: text too long to check]';
export const MAX_RAW = 1_000_000;

const STRIP = /[\p{Default_Ignorable_Code_Point}\p{Cf}\uFFFD]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g; // C0 and C1 except tab, newline, carriage return
const SEPARATOR = /[\t\n\r\u2028\u2029]/; // not global: .test() must not carry state

const normalise = (s) => s.normalize('NFKC').replace(STRIP, '').replace(CONTROL, '');
function decodeOnce(s) {
  try { return decodeURIComponent(s); } catch { return s.replace(/%([0-9a-f]{2})/gi, (m, h) => (parseInt(h, 16) < 128 ? String.fromCharCode(parseInt(h, 16)) : m)); }
}

const STRONG = 'passphrase|password|passwd|pwd|pw|secret|token|api[-_ ]?key|apikey|authorization|bearer|credentials?|private[-_ ]?key|access[-_ ]?key|client[-_ ]?secret|session[-_ ]?id';
// Keywords after which a plain space still introduces a value (only when the value has a digit and 6+ characters).
const SPACED = 'passphrase|password|passwd|pwd|pw|secret|token|api[-_ ]?key|apikey|credential|private[-_ ]?key|access[-_ ]?key|session[-_ ]?id';
const WEAK = 'pass|auth|cookie|signature|keys?';
const TOKEN_CHARS = '[^\\s,;&}\\])]';
const VALUE = `"[^"]{0,2000}"|'[^']{0,2000}'|\\{[^}]{0,300}\\}|\\[[^\\]]{0,300}\\]|${TOKEN_CHARS}+`;
const PASSWORDISH = 'passphrase|password|passwd|pwd|pw'; // after these "is" / "was" introduces a value of any shape
const WITH_DIGIT = `(?=${TOKEN_CHARS}{0,300}\\d)`; // bounded look-ahead: a digit within the next 300 characters of this token

// Each detector masks the named group v.
const DETECTORS = [
  // key blocks (an unterminated block is masked to the end)
  { re: /(?<v>-----BEGIN [A-Z ]{1,40}-----[\s\S]*?(?:-----END [A-Z ]{1,40}-----|$))/dg },
  // URL userinfo, with or without a scheme: https://user:pw@host, //user:pw@host
  { re: /(?<=\/\/)(?<v>[^\s/?#@]{1,200})@/dg },
  // header-style values run to the end of the line
  { re: /\b(?:authorization|proxy-authorization|set-cookie|cookie)\s{0,20}[:=]\s{0,20}(?<v>[^\r\n]+)/dgi },
  // keyword assignments with = : => ->: password=x, "password":"x", my_password: x (a keyword may be glued into a longer name)
  { re: new RegExp(`(?:${STRONG})[\\w-]{0,30}["']?\\s{0,20}(?:=>|->|[:=])\\s{0,20}(?<v>${VALUE})`, 'dgi') },
  // plain language: "my password is x" masks any value; for the other keywords "the token is x" needs a digit in the value, so
  // "the credential is stopped" and "the token is valid" stay readable
  { re: new RegExp(`(?:${PASSWORDISH})[\\w-]{0,30}["']?\\s{1,20}(?:is|was)\\s{1,20}(?<v>${VALUE})`, 'dgi') },
  { re: new RegExp(`(?:${STRONG})[\\w-]{0,30}["']?\\s{1,20}(?:is|was)\\s{1,20}(?<v>${WITH_DIGIT}${TOKEN_CHARS}+)`, 'dgi') },
  // weak keywords: only as a whole word, and "is"/"was" only when the value has a digit ("the key is hunter2")
  { re: new RegExp(`(?<![A-Za-z])(?:${WEAK})["']?\\s{0,20}(?:=>|->|[:=])\\s{0,20}(?<v>${VALUE})`, 'dgi') },
  { re: new RegExp(`(?<![A-Za-z])(?:${WEAK})\\s{1,20}(?:is|was)\\s{1,20}(?<v>${WITH_DIGIT}${TOKEN_CHARS}+)`, 'dgi') },
  // a strong keyword, a plain space, then a value of 6+ characters with a digit: "password hunter2xyz", "api key hunter2xyz"
  { re: new RegExp(`(?<![A-Za-z])(?:${SPACED})s?\\s{1,20}(?<v>${WITH_DIGIT}${TOKEN_CHARS}{6,})`, 'dgi') },
  // user:password@host without a scheme (a mailto: address is left alone)
  { re: /(?<![\w.%+-])(?!mailto:)(?<v>[\w.%+-]{1,200}:[^\s/?#@:]{1,200})@(?=[A-Za-z0-9[])/dgi },
  // bearer values: 6+ characters with a digit, or 20+ of any
  { re: /\bbearer\s{1,5}(?<v>(?=[A-Za-z0-9._~+/=-]{0,300}\d)[A-Za-z0-9._~+/=-]{6,}|[A-Za-z0-9._~+/=-]{20,})/dgi },
  { re: /\b(?<v>eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*)/dg },
  { re: /\b(?<v>(?:sk|pk|rk|ghp|gho|ghu|ghs|glpat|xox[abprs])[-_][A-Za-z0-9_-]{6,})/dg },
  { re: /\b(?<v>(?:AKIA|ASIA)[0-9A-Z]{12,})/dg },
  // a long opaque run with a digit (no hyphen: a traceparent is 00-<32 hex>-<16 hex>-01 and must stay readable)
  { re: /(?<v>[A-Za-z0-9+_=]{40,})/dg, accept: (s) => /\d/.test(s) },
];

function rangesOf(text) {
  const out = [];
  for (const { re, accept } of DETECTORS) {
    for (const m of text.matchAll(re)) {
      const [a, b] = m.indices.groups.v;
      if (b > a && (!accept || accept(text.slice(a, b)))) out.push([a, b]);
    }
  }
  return out;
}

// All three looks, as ranges of `text`.
function lookAll(text) {
  const out = rangesOf(text);
  if (text.includes('+')) out.push(...rangesOf(text.replaceAll('+', ' '))); // same length: same positions
  if (SEPARATOR.test(text)) {
    const keep = []; let stripped = '';
    for (let i = 0; i < text.length; i += 1) if (!SEPARATOR.test(text[i])) { keep.push(i); stripped += text[i]; }
    for (const [a, b] of rangesOf(stripped)) out.push([keep[a], keep[b - 1] + 1]);
  }
  return out;
}

function apply(text, ranges) {
  if (!ranges.length) return text;
  ranges.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  let out = ''; let at = 0; let [a, b] = ranges[0];
  const flush = () => { out += text.slice(at, a) + MARK; at = b; };
  for (let i = 1; i < ranges.length; i += 1) {
    const [x, y] = ranges[i];
    if (x <= b) { if (y > b) b = y; } else { flush(); a = x; b = y; }
  }
  flush();
  return out + text.slice(at);
}

export function maskText(input) {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  if (raw.length > MAX_RAW) return TOO_LONG;
  let cur = normalise(raw);
  let best = { text: cur, ranges: lookAll(cur) };
  for (let i = 0; i < 3; i += 1) {
    const next = normalise(decodeOnce(cur));
    if (next === cur) break;
    cur = next;
    const ranges = lookAll(cur);
    if (ranges.length) best = { text: cur, ranges };
  }
  return apply(best.text, best.ranges);
}

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

// A copy of any JSON-like value with every string AND every object key masked. Iterative: a hostile value cannot overflow the stack.
// Two keys that mask to the same text are kept apart ("#2"), and a key called __proto__ stays an ordinary own property.
export function maskDeep(value) {
  const out = { v: undefined };
  const work = [[{ v: value }, out, 'v']];
  const put = (dst, key, val) => Object.defineProperty(dst, key, { value: val, enumerable: true, writable: true, configurable: true });
  while (work.length) {
    const [src, dst, key] = work.pop(); const x = src[key];
    if (typeof x === 'string') put(dst, key, maskText(x));
    else if (x === null || typeof x !== 'object') put(dst, key, x);
    else if (Array.isArray(x)) { const copy = []; put(dst, key, copy); for (let i = x.length - 1; i >= 0; i -= 1) work.push([x, copy, i]); }
    else {
      const copy = {}; put(dst, key, copy);
      const used = new Set(); const jobs = [];
      for (const k of Object.keys(x)) {
        let nk = maskText(k); let n = 2;
        while (used.has(nk)) { nk = `${maskText(k)}#${n}`; n += 1; }
        used.add(nk); jobs.push([x, copy, k, nk]);
      }
      for (let i = jobs.length - 1; i >= 0; i -= 1) {
        const [s, d, k, nk] = jobs[i];
        // a one-key holder lets the same loop read s[k] and write d[nk]
        const shim = Object.defineProperty({}, nk, { value: s[k], enumerable: true });
        work.push([shim, d, nk]);
      }
    }
  }
  return out.v;
}

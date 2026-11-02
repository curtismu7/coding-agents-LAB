// The developer and the device, "taken from the machine's certificate". The lab has no certificate store and never reads one: the
// subject below is a MOCK string in a lab-invented format (CN=<account>@<host>.example,OU=device:<id>,O=<brand> (MOCK)), and the
// fingerprint is a hash of that string, not of a real certificate.
import { createHash } from 'node:crypto';
import { maskText, redact } from './mask.js';

export const mockCertSubject = (cast) => `CN=${cast.castAgentId}@${cast.castHost}.example,OU=device:${cast.castDevice},O=${cast.castBrand} (MOCK)`;

export const MAX_SUBJECT = 300; // a longer subject is refused by the callers that take one from a request; never cut
// The subject is a distinguished name: "KEY=value" pieces separated by commas, with the keys below. It is parsed FIRST and each value is masked on its own
// (no value can carry a comma, so a typed secret cannot hide behind the next piece, and one piece cannot change how another is read). A subject that is
// not in that shape (an unknown key, a piece without "=", more than 8 pieces, a line break or control character) is not read at all: the identity is "unknown". The fingerprint hashes the
// MASKED pieces, so a typed secret never leaves a hash behind. (Masking the whole text instead lets a plain-space value swallow the next keyword: a
// shared-masker 1.4.0 gap, reported.)
const DN_KEYS = new Set(['CN', 'OU', 'O', 'L', 'ST', 'C']);
const MAX_PIECES = 8;
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/; // a distinguished name is one line of printable text: a line break or a control character is no certificate
function maskedPieces(subject) {
  if (NOT_ONE_LINE.test(String(subject))) return null;
  const raw = String(subject).split(',');
  if (raw.length > MAX_PIECES) return null;
  const out = [];
  for (const piece of raw) {
    const eq = piece.indexOf('=');
    if (eq < 0 || !DN_KEYS.has(piece.slice(0, eq).trim())) return null;
    out.push({ key: piece.slice(0, eq).trim(), text: `${piece.slice(0, eq)}=${maskText(piece.slice(eq + 1))}`, value: piece.slice(eq + 1).trim() }); // value is shown through redact(), which masks first
  }
  return out;
}
export function identityFrom(subject) {
  const pieces = maskedPieces(subject);
  const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
  if (!pieces) return { identity: 'unknown', device: 'unknown', mock: true, fingerprint: sha('(not a certificate subject)') };
  const cn = pieces.find((p) => p.key === 'CN')?.value; const ou = pieces.find((p) => p.key === 'OU')?.value;
  return {
    identity: cn ? redact(cn, 80) : 'unknown',
    device: ou && ou.startsWith('device:') ? redact(ou.slice(7), 40) : 'unknown',
    mock: true,
    fingerprint: sha(pieces.map((p) => p.text).join(',')),
  };
}

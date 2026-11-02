// The developer and the device, "taken from the machine's certificate". The lab has no certificate store and never reads one: the
// subject below is a MOCK string in a lab-invented format (CN=<account>@<host>.example,OU=device:<id>,O=<brand> (MOCK)), and the
// fingerprint is a hash of that string, not of a real certificate.
import { createHash } from 'node:crypto';
import { maskText, redact } from './mask.js';

export const mockCertSubject = (cast) => `CN=${cast.castAgentId}@${cast.castHost}.example,OU=device:${cast.castDevice},O=${cast.castBrand} (MOCK)`;

export const MAX_SUBJECT = 300; // a longer subject is refused by the callers that take one from a request; never cut
const part = (subject, key) => {
  for (const piece of String(subject).split(',')) { const [k, ...v] = piece.trim().split('='); if (k === key) return v.join('='); }
  return null;
};
// The subject is MASKED before it is split into pieces, hashed or cut. It is masked piece by piece (each ","-separated piece alone) and then
// whole: the shared masker lets a plain-space value run to the next space, so "password hunter2xyz,OU=device:password hunter2xyz" masked in one
// go would hide the first value and show the second (shared-masker 1.4.0 gap, reported; the piecewise pass is the lab's workaround).
// The fingerprint hashes the masked text, so a typed secret never leaves a hash behind.
const maskSubject = (subject) => maskText(String(subject).split(',').map((piece) => maskText(piece)).join(','));
export function identityFrom(subject) {
  const masked = maskSubject(subject);
  const cn = part(masked, 'CN'); const ou = part(masked, 'OU');
  return {
    identity: cn ? redact(cn, 80) : 'unknown',
    device: ou && ou.startsWith('device:') ? redact(ou.slice(7), 40) : 'unknown',
    mock: true,
    fingerprint: createHash('sha256').update(masked).digest('hex').slice(0, 16),
  };
}

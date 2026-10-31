// The developer and the device, "taken from the machine's certificate". The lab has no certificate store and never reads one: the
// subject below is a MOCK string in a lab-invented format (CN=<account>@<host>.example,OU=device:<id>,O=<brand> (MOCK)), and the
// fingerprint is a hash of that string, not of a real certificate.
import { createHash } from 'node:crypto';
import { redact } from './detect.js';

export const mockCertSubject = (cast) => `CN=${cast.castAgentId}@${cast.castHost}.example,OU=device:${cast.castDevice},O=${cast.castBrand} (MOCK)`;

const part = (subject, key) => {
  for (const piece of String(subject).slice(0, 300).split(',')) { const [k, ...v] = piece.trim().split('='); if (k === key) return v.join('=').slice(0, 80); }
  return null;
};
export function identityFrom(subject) {
  const cn = part(subject, 'CN'); const ou = part(subject, 'OU');
  return {
    identity: cn ? redact(cn, 80) : 'unknown',
    device: ou && ou.startsWith('device:') ? redact(ou.slice(7), 40) : 'unknown',
    mock: true,
    fingerprint: createHash('sha256').update(String(subject)).digest('hex').slice(0, 16),
  };
}

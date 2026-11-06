// Deployment configuration. MODE is the DEFAULT mode the page opens in (mock, live or real); the header toggle can switch per visit.
// Mock is the default. Mock and live make zero outbound calls. Real sends the hook event to the tenant's live AI Gateway
// (one hostname, owner-set in the shared settings file); everything else stays blocked by the netguard. Anything else is an error,
// never a silent fallback. The one shared settings file (~/Development/.env, or STANDALONE_ENV) may carry CODING_AGENTS_LAB_MODE.
// A bare MODE is NOT read: the shared file is read by every standalone app, and another app's MODE must not switch this one.
export const MODES = ['mock', 'live', 'real'];
export function modeFrom(env = process.env) {
  const raw = env.CODING_AGENTS_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(m)) throw new Error(`CODING_AGENTS_LAB_MODE=${String(m).slice(0, 20)} is not available: use mock, live or real`);
  return m;
}
export const defaultMode = () => modeFrom(process.env);
export const modeOf = (v) => (MODES.includes(v) ? v : null);

// Real enforcement: the hook event goes to the tenant's live AI Gateway (Privilege AI Guard in the decision
// path), not just the lab's deterministic rules. The wire is the A2A JSON-RPC the gateway already serves:
//
//   POST {AIGATEWAY_URL}/message/send  (A2A JSON-RPC 2.0, Bearer {AIGATEWAY_BEARER})
//   answer: completed task  -> allow
//           error "request blocked by security policy" -> deny (AI Guard blocked it)
//           completed but the echoed prompt carries [REDACTED:...] -> deny (data stopped before the model)
//
// The blocked and redacted answers were MEASURED on the live gateway (2026-11-06); a clean completion was too.
// Everything else here (the mapping wording, the reason codes) is lab-invented and tagged.
//
// Safety: the endpoint and bearer come ONLY from the one shared settings file (~/Development/.env or
// STANDALONE_ENV), owner-set. The bearer is write-only: never returned by any API, never logged, never echoed.
// The netguard allowance is exactly the gateway's one hostname (allowlist below); every other outbound is still
// blocked and recorded. No value from a visitor ever builds a URL.
import { AGENT_IDS } from './agents.js';
import { loadSharedEnv, realEnvPath } from './sharedEnv.js';

export const AIGUARD_URL_KEY = 'CODING_AGENTS_LAB_AIGATEWAY_URL';
export const AIGUARD_BEARER_KEY = 'CODING_AGENTS_LAB_AIGATEWAY_BEARER';
export const FALLBACK_URL_KEY = 'CENTRAL_AGENT_A2A_URL';
export const FALLBACK_BEARER_KEY = 'CENTRAL_AGENT_A2A_BEARER';
export const MAX_TEXT = 4000;

// ---- Configuration from the shared settings file -----------------------------------------------------------------
// The A2A URL the lab posts to is the jsonrpc endpoint under the A2A base (the family's jsonRpcUrl rule:
// a URL not ending in /jsonrpc or /rpc gains /jsonrpc).
export function jsonRpcUrl(value) {
  const v = String(value ?? '').replace(/\/$/, '');
  return /\/(jsonrpc|rpc)$/i.test(v) ? v : `${v}/jsonrpc`;
}

function firstSet(env, keys) {
  for (const k of keys) {
    const v = env[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function aiGuardConfig(env = process.env) {
  const shared = loadSharedEnv(realEnvPath(env));
  const merged = { ...shared, ...env };
  const url = firstSet(merged, [AIGUARD_URL_KEY, FALLBACK_URL_KEY]);
  const bearer = firstSet(merged, [AIGUARD_BEARER_KEY, FALLBACK_BEARER_KEY]);
  let host = '';
  try { host = url ? new URL(jsonRpcUrl(url)).hostname : ''; } catch { host = ''; }
  return { configured: Boolean(url && bearer), url, bearer, host, hasUrl: Boolean(url), hasBearer: Boolean(bearer) };
}

export function realNotConfiguredReason() {
  return 'Real mode is not configured. Set CODING_AGENTS_LAB_AIGATEWAY_URL and CODING_AGENTS_LAB_AIGATEWAY_BEARER (or CENTRAL_AGENT_A2A_URL and CENTRAL_AGENT_A2A_BEARER) in the shared settings file, then restart the lab. The bearer is write-only: it is never shown.';
}

// The one hostname the netguard may reach. Nothing else is allowed through, in this process or the hook's.
export function netguardAllowlist(env = process.env) {
  const { host } = aiGuardConfig(env);
  return host ? [host] : [];
}

// ---- The event text that reaches the gateway ---------------------------------------------------------------------
// One text per kind of action, in the developer's own voice: the gateway sees the same content an LLM would.
const textOf = (call) => {
  switch (call.kind) {
    case 'prompt': return call.text;
    case 'shell': return `Please run this shell command: ${call.command}`;
    case 'file_read': return `Please read the file at ${call.path}`;
    case 'mcp_call': return `Please call the MCP tool ${call.server}/${call.tool}${call.args && Object.keys(call.args).length ? ` with: ${JSON.stringify(call.args)}` : ''}`;
    default: return `The tool ${call.server}/${call.tool} returned this result: ${call.result}`;
  }
};

export const eventText = (call) => String(textOf(call) ?? '').slice(0, MAX_TEXT);

// ---- Mapping the gateway's answer to a decision ------------------------------------------------------------------
// MEASURED on the live gateway (2026-11-06):
//   clean    -> {"jsonrpc":"2.0","id":...,"result":{"kind":"task",...,"status":{"state":"completed"},...}}
//   blocked  -> {"jsonrpc":"2.0","id":...,"error":{"code":-32600,"message":"request blocked by security policy"}}
//   redacted -> completed, and the echoed prompt part reads "key is [REDACTED:data_exfiltration]"
export function mapGatewayAnswer({ body, status, sentText }) {
  if (body && body.error) {
    const msg = String(body.error.message ?? '');
    if (/blocked by security policy/i.test(msg)) {
      return { decision: 'deny', reasonCode: 'DENY-AIGUARD-BLOCKED', decidedBy: 'the live AI Guard (real gateway)', measured: true };
    }
    return { decision: 'allow', reasonCode: 'ALLOW-AIGUARD-ERROR', decidedBy: 'the live gateway (non-blocking error)', measured: true };
  }
  const result = body?.result;
  const state = String(result?.status?.state ?? '');
  if (status >= 200 && status < 300 && (state === 'completed' || state === 'working' || state === 'submitted')) {
    const echoed = JSON.stringify(result ?? {});
    const red = /\[REDACTED:[a-z_]+\]/i.exec(echoed);
    if (red) return { decision: 'deny', reasonCode: 'DENY-AIGUARD-REDACTED', decidedBy: 'the live AI Guard (real gateway, data-loss policy)', measured: true };
    return { decision: 'allow', reasonCode: 'ALLOW-AIGUARD-CLEAN', decidedBy: 'the live AI Guard (real gateway)', measured: true };
  }
  return null; // not an answer shape this lab maps
}

export const mapAnswer = mapGatewayAnswer; // shorter alias for callers

// ---- The outbound call --------------------------------------------------------------------------------------------
// fetchFn is injectable for tests. The URL is built ONLY from the configured endpoint, never from input.
export async function sendToAiGuard({ call, cfg, traceparent, fetchFn = fetch, timeoutMs = 30000 }) {
  const text = eventText(call);
  const body = {
    jsonrpc: '2.0',
    id: `cag-${Date.now()}`,
    method: 'message/send',
    params: { message: { messageId: `cag-${Date.now()}-m`, role: 'user', parts: [{ kind: 'text', text }] } },
  };
  const response = await fetchFn(jsonRpcUrl(cfg.url), {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', ...(cfg.bearer ? { authorization: `Bearer ${cfg.bearer}` } : {}), ...(traceparent ? { traceparent } : {}) },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* non-JSON */ }
  return { status: response.status, body: parsed, raw: raw.slice(0, 2000), mapped: parsed ? mapGatewayAnswer({ body: parsed, status: response.status, sentText: text }) : null };
}

// ---- Which agents Real mode covers --------------------------------------------------------------------------------
// The console page enables agents one by one; Real mode reuses the CodingAgent config's Agents switches
// (isCovered in codingConfig.js). This helper is only for the doctor and /api/info wording.
export const coveredInReal = (config) => AGENT_IDS.filter((id) => config?.Agents?.[id] === true);

export const LAB_TAG = 'lab-invented';
export const MEASURED_TAG = 'measured on the live gateway, 2026-11-06';

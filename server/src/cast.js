// {{token}} templating for the story data. customer.config.json (optional, git-ignored) overrides the default cast.
// Tokens are filled from one of three vertical packs. A test fails on any token a pack does not define.
import fs from 'node:fs';
import { scanHosts } from './safety.js';

const TOKEN = /\{\{(\w+)\}\}/g;
const MAX_CAST = 40;
const ID = /^[a-z0-9.-]{1,40}$/;

// Everything a story needs per vertical: who the developer is, which repository and device, which internal MCP server, what the
// risky actions look like. Only brand, agentId (the developer's account name) and host are overridable by customer.config.json.
export const VERTICALS = {
  finance: {
    castBrand: 'Fabrikam Bank', castAgentId: 'maya.chen', castHost: 'fabrikam', castDevice: 'LT-4821', castRepo: 'payments-ledger',
    castMcp: 'ledger-mcp', castSecretLabel: 'payments gateway key', castTestCmd: 'npm test -- ledger', castCleanDir: 'ledger-cache',
  },
  health: {
    castBrand: 'Contoso Health', castAgentId: 'omar.reyes', castHost: 'contoso', castDevice: 'LT-7310', castRepo: 'claims-portal',
    castMcp: 'claims-mcp', castSecretLabel: 'claims database password', castTestCmd: 'npm test -- claims', castCleanDir: 'claims-cache',
  },
  retail: {
    castBrand: 'Northwind Retail', castAgentId: 'priya.nair', castHost: 'northwind', castDevice: 'LT-2096', castRepo: 'storefront-api',
    castMcp: 'orders-mcp', castSecretLabel: 'checkout API key', castTestCmd: 'npm test -- checkout', castCleanDir: 'storefront-cache',
  },
};
export const DEFAULT_VERTICAL = 'finance';
export const DEFAULT_CAST = VERTICALS[DEFAULT_VERTICAL];

export const unfilled = (text, cast) => [...String(text).matchAll(TOKEN)].map((m) => m[1]).filter((k) => !Object.hasOwn(cast, k));
export const fill = (text, cast) => String(text).replace(TOKEN, (m, k) => (Object.hasOwn(cast, k) ? cast[k] : m));
// Iterative, so a deep structure cannot overflow the stack. Data here is our own, but the walker stays safe regardless.
export function fillDeep(value, cast) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const outRoot = { v: clone(value) };
  const work = [[value, outRoot, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop();
    if (typeof src === 'string') { dst[key] = fill(src, cast); continue; }
    if (src === null || typeof src !== 'object') { dst[key] = src; continue; }
    const copy = clone(src);
    dst[key] = copy;
    for (const k of Object.keys(src).reverse()) work.push([src[k], copy, k]);
  }
  return outRoot.v;
}

export const verticalFrom = (id) => (Object.hasOwn(VERTICALS, id) ? id : DEFAULT_VERTICAL);

// Only brand, agentId and host, as short plain strings; anything else in the file is ignored.
export function loadCast(file, vertical = DEFAULT_VERTICAL) {
  const cast = { ...VERTICALS[verticalFrom(vertical)] };
  if (!file) return cast;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [short, key] of [['brand', 'castBrand'], ['agentId', 'castAgentId'], ['host', 'castHost']]) {
      const v = cfg?.cast?.[short];
      if (typeof v !== 'string' || !v.trim()) continue;
      const clean = v.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, MAX_CAST);
      if (/:\/\/|@/.test(clean) || scanHosts(clean).length) continue;
      if (short !== 'brand' && !ID.test(clean.toLowerCase())) continue;
      if (short === 'host' && clean.includes('.')) continue;
      cast[key] = short === 'brand' ? clean : clean.toLowerCase();
    }
  } catch { /* no file or not JSON: the defaults */ }
  return cast;
}

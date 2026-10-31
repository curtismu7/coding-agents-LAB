// What the hook posts is bounded: a long string field is cut to its head and tail before it leaves the hook, so a big tool result or a
// 900 KB command never meets the server's body limit (a 413 would look like an unreachable gateway). The gateway scans the first and
// last 4000 characters of any one field (detect.js), so keeping both ends loses nothing it would have looked at.
// Pure and iterative: a hostile, deeply nested value cannot overflow the stack.
export const HOOK_POST_LIMIT = 200_000; // bytes, well under the server's 256 KB limit for /api/hook
const CAPS = [4000, 1000, 250, 50];

export function trimStrings(value, cap) {
  const out = { v: undefined };
  const work = [[{ v: value }, out, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop(); const x = src[key];
    if (typeof x === 'string') dst[key] = x.length > cap * 2 ? `${x.slice(0, cap)}\n[... ${x.length - cap * 2} characters omitted by the hook ...]\n${x.slice(-cap)}` : x;
    else if (x === null || typeof x !== 'object') dst[key] = x;
    else { const copy = Array.isArray(x) ? [] : {}; dst[key] = copy; for (const k of Object.keys(x)) work.push([x, copy, k]); }
  }
  return out.v;
}

// Returns the payload to post, or null when even the smallest cap cannot bring it under the limit (then the event is unreadable).
export function trimPayload(payload) {
  for (const cap of CAPS) {
    const t = trimStrings(payload, cap);
    let size; try { size = JSON.stringify(t).length; } catch { return null; }
    if (size <= HOOK_POST_LIMIT) return t;
  }
  return null;
}

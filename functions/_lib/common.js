// Shared helpers used by every /api/* function.
// Files/folders starting with "_" are never turned into routes by Cloudflare
// Pages Functions, so this file is safe to import from elsewhere without
// creating an accidental /api/_lib/common endpoint.

export const STARTER_CANVASES = [
  {
    id: 'original-100m',
    name: 'The Pixel Canvas',
    description: 'The original community canvas — first come, first served.',
    width: 10000,
    height: 10000,
    isStarter: true,
  },
  {
    id: 'mini-1m',
    name: 'Mini Canvas',
    description: 'A cozy canvas for smaller claims — 1,000,000 pixels.',
    width: 1000,
    height: 1000,
    isStarter: true,
  },
  {
    id: 'mega-canvas',
    name: 'The Mega Canvas',
    description: 'The biggest canvas on the site — 400,000,000 pixels.',
    width: 20000,
    height: 20000,
    isStarter: true,
  },
];

export const MAX_CUSTOM_CANVAS_AREA = 100_000_000; // parity with the original canvas
export const MIN_CANVAS_DIM = 50;
export const MAX_CANVAS_DIM = 20000;

export function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
export function badRequest(msg) {
  return jsonResponse({ error: msg }, 400);
}
export function unauthorized(msg = 'Unauthorized') {
  return jsonResponse({ error: msg }, 401);
}
export function forbidden(msg = 'Forbidden') {
  return jsonResponse({ error: msg }, 403);
}
export function notFound(msg = 'Not found') {
  return jsonResponse({ error: msg }, 404);
}

export async function listAllKeys(kv, prefix) {
  let keys = [];
  let cursor;
  do {
    const res = await kv.list({ prefix, cursor });
    keys = keys.concat(res.keys);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

export async function getCanvas(kv, id) {
  const stored = await kv.get(`canvas:${id}`, 'json');
  if (stored) return stored;
  const starter = STARTER_CANVASES.find((c) => c.id === id);
  return starter || null;
}

export async function listCanvases(kv) {
  // Seed the three starter canvases into KV on first-ever visit so they show
  // up in listings alongside user-created ones and can be edited later.
  const keys = await listAllKeys(kv, 'canvas:');
  const stored = await Promise.all(keys.map((k) => kv.get(k.name, 'json')));
  const storedIds = new Set(stored.filter(Boolean).map((c) => c.id));
  const missingStarters = STARTER_CANVASES.filter((c) => !storedIds.has(c.id));
  if (missingStarters.length) {
    await Promise.all(
      missingStarters.map((c) =>
        kv.put(`canvas:${c.id}`, JSON.stringify({ ...c, createdAt: new Date().toISOString() }))
      )
    );
  }
  return [...missingStarters, ...stored.filter(Boolean)];
}

// --- Sessions -------------------------------------------------------------
// A lightweight signed cookie: base64url(payload json) + "." + base64url(hmac).
// No external libraries — uses the Web Crypto API available in Workers.

function base64urlEncode(bytes) {
  let str = '';
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signSession(payload, secret) {
  const key = await hmacKey(secret);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, payloadBytes));
  return `${base64urlEncode(payloadBytes)}.${base64urlEncode(sig)}`;
}

export async function verifySession(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [payloadPart, sigPart] = token.split('.');
  try {
    const key = await hmacKey(secret);
    const payloadBytes = base64urlDecode(payloadPart);
    const sigBytes = base64urlDecode(sigPart);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookieHeader(value, maxAgeSeconds) {
  const parts = [
    `session=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (maxAgeSeconds != null) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

export async function getSessionUser(request, env) {
  const token = getCookie(request, 'session');
  if (!token || !env.SESSION_SECRET) return null;
  return verifySession(token, env.SESSION_SECRET);
}

export async function getUserRecord(kv, sub) {
  const rec = await kv.get(`user:${sub}`, 'json');
  return (
    rec || {
      sub,
      claimedStarters: [],
      hasCreatedCanvas: false,
      ownCanvasId: null,
    }
  );
}

export async function putUserRecord(kv, sub, record) {
  await kv.put(`user:${sub}`, JSON.stringify(record));
}

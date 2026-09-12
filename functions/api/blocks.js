const GRID = 1;
const CANVAS_SIZE = 10000;
const MAX_IMAGE_LEN = 3_000_000;
const MAX_URL_LEN = 500;
const MAX_TAGLINE_LEN = 200;
const MAX_EMAIL_LEN = 200;

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function badRequest(msg) {
  return jsonResponse({ error: msg }, 400);
}

async function listAllKeys(kv) {
  let keys = [];
  let cursor;
  do {
    const res = await kv.list({ cursor });
    keys = keys.concat(res.keys);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

async function allBlocks(kv) {
  const keys = await listAllKeys(kv);
  const values = await Promise.all(keys.map((k) => kv.get(k.name, 'json')));
  return values.filter(Boolean);
}

// Only fields the public site is allowed to see — email and internal status
// never leave the server, since this GET is readable by anyone in devtools.
function toPublic(b) {
  return { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, image: b.image, url: b.url, tagline: b.tagline };
}

function validLink(url) {
  if (!url) return true;
  if (url.length > MAX_URL_LEN) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  const blocks = (await allBlocks(env.BLOCKS_KV)).filter((b) => b.status === 'confirmed').map(toPublic);
  return jsonResponse({ blocks });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Bad request');
  }
  const { x, y, w, h, image, url, tagline, email } = body;

  // Every check here must hold server-side — nothing stops a request sent
  // straight to this endpoint, bypassing the site's UI entirely.
  if (![x, y, w, h].every((n) => Number.isInteger(n) && n >= 0)) {
    return badRequest('Invalid coordinates');
  }
  if (x % GRID || y % GRID || w % GRID || h % GRID || w <= 0 || h <= 0) {
    return badRequest('Invalid selection');
  }
  if (x + w > CANVAS_SIZE || y + h > CANVAS_SIZE) {
    return badRequest('Out of bounds');
  }
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return badRequest('Missing artwork');
  }
  if (image.length > MAX_IMAGE_LEN) {
    return badRequest('That selection is too large to paint — try a smaller area');
  }
  if (url && (typeof url !== 'string' || !validLink(url))) {
    return badRequest('Enter a valid link starting with http:// or https://');
  }
  if (tagline && (typeof tagline !== 'string' || tagline.length > MAX_TAGLINE_LEN)) {
    return badRequest('Tagline is too long');
  }
  if (email && (typeof email !== 'string' || email.length > MAX_EMAIL_LEN)) {
    return badRequest('Email is too long');
  }

  const existing = await allBlocks(env.BLOCKS_KV);
  const overlap = existing.some(
    (b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y
  );
  if (overlap) {
    return jsonResponse({ error: 'That space overlaps a claimed block' }, 409);
  }

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Every claim goes live immediately — first come, first served, no approval step.
  const record = { id, x, y, w, h, image, url: url || '', tagline: tagline || '', email: email || '', status: 'confirmed', createdAt: new Date().toISOString() };
  await env.BLOCKS_KV.put(id, JSON.stringify(record));

  return jsonResponse({ ok: true, id });
}

import {
  jsonResponse,
  badRequest,
  notFound,
  listAllKeys,
  getCanvas,
  getSessionUser,
  getUserRecord,
  putUserRecord,
  STARTER_CANVASES,
} from '../../../_lib/common.js';

const GRID = 1;
const MAX_IMAGE_LEN = 3_000_000;
const MAX_URL_LEN = 500;
const MAX_TAGLINE_LEN = 200;
const MAX_EMAIL_LEN = 200;

async function allBlocks(kv, canvasId) {
  const keys = await listAllKeys(kv, `block:${canvasId}:`);
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
  const { env, params } = context;
  const canvasId = params.id;
  const canvas = await getCanvas(env.BLOCKS_KV, canvasId);
  if (!canvas) return notFound('Canvas not found');

  const blocks = (await allBlocks(env.BLOCKS_KV, canvasId))
    .filter((b) => b.status === 'confirmed')
    .map(toPublic);

  return jsonResponse({
    canvas: {
      id: canvas.id,
      name: canvas.name,
      description: canvas.description,
      width: canvas.width,
      height: canvas.height,
      isStarter: !!canvas.isStarter,
      ownerSub: undefined, // never sent; listed here only to document it's excluded
      theme: canvas.theme || null,
    },
    blocks,
  });
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const canvasId = params.id;
  const canvas = await getCanvas(env.BLOCKS_KV, canvasId);
  if (!canvas) return notFound('Canvas not found');

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
  if (x + w > canvas.width || y + h > canvas.height) {
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

  const existing = await allBlocks(env.BLOCKS_KV, canvasId);
  const overlap = existing.some(
    (b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y
  );
  if (overlap) {
    return jsonResponse({ error: 'That space overlaps a claimed block' }, 409);
  }

  const session = await getSessionUser(request, env);
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Every claim goes live immediately — first come, first served, no approval step.
  const record = {
    id,
    x,
    y,
    w,
    h,
    image,
    url: url || '',
    tagline: tagline || '',
    email: email || '',
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    ownerSub: session ? session.sub : null,
  };
  await env.BLOCKS_KV.put(`block:${canvasId}:${id}`, JSON.stringify(record));

  // Track starter-canvas quest progress for signed-in users.
  if (session && STARTER_CANVASES.some((c) => c.id === canvasId)) {
    const userRecord = await getUserRecord(env.BLOCKS_KV, session.sub);
    if (!userRecord.claimedStarters.includes(canvasId)) {
      userRecord.claimedStarters = [...userRecord.claimedStarters, canvasId];
      await putUserRecord(env.BLOCKS_KV, session.sub, userRecord);
    }
  }

  return jsonResponse({ ok: true, id });
}

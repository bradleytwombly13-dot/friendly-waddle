import { jsonResponse, badRequest, unauthorized, notFound, listAllKeys, getCanvas } from '../../../_lib/common.js';

const GRID = 1;
const MAX_URL_LEN = 500;
const MAX_TAGLINE_LEN = 200;

async function allBlocks(kv, canvasId) {
  const keys = await listAllKeys(kv, `block:${canvasId}:`);
  const values = await Promise.all(keys.map((k) => kv.get(k.name, 'json')));
  return values.filter(Boolean);
}

function checkAuth(request, env) {
  const pw = request.headers.get('x-admin-password');
  return !!env.ADMIN_PASSWORD && pw === env.ADMIN_PASSWORD;
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
  const { request, env, params } = context;
  if (!checkAuth(request, env)) return unauthorized();
  const canvasId = params.id;
  const canvas = await getCanvas(env.BLOCKS_KV, canvasId);
  if (!canvas) return notFound('Canvas not found');
  const blocks = await allBlocks(env.BLOCKS_KV, canvasId);
  return jsonResponse({ canvas, blocks });
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!checkAuth(request, env)) return unauthorized();
  const canvasId = params.id;
  const canvas = await getCanvas(env.BLOCKS_KV, canvasId);
  if (!canvas) return notFound('Canvas not found');

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Bad request');
  }

  if (body.action === 'delete') {
    if (typeof body.id !== 'string' || !body.id) return badRequest('Missing id');
    await env.BLOCKS_KV.delete(`block:${canvasId}:${body.id}`);
    return jsonResponse({ ok: true });
  }

  if (body.action === 'reset-all') {
    const keys = await listAllKeys(env.BLOCKS_KV, `block:${canvasId}:`);
    await Promise.all(keys.map((k) => env.BLOCKS_KV.delete(k.name)));
    return jsonResponse({ ok: true, deleted: keys.length });
  }

  if (body.action === 'direct-add') {
    const { x, y, w, h, image, url, tagline } = body;
    if (![x, y, w, h].every((n) => Number.isInteger(n) && n >= 0)) {
      return badRequest('Invalid coordinates');
    }
    if (x % GRID || y % GRID || w % GRID || h % GRID || w <= 0 || h <= 0 || x + w > canvas.width || y + h > canvas.height) {
      return badRequest('Invalid block');
    }
    if (typeof image !== 'string' || !image.startsWith('data:image/')) {
      return badRequest('Missing artwork');
    }
    if (url && !validLink(url)) {
      return badRequest('Enter a valid link starting with http:// or https://');
    }
    if (tagline && (typeof tagline !== 'string' || tagline.length > MAX_TAGLINE_LEN)) {
      return badRequest('Tagline is too long');
    }
    // Admin direct-add is a trusted, password-gated tool for testing/overrides —
    // unlike the public endpoint, it's intentionally allowed to overlap existing blocks.
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record = { id, x, y, w, h, image, url: url || '', tagline: tagline || '', status: 'confirmed', createdAt: new Date().toISOString() };
    await env.BLOCKS_KV.put(`block:${canvasId}:${id}`, JSON.stringify(record));
    return jsonResponse({ ok: true, id });
  }

  return badRequest('Unknown action');
}

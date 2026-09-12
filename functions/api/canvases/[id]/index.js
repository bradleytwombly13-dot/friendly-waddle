import {
  jsonResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  listAllKeys,
  getCanvas,
  getSessionUser,
  getUserRecord,
  putUserRecord,
} from '../../../_lib/common.js';

const MAX_NAME_LEN = 60;
const MAX_DESC_LEN = 300;
const VALID_MODES = ['dark', 'light'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function checkAdmin(request, env) {
  const pw = request.headers.get('x-admin-password');
  return !!env.ADMIN_PASSWORD && pw === env.ADMIN_PASSWORD;
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const canvas = await getCanvas(env.BLOCKS_KV, params.id);
  if (!canvas) return notFound('Canvas not found');
  return jsonResponse({
    canvas: {
      id: canvas.id,
      name: canvas.name,
      description: canvas.description,
      width: canvas.width,
      height: canvas.height,
      isStarter: !!canvas.isStarter,
      ownerName: canvas.ownerName || null,
      theme: canvas.theme || null,
    },
  });
}

// PATCH /api/canvases/:id — update theme, name, or description.
// Allowed for the canvas's own creator (matched by session) or the site admin.
export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const canvas = await getCanvas(env.BLOCKS_KV, params.id);
  if (!canvas) return notFound('Canvas not found');

  const isAdmin = checkAdmin(request, env);
  const session = isAdmin ? null : await getSessionUser(request, env);
  const isOwner = !!(session && canvas.ownerSub && session.sub === canvas.ownerSub);
  if (!isAdmin && !isOwner) return unauthorized('Only this canvas\'s creator or the admin can edit it');

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Bad request');
  }

  const updated = { ...canvas };

  if (body.name != null) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > MAX_NAME_LEN) {
      return badRequest(`Name must be 1-${MAX_NAME_LEN} characters`);
    }
    updated.name = body.name.trim();
  }
  if (body.description != null) {
    if (typeof body.description !== 'string' || body.description.length > MAX_DESC_LEN) {
      return badRequest(`Description must be under ${MAX_DESC_LEN} characters`);
    }
    updated.description = body.description.trim();
  }
  if (body.theme != null) {
    const { mode, accent } = body.theme || {};
    if (mode != null && !VALID_MODES.includes(mode)) {
      return badRequest(`Theme mode must be one of: ${VALID_MODES.join(', ')}`);
    }
    if (accent != null && !HEX_RE.test(accent)) {
      return badRequest('Accent color must be a hex code like #E4572E');
    }
    updated.theme = { mode: mode || (canvas.theme && canvas.theme.mode) || 'dark', accent: accent || (canvas.theme && canvas.theme.accent) || null };
  }

  await env.BLOCKS_KV.put(`canvas:${params.id}`, JSON.stringify(updated));
  return jsonResponse({ ok: true, canvas: updated });
}

// DELETE /api/canvases/:id — admin only. Removes the canvas and every block
// claimed on it. If it belonged to a user, frees up their one-canvas slot.
export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!checkAdmin(request, env)) return unauthorized();
  const canvas = await getCanvas(env.BLOCKS_KV, params.id);
  if (!canvas) return notFound('Canvas not found');

  const blockKeys = await listAllKeys(env.BLOCKS_KV, `block:${params.id}:`);
  await Promise.all(blockKeys.map((k) => env.BLOCKS_KV.delete(k.name)));
  await env.BLOCKS_KV.delete(`canvas:${params.id}`);

  if (canvas.ownerSub) {
    const userRecord = await getUserRecord(env.BLOCKS_KV, canvas.ownerSub);
    if (userRecord.ownCanvasId === params.id) {
      userRecord.hasCreatedCanvas = false;
      userRecord.ownCanvasId = null;
      await putUserRecord(env.BLOCKS_KV, canvas.ownerSub, userRecord);
    }
  }

  return jsonResponse({ ok: true, deletedBlocks: blockKeys.length });
}

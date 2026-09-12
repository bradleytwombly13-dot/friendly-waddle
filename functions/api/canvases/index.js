import {
  jsonResponse,
  badRequest,
  unauthorized,
  forbidden,
  listCanvases,
  getSessionUser,
  getUserRecord,
  putUserRecord,
  STARTER_CANVASES,
  MAX_CUSTOM_CANVAS_AREA,
  MIN_CANVAS_DIM,
  MAX_CANVAS_DIM,
} from '../../_lib/common.js';

const MAX_NAME_LEN = 60;
const MAX_DESC_LEN = 300;

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'canvas'
  );
}

function checkAdmin(request, env) {
  const pw = request.headers.get('x-admin-password');
  return !!env.ADMIN_PASSWORD && pw === env.ADMIN_PASSWORD;
}

export async function onRequestGet(context) {
  const { env } = context;
  const canvases = await listCanvases(env.BLOCKS_KV);
  // Never leak ownerSub — it's an internal Google account identifier.
  const pub = canvases.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    width: c.width,
    height: c.height,
    isStarter: !!c.isStarter,
    ownerName: c.ownerName || null,
    theme: c.theme || null,
    createdAt: c.createdAt,
  }));
  return jsonResponse({ canvases: pub });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const isAdmin = checkAdmin(request, env);
  const session = isAdmin ? null : await getSessionUser(request, env);
  if (!isAdmin && !session) return unauthorized('Sign in to create a canvas');

  let record = null;
  if (!isAdmin) {
    record = await getUserRecord(env.BLOCKS_KV, session.sub);
    if (record.hasCreatedCanvas) {
      return forbidden("You've already created a canvas — one per account.");
    }
    const questComplete = STARTER_CANVASES.every((c) => (record.claimedStarters || []).includes(c.id));
    if (!questComplete) {
      return forbidden('Claim space on all three starter canvases first to unlock creating your own.');
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Bad request');
  }
  const { name, description, width, height } = body;

  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LEN) {
    return badRequest(`Name is required (max ${MAX_NAME_LEN} characters)`);
  }
  if (description != null && (typeof description !== 'string' || description.length > MAX_DESC_LEN)) {
    return badRequest(`Description is too long (max ${MAX_DESC_LEN} characters)`);
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < MIN_CANVAS_DIM ||
    height < MIN_CANVAS_DIM ||
    width > MAX_CANVAS_DIM ||
    height > MAX_CANVAS_DIM
  ) {
    return badRequest(`Width and height must be between ${MIN_CANVAS_DIM} and ${MAX_CANVAS_DIM}`);
  }
  // Admin-created canvases can use the full width×height allowance (already
  // bounded by MAX_CANVAS_DIM per side); self-serve canvases stay capped
  // lower so one account can't eat all of KV's storage.
  if (!isAdmin && width * height > MAX_CUSTOM_CANVAS_AREA) {
    return badRequest(`Canvas is too large — max ${MAX_CUSTOM_CANVAS_AREA.toLocaleString()} total pixels`);
  }

  const id = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;
  const canvas = {
    id,
    name: name.trim(),
    description: (description || '').trim(),
    width,
    height,
    isStarter: false,
    ownerSub: isAdmin ? null : session.sub,
    ownerName: isAdmin ? 'Admin' : session.name,
    ownerEmail: isAdmin ? null : session.email,
    createdAt: new Date().toISOString(),
  };
  await env.BLOCKS_KV.put(`canvas:${id}`, JSON.stringify(canvas));

  if (!isAdmin) {
    record.hasCreatedCanvas = true;
    record.ownCanvasId = id;
    await putUserRecord(env.BLOCKS_KV, session.sub, record);
  }

  return jsonResponse({ ok: true, canvas: { id, name: canvas.name, description: canvas.description, width, height } });
}

import { getSessionUser, getUserRecord, jsonResponse, STARTER_CANVASES } from '../_lib/common.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await getSessionUser(request, env);
  if (!session) {
    return jsonResponse({ loggedIn: false });
  }
  const record = await getUserRecord(env.BLOCKS_KV, session.sub);
  return jsonResponse({
    loggedIn: true,
    user: {
      email: session.email,
      name: session.name,
      hasCreatedCanvas: !!record.hasCreatedCanvas,
      ownCanvasId: record.ownCanvasId || null,
      claimedStarters: record.claimedStarters || [],
      starterCount: STARTER_CANVASES.length,
      questComplete: STARTER_CANVASES.every((c) => (record.claimedStarters || []).includes(c.id)),
    },
  });
}

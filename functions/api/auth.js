import {
  jsonResponse,
  badRequest,
  unauthorized,
  signSession,
  sessionCookieHeader,
  getUserRecord,
  putUserRecord,
} from '../_lib/common.js';

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// POST /api/auth — body: { credential: <Google ID token JWT> }
// Verifies the token against Google, then issues our own signed session cookie.
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SESSION_SECRET) {
    return jsonResponse({ error: 'Server is not configured for sign-in yet (missing SESSION_SECRET)' }, 500);
  }
  if (!env.GOOGLE_CLIENT_ID) {
    return jsonResponse({ error: 'Server is not configured for sign-in yet (missing GOOGLE_CLIENT_ID)' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Bad request');
  }
  const { credential } = body;
  if (!credential || typeof credential !== 'string') {
    return badRequest('Missing credential');
  }

  // Verify the Google ID token server-side. tokeninfo checks the signature,
  // issuer, and expiry for us — we still must check the audience ourselves.
  const verifyRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  );
  if (!verifyRes.ok) {
    return unauthorized('Invalid Google credential');
  }
  const claims = await verifyRes.json();

  if (claims.aud !== env.GOOGLE_CLIENT_ID) {
    return unauthorized('Token was not issued for this site');
  }
  if (claims.email_verified !== 'true' && claims.email_verified !== true) {
    return unauthorized('Google account email is not verified');
  }

  const sub = claims.sub;
  const email = claims.email;
  const name = claims.name || email;

  // Make sure a user record exists (first sign-in creates it).
  const existing = await getUserRecord(env.BLOCKS_KV, sub);
  if (!existing.email) {
    existing.email = email;
    existing.name = name;
    await putUserRecord(env.BLOCKS_KV, sub, existing);
  }

  const sessionToken = await signSession({ sub, email, name }, env.SESSION_SECRET);
  const cookie = sessionCookieHeader(sessionToken, SESSION_MAX_AGE);

  return jsonResponse(
    { ok: true, user: { email, name } },
    200,
    { 'Set-Cookie': cookie }
  );
}

// DELETE /api/auth — signs the user out by clearing the session cookie.
export async function onRequestDelete() {
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader('', 0) });
}

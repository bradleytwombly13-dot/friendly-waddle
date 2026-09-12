# The Pixel Canvas

A 10,000 × 10,000 px collaborative canvas. No money involved — claim a pixel or a block of pixels, draw or paint an image into it, and it's yours on the canvas, first come first served.

**Hosting: Cloudflare Pages only.** The frontend (`index.html`, `dev.html`) calls `/api/blocks` and `/api/admin`, answered by the Cloudflare Pages Functions in `functions/api/`, backed by Workers KV for storage.

## Deploy

1. **Create a KV namespace** — Cloudflare dashboard → **Workers & Pages** → **KV** → **Create namespace**. Name it anything (e.g. `pixel-canvas`).
2. **Create the Pages project** — **Workers & Pages** → **Create** → **Pages** → **Upload assets** (or "Use direct upload" → **Get started**, depending on what the dashboard shows). Drag this whole folder (or the zip) in, name it, finish.
3. **Bind the KV namespace** — open the project → **Settings** → **Bindings** (may appear under Settings → Functions on some dashboard versions) → **Add** → **KV namespace**:
   - Variable name: `BLOCKS_KV` (must match exactly)
   - KV namespace: the one from step 1
4. **Set the admin password** — **Settings** → **Environment variables** → add `ADMIN_PASSWORD`.
5. **Redeploy** — bindings and env vars only apply to deployments made after they're set.

## Pages

- `/index.html` — public site. Visitors drag-select (or click for a single pixel), draw in the pixel editor or convert an uploaded image into pixel art (for selections bigger than 10×10), and submit. It goes live on the canvas immediately.
- `/dev.html` — password-gated admin page. Lists everything claimed (artwork, coordinates, link) with a **Delete** button per item, a direct-add tool to place a block without going through the claim flow, and a **Reset everything** button for wiping the canvas.

## Data

Each block is a JSON record `{ id, x, y, w, h, image, url, tagline, email, status, createdAt }`, stored in Workers KV (`BLOCKS_KV`), one key per block id. The public `/api/blocks` endpoint strips `email` and `status` before returning data — only `/api/admin` (password-gated) sees the full record.

## Server-side validation

Since anyone can call `/api/blocks` directly (not just through the UI), all of the following are enforced **server-side**:
- Coordinates must be integers, in-bounds, and non-overlapping with existing claims.
- The uploaded artwork must be a `data:image/...` PNG under ~3MB.
- Links must be valid `http(s)://` URLs (blocks `javascript:` and other unsafe schemes).
- Tagline and email have length caps.

This is a no-money fork of a paid version of the same project — no pricing, payment, or purchase logic exists anywhere in this codebase.

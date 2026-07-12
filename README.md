# Lumo Dreams of Being a Real Human

An interactive telling of the short story *"Lumo Dreams of Being a Real Human"* by
**Lewi Hirvelä**. Each chapter plays a looping Arctic-aurora video behind the text.
Deployed as a **Cloudflare Worker (static assets)** at **lumodreams.lewihirvela.com**.

## Structure

```
public/            # everything served
  index.html       # cover → preface → 5 chapters → "The End" (scroll-snapped)
  styles.css       # arctic/aurora theme; per-chapter text-legibility variables
  app.js           # lazy, view-gated chapter videos + epilogue modal
  videos/*.mp4      # 480×480 looping clips (kebab-case)
  cover-and-back.png
wrangler.jsonc     # static-assets-only Worker (no Worker script)
```

Chapters are one full-viewport `<section>` each, snap-scrolled. The epilogue is an
optional modal, offered on the cover and again on the "The End" screen.

## Develop

```bash
npm install
npm run dev      # wrangler dev — local preview
```

Or just open `public/index.html` in a browser (autoplay of muted video works offline).

## Deploy

**Manual:** `npm run deploy` (`wrangler deploy`).

**Push-to-deploy (recommended):** connect this GitHub repo in the Cloudflare dashboard
→ *Workers & Pages* → *Create* → *Connect to Git*. Set the deploy command to
`npx wrangler deploy`. Every push to the default branch redeploys.

Add the custom domain **lumodreams.lewihirvela.com** under the Worker's
*Settings → Domains & Routes* (zone `lewihirvela.com`).

## Roadmap — v2 (not built)

Pre-recorded Gemini voice narration per chapter, word-by-word karaoke highlighting,
and audio-synced auto-scroll. The v1 markup keeps prose in a clean paragraph model;
`app.js` ships a `wordify()` scaffold (exposed as `window.__lumoWordify`) so the
highlighting layer can be added without a rewrite.
```

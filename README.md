# Lumo Dreams of Being a Real Human

An interactive telling of the short story *"Lumo Dreams of Being a Real Human"* by
**Lewi Hirvelä**. Each chapter plays a looping Arctic-aurora video behind the text.
Deployed as a **Cloudflare Worker (static assets)** at **lumodreams.lewihirvela.com**.

## Structure

```
public/            # everything served
  index.html       # cover → 5 chapters → epilogue → "The End" (scroll-snapped)
  styles.css       # arctic/aurora theme; per-chapter text-legibility variables
  app.js           # lazy, view-gated chapter videos + preface modal
  videos/*.mp4      # 480×480 looping clips (kebab-case)
  interactive-cover.png   # cover screen (title baked in)
  interactive-back.png    # "The End" + preface-modal backdrop (title-free sky)
wrangler.jsonc     # static-assets-only Worker (no Worker script)
```

Chapters are one full-viewport `<section>` each, snap-scrolled. The preface is an
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

## v2 — read-along narration

Pre-recorded Gemini TTS narration per chapter, with word-by-word highlighting and
auto-advance between chapters. It's **progressive enhancement**: if `public/audio/`
has no `manifest.json`, the site behaves exactly like v1. Once audio exists, a
"Read to me" toggle appears (`narration.js`); the current word glows in time with
the voice and each chapter flows into the next when its audio ends.

### Generate the audio

```
scripts/chapters.mjs             # narration text + per-paragraph [Mood]/[Expression]
scripts/generate-narration.mjs   # Gemini TTS → public/audio/*.mp3 + timing JSON
```

Each paragraph is synthesized separately (21 calls total) in the **Leda** voice with
a soft, whimsical, British-accented bedtime-story style; per-paragraph timings are
distributed within each paragraph's exact audio duration (Gemini TTS returns no
word timestamps, so we estimate — error stays bounded to one paragraph).

```bash
# needs a Google AI Studio key: https://aistudio.google.com/apikey
# PowerShell:
$env:GEMINI_API_KEY="your-key"
node scripts/generate-narration.mjs        # writes public/audio/*, then commit & push
```

Optional overrides (env vars): `GEMINI_TTS_VOICE` (e.g. `Achernar`, `Aoede`),
`GEMINI_TTS_ACCENT` (`british` | `nordic`), `GEMINI_TTS_MODEL`.

> Note: accent is steered by the prompt — Gemini has no dedicated British/Nordic
> voice, so `british` is reliable while `nordic` is only approximated. Audio is encoded
> as `.mp3` at 64kbps mono for optimized load times (generated as PCM and compressed
> via `@breezystack/lamejs`).

The v1 markup keeps prose in a clean paragraph model; `app.js`'s `wordify()`
(exposed as `window.__lumoWordify`) wraps every word — including italicised ones —
in spans so highlighting maps 1:1 to the generated timings.
```

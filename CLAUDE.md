# Lumo Dreams — Interactive Story Site

Build an interactive version of the short story **"Lumo Dreams of Being a Real Human"** by Lewi Hirvelä. Each chapter has a looping video playing **behind** the text. Deploys as a **Cloudflare Worker (static assets)** connected to **GitHub**, served at **lumodreams.com**.

## Source assets (in repo root)
- `Draft of Lumo Dreams of Being a Real Human.docx.pdf` — the story text (source of truth for chapter copy).
- `Cover-and-back.png` — 3600×2700 aurora cover. Title "Lumo Dreams / Of Being A Real Human" sits top-right; **empty sky on the left** is where a "The End" version goes.
- `videos/` — 480×480 square MP4s, ~6s each, meant to **loop** (`muted loop autoplay playsinline`).

## Chapters → videos (in reading order)
| # | Chapter | Video file |
|---|---------|-----------|
| — | Cover | `Cover-and-back.png` |
| 0 | Preface | *(no video — use cover image as bg, or a subtle static aurora)* |
| 1 | A Puppy's World | `videos/A Puppys World.mp4` |
| 2 | The Dream of Being Human | `videos/The Dream of Being Human.mp4` |
| 3 | Trials and Frustrations | `videos/Trials and Frustrations.mp4` |
| 4 | The Turning Point | `videos/The Turning Point.mp4` |
| 5 | The Realisation | `videos/The Realisation.mp4` |
| — | The End | `Cover-and-back.png` (styled with "The End" in the left empty space) |
| ★ | Epilogue | `videos/Epilogue.mp4` — **modal popup only** (see below) |

Unused/alternate files to ignore: `The Turning Poi nt 2.mp4`, `a9666840-….mp4`, `ce441594-….mp4`.

## Layout & style decisions
- **Video behind text (full-bleed).** Square 480×480 video scaled to `object-fit: cover` to fill the viewport. Add a dark scrim/gradient over the video so text stays readable.
- **Text legibility over video (user's explicit note):** use a **drop-shadow when text is white**, and a **glow when text is coloured**, tuned per chapter to whatever the underlying video needs. Keep this adjustable (CSS variable per section).
- **Cover screen** first: full `Cover-and-back.png`, a "Begin" affordance, and an option to read the Epilogue.
- **"The End" screen** last: reuse `Cover-and-back.png`, render "The End" in the empty left sky area.
- Mood: arctic / aurora / dreamy — deep blues, violet-green aurora accents, warm candle-gold for the title (matches cover).

## Interaction — v1 (build this first)
- **Manual, whole-page scroll** between chapters (one chapter = one full-viewport section; snap scrolling is a good fit).
- **Epilogue is an optional modal popup**, offered **at the start** (on the cover) and **again at the end** (on the "The End" screen). Not part of the main scroll flow.

## Interaction — v2 (later, note in code, don't build yet)
- Pre-recorded **Gemini voice** narration per chapter (audio files).
- **Text highlights word-by-word as it's spoken** (timed karaoke-style highlighting — pre-recorded audio + a timing map is the reliable path; live TTS not required).
- **Auto-scroll synced to the audio.** Keep the v1 markup structured (words in spans or a clean paragraph model) so highlighting/auto-scroll can be added without a rewrite.

## Hosting
- Cloudflare **Worker with static assets** (`wrangler.toml` with `[assets] directory = "./public"` or the current Workers Static Assets convention — check latest docs).
- Connect the GitHub repo to Cloudflare for push-to-deploy.
- Custom domain: **lumodreams.com** (add route / custom domain in Cloudflare; its own zone `lumodreams.com`). Previously served at lumodreams.lewihirvela.com.
- Videos total ~4MB — fine to serve as static assets.

## Suggested structure
```
/public
  index.html
  styles.css
  app.js
  /videos/*.mp4
  Cover-and-back.png
/src (or worker entry, if needed beyond static assets)
wrangler.toml
```
Note: video filenames contain spaces — URL-encode them or rename to kebab-case on copy into `/public/videos/`.

# Changelog

## 2026-07-12

- **Domain:** the site now lives at **lumodreams.com** (its own Cloudflare zone).
  Previously served at `lumodreams.lewihirvela.com`.
- Read-along narration: the currently-spoken sentence is now **bold** as well as
  gold-glowed.
- Fixed doubled narration ("Chapter… Chapter One") on chapter auto-advance.
- v2 read-along narration shipped: Gemini TTS (Leda voice, soft/whimsical British),
  per-sentence highlighting, background music, and a "Read to me" control panel.

## Earlier

- v1: cover → 5 chapters → epilogue → "The End", scroll-snapped, looping aurora
  video behind each chapter; optional preface modal; Turning Point video morph.
- Deployed as a Cloudflare Worker (static assets), push-to-deploy from GitHub.

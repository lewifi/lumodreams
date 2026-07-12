# Changelog — Narration & UX Refinements (v2)

This document details the codebase updates made to **Lumo Dreams** to support precise narration timing, pronunciation steering, layout toggle transitions, chapter-specific video sync, and visual effect transitions.

---

## 🎙️ 1. Audio Alignment & Pronunciation Engine
*   **Automatic timing aligner (`scripts/align-timings.mjs`):** 
    *   Created an offline Node.js alignment script that reads narration MP3s and calls `gemini-3.1-pro-preview` with base64 audio and text.
    *   Instructed the model with rules for phonetic alignment (3-decimal millisecond precision) and comando-mandated silence gaps.
    *   Configured the aligner script to support target filtering via command-line arguments (e.g. `node scripts/align-timings.mjs cover theend`) to prevent rate limits and save tokens.
    *   Equipped the script with markdown code fence stripping to safely extract raw JSON blocks from multimodal replies.
*   **Pronunciation steering overrides (`scripts/generate-narration.mjs`):**
    *   Configured text interceptors to phonetically substitute target names in text prompts sent to the Google TTS synthesis API:
        *   `"Lewi"` ➡️ `"Levee"`: Forces correct storyteller RP pronunciation (`"Leh-vee"`, as in *Chevy to the levee*) instead of the default `"Louie"` or `"Lee-vye"` (Levi).
        *   `"Lumo"` ➡️ `"Lumoh"`: Forces a distinct, rounded long `"oh"` ending (`"Loo-moh"`) rather than a clipped flat sound.
    *   *Note: Visual text on the screen is completely unaffected and remains spelled correctly (`"Lewi"`, `"Lumo"`).*

## 🌟 2. Snappy Karaoke UX & Snug Scrolling
*   **Magical Shimmer Highlight (`public/styles.css`):**
    *   Replaced the static gold text shadow on the active sentence (`.word.is-current`) with an animated golden metallic sheen.
    *   Utilizes a linear-gradient background, `-webkit-background-clip: text`, and a slow `6s` looping keyframe animation (`text-shimmer`).
    *   Fitted a dual-layered CSS `drop-shadow` filter glow to make the active sentence legible and visually striking.
*   **Timing Pre-caching (`public/narration.js`):**
    *   Added a `preloadAllTimings()` function inside `enable()`. When the reader triggers "Read to me", it pre-caches all timing `.json` files in memory, removing network fetch delays during chapter transitions.
*   **Scroll Snap Settle Delay (`public/narration.js`):**
    *   Delayed `playTrack(0)` by `600ms` when entering a new section. This pauses speech until snap transitions settle, keeping highlights positioned correctly.

## 🎬 3. Chapter-Specific Video & SFX Sync
*   **Chapter 3 Morph & Demorph Cueing (`public/index.html`, `public/narration.js`):**
    *   Added `data-morph-cue="squeezed"` and `data-demorph-cue="tired"` triggers on the Chapter 3 section.
    *   Paragraph 1 morphs the background video to the clothed version (`trials-and-frustrations-2.mp4`).
    *   Paragraph 2 (*"The family grew tired..."*) removes the `.is-morphed` class, triggering a `1600ms` opacity transition that cross-fades back to the first loop (`trials-and-frustrations.mp4`).
*   ** Nordic Ambient Low-Pass Filter (`public/narration.js`):**
    *   Routed all active music streams and background video sfx through a `1200Hz` BiquadFilterNode to muffle high frequencies and allow the voice-over to stand out.
*   **Chapter 1 & Epilogue Volume Profiles:**
    *   **Chapter 1:** Audio track (`a-puppys-world.mp4` / `lumo1.mp4`) is kept fully muted to prevent ambient noise clashes during the preface modal introduction.
    *   **Epilogue:** Added a fader loop. The sound fades up to `0.02` over `1s` when the Epilogue section is loaded, then after `1.5s` initiates a slow `15-second` linear fade-out to `0` and mutes the track.
    *   **Focus Safeguard:** Built a window focus and page visibility observer to mute all music and video sounds within `300ms` when the tab loses focus, and restore them when returning.

## 📐 4. Layout and Back-Page Control
*   **Split/Overlay Layout Toggle (`public/app.js`, `public/styles.css`):**
    *   Equipped the floating control panel with a layout toggle (`[ 📖 Split ]` / `[ 🖼 Overlay ]`).
    *   Overlay mode positions the panel at the bottom right. Split mode transitions the text column to a left split panel and slides the video loop to the right half of the screen using hardware-accelerated CSS transitions.
*   **Back-Page conclusion narration (`public/index.html`, `public/app.js`, `public/narration.js`):**
    *   Appended the final `"theend"` chapter definition.
    *   Treated `"theend"` as a single unified track (like `"cover"`) in the generation script to prevent eyebrow/title division build crashes.
    *   Allowed the final page (`#theend`) to be targeted by `wordify` and mapped its spoken timeline to `.theend-title .word`.

## 🌐 5. SEO, Google Analytics, and Git Maintenance
*   **Sharing Cards:** Added absolute Open Graph and Twitter Card tags pointing to your live asset: `https://lumodreams.com/og.png`.
*   **Google Analytics:** Integrated Gtag script `G-DG7PP06W0C` directly in the head.
*   **Git hygiene:** Ignored raw `.mov` draft assets, `.agents` caches, and large `.png` cover backups to keep repository clean.

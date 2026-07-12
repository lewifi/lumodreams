/* ============================================================
   Lumo Dreams — v2 read-along narration (progressive enhancement)

   If public/audio/manifest.json exists, this:
     - wraps every prose word in a <span class="word"> (via app.js wordify),
     - adds a "Read to me" toggle,
     - when enabled, narrates each chapter as it scrolls into view,
       glowing the current word in time with the audio,
     - auto-advances to the next chapter when a chapter's audio ends.

   If there is no audio yet, nothing here changes the page. Generate audio with
   scripts/generate-narration.mjs (see README).
   ============================================================ */

(function () {
  "use strict";

  const BASE = "audio/";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const normWord = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  let manifest = [];           // ordered chapter ids that have audio
  let enabled = false;         // narration mode on/off
  let playing = null;          // { id, spans, words, idx, raf }
  let loadingId = null;        // guards against double-starts
  let currentVisible = null;   // most-visible narratable section id
  const timingCache = new Map();

  const audio = new Audio();
  audio.preload = "auto";

  init();

  async function init() {
    try {
      const res = await fetch(BASE + "manifest.json", { cache: "no-cache" });
      if (!res.ok) return;
      manifest = await res.json();
    } catch {
      return; // no narration available — leave the site as-is
    }
    if (!Array.isArray(manifest) || manifest.length === 0) return;

    if (window.__lumoWordify) window.__lumoWordify(document);
    buildToggle();
    observeSections();
    audio.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && playing) audio.pause();
    });
  }

  /* ---------- UI toggle ---------- */
  let toggleBtn;
  function buildToggle() {
    toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "narrate-toggle";
    toggleBtn.setAttribute("aria-pressed", "false");
    setToggleLabel();
    toggleBtn.addEventListener("click", () => (enabled ? disable() : enable()));
    document.body.appendChild(toggleBtn);
  }
  function setToggleLabel() {
    toggleBtn.innerHTML = enabled
      ? '<span class="narrate-ico">❚❚</span> Stop reading'
      : '<span class="narrate-ico">▶</span> Read to me';
    toggleBtn.setAttribute("aria-label", enabled ? "Stop narration" : "Read the story aloud");
    toggleBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
    toggleBtn.classList.toggle("is-on", enabled);
  }

  function enable() {
    enabled = true;
    document.body.classList.add("narrating"); // app.js: narration owns morph timing
    setToggleLabel();
    const target =
      currentVisible && manifest.includes(currentVisible) ? currentVisible : manifest[0];
    if (currentVisible !== target) scrollToSection(target);
    playSection(target);
  }

  function disable() {
    enabled = false;
    document.body.classList.remove("narrating");
    setToggleLabel();
    stop();
    clearHighlights();
  }

  /* ---------- Which chapter is in view ---------- */
  function observeSections() {
    const ratios = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        let best = null, bestR = 0;
        for (const id of manifest) {
          const r = ratios.get(id) || 0;
          if (r > bestR) { bestR = r; best = id; }
        }
        if (best && bestR >= 0.55 && best !== currentVisible) {
          currentVisible = best;
          if (enabled && (!playing || playing.id !== best) && loadingId !== best) {
            playSection(best);
          }
        }
      },
      { threshold: [0, 0.55, 0.8] }
    );
    manifest.forEach((id) => {
      const s = document.getElementById(id);
      if (s) io.observe(s);
    });
  }

  /* ---------- Timing data ---------- */
  async function getTiming(id) {
    if (timingCache.has(id)) return timingCache.get(id);
    try {
      const res = await fetch(BASE + id + ".json", { cache: "force-cache" });
      if (!res.ok) return null;
      const data = await res.json();
      timingCache.set(id, data);
      return data;
    } catch {
      return null;
    }
  }

  /* ---------- Play / highlight ---------- */
  async function playSection(id) {
    if (playing && playing.id === id) return;
    loadingId = id;
    stop();
    const data = await getTiming(id);
    const section = document.getElementById(id);
    if (!data || !section || !enabled) { loadingId = null; return; }

    const spans = Array.from(section.querySelectorAll(".prose .word"));
    resetSpans(spans);

    // Video morph: start fresh on the primary clip, note when to crossfade.
    section.classList.remove("is-morphed");
    let morphAt = null;
    const cue = section.dataset.morphCue;
    if (cue && section.dataset.videoMorph) {
      const hit = data.words.find((w) => normWord(w.w) === normWord(cue));
      if (hit) morphAt = hit.s;
    }

    audio.src = BASE + id + ".wav";
    try {
      audio.currentTime = 0;
    } catch {}
    playing = { id, section, spans, words: data.words, idx: -1, morphAt, raf: 0 };

    try {
      await audio.play();
    } catch {
      playing = null;
      loadingId = null;
      return; // autoplay blocked; wait for another user gesture
    }
    loadingId = null;
    tick();
  }

  function tick() {
    if (!playing) return;
    const { words, spans } = playing;
    const t = audio.currentTime;
    if (playing.morphAt != null && t >= playing.morphAt) {
      if (window.__lumoTriggerMorph) window.__lumoTriggerMorph(playing.section);
      else playing.section.classList.add("is-morphed");
      playing.morphAt = null; // once
    }
    let i = playing.idx;
    while (i + 1 < words.length && t >= words[i + 1].s) i++;
    // clamp to available spans (should match, but stay safe)
    const maxI = Math.min(i, spans.length - 1);
    if (maxI !== playing.idx) {
      for (let k = Math.max(0, playing.idx); k < maxI; k++) {
        if (spans[k]) { spans[k].classList.add("is-spoken"); spans[k].classList.remove("is-current"); }
      }
      if (spans[maxI]) { spans[maxI].classList.add("is-current"); spans[maxI].classList.remove("is-spoken"); }
      playing.idx = maxI;
    }
    playing.raf = requestAnimationFrame(tick);
  }

  function onEnded() {
    if (!playing) return;
    playing.spans.forEach((s) => { s.classList.add("is-spoken"); s.classList.remove("is-current"); });
    const finishedId = playing.id;
    stop();
    if (!enabled) return;
    const next = manifest[manifest.indexOf(finishedId) + 1];
    if (next) {
      scrollToSection(next); // IntersectionObserver picks it up and plays it
    } else {
      scrollToSection("theend"); // gentle close
      enabled = false;
      document.body.classList.remove("narrating");
      setToggleLabel();
    }
  }

  function stop() {
    if (playing && playing.raf) cancelAnimationFrame(playing.raf);
    audio.pause();
    playing = null;
  }

  /* ---------- Highlight helpers ---------- */
  function resetSpans(spans) {
    spans.forEach((s) => s.classList.remove("is-spoken", "is-current"));
  }
  function clearHighlights() {
    document
      .querySelectorAll(".word.is-spoken, .word.is-current")
      .forEach((s) => s.classList.remove("is-spoken", "is-current"));
  }

  function scrollToSection(id) {
    const s = document.getElementById(id);
    if (s) s.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
})();

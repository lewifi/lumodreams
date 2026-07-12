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
  let suppressObserverUntil = 0; // ignore observer switches during programmatic scroll
  const timingCache = new Map();

  const audio = new Audio();
  audio.preload = "auto";

  /* ---------- Background Music ---------- */
  // Melodic music only bookends the story: lumo1 for the title, then a long
  // gradual fade to the Nordic ambience bed once chapter 1 begins, and lumo6
  // returns for the epilogue. Sections with no entry here run on ambience alone.
  const MUSIC_MAP = {
    "cover": "music/lumo1.mp3",
    "epilogue-ch": "music/lumo6.mp3"
  };

  const musicA = new Audio();
  const musicB = new Audio();
  musicA.loop = true;
  musicB.loop = true;
  musicA.volume = 0;
  musicB.volume = 0;
  musicA.preload = "auto";
  musicB.preload = "auto";

  let activeMusic = musicA;
  let inactiveMusic = musicB;
  let currentMusicUrl = null;
  let musicFadeInterval = null;

  const MUSIC_VOL = 0.04;         // melody level
  const MUSIC_LOWPASS_HZ = 1200;  // roll off highs so the music is warm/soft and sits back
  const MUSIC_FADEOUT_MS = 25000; // long gradual fade as chapter 1 begins

  // Route the two music elements through a shared low-pass filter (Web Audio).
  // Must be created after a user gesture (enable), and only once per element.
  let audioCtx = null;
  function ensureMusicGraph() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const lp = audioCtx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = MUSIC_LOWPASS_HZ;
      lp.connect(audioCtx.destination);
      [musicA, musicB].forEach((el) => audioCtx.createMediaElementSource(el).connect(lp));
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {
      audioCtx = null; // fall back to plain playback (no filter)
    }
  }

  function playMusic(url) {
    if (!enabled) return;
    if (currentMusicUrl === url) return; // Keep playing and looping seamlessly
    
    currentMusicUrl = url;
    
    const prevActive = activeMusic;
    activeMusic = inactiveMusic;
    inactiveMusic = prevActive;
    
    activeMusic.src = url;
    activeMusic.currentTime = 0;
    
    activeMusic.play().catch(() => {});
    
    let steps = 20;
    const duration = 2000; // 2 seconds cross-fade
    const intervalTime = duration / steps;
    const targetVolume = isMusicMuted ? 0 : MUSIC_VOL;
    
    if (musicFadeInterval) clearInterval(musicFadeInterval);
    
    musicFadeInterval = setInterval(() => {
      steps--;
      
      activeMusic.volume = Math.min(targetVolume, activeMusic.volume + (targetVolume / 20));
      inactiveMusic.volume = Math.max(0, inactiveMusic.volume - (targetVolume / 20));
      
      if (steps <= 0) {
        clearInterval(musicFadeInterval);
        inactiveMusic.pause();
        inactiveMusic.volume = 0;
        activeMusic.volume = targetVolume;
      }
    }, intervalTime);
  }

  function fadeOutMusic(duration = MUSIC_FADEOUT_MS) {
    currentMusicUrl = null;
    if (musicFadeInterval) clearInterval(musicFadeInterval);
    const startA = musicA.volume;
    const startB = musicB.volume;
    if (startA <= 0 && startB <= 0) { musicA.pause(); musicB.pause(); return; }

    const steps = Math.max(1, Math.round(duration / 100)); // ~100 ms per step
    let step = 0;
    musicFadeInterval = setInterval(() => {
      step++;
      const k = Math.max(0, 1 - step / steps); // linear ramp to 0
      musicA.volume = startA * k;
      musicB.volume = startB * k;
      if (step >= steps) {
        clearInterval(musicFadeInterval);
        musicFadeInterval = null;
        musicA.pause();
        musicB.pause();
        musicA.volume = 0;
        musicB.volume = 0;
      }
    }, 100);
  }

  /* ---------- Nordic ambience bed (plays under everything) ---------- */
  const ambience = new Audio();
  ambience.loop = true;
  ambience.preload = "auto";
  ambience.src = "music/nordic-ambience.mp3";
  ambience.volume = 0;
  const AMBIENCE_UNDER_MUSIC = 0.05; // ducked while a melody plays
  const AMBIENCE_LEAD = 0.1;         // main bed when no melody (middle chapters)
  let ambienceTarget = 0;
  let ambienceFade = null;

  function rampAmbience() {
    if (ambienceFade) clearInterval(ambienceFade);
    ambienceFade = setInterval(() => {
      const tgt = isMusicMuted ? 0 : ambienceTarget;
      const cur = ambience.volume;
      const step = 0.008;
      if (Math.abs(cur - tgt) <= step) {
        ambience.volume = tgt;
        clearInterval(ambienceFade);
        ambienceFade = null;
        if (tgt === 0) ambience.pause();
      } else {
        ambience.volume = Math.max(0, Math.min(1, cur + (tgt > cur ? step : -step)));
      }
    }, 60);
  }
  function setAmbience(target) {
    ambienceTarget = target;
    if (target > 0 && ambience.paused && !isMusicMuted && !isPaused) {
      ambience.play().catch(() => {});
    }
    rampAmbience();
  }

  // Set the melody (crossfade) and ambience level for a section in one place.
  function updateMusic(id) {
    if (!enabled) return;
    if (MUSIC_MAP[id]) {
      playMusic(MUSIC_MAP[id]);
      setAmbience(AMBIENCE_UNDER_MUSIC);
    } else {
      fadeOutMusic();
      setAmbience(AMBIENCE_LEAD);
    }
  }

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

    // Intercept cover/scroll links to scroll programmatically and mute observer
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      const targetId = anchor.getAttribute("href").slice(1);
      if (manifest.includes(targetId) || targetId === "theend") {
        anchor.addEventListener("click", (e) => {
          e.preventDefault();
          scrollToSection(targetId);
        });
      }
    });
    // Drive highlighting from the media clock, not rAF — this stays in sync when
    // the tab is backgrounded or the window is unfocused (rAF throttles/stops),
    // and it automatically pauses/resumes with the audio.
    audio.addEventListener("timeupdate", updateHighlight);
    let wasPlayingBeforeHide = false;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (playing && !audio.paused) {
          audio.pause();
          wasPlayingBeforeHide = true;
        }
        if (activeMusic && !activeMusic.paused) {
          activeMusic.pause();
        }
        if (!ambience.paused) ambience.pause();
      } else {
        if (wasPlayingBeforeHide && playing && !isPaused) {
          audio.play().catch(() => {});
          wasPlayingBeforeHide = false;
        }
        if (enabled && activeMusic && activeMusic.paused && currentMusicUrl && !isMusicMuted && !isPaused) {
          activeMusic.play().catch(() => {});
        }
        if (enabled && ambience.paused && ambienceTarget > 0 && !isMusicMuted && !isPaused) {
          ambience.play().catch(() => {});
        }
      }
    });

    // Preface modal narration: when read-along is on and the modal opens, narrate
    // it (playSection no-ops if there is no preface audio). Stop when it closes.
    document.addEventListener("preface:open", () => {
      if (enabled) playSection("preface");
    });
    document.addEventListener("preface:close", () => {
      if (playing && playing.id === "preface") {
        stop();
        clearHighlights();
      }
    });
  }

  /* ---------- UI toggle ---------- */
  let panelContainer;
  let startBtn;
  let controlsDiv;
  let pauseBtn;
  let musicBtn;
  let stopBtn;

  let isPaused = false;
  let isMusicMuted = false;

  function buildToggle() {
    panelContainer = document.createElement("div");
    panelContainer.className = "narrate-panel is-intro"; // starts as a big centred pill

    startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "narrate-toggle";
    startBtn.innerHTML = '<span class="narrate-ico">▶</span> Narrate it to me';
    startBtn.addEventListener("click", enable);
    panelContainer.appendChild(startBtn);

    controlsDiv = document.createElement("div");
    controlsDiv.className = "narrate-controls";
    controlsDiv.style.display = "none";

    pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.className = "narrate-btn";
    pauseBtn.innerHTML = '⏸ Pause';
    pauseBtn.addEventListener("click", togglePause);
    controlsDiv.appendChild(pauseBtn);

    musicBtn = document.createElement("button");
    musicBtn.type = "button";
    musicBtn.className = "narrate-btn";
    musicBtn.innerHTML = '🔊 Music';
    musicBtn.addEventListener("click", toggleMusic);
    controlsDiv.appendChild(musicBtn);

    stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "narrate-btn";
    stopBtn.innerHTML = '⏹ Stop';
    stopBtn.addEventListener("click", disable);
    controlsDiv.appendChild(stopBtn);

    panelContainer.appendChild(controlsDiv);
    document.body.appendChild(panelContainer);

    positionIntro();
    window.addEventListener("resize", () => {
      if (panelContainer.classList.contains("is-intro")) positionIntro();
    });
  }

  // Place the large intro pill centred, just above the cover's action buttons.
  // The panel rests at the bottom-right corner; we translate it up to the intro
  // spot, then enable() clears the transform so it flies back to the corner.
  function positionIntro() {
    panelContainer.style.transition = "none";
    panelContainer.style.transform = "none";
    const r = panelContainer.getBoundingClientRect();
    const targetX = window.innerWidth / 2;
    let targetY = window.innerHeight * 0.62;
    // Anchor above the byline/buttons so the pill never covers the author name.
    const anchor = document.querySelector(".cover-content .byline") ||
      document.querySelector(".cover-actions");
    if (anchor) {
      const ar = anchor.getBoundingClientRect();
      if (ar.top > 0) targetY = ar.top - r.height / 2 - 20;
    }
    targetY = Math.max(window.innerHeight * 0.14, targetY); // keep it on screen
    const dx = Math.round(targetX - (r.left + r.width / 2));
    const dy = Math.round(targetY - (r.top + r.height / 2));
    panelContainer.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => { panelContainer.style.transition = ""; });
  }

  function togglePause() {
    if (!playing) return;
    
    isPaused = !isPaused;
    if (isPaused) {
      audio.pause();
      if (activeMusic) activeMusic.pause();
      ambience.pause();
      pauseBtn.innerHTML = '▶ Resume';
      pauseBtn.classList.add("is-active");
    } else {
      audio.play().catch(() => {});
      if (activeMusic && !isMusicMuted) activeMusic.play().catch(() => {});
      if (!isMusicMuted && ambienceTarget > 0) ambience.play().catch(() => {});
      pauseBtn.innerHTML = '⏸ Pause';
      pauseBtn.classList.remove("is-active");
    }
  }

  function toggleMusic() {
    isMusicMuted = !isMusicMuted;
    if (isMusicMuted) {
      musicA.volume = 0;
      musicB.volume = 0;
      musicA.pause();
      musicB.pause();
      ambience.pause();
      musicBtn.innerHTML = '🔇 Mute';
      musicBtn.classList.add("is-active");
    } else {
      musicBtn.innerHTML = '🔊 Music';
      musicBtn.classList.remove("is-active");
      if (enabled) {
        if (activeMusic) {
          activeMusic.volume = MUSIC_VOL;
          activeMusic.play().catch(() => {});
        }
        if (ambienceTarget > 0) {
          ambience.play().catch(() => {});
          rampAmbience();
        }
      }
    }
  }

  function getActiveSection() {
    let best = null;
    let bestVisibleHeight = -1;
    for (const id of manifest) {
      const el = document.getElementById(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const visibleTop = Math.max(0, rect.top);
      const visibleBottom = Math.min(window.innerHeight, rect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      if (visibleHeight > bestVisibleHeight) {
        bestVisibleHeight = visibleHeight;
        best = id;
      }
    }
    return best;
  }

  function enable() {
    enabled = true;
    isPaused = false;
    ensureMusicGraph(); // set up the high-pass routing (needs this user gesture)
    document.body.classList.add("narrating");

    // Swap the big intro pill for the controls, then fly the panel to the corner:
    // clearing the intro transform lets the CSS transition animate it home.
    startBtn.style.display = "none";
    controlsDiv.style.display = "flex";
    pauseBtn.innerHTML = '⏸ Pause';
    pauseBtn.classList.remove("is-active");
    panelContainer.classList.remove("is-intro");
    panelContainer.style.transform = "";

    const target = getActiveSection() || manifest[0];
    currentVisible = target;
    playSection(target); // starts section audio + music/ambience (updateMusic)
  }

  function disable() {
    enabled = false;
    isPaused = false;
    document.body.classList.remove("narrating");

    controlsDiv.style.display = "none";
    startBtn.innerHTML = '<span class="narrate-ico">▶</span> Read to me'; // compact corner restart
    startBtn.style.display = "flex";

    stop();
    clearHighlights();
    fadeOutMusic();
    setAmbience(0);
  }

  /* ---------- Which chapter is in view ---------- */
  function observeSections() {
    const ratios = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        // During an auto-advance scroll the outgoing section is transiently the
        // "most visible" — ignore switches until the programmatic scroll settles,
        // so we don't double-start the next chapter's narration.
        if (performance.now() < suppressObserverUntil) return;
        let best = null, bestR = 0;
        for (const id of manifest) {
          const r = ratios.get(id) || 0;
          if (r > bestR) { bestR = r; best = id; }
        }
        if (best && bestR >= 0.3 && best !== currentVisible) {
          currentVisible = best;
          if (enabled && (!playing || playing.id !== best) && loadingId !== best) {
            playSection(best); // handles music + ambience via updateMusic
          }
        }
      },
      { threshold: [0, 0.3, 0.8] }
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
    if (loadingId === id) return; // already loading this section — don't start twice
    loadingId = id;
    stop();

    const section = document.getElementById(id);
    if (!section || !enabled) { loadingId = null; return; }

    // Build the list of potential subtracks to play
    const candidateTracks = [];
    if (id !== "cover") {
      const eyebrow = section.querySelector(".eyebrow");
      if (eyebrow) {
        candidateTracks.push({ suffix: "-eyebrow", selector: ".eyebrow .word" });
      }
      const h2 = section.querySelector("h2");
      if (h2) {
        candidateTracks.push({ suffix: "-title", selector: "h2 .word" });
      }
    }
    // Main body track
    candidateTracks.push({ suffix: "", selector: ".prose .word" });

    // Fetch timing data for all candidate tracks that are actually generated
    const tracks = [];
    for (const cand of candidateTracks) {
      const timing = await getTiming(id + cand.suffix);
      if (timing) {
        const spans = Array.from(section.querySelectorAll(cand.selector));
        tracks.push({
          suffix: cand.suffix,
          spans,
          words: timing.words,
        });
      }
    }

    if (tracks.length === 0) { loadingId = null; return; }

    // Check for video morph cue on the main body track
    let morphAt = null;
    const cue = section.dataset.morphCue;
    if (cue && section.dataset.videoMorph) {
      const bodyTrack = tracks.find((t) => t.suffix === "");
      if (bodyTrack) {
        const hit = bodyTrack.words.find((w) => normWord(w.w) === normWord(cue));
        if (hit) morphAt = hit.s;
      }
    }

    section.classList.remove("is-morphed");

    playing = {
      id,
      section,
      tracks,
      trackIdx: 0,
      spans: tracks[0].spans,
      words: tracks[0].words,
      idx: -1,
      morphAt,
    };

    loadingId = null;
    playTrack(0);
    updateMusic(id);
  }

  async function playTrack(idx) {
    if (!playing || idx >= playing.tracks.length) {
      onSectionComplete();
      return;
    }

    playing.trackIdx = idx;
    const track = playing.tracks[idx];
    playing.spans = track.spans;
    playing.words = track.words;
    playing.idx = -1;
    resetSpans(playing.spans);

    audio.src = BASE + playing.id + track.suffix + ".mp3";
    try {
      audio.currentTime = 0;
    } catch {}

    try {
      await audio.play();
    } catch {
      stop();
      return; // autoplay blocked
    }
    updateHighlight(); // highlight the first sentence; timeupdate drives the rest
  }

  function updateHighlight() {
    if (!playing) return;
    const { words, spans, trackIdx, tracks } = playing;
    const currentTrack = tracks[trackIdx];
    const t = audio.currentTime;
    // Video morph ONLY triggers when the main body track is active (suffix === "")
    if (currentTrack.suffix === "" && playing.morphAt != null && t >= playing.morphAt) {
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
      if (spans[maxI]) {
        spans[maxI].classList.add("is-current");
        spans[maxI].classList.remove("is-spoken");
        
        // Auto-scroll the word into the center of the viewport if needed
        const viewportHeight = window.innerHeight;
        const rect = spans[maxI].getBoundingClientRect();
        if (rect.bottom > viewportHeight * 0.75 || rect.top < viewportHeight * 0.25) {
          const isInModal = playing.section.closest(".modal");
          if (isInModal || playing.section.offsetHeight > viewportHeight) {
            scrollWordIntoView(spans[maxI]);
          }
        }
      }
      playing.idx = maxI;
    }
  }

  function onEnded() {
    if (!playing) return;
    playing.spans.forEach((s) => { s.classList.add("is-spoken"); s.classList.remove("is-current"); });
    
    // Play next track in the queue for this chapter section if there is one
    if (playing.trackIdx + 1 < playing.tracks.length) {
      playTrack(playing.trackIdx + 1);
      return;
    }

    onSectionComplete();
  }

  function onSectionComplete() {
    if (!playing) return;
    const finishedId = playing.id;
    stop();
    if (!enabled) return;
    // Standalone sections (e.g. the preface modal) aren't in the flow — don't advance.
    if (manifest.indexOf(finishedId) === -1) return;
    const next = manifest[manifest.indexOf(finishedId) + 1];
    if (next) {
      currentVisible = next;
      scrollToSection(next);
      playSection(next);
    } else {
      scrollToSection("theend"); // gentle close
      enabled = false;
      document.body.classList.remove("narrating");
      setToggleLabel();
    }
  }

  function stop() {
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
    if (s) {
      // Mute observer-driven section switches for the duration of this scroll.
      suppressObserverUntil = performance.now() + (reduceMotion ? 200 : 1500);
      currentVisible = id; // set immediately so observer doesn't trigger on intermediate positions
      s.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  /* ---------- Slow, custom smooth scroll ---------- */
  let activeScrollAnimation = null;

  function animateScrollTo(container, targetScrollTop, duration = 800) {
    if (activeScrollAnimation && activeScrollAnimation.container === container) {
      cancelAnimationFrame(activeScrollAnimation.rafId);
    }

    const startScrollTop = container.scrollTop;
    const distance = targetScrollTop - startScrollTop;
    if (Math.abs(distance) < 2) return; // already close enough

    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing: easeInOutQuad
      const ease = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      container.scrollTop = startScrollTop + distance * ease;

      if (progress < 1) {
        activeScrollAnimation.rafId = requestAnimationFrame(step);
      } else {
        activeScrollAnimation = null;
      }
    }

    activeScrollAnimation = {
      container,
      rafId: requestAnimationFrame(step)
    };
  }

  function getScrollContainer(element) {
    const isInModal = element.closest(".modal");
    if (isInModal) {
      return isInModal.querySelector(".modal-body") || isInModal;
    }
    return document.getElementById("story");
  }

  function getOffsetTopRelativeTo(element, ancestor) {
    let offsetTop = 0;
    let curr = element;
    while (curr && curr !== ancestor) {
      offsetTop += curr.offsetTop;
      curr = curr.offsetParent;
    }
    return offsetTop;
  }

  function scrollWordIntoView(wordSpan) {
    const container = getScrollContainer(wordSpan);
    if (!container) return;

    const offsetTop = getOffsetTopRelativeTo(wordSpan, container);
    const targetScrollTop = Math.max(0, Math.min(
      offsetTop - (container.clientHeight / 2) + (wordSpan.clientHeight / 2),
      container.scrollHeight - container.clientHeight
    ));

    if (reduceMotion) {
      container.scrollTop = targetScrollTop;
      return;
    }

    // Slow and smooth animation (800ms)
    animateScrollTo(container, targetScrollTop, 800);
  }
})();

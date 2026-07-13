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
  let startTimer = null;       // settle timer that starts a section's first track
  let currentVisible = null;   // most-visible narratable section id
  let suppressObserverUntil = 0; // ignore observer switches during programmatic scroll
  const timingCache = new Map();
  let epilogueFaded = false;
  let scrollLoopRaf = null;
  let isProgrammaticScrolling = false;

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
  const VIDEO_SFX_VOL = 0.02;     // separate volume level for video SFX
  const MUSIC_LOWPASS_HZ = 1200;  // roll off highs so the music is warm/soft and sits back
  const MUSIC_FADEOUT_MS = 90000; // long gradual fade as chapter 1 begins

  // Route the audio elements through a shared low-pass filter (Web Audio).
  // Must be created after a user gesture (enable), and only once per element.
  let audioCtx = null;
  let lpFilter = null;
  const activeVideoFades = new Map();

  function ensureMusicGraph() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      lpFilter = audioCtx.createBiquadFilter();
      lpFilter.type = "lowpass";
      lpFilter.frequency.value = MUSIC_LOWPASS_HZ;
      lpFilter.connect(audioCtx.destination);
      [musicA, musicB].forEach((el) => audioCtx.createMediaElementSource(el).connect(lpFilter));
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {
      audioCtx = null; // fall back to plain playback (no filter)
      lpFilter = null;
    }
  }

  function connectVideoToAudioGraph(v) {
    if (!audioCtx || !lpFilter) return;
    if (v._routedToWebAudio) return;
    try {
      const source = audioCtx.createMediaElementSource(v);
      source.connect(lpFilter);
      v._routedToWebAudio = true;
    } catch (err) {
      console.warn("Failed to connect video to Web Audio graph:", err);
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
      syncVideoVolumes(300);
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
    const scrim = document.createElement("div");
    scrim.className = "narrate-scrim";
    document.body.appendChild(scrim);

    panelContainer = document.createElement("div");
    panelContainer.className = "narrate-panel is-intro"; // starts as a big centred pill

    startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "narrate-toggle";
    startBtn.innerHTML = '<span class="narrate-ico">▶</span> Read to me';
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

  function fadeVideoVolume(section, targetVol, duration = 1500) {
    if (!section) return;
    
    if (activeVideoFades.has(section)) {
      clearInterval(activeVideoFades.get(section));
      activeVideoFades.delete(section);
    }

    const videos = [section._video, section._videoMorph].filter(Boolean);
    if (videos.length === 0) return;

    // Connect to Web Audio graph (low-pass filter) once active (except for mute-only tracks)
    videos.forEach((v) => {
      const isMutedTrack = v.src.includes("a-puppys-world.mp4") || v.src.includes("lumo1.mp4");
      if (!isMutedTrack) {
        connectVideoToAudioGraph(v);
      }
    });

    const startVols = videos.map((v) => {
      const isMutedTrack = v.src.includes("a-puppys-world.mp4") || v.src.includes("lumo1.mp4");
      return (v.muted || isMutedTrack) ? 0 : v.volume;
    });
    
    if (targetVol > 0) {
      videos.forEach((v) => {
        const isMutedTrack = v.src.includes("a-puppys-world.mp4") || v.src.includes("lumo1.mp4");
        v.muted = isMutedTrack;
        if (v.volume === 0) v.volume = 0;
      });
    }

    const steps = 15;
    const intervalTime = duration / steps;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      const progress = step / steps;
      
      videos.forEach((v, idx) => {
        const isMutedTrack = v.src.includes("a-puppys-world.mp4") || v.src.includes("lumo1.mp4");
        if (isMutedTrack) {
          v.volume = 0;
          v.muted = true;
          return;
        }
        const start = startVols[idx];
        const currentVal = start + (targetVol - start) * progress;
        v.volume = Math.max(0, Math.min(1, currentVal));
      });

      if (step >= steps) {
        clearInterval(interval);
        activeVideoFades.delete(section);
        
        videos.forEach((v) => {
          const isMutedTrack = v.src.includes("a-puppys-world.mp4") || v.src.includes("lumo1.mp4");
          if (isMutedTrack) {
            v.volume = 0;
            v.muted = true;
          } else {
            v.volume = targetVol;
            if (targetVol === 0) {
              v.muted = true;
            }
          }
        });
      }
    }, intervalTime);

    activeVideoFades.set(section, interval);
  }

  function syncVideoVolumes(fadeDuration = 1500) {
    const activeSectionId = currentVisible;
    const isVoicePlaying = enabled && !isPaused && !isMusicMuted && !document.hidden;
    
    document.querySelectorAll(".chapter").forEach((section) => {
      let targetVol = 0;
      if (section.id === activeSectionId && isVoicePlaying) {
        if (section.id === "epilogue-ch" && epilogueFaded) {
          targetVol = 0;
        } else {
          targetVol = VIDEO_SFX_VOL;
        }
      }
      fadeVideoVolume(section, targetVol, fadeDuration);
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
    document.body.classList.toggle("narration-paused", isPaused);
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
    updateVideoMuteState();
  }

  function toggleMusic() {
    isMusicMuted = !isMusicMuted;
    document.body.classList.toggle("music-muted", isMusicMuted);
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
    syncVideoVolumes();
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

  function preloadAllTimings() {
    manifest.forEach((id) => {
      getTiming(id).catch(() => {});
      getTiming(id + "-eyebrow").catch(() => {});
      getTiming(id + "-title").catch(() => {});
    });
  }

  function enable() {
    enabled = true;
    isPaused = false;
    ensureMusicGraph(); // set up the high-pass routing (needs this user gesture)
    document.body.classList.add("narrating");
    document.body.classList.remove("narration-paused");
    panelContainer.style.display = ""; // ensure the panel is visible (it's hidden at The End)

    // Turn off mandatory scroll-snap while narrating — the code drives all
    // scrolling (auto-advance + follow the sentence), and snap otherwise yanks
    // an intra-chapter scroll back to the chapter start.
    const storyEl = document.getElementById("story");
    if (storyEl) { storySnapBase = "none"; storyEl.style.scrollSnapType = "none"; }

    // Swap the big intro pill for the controls, then fly the panel to the corner:
    // clearing the intro transform lets the CSS transition animate it home.
    startBtn.style.display = "none";
    controlsDiv.style.display = "flex";
    pauseBtn.innerHTML = '⏸ Pause';
    pauseBtn.classList.remove("is-active");
    panelContainer.classList.remove("is-intro");
    panelContainer.style.transform = "";

    preloadAllTimings();

    const target = getActiveSection() || manifest[0];
    currentVisible = target;
    playSection(target); // starts section audio + music/ambience (updateMusic)
    syncVideoVolumes();
  }

  function updateStartButtonLabel() {
    if (enabled) return;
    startBtn.innerHTML = '<span class="narrate-ico">▶</span> Read to me';
  }

  // Show/position the floating pill for the given section (when not narrating).
  // At "The End" the pill is hidden — the in-page "Back to the beginning" button
  // is the single restart affordance; the pill returns once we're back on top.
  function refreshIntroPanel(id) {
    if (enabled) { panelContainer.style.display = ""; return; }
    if (id === "theend") { panelContainer.style.display = "none"; return; }
    panelContainer.style.display = "";
    if (id === "cover") {
      panelContainer.classList.add("is-intro");
      positionIntro();
    } else {
      panelContainer.classList.remove("is-intro");
      panelContainer.style.transform = "";
    }
    updateStartButtonLabel();
  }

  function disable() {
    enabled = false;
    isPaused = false;
    document.body.classList.remove("narrating");
    document.body.classList.remove("narration-paused");

    controlsDiv.style.display = "none";
    startBtn.style.display = "flex";

    stop();
    clearHighlights();
    fadeOutMusic();
    setAmbience(0);
    syncVideoVolumes();
    // Restore mandatory scroll-snap for manual reading.
    const storyEl = document.getElementById("story");
    if (storyEl) { storySnapBase = ""; storyEl.style.scrollSnapType = ""; }
    refreshIntroPanel(currentVisible); // hides the pill at "The End"
  }

  /* ---------- Which chapter is in view ---------- */
  function observeSections() {
    const ratios = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        // Ignore switches during programmatic scrolls so we don't double-start chapters
        if (isProgrammaticScrolling || performance.now() < suppressObserverUntil) return;
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
          if (!enabled) refreshIntroPanel(best);
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
      const res = await fetch(BASE + id + ".json", { cache: "no-cache" });
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
    const bodySelector = id === "theend" ? ".theend-title .word" : ".prose .word";
    candidateTracks.push({ suffix: "", selector: bodySelector });

    // Fetch timing data for all candidate tracks that are actually generated
    const tracks = [];
    for (const cand of candidateTracks) {
      const timing = await getTiming(id + cand.suffix);
      if (timing) {
        // Group spans into sentences: an inline element (e.g. <em>) splits one
        // sentence into several .word spans, but there's one timing per sentence,
        // so we map sentence-groups -> words (keeps counts aligned).
        const spans = groupSpansBySentence(Array.from(section.querySelectorAll(cand.selector)));
        tracks.push({
          suffix: cand.suffix,
          spans,
          words: timing.words,
          duration: timing.duration,
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
        // Since words timing uses full sentences, check if the sentence contains the cue word
        const hit = bodyTrack.words.find((w) =>
          w.w.toLowerCase().includes(cue.toLowerCase())
        );
        if (hit) morphAt = hit.s;
      }
    }

    // Check for video demorph cue on the main body track
    let demorphAt = null;
    const demorphCue = section.dataset.demorphCue;
    if (demorphCue && section.dataset.videoMorph) {
      const bodyTrack = tracks.find((t) => t.suffix === "");
      if (bodyTrack) {
        const hit = bodyTrack.words.find((w) =>
          w.w.toLowerCase().includes(demorphCue.toLowerCase())
        );
        if (hit) demorphAt = hit.s;
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
      demorphAt,
    };

    loadingId = null;
    updateMusic(id);

    // Start the first track after a short settle. Tie the timer to THIS play
    // instance so a stray second setup can't fire the eyebrow twice ("Chapter…
    // Chapter One"). `started` guards against any duplicate timer.
    const myPlaying = playing;
    if (startTimer) clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      startTimer = null;
      if (enabled && playing === myPlaying && !playing.started && playing.trackIdx === 0) {
        playing.started = true;
        playTrack(0);
      }
    }, 600);
    
    if (id === "epilogue-ch") {
      epilogueFaded = false;
      fadeVideoVolume(section, VIDEO_SFX_VOL, 1000);
      setTimeout(() => {
        if (currentVisible === "epilogue-ch" && enabled && !isPaused) {
          fadeVideoVolume(section, 0, 15000);
          epilogueFaded = true;
        }
      }, 1500);
    } else {
      syncVideoVolumes();
    }
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
    // Video demorph (fade back to original video loop)
    if (currentTrack.suffix === "" && playing.demorphAt != null && t >= playing.demorphAt) {
      playing.section.classList.remove("is-morphed");
      playing.demorphAt = null; // once
    }
    let i = playing.idx;
    while (i + 1 < words.length && t >= words[i + 1].s) i++;
    // clamp to available sentence-groups (should match, but stay safe)
    const maxI = Math.min(i, spans.length - 1);
    if (maxI !== playing.idx) {
      for (let k = Math.max(0, playing.idx); k < maxI; k++) {
        setGroupClass(spans[k], "is-spoken", true);
        setGroupClass(spans[k], "is-current", false);
      }
      if (spans[maxI]) {
        setGroupClass(spans[maxI], "is-current", true);
        setGroupClass(spans[maxI], "is-spoken", false);

        const group = spans[maxI];
        const firstSpan = group[0];
        const lastSpan = group[group.length - 1];
        const viewportHeight = window.innerHeight;
        const bottom = lastSpan.getBoundingClientRect().bottom;
        if (bottom > viewportHeight * 0.78) {
          const isInModal = playing.section.closest(".modal");
          if (isInModal || playing.section.offsetHeight > viewportHeight) {
            scrollWordIntoView(firstSpan);
          }
        }
      }
      playing.idx = maxI;
    }
  }

  function onEnded() {
    if (!playing) return;
    playing.spans.flat().forEach((s) => { s.classList.add("is-spoken"); s.classList.remove("is-current"); });
    
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
      scrollToSection(next, () => {
        playSection(next);
      });
    } else {
      disable(); // last section done — hides the pill (see refreshIntroPanel)
    }
  }

  function stop() {
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    audio.pause();
    playing = null;
    document.querySelectorAll(".chapter").forEach((s) => s.classList.remove("is-morphed"));
  }



  /* ---------- Highlight helpers ---------- */
  // Group consecutive .word spans into sentences. A span ends a sentence when its
  // trimmed text ends in . ! or ? (optionally + closing quote/bracket). Spans that
  // don't (e.g. "…whispering," before an italic phrase) merge with what follows,
  // so N spans collapse to the number of timed sentences.
  function groupSpansBySentence(rawSpans) {
    const groups = [];
    let cur = [];
    for (const sp of rawSpans) {
      cur.push(sp);
      if (/[.!?]["'”’)\]]*$/.test(sp.textContent.trim())) { groups.push(cur); cur = []; }
    }
    if (cur.length) groups.push(cur); // trailing group with no end punctuation (e.g. a title)
    return groups;
  }
  function setGroupClass(group, cls, on) {
    if (!group) return;
    for (const sp of group) { if (on) sp.classList.add(cls); else sp.classList.remove(cls); }
  }
  function resetSpans(spans) {
    spans.flat().forEach((s) => s.classList.remove("is-spoken", "is-current"));
  }
  function clearHighlights() {
    document
      .querySelectorAll(".word.is-spoken, .word.is-current")
      .forEach((s) => s.classList.remove("is-spoken", "is-current"));
  }

  function scrollToSection(id, onDone) {
    const s = document.getElementById(id);
    if (!s) { if (onDone) onDone(); return; }
    
    isProgrammaticScrolling = true;
    suppressObserverUntil = performance.now() + (reduceMotion ? 200 : 1600);
    currentVisible = id; // set immediately so observer doesn't trigger on intermediate positions
    
    const finish = () => {
      refreshIntroPanel(id);
      setTimeout(() => {
        isProgrammaticScrolling = false;
        if (onDone) onDone();
      }, 100);
    };
    
    const container = document.getElementById("story");
    if (container) {
      if (reduceMotion) {
        container.scrollTop = s.offsetTop;
        finish();
      } else {
        animateScrollTo(container, s.offsetTop, 1000, { onDone: finish, manageSnap: true });
      }
    } else {
      s.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      setTimeout(finish, 1200);
    }
  }

  /* ---------- Slow, custom smooth scroll ---------- */
  let activeScrollAnimation = null;
  // The #story snap state we return to after a JS scroll: "none" while narrating
  // (the code drives all scrolling), "" (CSS mandatory) for manual reading.
  let storySnapBase = "";

  function animateScrollTo(container, targetScrollTop, duration = 800, opts = {}) {
    const { onDone, manageSnap = false } = opts;
    if (activeScrollAnimation && activeScrollAnimation.container === container) {
      cancelAnimationFrame(activeScrollAnimation.rafId);
      if (activeScrollAnimation.restoreSnap) activeScrollAnimation.restoreSnap();
    }

    const isWindow = container === window;
    const startScrollTop = isWindow ? window.scrollY : container.scrollTop;
    const distance = targetScrollTop - startScrollTop;
    if (Math.abs(distance) < 2) { if (onDone) onDone(); return; }

    // Mandatory scroll-snap fights a JS scroll (it yanks to the nearest snap
    // point → jerk). Disable it during the glide; restore afterwards. Only safe
    // when the target is itself a snap point (section scrolls), hence manageSnap.
    let snapManaged = false;
    if (manageSnap && !isWindow && container.style) {
      container.style.scrollSnapType = "none";
      snapManaged = true;
    }
    const restoreSnap = () => { if (snapManaged) { container.style.scrollSnapType = storySnapBase; snapManaged = false; } };

    const startTime = performance.now();
    function step(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      // easeInOutCubic — gentle, no jerk
      const ease = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const currentVal = startScrollTop + distance * ease;
      if (isWindow) window.scrollTo(0, currentVal);
      else container.scrollTop = currentVal;

      if (progress < 1) {
        activeScrollAnimation.rafId = requestAnimationFrame(step);
      } else {
        restoreSnap();
        activeScrollAnimation = null;
        if (onDone) onDone();
      }
    }
    activeScrollAnimation = { container, rafId: requestAnimationFrame(step), restoreSnap };
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
    // Bring the sentence to ~62% down the viewport (lower third), not centred —
    // just enough to keep it comfortably on screen with room to read ahead.
    let target = offsetTop - container.clientHeight * 0.62;

    // Clamp to the CURRENT chapter so we never scroll far enough to reveal the
    // next chapter — it stays hidden until this one finishes (then scrollToSection).
    const section = playing && playing.section;
    if (section && container === document.getElementById("story")) {
      const chapTop = getOffsetTopRelativeTo(section, container);
      const chapMax = chapTop + section.offsetHeight - container.clientHeight;
      target = Math.max(chapTop, Math.min(target, Math.max(chapTop, chapMax)));
    } else {
      target = Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight));
    }

    if (reduceMotion) { container.scrollTop = target; return; }
    // Slow, gentle glide (~2s). Snap is off during narration so it won't yank back.
    animateScrollTo(container, target, 2000);
  }
})();

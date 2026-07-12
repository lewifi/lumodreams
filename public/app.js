/* ============================================================
   Lumo Dreams — v1 behaviour
   - Lazily mounts one looping <video> per chapter (incl. the epilogue);
     only plays the chapter currently in view (saves battery / decode on mobile).
   - Preface modal: open from cover + "The End", close via ×, backdrop, Esc.
   - wordify(): v2 scaffold for karaoke highlighting (defined, not run).
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Lazy, view-gated chapter videos ---------- */
  const chapters = Array.from(document.querySelectorAll(".chapter[data-video]"));

  function makeVideo(src, cls) {
    const v = document.createElement("video");
    v.className = cls;
    v.muted = true;            // required for autoplay
    v.loop = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("aria-hidden", "true");
    v.preload = "auto";
    v.src = src;
    return v;
  }

  // Mounts the chapter's background video(s). A chapter may declare a second
  // "morph" video (data-video-morph) that crossfades in over the first when the
  // narration reaches a cue word (see narration.js) — or, without narration,
  // after data-morph-delay ms in view.
  function mountVideo(section) {
    if (section._video) return section._video;
    section._video = makeVideo(section.getAttribute("data-video"), "bg bg-primary");
    section.insertBefore(section._video, section.firstChild); // under scrim/text
    const morphSrc = section.getAttribute("data-video-morph");
    if (morphSrc) {
      section._videoMorph = makeVideo(morphSrc, "bg bg-morph");
      // after the primary so it stacks above it and can fade in
      section._video.insertAdjacentElement("afterend", section._videoMorph);
    }
    return section._video;
  }

  function playSectionVideos(section) {
    [section._video, section._videoMorph].forEach((v) => {
      if (!v) return;
      const p = v.play();
      if (p && p.catch) p.catch(() => {}); // ignore autoplay rejections
    });
  }
  function pauseSectionVideos(section) {
    [section._video, section._videoMorph].forEach((v) => v && v.pause());
  }

  const inView = new Set();

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const section = e.target;
      if (e.isIntersecting && e.intersectionRatio > 0.4) {
        inView.add(section);
        mountVideo(section);
        playSectionVideos(section);
        scheduleMorphFallback(section);
      } else {
        inView.delete(section);
        pauseSectionVideos(section);
        clearMorphFallback(section);
        section.classList.remove("is-morphed"); // reset for next visit
      }
    }
  }, { threshold: [0, 0.4, 0.75] });

  chapters.forEach((c) => io.observe(c));

  // Warm the very first chapter video eagerly so scrolling in is instant.
  if (chapters[0]) mountVideo(chapters[0]);

  /* ---------- Video morph ---------- */
  // Accurate trigger is narration-driven (narration.js calls triggerMorph at the
  // cue word). Fallback: if narration isn't active, morph after data-morph-delay.
  function triggerMorph(section) {
    if (section && section._videoMorph) section.classList.add("is-morphed");
  }
  window.__lumoTriggerMorph = triggerMorph;

  function scheduleMorphFallback(section) {
    if (!section.getAttribute("data-video-morph")) return;
    if (document.body.classList.contains("narrating")) return; // narration owns it
    if (section._morphTimer || section.classList.contains("is-morphed")) return;
    const delay = parseInt(section.getAttribute("data-morph-delay") || "16000", 10);
    section._morphTimer = setTimeout(() => {
      if (!document.body.classList.contains("narrating")) triggerMorph(section);
    }, delay);
  }
  function clearMorphFallback(section) {
    if (section._morphTimer) {
      clearTimeout(section._morphTimer);
      section._morphTimer = null;
    }
  }

  /* ---------- Preface modal (optional; offered on cover + "The End") ---------- */
  const modal = document.getElementById("preface");
  let lastFocused = null;

  function openPreface() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    const closeBtn = modal.querySelector(".modal-close");
    if (closeBtn) closeBtn.focus();
    document.dispatchEvent(new CustomEvent("preface:open")); // narration.js may narrate it
  }

  function closePreface() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    document.dispatchEvent(new CustomEvent("preface:close"));
  }

  document.querySelectorAll("[data-open-preface]").forEach((btn) =>
    btn.addEventListener("click", openPreface)
  );
  document.querySelectorAll("[data-close-preface]").forEach((el) =>
    el.addEventListener("click", closePreface)
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closePreface();
  });

  /* ---------- v2 scaffold (NOT active) ------------------------
     Pre-recorded narration + word-by-word highlighting + auto-scroll.
     Call wordify(document) once, then drive .is-spoken from a timing map
     synced to each chapter's audio. Left here so v1 markup needs no rewrite. */
  // Recursively wrap every visible word in <span class="word">, preserving
  // inline wrappers (<em>) and <br>. Document order of the resulting .word
  // spans matches the reading order the narration timings are built from.
  function wordifyNode(node) {
    const out = [];
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent.split(/(\s+)/).forEach((tok) => {
          if (tok === "") return;
          if (/^\s+$/.test(tok)) {
            out.push(document.createTextNode(tok));
          } else {
            const s = document.createElement("span");
            s.className = "word";
            s.textContent = tok;
            out.push(s);
          }
        });
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== "BR") {
        wordifyNode(child); // wrap words inside <em> etc. in place
        out.push(child);
      } else {
        out.push(child.cloneNode(true)); // <br>, comments, …
      }
    });
    node.replaceChildren(...out);
  }

  function wordify(root) {
    root.querySelectorAll(".prose p").forEach((p) => {
      if (p.dataset.wordified) return;
      wordifyNode(p);
      p.dataset.wordified = "true";
    });
  }
  window.__lumoWordify = wordify; // exposed for v2 wiring
})();

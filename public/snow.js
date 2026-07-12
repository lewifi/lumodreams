/* ============================================================
   Lumo Dreams — gentle snow + star twinkle on the cover screens.
   Desktop only, respects reduced motion, and animates a section only while
   it's on screen. Purely decorative (pointer-events: none), behind the text.
   ============================================================ */

(function () {
  "use strict";

  const desktop = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!desktop.matches || reduce.matches) return;

  ["cover", "theend"].forEach((id) => {
    const section = document.getElementById(id);
    if (section) setupSnow(section);
  });

  function setupSnow(section) {
    const canvas = document.createElement("canvas");
    canvas.className = "snow-canvas";
    canvas.setAttribute("aria-hidden", "true");
    // Sit above the scrim but below the text content.
    const scrim = section.querySelector(".scrim");
    if (scrim) scrim.insertAdjacentElement("afterend", canvas);
    else section.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0, h = 0, flakes = [], stars = [], raf = 0, last = 0;

    function resize() {
      const r = section.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function newFlake(spread) {
      return {
        x: Math.random() * w,
        y: spread ? Math.random() * h : -6,
        r: Math.random() * 1.6 + 0.6,      // radius
        fall: Math.random() * 26 + 14,     // px/sec, gentle
        drift: Math.random() * 14 + 6,     // horizontal sway px/sec
        sway: Math.random() * 1 + 0.4,     // sway speed
        ph: Math.random() * Math.PI * 2,
        op: Math.random() * 0.35 + 0.25
      };
    }

    function seed() {
      const flakeCount = Math.min(120, Math.round((w * h) / 30000));
      flakes = [];
      for (let i = 0; i < flakeCount; i++) flakes.push(newFlake(true));

      const starCount = Math.min(48, Math.round(w / 55));
      stars = [];
      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.33,     // upper third
          r: Math.random() * 1.1 + 0.4,
          base: Math.random() * 0.45 + 0.15,
          amp: Math.random() * 0.5 + 0.3,
          sp: Math.random() * 1.1 + 0.4,   // twinkle speed
          ph: Math.random() * Math.PI * 2
        });
      }
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);

      for (const s of stars) {
        s.ph += s.sp * dt;
        const tw = Math.max(0, Math.min(1, s.base + (Math.sin(s.ph) * 0.5 + 0.5) * s.amp));
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255," + tw.toFixed(3) + ")";
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const f of flakes) {
        f.ph += f.sway * dt;
        f.y += f.fall * dt;
        f.x += Math.sin(f.ph) * f.drift * dt;
        if (f.y > h + 6) Object.assign(f, newFlake(false));
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255," + f.op + ")";
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    }

    function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    resize();

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && entries[0].intersectionRatio > 0.05) start();
        else { stop(); ctx.clearRect(0, 0, w, h); }
      },
      { threshold: [0, 0.05] }
    );
    io.observe(section);

    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(resize, 200); });
  }
})();

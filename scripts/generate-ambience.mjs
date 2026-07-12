// Generate a seamless Nordic wind/aurora ambience bed for the read-along.
//
// Procedural: brown-noise wind shaped by slow gusts, two faintly "singing"
// resonators that drift (the whistle of wind over snow), a cold sub drone, and
// a whisper of air. The buffer is crossfade-wrapped so it loops with no seam.
//
//   node scripts/generate-ambience.mjs   →   public/music/nordic-ambience.mp3
//
// Re-run to tweak; the frontend just loops the file under the middle chapters.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as lamejs from "@breezystack/lamejs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "music", "nordic-ambience.mp3");

const SR = 44100;
const LOOP = 30;      // seconds of loop
const XFADE = 4;      // seamless crossfade region
const total = LOOP + XFADE;
const N = Math.floor(total * SR);

// Two-pole resonator (peak at f0). r→1 = narrower/louder.
function makeResonator(r) {
  let y1 = 0, y2 = 0;
  return (x, w0) => {
    const y = (1 - r) * x + 2 * r * Math.cos(w0) * y1 - r * r * y2;
    y2 = y1; y1 = y;
    return y;
  };
}

const buf = new Float32Array(N);
let brown = 0, lp = 0, lp2 = 0;
const res1 = makeResonator(0.9985);
const res2 = makeResonator(0.9980);

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const white = Math.random() * 2 - 1;

  // brown noise → soft wind body
  brown = (brown + 0.02 * white) / 1.02;
  lp += 0.045 * (brown - lp);
  let wind = lp * 13;

  // slow, natural gusting from a few detuned LFOs
  const g =
    0.5 * Math.sin(2 * Math.PI * 0.05 * t) +
    0.3 * Math.sin(2 * Math.PI * 0.13 * t + 1.3) +
    0.2 * Math.sin(2 * Math.PI * 0.083 * t + 2.1);
  const gust = Math.max(0.12, Math.min(1, 0.55 + 0.5 * g));
  wind *= gust;

  // faint "singing" wind: resonators on the noise, slowly drifting a cold fifth apart
  const f1 = 330 + 40 * Math.sin(2 * Math.PI * 0.017 * t);
  const f2 = 495 + 55 * Math.sin(2 * Math.PI * 0.011 * t + 0.7);
  const sing =
    res1(brown * 6, (2 * Math.PI * f1) / SR) * 0.13 * gust +
    res2(brown * 6, (2 * Math.PI * f2) / SR) * 0.1 * gust;

  // cold sub drone (slow beat between 58 and 87 Hz)
  const drone = (Math.sin(2 * Math.PI * 58 * t) + Math.sin(2 * Math.PI * 87.2 * t)) * 0.22;

  // whisper of air
  lp2 += 0.4 * (white - lp2);
  const air = (white - lp2) * 0.05 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.11 * t));

  buf[i] = wind + sing + drone + air;
}

// Seamless loop: crossfade the head with the material that follows the loop point.
const outLen = LOOP * SR;
const xn = XFADE * SR;
const out = new Float32Array(outLen);
for (let i = 0; i < outLen; i++) {
  if (i < xn) {
    const w = i / xn;
    const fi = Math.sin((Math.PI / 2) * w);
    const fo = Math.cos((Math.PI / 2) * w);
    out[i] = buf[i] * fi + buf[outLen + i] * fo;
  } else {
    out[i] = buf[i];
  }
}

// Normalise to a safe peak (played quietly under the narration anyway).
let peak = 0;
for (let i = 0; i < outLen; i++) peak = Math.max(peak, Math.abs(out[i]));
const gain = 0.5 / (peak || 1);
const pcm = new Int16Array(outLen);
for (let i = 0; i < outLen; i++) {
  pcm[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * gain * 32767)));
}

// Encode MP3 (mono, 96 kbps).
const enc = new lamejs.Mp3Encoder(1, SR, 96);
const chunks = [];
for (let i = 0; i < pcm.length; i += 1152) {
  const mp3 = enc.encodeBuffer(pcm.subarray(i, i + 1152));
  if (mp3.length) chunks.push(Buffer.from(mp3));
}
const tail = enc.flush();
if (tail.length) chunks.push(Buffer.from(tail));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, Buffer.concat(chunks));
console.log(`Wrote ${OUT} (${LOOP}s loop, ${(Buffer.concat(chunks).length / 1024).toFixed(0)} KB)`);

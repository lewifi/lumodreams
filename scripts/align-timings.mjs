// Lumo Dreams — waveform sentence aligner.
//
// Replaces the old LLM-based aligner. Large language models (Gemini included)
// cannot produce sample-accurate audio timestamps — they estimate, and drift by
// a few hundred ms inconsistently. This decodes the MP3 to PCM, finds the real
// pauses in the waveform, and snaps each sentence's start ("s") to the actual
// speech onset after a boundary pause. The syllable estimate is only a prior for
// deciding WHICH pause is a sentence boundary (vs a comma/breath pause).
//
// The frontend advances the highlight on each sentence's "s", so accurate onsets
// are what matter; "e" is filled in for completeness.
//
// Usage (Windows PowerShell):
//   node scripts/align-timings.mjs                 # all tracks with an MP3
//   node scripts/align-timings.mjs ch1 ch2         # just these
//   node scripts/align-timings.mjs ch1 --dry       # print, don't write

import { MPEGDecoder } from "mpg123-decoder";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = join(__dirname, "..", "public", "audio");

// ---- Tunables ------------------------------------------------------------
const FRAME_MS = 10;         // envelope resolution
const SIL_FACTOR = 0.05;     // silence threshold = peak * this
const MIN_GAP_MS = 120;      // shortest silence counted as a candidate boundary
const PRIOR_LAMBDA = 0.4;    // how much to prefer longer pauses when snapping
const PRIOR_CAP = 1.0;       // cap on the longer-pause reward (s)
const SNAP_WINDOW = 0.9;     // only move a start to an onset within this many seconds
const LEAD_MS = 100;         // start each highlight this much before the onset

// ---- Syllable-weight prior ----------------------------------------------
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  const g = w.match(/[aeiouy]+/g);
  let n = g ? g.length : 1;
  if (w.length > 3 && w.endsWith("e")) n = Math.max(1, n - 1);
  return Math.max(1, n);
}
function sentenceWeight(s) {
  let w = 1;
  for (const x of s.split(/\s+/).filter(Boolean)) w += syllables(x);
  return w;
}

// ---- Audio → envelope → pauses ------------------------------------------
async function decodeMono(mp3Path) {
  const dec = new MPEGDecoder();
  await dec.ready;
  const { channelData, samplesDecoded, sampleRate } = dec.decode(new Uint8Array(await readFile(mp3Path)));
  dec.free();
  const n = samplesDecoded;
  const mono = new Float32Array(n);
  if (channelData.length > 1) {
    const a = channelData[0], b = channelData[1];
    for (let i = 0; i < n; i++) mono[i] = (a[i] + b[i]) * 0.5;
  } else {
    mono.set(channelData[0].subarray(0, n));
  }
  return { mono, sampleRate };
}

function analyze(mono, sr) {
  const win = Math.max(1, Math.floor((FRAME_MS / 1000) * sr));
  const fr = win / sr; // seconds per frame
  const frames = Math.ceil(mono.length / win);
  const env = new Float32Array(frames);
  let peak = 0;
  for (let i = 0, k = 0; i < mono.length; i += win, k++) {
    let s = 0;
    const end = Math.min(i + win, mono.length);
    for (let j = i; j < end; j++) s += mono[j] * mono[j];
    env[k] = Math.sqrt(s / (end - i));
    if (env[k] > peak) peak = env[k];
  }
  const thr = peak * SIL_FACTOR;
  let first = 0; while (first < frames && env[first] < thr) first++;
  let last = frames - 1; while (last > first && env[last] < thr) last--;
  const firstOnset = first * fr;
  const lastOffset = (last + 1) * fr;

  // Speech onsets: every point where speech resumes after >= MIN_GAP_MS of silence,
  // tagged with the length of the pause before it (longer = more likely a sentence).
  const minFrames = MIN_GAP_MS / FRAME_MS;
  const onsets = [{ t: firstOnset, pause: 99 }];
  let run = 0;
  for (let k = first; k <= last; k++) {
    if (env[k] < thr) run++;
    else { if (run >= minFrames) onsets.push({ t: k * fr, pause: run * fr }); run = 0; }
  }
  return { firstOnset, lastOffset, onsets };
}

// ---- Snap each existing start to the nearest real speech onset -----------
// The existing "s" values (from generation or a prior pass) place each sentence
// in roughly the right spot; we just move each start onto the actual onset in the
// waveform. Within the window, a nearby onset preceded by a longer pause (i.e. a
// real sentence boundary) is preferred over a comma/clause pause.
function snapStarts(priorStarts, onsets, lastOffset) {
  const N = priorStarts.length;
  const out = new Array(N);
  out[0] = onsets[0].t; // first sentence = first speech
  let prev = out[0];
  for (let i = 1; i < N; i++) {
    const p = priorStarts[i];
    let best = null, bestScore = Infinity;
    for (const o of onsets) {
      if (o.t <= prev + 0.25) continue;         // stay after the previous start
      const dist = Math.abs(o.t - p);
      if (dist > SNAP_WINDOW) continue;
      const score = dist - PRIOR_LAMBDA * Math.min(o.pause, PRIOR_CAP);
      if (score < bestScore) { bestScore = score; best = o.t; }
    }
    out[i] = best != null ? best : Math.max(prev + 0.3, p); // keep prior if nothing close
    prev = out[i];
  }
  return out;
}

async function alignTrack(trackId, dry) {
  const jsonPath = join(AUDIO_DIR, `${trackId}.json`);
  const mp3Path = join(AUDIO_DIR, `${trackId}.mp3`);
  if (!existsSync(mp3Path) || !existsSync(jsonPath)) { console.log(`  — skip ${trackId}`); return; }

  const data = JSON.parse(await readFile(jsonPath, "utf8"));
  const sentences = data.words.map((w) => w.w);
  const N = sentences.length;
  const { mono, sampleRate } = await decodeMono(mp3Path);
  const { firstOnset, lastOffset, onsets } = analyze(mono, sampleRate);

  let starts = new Array(N);
  const ends = new Array(N);
  if (N === 1) {
    starts[0] = firstOnset; ends[0] = lastOffset;
  } else {
    // Prior = existing starts if they look sane, else a syllable estimate.
    let prior = data.words.map((w) => (typeof w.s === "number" ? w.s : NaN));
    const sane = prior.every((v, i) => !isNaN(v) && (i === 0 || v > prior[i - 1] - 0.001));
    if (!sane) {
      const weights = sentences.map(sentenceWeight);
      const tot = weights.reduce((a, b) => a + b, 0);
      const span = lastOffset - firstOnset;
      let acc = 0; prior = [];
      for (let i = 0; i < N; i++) { prior.push(firstOnset + span * (acc / tot)); acc += weights[i]; }
    }
    starts = snapStarts(prior, onsets, lastOffset);
    for (let i = 0; i < N; i++) ends[i] = i < N - 1 ? Math.max(starts[i] + 0.2, starts[i + 1] - 0.08) : lastOffset;
  }

  // Small anticipatory lead, keep strictly increasing.
  data.words = sentences.map((w, i) => {
    let s = Math.max(0, starts[i] - LEAD_MS / 1000);
    if (i > 0) s = Math.max(s, starts[i - 1] + 0.05);
    return { w, s: +s.toFixed(3), e: +ends[i].toFixed(3) };
  });

  if (dry) {
    console.log(`▶ ${trackId} (dry) — onset ${firstOnset.toFixed(2)}s, ${onsets.length} onsets`);
    data.words.forEach((w, i) => console.log(String(i).padStart(2), (w.s + "").padStart(8), "->", (w.e + "").padStart(8), " ", w.w.slice(0, 46)));
  } else {
    await writeFile(jsonPath, JSON.stringify(data), "utf8");
    console.log(`  ✓ ${trackId} aligned (${N} sentences)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const ids = args.filter((a) => !a.startsWith("--")).map((a) => a.replace(/\.(json|mp3)$/i, ""));
  let tracks = readdirSync(AUDIO_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json").map((f) => f.replace(".json", ""));
  if (ids.length) tracks = tracks.filter((t) => ids.includes(t));
  console.log(`Aligning ${tracks.length} track(s)…\n`);
  for (const t of tracks) {
    try { await alignTrack(t, dry); } catch (e) { console.error(`  ✗ ${t}: ${e.message}`); }
  }
  console.log("\nDone.");
}

main().catch(console.error);

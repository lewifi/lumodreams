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

// ---- Choose the N-1 boundary onsets by global segmentation (prior-free) ---
// Pick which real speech onsets are the sentence boundaries so that each
// sentence's resulting duration best matches its syllable-weighted expectation,
// anchored at both firstOnset and lastOffset (so it can't drift), and rewarding
// onsets preceded by a longer pause (real sentence ends vs comma/clause pauses).
// Returns { starts, ends } snapped to actual onsets.
function segmentByOnsets(onsets, weights, firstOnset, lastOffset) {
  const N = weights.length;
  if (N === 1) return { starts: [firstOnset], ends: [lastOffset] };

  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const span = lastOffset - firstOnset;
  const expected = weights.map((w) => (w / totalW) * span);

  const cuts = onsets.filter((o) => o.t > firstOnset + 0.15 && o.t < lastOffset - 0.15);
  const M = cuts.length;
  if (M < N - 1) {
    // Not enough pauses — proportional fallback.
    const starts = [], ends = [];
    let acc = 0;
    for (let i = 0; i < N; i++) { starts.push(firstOnset + span * (acc / totalW)); acc += weights[i]; ends.push(firstOnset + span * (acc / totalW)); }
    return { starts, ends };
  }

  const bonus = (m) => PRIOR_LAMBDA * Math.min(cuts[m].pause, PRIOR_CAP);
  const INF = 1e18;
  // dp[k][m] = min cost for sentences 0..k-1 with sentence k starting at cuts[m].
  const dp = Array.from({ length: N }, () => new Float64Array(M).fill(INF));
  const par = Array.from({ length: N }, () => new Int32Array(M).fill(-1));
  for (let m = 0; m < M; m++) dp[1][m] = Math.abs(cuts[m].t - firstOnset - expected[0]) - bonus(m);
  for (let k = 2; k < N; k++) {
    for (let m = k - 1; m < M; m++) {
      let best = INF, bi = -1;
      for (let mp = k - 2; mp < m; mp++) {
        const c = dp[k - 1][mp] + Math.abs(cuts[m].t - cuts[mp].t - expected[k - 1]);
        if (c < best) { best = c; bi = mp; }
      }
      dp[k][m] = best - bonus(m);
      par[k][m] = bi;
    }
  }
  let best = INF, endM = -1;
  for (let m = N - 2; m < M; m++) {
    const c = dp[N - 1][m] + Math.abs(lastOffset - cuts[m].t - expected[N - 1]);
    if (c < best) { best = c; endM = m; }
  }
  const chosen = new Array(N - 1);
  for (let k = N - 1, m = endM; k >= 1; k--) { chosen[k - 1] = cuts[m]; m = par[k][m]; }

  const starts = [firstOnset], ends = [];
  for (let i = 1; i < N; i++) starts.push(chosen[i - 1].t);
  for (let i = 0; i < N; i++) {
    if (i < N - 1) ends.push(Math.max(starts[i] + 0.1, chosen[i].t - chosen[i].pause)); // speech end before the pause
    else ends.push(lastOffset);
  }
  return { starts, ends };
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

  const weights = sentences.map(sentenceWeight);
  const { starts, ends } = segmentByOnsets(onsets, weights, firstOnset, lastOffset);

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

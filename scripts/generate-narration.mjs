// Lumo Dreams — v2 narration generator.
//
// Synthesizes each chapter with Gemini TTS in a soft, whimsical female voice,
// paragraph by paragraph, then concatenates the paragraphs (with a short pause)
// into one WAV per chapter. Because we know each paragraph's exact audio
// duration, we can place per-word timings within it (weighted by syllables and
// punctuation) so the frontend can highlight words as they're spoken. Any small
// timing error is bounded to a single paragraph.
//
// Gemini TTS returns audio only (no word timestamps), which is why we estimate
// timings this way rather than reading them back from the API.
//
// Usage:
//   set GEMINI_API_KEY=...            (Windows PowerShell: $env:GEMINI_API_KEY="...")
//   node scripts/generate-narration.mjs
//
// Output (git-committed, served as static assets):
//   public/audio/<id>.wav
//   public/audio/<id>.json      { id, duration, words:[{w,s,e}] }
//   public/audio/manifest.json  [ ids... ]  (chapter order)

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chapters } from "./chapters.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "audio");

// ---- Config (tweak to taste) --------------------------------------------
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
// Soft/whimsical female prebuilt voices worth trying:
//   Leda (youthful) · Achernar (soft) · Aoede (breezy) · Vindemiatrix (gentle) · Sulafat (warm)
const VOICE = process.env.GEMINI_TTS_VOICE || "Leda";
// Accent is steered by the prompt (Gemini has no dedicated British/Nordic voice).
// British reproduces reliably; "nordic" is only an approximation.
const ACCENT_PRESETS = {
  british: "a soft, warm British (Received Pronunciation) storyteller’s accent",
  nordic: "a gentle Nordic-tinged English accent — soft, lightly Scandinavian, never harsh"
};
const ACCENT = ACCENT_PRESETS[process.env.GEMINI_TTS_ACCENT || "british"] || ACCENT_PRESETS.british;

// Build the per-paragraph style directive. Tags sit BEFORE the text and are
// phrased as instructions so they guide delivery without being read aloud.
function stylePrompt(chapter, para) {
  return [
    `[Voice] a soft, whimsical young woman with ${ACCENT}; a slow, gentle, unhurried bedtime-story cadence`,
    `[Mood] ${chapter.mood} — ${para.mood}`,
    `[Expression] ${para.expression}`,
    `[Chapter] ${chapter.title}`,
    `Narrate the following passage warmly and tenderly. Do not read these bracketed directions aloud; only read the passage:`
  ].join("\n");
}
const SAMPLE_RATE = 24000; // Gemini TTS PCM output: 24 kHz, 16-bit, mono
const SILENCE_MS = 450; // pause inserted between paragraphs
const CALL_DELAY_MS = 600; // gap between API calls (be kind to rate limits)

// ---- Helpers -------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (w.length > 3 && w.endsWith("e")) n = Math.max(1, n - 1); // silent-ish 'e'
  return Math.max(1, n);
}

// Relative "how long to dwell" weight per token, incl. punctuation pauses.
function tokenWeight(tok) {
  let w = 0.5 + syllables(tok) * 0.9;
  if (/[.!?]["”’)]?$/.test(tok)) w += 2.4;      // sentence end
  else if (/[,;:]["”’)]?$/.test(tok)) w += 1.0;  // clause pause
  else if (/[—–]$/.test(tok)) w += 1.0;
  return w;
}

// Trim near-silence from the head/tail of a 16-bit PCM buffer (keeps a margin),
// so word timings track the actual speech rather than leading/trailing air.
function trimSilence(buf) {
  const THRESH = 450; // amplitude (of 32768)
  const MARGIN = Math.floor(0.04 * SAMPLE_RATE); // 40 ms
  const n = buf.length / 2;
  let first = 0, last = n - 1;
  while (first < n && Math.abs(buf.readInt16LE(first * 2)) < THRESH) first++;
  while (last > first && Math.abs(buf.readInt16LE(last * 2)) < THRESH) last--;
  if (first >= last) return buf; // all quiet; leave as-is
  const start = Math.max(0, first - MARGIN);
  const end = Math.min(n - 1, last + MARGIN);
  return buf.subarray(start * 2, (end + 1) * 2);
}

function silenceBuffer(ms) {
  return Buffer.alloc(Math.floor((ms / 1000) * SAMPLE_RATE) * 2); // zeros
}

function wavHeader(dataLen) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // PCM chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits/sample
  h.write("data", 36);
  h.writeUInt32LE(dataLen, 40);
  return h;
}

async function synthParagraph(chapter, para, attempt = 1) {
  const promptText = `${stylePrompt(chapter, para)}\n\n${para.text}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } }
      }
    }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const msg = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt <= 5) {
      const wait = 1500 * attempt;
      console.warn(`  · ${res.status}, retrying in ${wait}ms (attempt ${attempt})`);
      await sleep(wait);
      return synthParagraph(text, attempt + 1);
    }
    throw new Error(`TTS ${res.status}: ${msg.slice(0, 300)}`);
  }
  const json = await res.json();
  const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  const b64 = part?.inlineData?.data;
  if (!b64) throw new Error("No audio in response: " + JSON.stringify(json).slice(0, 300));
  return trimSilence(Buffer.from(b64, "base64"));
}

// Distribute word timings across [t0, t0+dur] for one paragraph.
function paragraphTimings(text, t0, dur) {
  const toks = text.split(/\s+/).filter(Boolean);
  const weights = toks.map(tokenWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const words = [];
  let acc = 0;
  for (let i = 0; i < toks.length; i++) {
    const s = t0 + (dur * acc) / total;
    acc += weights[i];
    const e = t0 + (dur * acc) / total;
    words.push({ w: toks[i], s: +s.toFixed(3), e: +e.toFixed(3) });
  }
  return words;
}

// ---- Main ----------------------------------------------------------------
async function main() {
  if (!API_KEY) {
    console.error(
      "Missing GEMINI_API_KEY.\n" +
        "Get a key at https://aistudio.google.com/apikey then:\n" +
        '  PowerShell:  $env:GEMINI_API_KEY="your-key"; node scripts/generate-narration.mjs'
    );
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Voice: ${VOICE}  ·  Model: ${MODEL}\n`);

  const silence = silenceBuffer(SILENCE_MS);
  const manifest = [];

  for (const ch of chapters) {
    console.log(`▶ ${ch.id} — ${ch.title}`);
    const pcmChunks = [];
    const words = [];
    let cursorSamples = 0; // running length in samples

    for (let p = 0; p < ch.paragraphs.length; p++) {
      const para = ch.paragraphs[p];
      process.stdout.write(`  · paragraph ${p + 1}/${ch.paragraphs.length} … `);
      const pcm = await synthParagraph(ch, para);
      const dur = pcm.length / 2 / SAMPLE_RATE;
      const t0 = cursorSamples / SAMPLE_RATE;
      words.push(...paragraphTimings(para.text, t0, dur));
      pcmChunks.push(pcm);
      cursorSamples += pcm.length / 2;
      if (p < ch.paragraphs.length - 1) {
        pcmChunks.push(silence);
        cursorSamples += silence.length / 2;
      }
      console.log(`${dur.toFixed(1)}s`);
      await sleep(CALL_DELAY_MS);
    }

    const data = Buffer.concat(pcmChunks);
    const duration = +(data.length / 2 / SAMPLE_RATE).toFixed(3);
    await writeFile(join(OUT_DIR, `${ch.id}.wav`), Buffer.concat([wavHeader(data.length), data]));
    await writeFile(
      join(OUT_DIR, `${ch.id}.json`),
      JSON.stringify({ id: ch.id, voice: VOICE, duration, words })
    );
    manifest.push(ch.id);
    console.log(`  ✓ ${ch.id}.wav (${duration.toFixed(1)}s, ${words.length} words)\n`);
  }

  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest));
  console.log(`Done. Wrote ${manifest.length} chapters to public/audio/.`);
}

main().catch((e) => {
  console.error("\nGeneration failed:", e.message);
  process.exit(1);
});

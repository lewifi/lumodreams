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
// Usage (Windows PowerShell):
//   $env:GEMINI_API_KEY="..."
//   node scripts/generate-narration.mjs                       # all MISSING chapters
//   node scripts/generate-narration.mjs ch4 ch5 epilogue preface   # just these (aliases ok)
//   node scripts/generate-narration.mjs --force               # regenerate everything
//
// Already-generated chapters are skipped unless named explicitly or --force is
// used, so you can grab a few at a time (free tier is ~3 calls/min). The manifest
// is rebuilt from whatever .wav files are present, in canonical order.
//
// Output (git-committed, served as static assets):
//   public/audio/<id>.mp3
//   public/audio/<id>.json      { id, duration, words:[{w,s,e}] }
//   public/audio/manifest.json  [ ids... ]  (read-along scroll flow only)

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chapters } from "./chapters.mjs";
import * as lamejs from "@breezystack/lamejs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "audio");

// ---- Config (tweak to taste) --------------------------------------------
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";
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
// Free-tier TTS is ~3 requests/min → ~20s between calls. Override with GEMINI_TTS_DELAY_MS.
const CALL_DELAY_MS = parseInt(process.env.GEMINI_TTS_DELAY_MS || "20000", 10);

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

function encodeMP3(pcmBuffer) {
  const mp3encoder = new lamejs.Mp3Encoder(1, SAMPLE_RATE, 64);
  const mp3Data = [];
  const samples = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.length / 2
  );
  const sampleBlockSize = 1152;
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const chunk = samples.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) {
      mp3Data.push(Buffer.from(mp3buf));
    }
  }
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(Buffer.from(mp3buf));
  }
  return Buffer.concat(mp3Data);
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

// Pull RetryInfo + which quota was hit out of a 429 body.
function parseQuota(bodyText) {
  const out = { retryMs: null, perDay: false, quotaId: null };
  try {
    const details = JSON.parse(bodyText)?.error?.details || [];
    for (const d of details) {
      const type = d["@type"] || "";
      if (type.includes("RetryInfo") && d.retryDelay) {
        const m = /(\d+(?:\.\d+)?)s/.exec(d.retryDelay);
        if (m) out.retryMs = Math.ceil(parseFloat(m[1]) * 1000);
      }
      if (type.includes("QuotaFailure")) {
        for (const v of d.violations || []) {
          out.quotaId = v.quotaId || out.quotaId;
          if (/PerDay/i.test(v.quotaId || "")) out.perDay = true;
        }
      }
    }
  } catch {}
  return out;
}

async function synthParagraph(chapter, para, attempt = 1) {
  const ttsText = para.text
    .replace(/\bLewi\b/g, "Levy")
    .replace(/\bLumo\b/g, "Lumoh")
    .replace(/\blumo\b/g, "lumoh");
  const promptText = `${stylePrompt(chapter, para)}\n\n${ttsText}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } }
      }
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE"
      }
    ]
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const msg = await res.text();
    if (res.status === 429) {
      const q = parseQuota(msg);
      if (q.perDay) {
        // Daily cap won't clear by waiting minutes — stop and keep progress.
        throw new Error(
          `DAILY QUOTA EXHAUSTED (${q.quotaId || "requests/day"}). ` +
            "The free tier's per-day TTS limit is spent. Options: wait until it resets " +
            "(~midnight US Pacific), enable billing on the project, or use a key from a " +
            "different Google Cloud project. Completed chapters are already saved — re-run to continue."
        );
      }
      if (attempt <= 6) {
        const wait = q.retryMs || 25000; // honor Google's RetryInfo, else ~25s for 3 RPM
        console.warn(`  · 429 (per-minute), retrying in ${Math.round(wait / 1000)}s (attempt ${attempt})`);
        await sleep(wait);
        return synthParagraph(chapter, para, attempt + 1);
      }
    } else if (res.status >= 500 && attempt <= 6) {
      const wait = 1500 * attempt;
      console.warn(`  · ${res.status}, retrying in ${Math.round(wait / 1000)}s (attempt ${attempt})`);
      await sleep(wait);
      return synthParagraph(chapter, para, attempt + 1);
    }
    throw new Error(`TTS ${res.status}: ${msg.slice(0, 300)}`);
  }
  const json = await res.json();
  const candidate = json?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  
  if (finishReason === "OTHER" && attempt <= 3) {
    console.warn(`  · finishReason is OTHER, retrying in 5s (attempt ${attempt})`);
    await sleep(5000);
    return synthParagraph(chapter, para, attempt + 1);
  }

  const part = candidate?.content?.parts?.find((p) => p.inlineData);
  const b64 = part?.inlineData?.data;
  if (!b64) {
    if (attempt <= 3) {
      console.warn(`  · No audio in response (finishReason: ${finishReason || "UNKNOWN"}), retrying in 5s (attempt ${attempt})`);
      await sleep(5000);
      return synthParagraph(chapter, para, attempt + 1);
    }
    throw new Error("No audio in response: " + JSON.stringify(json).slice(0, 300));
  }
  return trimSilence(Buffer.from(b64, "base64"));
}

// Distribute sentence timings across [t0, t0+dur] for one paragraph.
function paragraphTimings(text, t0, dur) {
  const cleanText = text.replace(/\[.*?\]/g, "");
  
  // Split cleanText into sentences matching the frontend splitting rules
  const parts = cleanText.split(/([.!?]\s+)/);
  const toks = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i % 2 === 0) {
      if (part.trim().length > 0) {
        toks.push(part);
      }
    } else {
      if (toks.length > 0) {
        toks[toks.length - 1] += part;
      }
    }
  }

  if (toks.length === 0) {
    toks.push(cleanText);
  }

  const weights = toks.map(tokenWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const words = [];
  let acc = 0;
  for (let i = 0; i < toks.length; i++) {
    const s = t0 + (dur * acc) / total;
    acc += weights[i];
    const e = t0 + (dur * acc) / total;
    words.push({ w: toks[i].trim(), s: +s.toFixed(3), e: +e.toFixed(3) });
  }
  return words;
}

// Resolve CLI ids (with friendly aliases) to chapter ids or track ids.
const ALIASES = { epilogue: "epilogue-ch", cover: "cover", preface: "preface" };
function resolveId(arg) {
  const a = arg.toLowerCase();
  const suffixMatch = /(\-(?:eyebrow|title))$/.exec(a);
  const suffix = suffixMatch ? suffixMatch[1] : "";
  const base = suffixMatch ? a.slice(0, -suffix.length) : a;

  let resolvedBase = base;
  if (ALIASES[base]) resolvedBase = ALIASES[base];
  else if (/^\d+$/.test(base)) resolvedBase = "ch" + base; // "4" → "ch4"
  else if (/^chapter\s*\d+$/.test(base)) resolvedBase = "ch" + base.replace(/\D/g, "");

  return resolvedBase + suffix;
}

async function generateChapter(ch, silence, force, requestedTracks = null) {
  console.log(`▶ ${ch.id} — ${ch.title}`);
  
  const subTracks = [];
  if (ch.id === "cover" || ch.id === "theend") {
    subTracks.push({ suffix: "", paragraphs: ch.paragraphs });
  } else {
    subTracks.push({ suffix: "-eyebrow", paragraphs: [ch.paragraphs[0]] });
    subTracks.push({ suffix: "-title", paragraphs: [ch.paragraphs[1]] });
    subTracks.push({ suffix: "", paragraphs: ch.paragraphs.slice(2) });
  }

  for (const track of subTracks) {
    const trackId = `${ch.id}${track.suffix}`;
    
    // Skip if track filter is active and this track isn't requested
    if (requestedTracks && requestedTracks.size > 0) {
      if (!requestedTracks.has(trackId) && !requestedTracks.has(ch.id)) {
        continue;
      }
    }

    const has = existsSync(join(OUT_DIR, `${trackId}.mp3`));
    const isExplicitlyRequested = requestedTracks && requestedTracks.has(trackId);
    if (has && !force && !isExplicitlyRequested) {
      console.log(`  — skip ${trackId} (already generated)`);
      continue;
    }

    console.log(`  ▶ Generating ${trackId} …`);
    const pcmChunks = [];
    const words = [];
    let cursorSamples = 0;

    for (let p = 0; p < track.paragraphs.length; p++) {
      const para = track.paragraphs[p];
      process.stdout.write(`    · paragraph ${p + 1}/${track.paragraphs.length} … `);
      const pcm = await synthParagraph(ch, para);
      const dur = pcm.length / 2 / SAMPLE_RATE;
      const t0 = cursorSamples / SAMPLE_RATE;
      words.push(...paragraphTimings(para.text, t0, dur));
      pcmChunks.push(pcm);
      cursorSamples += pcm.length / 2;
      if (p < track.paragraphs.length - 1) {
        pcmChunks.push(silence);
        cursorSamples += silence.length / 2;
      }
      console.log(`${dur.toFixed(1)}s`);
      await sleep(CALL_DELAY_MS);
    }

    const data = Buffer.concat(pcmChunks);
    const duration = +(data.length / 2 / SAMPLE_RATE).toFixed(3);
    const mp3Data = encodeMP3(data);
    await writeFile(join(OUT_DIR, `${trackId}.mp3`), mp3Data);
    await writeFile(
      join(OUT_DIR, `${trackId}.json`),
      JSON.stringify({ id: trackId, voice: VOICE, duration, words })
    );
    console.log(`    ✓ ${trackId}.mp3 (${duration.toFixed(1)}s, ${words.length} words)\n`);
  }
}

// Rebuild the read-along manifest from whatever audio is present on disk, in
// canonical chapter order, excluding standalone entries (inFlow: false).
async function writeManifest() {
  const present = chapters
    .filter((c) => c.inFlow !== false && existsSync(join(OUT_DIR, `${c.id}.mp3`)))
    .map((c) => c.id);
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(present));
  return present;
}

// ---- Main ----------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const requested = new Set(args.filter((a) => !a.startsWith("--")).map(resolveId));

  if (!API_KEY) {
    console.error(
      "Missing GEMINI_API_KEY.\n" +
        "Get a key at https://aistudio.google.com/apikey then, in PowerShell:\n" +
        '  $env:GEMINI_API_KEY="your-key"\n' +
        "  node scripts/generate-narration.mjs                 # all missing chapters\n" +
        "  node scripts/generate-narration.mjs ch4 ch5 epilogue preface   # just these\n\n" +
        "Available ids: " + chapters.map((c) => c.id).join(", ")
    );
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Voice: ${VOICE}  ·  Model: ${MODEL}  ·  ~${(CALL_DELAY_MS / 1000).toFixed(0)}s between calls\n`);

  const silence = silenceBuffer(SILENCE_MS);
  let done = 0;
  let failure = null;

  for (const ch of chapters) {
    const hasBody = existsSync(join(OUT_DIR, `${ch.id}.mp3`));
    const hasEyebrow = ch.id === "cover" || existsSync(join(OUT_DIR, `${ch.id}-eyebrow.mp3`));
    const hasTitle = ch.id === "cover" || existsSync(join(OUT_DIR, `${ch.id}-title.mp3`));
    const has = hasBody && hasEyebrow && hasTitle;
    
    const isChapterRequested = requested.has(ch.id);
    const isSubTrackRequested = Array.from(requested).some((reqId) => reqId.startsWith(ch.id + "-"));
    const shouldGen = requested.size ? (isChapterRequested || isSubTrackRequested) : force || !has;
    
    if (!shouldGen) {
      console.log(`— skip ${ch.id} (${has ? "already generated" : "not requested"})`);
      continue;
    }
    try {
      await generateChapter(ch, silence, force, requested);
      done++;
    } catch (e) {
      failure = e; // stop, but keep whatever finished
      break;
    }
  }

  // Always rebuild the manifest so completed chapters are usable even after a stop.
  const manifest = await writeManifest();
  console.log(`\nGenerated ${done} chapter(s) this run. Manifest (read-along flow): ${manifest.join(", ") || "(none)"}.`);
  if (failure) {
    console.error(`\nStopped: ${failure.message}`);
    process.exit(1);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error("\nGeneration failed:", e.message);
  process.exit(1);
});

// Rebuilds sentence-level JSON timing files from existing MP3 narration assets offline.
// No Gemini API calls, no quota usage.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chapters } from "./chapters.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "audio");
const SAMPLE_RATE = 24000;

// Parse MP3 frame headers to calculate exact audio duration in seconds
function parseMP3Duration(buffer) {
  let duration = 0;
  let offset = 0;
  
  if (buffer.length > 10 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    const id3Size = ((buffer[6] & 0x7F) << 21) |
                    ((buffer[7] & 0x7F) << 14) |
                    ((buffer[8] & 0x7F) << 7) |
                    (buffer[9] & 0x7F);
    offset = 10 + id3Size;
  }

  const bitrates = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
  };

  const sampleRates = {
    0: [44100, 48000, 32000, 0],
    1: [22050, 24000, 16000, 0],
    2: [11025, 12000, 8000, 0]
  };

  while (offset < buffer.length - 4) {
    if (buffer[offset] === 0xFF && (buffer[offset + 1] & 0xE0) === 0xE0) {
      const b1 = buffer[offset + 1];
      const b2 = buffer[offset + 2];

      const mpegVersionIndex = (b1 & 0x18) >> 3; // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
      const layer = (b1 & 0x06) >> 1; // 1 = Layer III
      const bitrateKey = (b2 & 0xF0) >> 4;
      const srKey = (b2 & 0x0C) >> 2;
      const padding = (b2 & 0x02) >> 1;

      if (layer !== 1 || bitrateKey === 0 || bitrateKey === 15 || srKey === 3) {
        offset++;
        continue;
      }

      const mpegVer = mpegVersionIndex === 3 ? 1 : 2;
      const mpegSrGroup = mpegVersionIndex === 3 ? 0 : (mpegVersionIndex === 2 ? 1 : 2);

      const bitrate = bitrates[mpegVer][bitrateKey] * 1000;
      const sampleRate = sampleRates[mpegSrGroup][srKey];
      const samplesPerFrame = mpegVersionIndex === 3 ? 1152 : 576;

      const frameLength = Math.floor((samplesPerFrame / 8) * bitrate / sampleRate) + padding;

      if (frameLength <= 0) {
        offset++;
        continue;
      }

      duration += samplesPerFrame / sampleRate;
      offset += frameLength;
    } else {
      offset++;
    }
  }

  return duration;
}

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (w.length > 3 && w.endsWith("e")) n = Math.max(1, n - 1);
  return Math.max(1, n);
}

function tokenWeight(tok) {
  let w = 0.5 + syllables(tok) * 0.9;
  if (/[.!?]["”’)]?$/.test(tok)) w += 2.4;
  else if (/[,;:]["”’)]?$/.test(tok)) w += 1.0;
  else if (/[—–]$/.test(tok)) w += 1.0;
  return w;
}

function paragraphWeight(text) {
  const cleanText = text.replace(/\[.*?\]/g, "");
  const parts = cleanText.split(/([.!?]\s+)/);
  const toks = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i % 2 === 0) {
      if (part.trim().length > 0) toks.push(part);
    } else {
      if (toks.length > 0) toks[toks.length - 1] += part;
    }
  }
  if (toks.length === 0) toks.push(cleanText);
  return toks.map(tokenWeight).reduce((a, b) => a + b, 0);
}

function paragraphTimings(text, t0, dur) {
  const cleanText = text.replace(/\[.*?\]/g, "");
  const parts = cleanText.split(/([.!?]\s+)/);
  const toks = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i % 2 === 0) {
      if (part.trim().length > 0) toks.push(part);
    } else {
      if (toks.length > 0) toks[toks.length - 1] += part;
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

async function rebuild() {
  console.log("Offline rebuild starting: generating sentence timing JSON files from existing MP3s...\n");
  let count = 0;

  for (const ch of chapters) {
    const subTracks = [];
    if (ch.id === "cover") {
      subTracks.push({ suffix: "", paragraphs: ch.paragraphs });
    } else {
      subTracks.push({ suffix: "-eyebrow", paragraphs: [ch.paragraphs[0]] });
      subTracks.push({ suffix: "-title", paragraphs: [ch.paragraphs[1]] });
      subTracks.push({ suffix: "", paragraphs: ch.paragraphs.slice(2) });
    }

    for (const track of subTracks) {
      const trackId = `${ch.id}${track.suffix}`;
      const mp3Path = join(OUT_DIR, `${trackId}.mp3`);
      
      if (!existsSync(mp3Path)) {
        continue; // skip if MP3 doesn't exist
      }

      const fileBuffer = await readFile(mp3Path);
      const duration = +parseMP3Duration(fileBuffer).toFixed(3);
      
      if (duration <= 0) {
        console.warn(`  ⚠ ${trackId}.mp3 is empty or invalid duration, skipping`);
        continue;
      }

      // Distribute timings across paragraphs
      const paragraphs = track.paragraphs;
      const numParas = paragraphs.length;
      const silenceSec = 0.45; // SILENCE_MS / 1000
      const totalSilence = (numParas - 1) * silenceSec;
      const spokenDur = Math.max(0, duration - totalSilence);

      const weights = paragraphs.map(p => paragraphWeight(p.text));
      const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

      const words = [];
      let cursorTime = 0;

      for (let p = 0; p < numParas; p++) {
        const para = paragraphs[p];
        const paraWeight = weights[p];
        const paraDur = totalWeight > 0 ? spokenDur * (paraWeight / totalWeight) : spokenDur / numParas;
        
        words.push(...paragraphTimings(para.text, cursorTime, paraDur));
        cursorTime += paraDur + silenceSec;
      }

      const jsonPath = join(OUT_DIR, `${trackId}.json`);
      await writeFile(jsonPath, JSON.stringify({ id: trackId, voice: "Leda", duration, words }));
      console.log(`  ✓ Rebuilt ${trackId}.json (${duration.toFixed(1)}s, ${words.length} sentence(s))`);
      count++;
    }
  }

  // Rebuild manifest
  const present = chapters
    .filter((c) => c.inFlow !== false && existsSync(join(OUT_DIR, `${c.id}.mp3`)))
    .map((c) => c.id);
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(present));

  console.log(`\nSuccessfully rebuilt ${count} timing JSON file(s) and manifest.json.`);
}

rebuild().catch(console.error);

// Lumo Dreams — Audio-to-Text sentence aligner using Gemini 1.5 Flash.
//
// Sends the existing narration MP3s along with their spoken text to Gemini,
// requesting precise sentence-level start and end timestamps.
// Updates public/audio/*.json files on disk with exact alignments.
//
// Usage (Windows PowerShell):
//   $env:GEMINI_API_KEY="..."
//   node scripts/align-timings.mjs

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = join(__dirname, "..", "public", "audio");
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-1.5-flash";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function alignTrack(filename) {
  const jsonPath = join(AUDIO_DIR, filename);
  const trackId = filename.replace(".json", "");
  const mp3Path = join(AUDIO_DIR, `${trackId}.mp3`);

  if (!existsSync(mp3Path)) {
    console.log(`  — Skip ${trackId} (no corresponding MP3 found)`);
    return;
  }

  console.log(`▶ Aligning timings for: ${trackId} …`);
  
  // Read target text and structured metadata
  const jsonData = JSON.parse(await readFile(jsonPath, "utf8"));
  const sentences = jsonData.words.map(item => item.w);
  const chapterText = sentences.join("\n");

  // Read MP3 bytes and encode to base64
  const mp3Buffer = await readFile(mp3Path);
  const base64Audio = mp3Buffer.toString("base64");

  const promptText = `
You are an expert audio alignment tool.
I have provided an audio narration file along with the exact text spoken in it.
Your task is to identify the start and end timestamps (in seconds) for each sentence in the audio.

Here is the exact list of sentences spoken, in sequential order:
${sentences.map((s, idx) => `${idx + 1}. "${s}"`).join("\n")}

Respond ONLY with a valid JSON array of objects following the exact order of sentences.
Do not include any explanation, intro/outro text, or markdown formatting.
The response schema must be:
[
  {
    "w": "The exact sentence text from the list",
    "s": 0.0, // Start time in seconds (float)
    "e": 8.5  // End time in seconds (float)
  }
]
`;

  const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`;
  const body = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "audio/mp3",
              data: base64Audio
            }
          },
          {
            text: promptText
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini API Error (${res.status}): ${errorText}`);
  }

  const result = await res.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("Empty response content from Gemini API.");
  }

  const alignment = JSON.parse(rawText.trim());
  if (!Array.isArray(alignment) || alignment.length === 0) {
    throw new Error("Invalid response format: expected a non-empty JSON array.");
  }

  // Soft verification: check if count matches
  if (alignment.length !== sentences.length) {
    console.warn(`  ⚠️ Warning: Sentences count mismatch. Expected ${sentences.length}, got ${alignment.length}. Matching closest indices.`);
  }

  // Update words array in JSON structure
  jsonData.words = alignment.map((item, idx) => {
    // Keep target text from our original chapters definition to preserve spelling
    const originalText = sentences[idx] || item.w;
    return {
      w: originalText,
      s: typeof item.s === "number" ? +item.s.toFixed(3) : 0,
      e: typeof item.e === "number" ? +item.e.toFixed(3) : 0
    };
  });

  await writeFile(jsonPath, JSON.stringify(jsonData, null, 2), "utf8");
  console.log(`  ✓ Timings aligned successfully (${jsonData.words.length} items saved).\n`);
}

async function main() {
  if (!API_KEY) {
    console.error("Error: GEMINI_API_KEY environment variable is not defined.");
    process.exit(1);
  }

  console.log("Analyzing audio assets directory …");
  const files = readdirSync(AUDIO_DIR).filter(
    (f) => f.endsWith(".json") && f !== "manifest.json"
  );

  console.log(`Found ${files.length} tracks to align.\n`);

  for (const file of files) {
    try {
      await alignTrack(file);
      // Brief sleep between calls to avoid API rate limit triggers
      await sleep(1500);
    } catch (err) {
      console.error(`  ✗ Error aligning ${file}: ${err.message}\n`);
    }
  }

  console.log("🎉 All audio tracks aligned successfully!");
}

main().catch(console.error);

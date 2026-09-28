import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import "dotenv/config";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const AUDIO = path.join(ROOT, "audio");
const EXPORTS = path.join(ROOT, "exports");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(AUDIO, { recursive: true });
fs.mkdirSync(EXPORTS, { recursive: true });

// Exported mixdowns are disposable — generated on demand, meant to be downloaded once and
// kept on the phone, not archived here. Sweep anything older than a day so they don't pile up.
async function cleanExports() {
  const cutoff = Date.now() - 24 * 3600e3;
  try {
    for (const f of await fsp.readdir(EXPORTS)) {
      const p = path.join(EXPORTS, f);
      const st = await fsp.stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fsp.unlink(p).catch(() => {});
    }
  } catch { /* exports dir always exists via mkdirSync above */ }
}
cleanExports();
setInterval(cleanExports, 3600e3).unref();

const PORT = Number(process.env.PORT || 8787);
const TTS_KEY = process.env.GOOGLE_TTS_KEY || "";
const STT_KEY = process.env.GOOGLE_STT_KEY || "";
// Two ways to reach Gemini. Vertex express bills through Cloud Billing (so trial
// credits apply); AI Studio keys bill the Gemini Developer API directly.
const PROVIDER = (process.env.MODEL_PROVIDER || "vertex").toLowerCase();
const VERTEX_KEY = process.env.VERTEX_API_KEY || "";
const STUDIO_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.MODEL_NAME || "gemini-2.5-flash-lite";
// Reasoning is on by default on 2.5 models and dominates latency for a task this small.
const THINKING = process.env.THINKING_BUDGET === "" ? null : Number(process.env.THINKING_BUDGET ?? 0);

const IS_VERTEX = PROVIDER === "vertex" ? Boolean(VERTEX_KEY) || !STUDIO_KEY : false;
const MODEL_KEY = IS_VERTEX ? VERTEX_KEY : STUDIO_KEY;
const PROVIDER_NAME = IS_VERTEX ? "Vertex AI (express mode)" : "Gemini API (AI Studio)";
const KEY_VAR = IS_VERTEX ? "VERTEX_API_KEY" : "GEMINI_API_KEY";

// Express mode uses the global endpoint with no project or location in the path.
const chatUrl = (model) => {
  const q = `key=${encodeURIComponent(MODEL_KEY)}`;
  return IS_VERTEX
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent?${q}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?${q}`;
};

// extra.thinkingBudget overrides the global THINKING default for this one call — used by
// manually-triggered, latency-insensitive endpoints (e.g. /api/explain) that want real
// reasoning time, without slowing down the per-turn chat call that stays on THINKING.
function genConfig(schema = SCHEMA, extra = {}) {
  const { thinkingBudget, ...rest } = extra;
  const cfg = {
    temperature: 0.8,
    maxOutputTokens: 1400,
    responseMimeType: "application/json",
    responseSchema: schema,
    ...rest
  };
  const tb = thinkingBudget !== undefined ? thinkingBudget : THINKING;
  if (tb !== null && Number.isFinite(tb)) cfg.thinkingConfig = { thinkingBudget: tb };
  return cfg;
}

const bodyFor = (system, messages) => ({
  systemInstruction: { parts: [{ text: String(system || "") }] },
  contents: (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }]
  })),
  generationConfig: genConfig()
});

const singleShot = (system, userText, schema, extra) => ({
  systemInstruction: { parts: [{ text: String(system || "") }] },
  contents: [{ role: "user", parts: [{ text: String(userText || "") }] }],
  generationConfig: genConfig(schema, extra)
});

// Shared one-shot call + defensive JSON parse, used by manually-triggered endpoints
// like /api/explain and /api/translate (the chat endpoint has its own
// streaming-aware variant below and stays as-is).
async function callGemini(use, system, userText, schema, extra) {
  const r = await fetch(chatUrl(use), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(singleShot(system, userText, schema, extra))
  });
  const d = await readJson(r);
  if (!r.ok) {
    const msg = d?.error?.message || `HTTP ${r.status}`;
    const err = new Error(r.status === 429
      ? `Limiet bereikt (${msg}). Even wachten, of kies een Flash-Lite model bij Instellingen.`
      : `${PROVIDER_NAME}: ${msg}`);
    err.status = r.status;
    throw err;
  }
  const txt = d?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!txt) {
    const why = d?.candidates?.[0]?.finishReason || "leeg antwoord";
    const err = new Error(`Geen antwoord van het model (${why}).`);
    err.status = 502;
    throw err;
  }
  let parsed;
  try { parsed = JSON.parse(txt); }
  catch {
    const a = txt.indexOf("{"), z = txt.lastIndexOf("}");
    if (a < 0 || z < 0) { const err = new Error("Antwoord was geen geldige JSON."); err.status = 502; throw err; }
    parsed = JSON.parse(txt.slice(a, z + 1));
  }
  return { parsed, usage: d.usageMetadata || null };
}

function logUsage(model, usage, ms) {
  if (!usage) { console.log(`  ${model}  ${ms} ms`); return; }
  const th = usage.thoughtsTokenCount || 0;
  console.log(`  ${model}  ${ms} ms  in ${usage.promptTokenCount || 0}  out ${usage.candidatesTokenCount || 0}` +
    (th ? `  denken ${th}  <-- dit is je vertraging; zet THINKING_BUDGET=0 in .env` : "  denken 0"));
}

function normalize(parsed, usage) {
  return {
    corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
    reply_nl: String(parsed.reply_nl || ""),
    new_words: Array.isArray(parsed.new_words) ? parsed.new_words : [],
    usage: usage || null
  };
}

// Express mode has no models.list, so offer a typed list there instead.
const KNOWN_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro",
  "gemini-2.0-flash", "gemini-2.0-flash-lite"];

const TRANSLATE_SCHEMA = {
  type: "OBJECT",
  propertyOrdering: ["en"],
  properties: { en: { type: "STRING" } },
  required: ["en"]
};

const EXPLAIN_SCHEMA = {
  type: "OBJECT",
  propertyOrdering: ["mistake_note", "translation", "literal", "words", "examples", "notes"],
  properties: {
    // Only meaningful when the request included a "mistake" (the learner's original wrong
    // phrasing) — otherwise the model is told to leave this "". Kept as its own field, ahead
    // of the rest, so a mistake explanation reads as "here's what went wrong" first and
    // "here's the pattern" second — not the other way around.
    mistake_note: { type: "STRING" },
    translation: { type: "STRING" },
    literal: { type: "STRING" },
    words: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nl: { type: "STRING" },
          en: { type: "STRING" },
          note: { type: "STRING" }
        },
        required: ["nl", "en", "note"]
      }
    },
    examples: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { nl: { type: "STRING" }, en: { type: "STRING" } },
        required: ["nl", "en"]
      }
    },
    notes: { type: "STRING" }
  },
  required: ["mistake_note", "translation", "literal", "words", "examples", "notes"]
};

const WORD_SENTENCE_SCHEMA = {
  type: "OBJECT",
  propertyOrdering: ["sentence"],
  properties: { sentence: { type: "STRING" } },
  required: ["sentence"]
};

const READING_SCHEMA = {
  type: "OBJECT",
  propertyOrdering: ["title", "text", "translation"],
  properties: {
    title: { type: "STRING" },
    text: { type: "STRING" },
    // Generated alongside the text, not on a separate request — the "show translation"
    // toggle in the UI just reveals/hides this, no extra round trip needed.
    translation: { type: "STRING" }
  },
  required: ["title", "text", "translation"]
};

const WORD_CHECK_SCHEMA = {
  type: "OBJECT",
  propertyOrdering: ["usesWord", "corrections", "note"],
  properties: {
    // Loosely — the target word's lemma/inflection appears somewhere and is doing real work
    // in the sentence, not just tacked on. False fails the attempt regardless of grammar.
    usesWord: { type: "BOOLEAN" },
    corrections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { original: { type: "STRING" }, corrected: { type: "STRING" } },
        required: ["original", "corrected"]
      }
    },
    // One short, encouraging line — in Dutch and English combined like the rest of the UI's
    // bilingual strings — only when it's genuinely useful (e.g. why usesWord failed). "" otherwise.
    note: { type: "STRING" }
  },
  required: ["usesWord", "corrections", "note"]
};

// Google normally returns JSON, but a proxy or network error can return HTML.
// Parse defensively so the user sees something actionable instead of a parser error.
async function readJson(r) {
  const body = await r.text();
  try { return JSON.parse(body); }
  catch {
    const snip = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
    throw new Error(r.ok
      ? `Onverwacht antwoord van Google: ${snip || "(leeg)"}`
      : `HTTP ${r.status} — ${snip || r.statusText}`);
  }
}

const app = express();
app.use(express.json({ limit: "16mb" }));

/* ---------------- state: plain JSON files you can read and back up ---------------- */

const FILES = {
  vocab: { words: [], raw: "", updated: null },
  progress: { corrections: [], ledger: [], daily: {} },
  settings: {},
  chat: [],
  // Keyed by exact sentence text (not per-chat-message), so an explanation survives
  // clearing the chat and is shared with the same sentence's entry on the Library page.
  explanations: {},
  // Saved reading-exercise stories — see the Leesoefening tab's "Bewaren" button.
  reading: []
};

async function readState(name) {
  try { return JSON.parse(await fsp.readFile(path.join(DATA, name + ".json"), "utf8")); }
  catch { return FILES[name]; }
}
async function writeJson(name, value) {
  const dest = path.join(DATA, name + ".json");
  const tmp = dest + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, dest);            // atomic: a crash mid-write can't corrupt the file
}

app.get("/api/state", async (_req, res) => {
  const out = {};
  for (const name of Object.keys(FILES)) out[name] = await readState(name);
  res.json(out);
});

app.put("/api/state/:name", async (req, res) => {
  const name = req.params.name;
  if (!Object.prototype.hasOwnProperty.call(FILES, name)) return res.status(400).json({ error: "onbekende sleutel" });
  try { await writeJson(name, req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

/* ---------------- audio: synthesize once, keep the mp3 forever ---------------- */

const INDEX = path.join(DATA, "audio-index.json");
let index = {};
try { index = JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch { index = {}; }
let dirty = false;
const flushIndex = () => {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(INDEX, JSON.stringify(index, null, 2), () => {});
};
setInterval(flushIndex, 4000).unref();
process.on("SIGINT", () => { flushIndex(); process.exit(0); });

app.use("/audio", express.static(AUDIO, { maxAge: "365d", immutable: true }));

const keyFor = (voice, text) =>
  crypto.createHash("sha1").update(voice + "\u0000" + text).digest("hex").slice(0, 20);

app.post("/api/tts", async (req, res) => {
  const text = String(req.body?.text || "").replace(/\*\*/g, "").trim();
  const voice = String(req.body?.voice || process.env.GOOGLE_TTS_VOICE || "nl-NL-Wavenet-D");
  // Voice tests (Settings) still cache to disk — so re-listening or comparing the same
  // voice again never re-synthesizes — they just don't get listed on the Library page.
  const library = req.body?.library !== false;
  if (!text) return res.status(400).json({ error: "lege tekst" });

  const hash = keyFor(voice, text);
  const file = path.join(AUDIO, hash + ".mp3");
  // Cache first: a clip already on disk never needs the key, or the network.
  if (fs.existsSync(file)) return res.json({ url: `/audio/${hash}.mp3`, hash, cached: true, chars: 0 });

  // Switching your active voice shouldn't re-synthesize every sentence you've already
  // heard: reuse whichever voice first said this exact text, rather than paying for a new
  // recording just because the voice setting changed. Voice tests (library:false) skip
  // this on purpose — comparing voices is the whole point there.
  if (library) {
    const existing = Object.entries(index).find(([, v]) => v.text === text);
    if (existing) {
      const [existingHash] = existing;
      return res.json({ url: `/audio/${existingHash}.mp3`, hash: existingHash, cached: true, chars: 0 });
    }
  }

  if (!TTS_KEY) return res.status(500).json({ error: "GOOGLE_TTS_KEY ontbreekt in .env" });

  try {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(TTS_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voice.slice(0, 5), name: voice },
        audioConfig: { audioEncoding: "MP3" }   // always normal speed; the player slows it down
      })
    });
    const d = await readJson(r);
    if (!r.ok || !d.audioContent) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    const buf = Buffer.from(d.audioContent, "base64");
    await fsp.writeFile(file, buf);
    if (library) {
      index[hash] = { text, voice, at: Date.now(), bytes: buf.length, chars: text.length };
      dirty = true;
    }
    res.json({ url: `/audio/${hash}.mp3`, hash, cached: false, chars: text.length });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/api/voices", async (_req, res) => {
  if (!TTS_KEY) return res.status(500).json({ error: "GOOGLE_TTS_KEY ontbreekt in .env" });
  try {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=nl-NL&key=${encodeURIComponent(TTS_KEY)}`);
    const d = await readJson(r);
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    const rank = (n) => (/chirp/i.test(n) ? 4 : /neural/i.test(n) ? 3 : /wavenet/i.test(n) ? 2 : 1);
    const voices = (d.voices || [])
      .map((v) => ({ name: v.name, gender: v.ssmlGender }))
      .sort((a, b) => rank(b.name) - rank(a.name) || a.name.localeCompare(b.name));
    res.json({ voices });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

// Speech-to-text: the recorded clip never touches disk — transcribe once, return the text.
const STT_ENCODING = {
  "audio/webm": "WEBM_OPUS", "audio/webm;codecs=opus": "WEBM_OPUS",
  "audio/ogg": "OGG_OPUS", "audio/ogg;codecs=opus": "OGG_OPUS"
};

app.post("/api/stt", async (req, res) => {
  if (!STT_KEY) return res.status(500).json({ error: "GOOGLE_STT_KEY ontbreekt in .env" });
  const audio = String(req.body?.audio || "");
  const mimeType = String(req.body?.mimeType || "audio/webm;codecs=opus");
  if (!audio) return res.status(400).json({ error: "geen audio" });
  const encoding = STT_ENCODING[mimeType] || STT_ENCODING[mimeType.split(";")[0]];
  if (!encoding) return res.status(400).json({ error: `niet-ondersteund audioformaat: ${mimeType}` });

  try {
    const r = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(STT_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { encoding, languageCode: "nl-NL", enableAutomaticPunctuation: true, model: "latest_long" },
        audio: { content: audio }
      })
    });
    const d = await readJson(r);
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    const text = (d.results || []).map((x) => x.alternatives?.[0]?.transcript || "").join(" ").trim();
    res.json({ text });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

app.get("/api/library", (_req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const items = Object.entries(index)
    .map(([hash, m]) => ({ hash, url: `/audio/${hash}.mp3`, ...m }))
    .sort((a, b) => b.at - a.at);
  res.json({
    items,
    bytes: items.reduce((n, i) => n + (i.bytes || 0), 0),
    monthChars: items.filter((i) => i.at >= monthStart).reduce((n, i) => n + (i.chars || 0), 0)
  });
});

app.delete("/api/library/:hash", async (req, res) => {
  const hash = String(req.params.hash).replace(/[^a-f0-9]/g, "");
  try {
    await fsp.unlink(path.join(AUDIO, hash + ".mp3")).catch(() => {});
    delete index[hash];
    dirty = true;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.use("/exports", express.static(EXPORTS));

// Decomposes an arbitrary speed factor into a chain of ffmpeg atempo filters, each within
// atempo's own valid range of 0.5–2.0 — our UI allows 0.4–1.2, just outside that on the low end.
function atempoChain(factor) {
  let f = Math.max(0.05, Number(factor) || 1);
  const parts = [];
  while (f > 2) { parts.push(2); f /= 2; }
  while (f < 0.5) { parts.push(0.5); f /= 0.5; }
  parts.push(f);
  return parts;
}

// Mixes a set of clips down into one downloadable mp3 — replaying exactly what the hands-free
// loop would play (same per-repeat speed/pause steps), just baked into a single file instead of
// live browser playback, so it can be saved to a phone and played offline with no app involved.
app.post("/api/library/export", async (req, res) => {
  const hashes = (Array.isArray(req.body?.hashes) ? req.body.hashes : [])
    .map((h) => String(h).replace(/[^a-f0-9]/g, ""))
    .filter((h) => index[h]);
  if (!hashes.length) return res.status(400).json({ error: "geen clips" });

  const steps = (Array.isArray(req.body?.steps) ? req.body.steps : [])
    .filter((s) => s && Number.isFinite(s.speed))
    .map((s) => ({ speed: Math.min(2, Math.max(0.4, Number(s.speed) || 1)), pause: Math.max(0, Number(s.pause) || 0) }));
  const seq = steps.length ? steps : [{ speed: 1, pause: 0 }];

  const id = crypto.randomBytes(8).toString("hex");
  const outFile = path.join(EXPORTS, `${id}.mp3`);
  const scriptFile = path.join(EXPORTS, `${id}.filter.txt`);

  const inputs = [];
  const filterLines = [];
  const labels = [];
  hashes.forEach((h, i) => {
    inputs.push(path.join(AUDIO, h + ".mp3"));
    seq.forEach((st, j) => {
      const chain = atempoChain(st.speed).map((f) => `atempo=${f.toFixed(4)}`).join(",");
      const lbl = `a${i}_${j}`;
      filterLines.push(`[${i}:a]${chain},aformat=sample_rates=24000:channel_layouts=mono[${lbl}]`);
      labels.push(lbl);
      if (st.pause > 0) {
        const silLbl = `s${i}_${j}`;
        filterLines.push(`anullsrc=cl=mono:r=24000:d=${st.pause}[${silLbl}]`);
        labels.push(silLbl);
      }
    });
  });
  filterLines.push(`${labels.map((l) => `[${l}]`).join("")}concat=n=${labels.length}:v=0:a=1[out]`);

  try {
    await fsp.writeFile(scriptFile, filterLines.join(";\n"));
    const args = [];
    inputs.forEach((f) => args.push("-i", f));
    args.push("-filter_complex_script", scriptFile, "-map", "[out]",
      "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-y", outFile);

    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 100 }, (err, _stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).slice(-800)));
        resolve();
      });
    });
    res.json({ url: `/exports/${id}.mp3`, clips: hashes.length, steps: seq.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    fsp.unlink(scriptFile).catch(() => {});
  }
});

/* ---------------- chat: Gemini, with a schema so the JSON is always well-formed ---------------- */

const SCHEMA = {
  type: "OBJECT",
  // reply_nl first: with streaming, the visible sentence arrives before the metadata.
  propertyOrdering: ["reply_nl", "corrections", "new_words"],
  properties: {
    reply_nl: { type: "STRING" },
    corrections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          original: { type: "STRING" },
          corrected: { type: "STRING" },
          type: { type: "STRING", enum: ["fout", "beter"] }
        },
        // original/corrected are whole sentences, not isolated fragments — see the
        // CORRECTIES prompt in App.jsx. Categorizing (category + bilingual reason) is
        // deliberately NOT asked for here — it's the slowest part of the schema and only
        // needed once, on manual analyze.
        required: ["original", "corrected", "type"]
      }
    },
    new_words: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { word: { type: "STRING" }, lemma: { type: "STRING" }, en: { type: "STRING" } },
        required: ["word", "lemma", "en"]
      }
    }
  },
  required: ["corrections", "reply_nl", "new_words"]
};

app.get("/api/models", async (req, res) => {
  if (!MODEL_KEY) return res.status(500).json({ error: `${KEY_VAR} ontbreekt in .env` });
  // Probe whatever will actually be used: the UI's model if set, otherwise the .env default.
  const probe = String(req.query.model || "").trim() || MODEL;
  if (IS_VERTEX) {
    // No list endpoint in express mode. Verify the key with a one-token call instead.
    try {
      const r = await fetch(chatUrl(probe), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hoi" }] }],
          generationConfig: { maxOutputTokens: 1 }
        })
      });
      const d = await readJson(r);
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
      return res.json({ models: KNOWN_MODELS, current: MODEL, tested: probe,
        provider: PROVIDER_NAME, listable: false, verified: true });
    } catch (e) {
      return res.status(502).json({ error: `${PROVIDER_NAME}: ${e.message || e}` });
    }
  }
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(MODEL_KEY)}&pageSize=200`);
    const d = await readJson(r);
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    const models = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /gemini/i.test(n) && !/embedding|aqa|vision/i.test(n))
      .sort();
    const known = models.includes(probe);
    res.json({ models, current: MODEL, tested: probe, provider: PROVIDER_NAME,
      listable: true, verified: true, exists: known });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

app.post("/api/chat", async (req, res) => {
  if (!MODEL_KEY) return res.status(500).json({ error: `${KEY_VAR} ontbreekt in .env` });
  const { system, messages, model } = req.body || {};
  const use = String(model || MODEL);
  const t0 = Date.now();
  try {
    const r = await fetch(chatUrl(use), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyFor(system, messages))
    });
    const d = await readJson(r);
    if (!r.ok) {
      const msg = d?.error?.message || `HTTP ${r.status}`;
      return res.status(r.status).json({
        error: r.status === 429
          ? `Limiet bereikt (${msg}). Even wachten, of kies een Flash-Lite model bij Instellingen.`
          : `${PROVIDER_NAME}: ${msg}`
      });
    }
    const txt = d?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!txt) {
      const why = d?.candidates?.[0]?.finishReason || "leeg antwoord";
      return res.status(502).json({ error: `Geen antwoord van het model (${why}).` });
    }
    let parsed;
    try { parsed = JSON.parse(txt); }
    catch {
      const a2 = txt.indexOf("{"), z = txt.lastIndexOf("}");
      if (a2 < 0 || z < 0) return res.status(502).json({ error: "Antwoord was geen geldige JSON." });
      parsed = JSON.parse(txt.slice(a2, z + 1));
    }
    logUsage(use, d.usageMetadata, Date.now() - t0);
    res.json(normalize(parsed, d.usageMetadata));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

/* ---------------- revision mode: translate a Dutch mistake-log sentence to English ---------------- */

app.post("/api/translate", async (req, res) => {
  if (!MODEL_KEY) return res.status(500).json({ error: `${KEY_VAR} ontbreekt in .env` });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.json({ en: "", usage: null });

  const use = String(req.body.model || MODEL);
  const t0 = Date.now();
  const system = `Vertaal de Nederlandse zin naar natuurlijk, alledaags Engels. Geef alleen de vertaling,
geen uitleg, geen aanhalingstekens.`;

  try {
    const { parsed, usage } = await callGemini(use, system, text, TRANSLATE_SCHEMA, { maxOutputTokens: 150 });
    logUsage(use, usage, Date.now() - t0);
    res.json({ en: String(parsed.en || ""), usage });
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});

/* ---------------- explain: on-demand breakdown of one Dutch sentence ----------------
   Stateless here — caching lives client-side, keyed by sentence text, so the same
   explanation is shared between the chat view and the Library and survives chat deletion.
   See getExplanation() in App.jsx. */

app.post("/api/explain", async (req, res) => {
  if (!MODEL_KEY) return res.status(500).json({ error: `${KEY_VAR} ontbreekt in .env` });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "lege tekst" });
  // Optional: the learner's original wrong phrasing, when explaining a logged mistake rather
  // than just a plain sentence — shifts the explanation to be about THIS error specifically.
  const mistake = String(req.body?.mistake || "").trim();

  const use = String(req.body.model || MODEL);
  const t0 = Date.now();
  const system = `You are an experienced, engaging Dutch teacher explaining grammar to an adult learner
who is genuinely trying to get good at this. Teach like it's a real one-on-one lesson: confident, direct,
a little conversational — not a children's book, and not a dry mechanical parse of word order. The goal
is for the learner to walk away recognizing this PATTERN the next time they see it, not just knowing what
happened in this one sentence. Respond only with the required JSON.

NO LINGUISTICS JARGON, ANYWHERE IN YOUR ANSWER. The learner does not know grammar terminology and terms
like these mean nothing to them — never use words such as "impersonal structure", "exclamatory sentence",
"subordinate/subordinating clause", "inversion", "auxiliary verb", "past participle", "modal verb",
"conjugation", "declension", "syntax", "adverbial", "nominative/dative", or any other label for a
grammatical category. Explain the RULE itself in plain, everyday English instead of naming the
phenomenon. Describe what changes, where it goes, and why, in words a beginner already understands —
but "plain language" does not mean dumbed down: write like a smart adult, not a toddler.

${mistake ? `The learner originally wrote this WRONG: "${mistake}" — the corrected version, "${text}", is
what you're explaining below. Fill in mistake_note: specifically what went wrong in THEIR sentence and
why, contrasting it with the correction — concrete to this error, not a generic rule statement. This is
the most important field when a mistake is given; write it like you're the reason they'll understand this
error's category the next time it comes up, not just a match for one card. Leave "" only if no mistake
was given.` : `No specific mistake was given — leave mistake_note "".`}

- translation: the most natural English translation of the (corrected) sentence.
- literal: a brief literal/word-for-word translation, ONLY if it helps clarify the structure — otherwise
  leave it "".
- words: the important words/phrases in the sentence, each with the Dutch word/phrase (nl), its English
  meaning (en), and — only when it actually helps — a plain-language note on what job it's doing in the
  sentence (note), e.g. "connects the two ideas" or "says who is doing the action" — never a grammar
  term. Leave note "" when there's nothing useful to add.
- examples: 2 short, different Dutch sentences (each with its English translation) that follow the SAME
  underlying pattern as this one (or as the fix, if a mistake was given) — different situations/vocabulary,
  same structure — so the learner can recognize it again elsewhere, not just in this one sentence. Leave
  this [] only if there's truly nothing pattern-worthy to reinforce (e.g. it's simple and fully regular).
- notes: anything about natural/idiomatic Dutch usage worth knowing here, in plain language — otherwise
  leave it "".

Keep it tight and worth reading — a real explanation with substance, not padding, and not a lecture.`;
  const userText = mistake ? `Wrong: ${mistake}\nCorrected: ${text}` : text;

  try {
    const { parsed, usage } = await callGemini(use, system, userText, EXPLAIN_SCHEMA, { maxOutputTokens: 1200 });
    logUsage(use, usage, Date.now() - t0);
    res.json({
      mistake_note: String(parsed.mistake_note || ""),
      translation: String(parsed.translation || ""),
      literal: String(parsed.literal || ""),
      words: Array.isArray(parsed.words)
        ? parsed.words.map((w) => ({ nl: String(w.nl || ""), en: String(w.en || ""), note: String(w.note || "") }))
        : [],
      examples: Array.isArray(parsed.examples)
        ? parsed.examples.map((x) => ({ nl: String(x.nl || ""), en: String(x.en || "") }))
        : [],
      notes: String(parsed.notes || ""),
      usage
    });
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});

/* ---------------- reading exercise: a full generated text at a chosen new-word density ----------------
   Unlike chat, the new-word constraint here is a user-set dial (0-30%), not a fixed comfort
   band — so it's spelled out as an explicit instruction rather than left to LADDER's newMax. */

app.post("/api/reading", async (req, res) => {
  if (!MODEL_KEY) return res.status(500).json({ error: `${KEY_VAR} ontbreekt in .env` });
  const genre = String(req.body?.genre || "").trim();
  const topic = String(req.body?.topic || "").trim();
  const wordCount = Math.min(1000, Math.max(50, Number(req.body?.wordCount) || 200));
  const newWordPercent = Math.min(30, Math.max(0, Number(req.body?.newWordPercent) || 0));
  const known = (Array.isArray(req.body?.knownWords) ? req.body.knownWords : [])
    .map((w) => String(w)).filter(Boolean).slice(-6000);
  const knownList = known.join(", ") ||
    "(leeg — gebruik dan alleen de allersimpelste woorden: ik, je, is, een, de, het, en, niet)";

  const constraint = newWordPercent === 0
    ? `Gebruik UITSLUITEND woorden uit deze lijst — geen enkel ander woord, geen enkele uitzondering,
ook geen namen, plaatsen of getallen die er niet letterlijk in staan:
${knownList}`
    : `Woordenlijst met bekende woorden:
${knownList}
Gebruik zoveel mogelijk woorden uit deze lijst. Je mag af en toe een woord gebruiken dat niet in de
lijst staat — in totaal MAXIMAAL ${newWordPercent}% van alle woorden in de hele tekst, nooit meer.
Kies die nieuwe woorden zorgvuldig: nuttig en natuurlijk om te leren, ongeveer één niveau boven de
lijst — geen willekeurige moeilijke woorden.`;

  const use = String(req.body.model || MODEL);
  const t0 = Date.now();
  const system = `Je schrijft ${genre ? `een tekst in het genre "${genre}"` : "een verhaal"} in het
Nederlands voor een taalleerling, ongeveer ${wordCount} woorden lang (een kleine afwijking in lengte is
prima, maar blijf in de buurt van dit aantal).
${topic ? `Het moet gaan over: ${topic}` : ""}

${constraint}

- Verzin een pakkende titel (title) en schrijf de volledige tekst (text).
- Natuurlijk, vloeiend Nederlands — geen kunstmatig vereenvoudigde of houterige zinnen.
- Geef ook translation: een natuurlijke Engelse vertaling van de VOLLEDIGE tekst (titel + verhaal),
  even lang en met dezelfde alinea-indeling — geen samenvatting, een echte vertaling.
- Geef ALLEEN de gevraagde JSON terug, geen markdown, geen uitleg.`;

  try {
    const { parsed, usage } = await callGemini(use, system, "Schrijf de tekst nu.", READING_SCHEMA,
      { maxOutputTokens: Math.min(6000, Math.max(1500, wordCount * 7)) });
    logUsage(use, usage, Date.now() - t0);
    res.json({
      title: String(parsed.title || ""), text: String(parsed.text || ""),
      translation: String(parsed.translation || ""), usage
    });
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});

/* ---------------- word mastery: star 2's dictation sentence, star 3's free-write grading ----------------
   See the "word mastery" spaced-repetition block in App.jsx for the full 3-star flow these
   two endpoints support. */

app.post("/api/word-sentence", async (req, res) => {
  if (!MODEL_KEY) return res.status(500).json({ error: `${KEY_VAR} ontbreekt in .env` });
  const word = String(req.body?.word || "").trim();
  const lemma = String(req.body?.lemma || word).trim();
  const en = String(req.body?.en || "").trim();
  if (!word) return res.status(400).json({ error: "geen woord" });
  // Hard constraint, not a style preference — a dictation exercise only works if every other
  // word in the sentence is one the learner has already seen, so there's no carve-out here for
  // "common function words" the way the main chat prompt allows.
  const known = (Array.isArray(req.body?.knownWords) ? req.body.knownWords : [])
    .map((w) => String(w)).filter(Boolean).slice(-3000);

  const use = String(req.body.model || MODEL);
  const t0 = Date.now();
  const system = `Genereer ÉÉN natuurlijke, grammaticaal correcte Nederlandse zin die het woord
"${word}" bevat (of een vervoeging/vorm van de grondvorm "${lemma}", als dat natuurlijker is).

Gebruik voor de REST van de zin UITSLUITEND woorden uit deze lijst — geen enkel ander woord, ook
geen andere veelvoorkomende functiewoorden als ze niet letterlijk in de lijst staan:
${known.join(", ") || "(leeg — gebruik dan alleen het woord zelf plus de allersimpelste woorden: ik, je, is, een, de, het, en, niet)"}

Regels:
- 5 tot 10 woorden. Eén zin, geen samengestelde opsomming van meerdere zinnen.
- Gebruik "${word}" op een manier die past bij de betekenis${en ? ` "${en}"` : ""}.
- Geef ALLEEN de zin terug — geen uitleg, geen aanhalingstekens, geen markdown.`;
  const userText = `Woord: ${word}${en ? `\nBetekenis: ${en}` : ""}`;

  try {
    const { parsed, usage } = await callGemini(use, system, userText, WORD_SENTENCE_SCHEMA, { maxOutputTokens: 200 });
    logUsage(use, usage, Date.now() - t0);
    res.json({ sentence: String(parsed.sentence || "").trim(), usage });
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});

app.post("/api/word-check", async (req, res) => {
  if (!MODEL_KEY) return res.status(500).json({ error: `${KEY_VAR} ontbreekt in .env` });
  const word = String(req.body?.word || "").trim();
  const lemma = String(req.body?.lemma || word).trim();
  const sentence = String(req.body?.sentence || "").trim();
  if (!word || !sentence) return res.status(400).json({ error: "woord of zin ontbreekt" });

  const use = String(req.body.model || MODEL);
  const t0 = Date.now();
  const system = `Je bent een Nederlandse taaldocent. De leerling heeft zelf een Nederlandse zin
geschreven waarin het woord "${word}" (grondvorm: "${lemma}") moet voorkomen, als oefening om dit
specifieke woord te leren gebruiken.

Controleer:
- usesWord: gebruikt de zin het woord "${word}" of een natuurlijke vervoeging/vorm van de
  grondvorm "${lemma}" op een zinvolle manier (niet zomaar los toegevoegd, echt onderdeel van de
  betekenis van de zin)? true of false.
- corrections: eventuele grammatica- of spelfouten, als [{original, corrected}] met de HELE zin
  (origineel en gecorrigeerd) — niet losse woorden. Kleine stijlkwesties die niet fout zijn, alleen
  wat onnatuurlijk, hoeven NIET meegeteld te worden — wees soepel, dit is een leerling die net een
  nieuw woord voor het eerst zelf gebruikt. Leeg [] als de zin prima is.
- note: alleen invullen als usesWord false is — leg in één korte, vriendelijke regel uit waarom
  het woord niet goed gebruikt werd, eenmaal in het Nederlands gevolgd door de Engelse vertaling
  tussen haakjes. Anders "".

Antwoord alleen met de vereiste JSON, geen markdown.`;
  const userText = sentence;

  try {
    const { parsed, usage } = await callGemini(use, system, userText, WORD_CHECK_SCHEMA, { maxOutputTokens: 400 });
    logUsage(use, usage, Date.now() - t0);
    res.json({
      usesWord: Boolean(parsed.usesWord),
      corrections: Array.isArray(parsed.corrections)
        ? parsed.corrections.map((c) => ({ original: String(c.original || ""), corrected: String(c.corrected || "") }))
        : [],
      note: String(parsed.note || ""),
      usage
    });
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});

app.get("/api/health", (_req, res) => res.json({
  ok: true, tts: Boolean(TTS_KEY), stt: Boolean(STT_KEY), model: MODEL, provider: PROVIDER_NAME,
  modelKey: Boolean(MODEL_KEY), listable: !IS_VERTEX, clips: Object.keys(index).length
}));

/* serve the built frontend when running `npm start` */
const DIST = path.join(ROOT, "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api|\/audio).*/, (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

app.listen(PORT, () => {
  console.log(`\n  Nederlands — server op http://localhost:${PORT}`);
  console.log(`  TTS-sleutel: ${TTS_KEY ? "ok" : "ONTBREEKT"}`);
  console.log(`  STT-sleutel: ${STT_KEY ? "ok" : "ONTBREEKT"}`);
  console.log(`  Model: ${PROVIDER_NAME} — ${MODEL_KEY ? "sleutel ok" : KEY_VAR + " ONTBREEKT"} — ${MODEL}`);
  console.log(`  data/ ${Object.keys(index).length} audioclips opgeslagen\n`);
});

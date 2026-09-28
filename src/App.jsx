import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend
} from "recharts";
import {
  MessageSquare, BookOpen, AlertCircle, Sparkles, TrendingUp, Settings,
  Play, Volume2, Download, Upload, Trash2, Check, Search, Send,
  Clock, Plus, X, Pause, RotateCcw, VolumeX, Headphones, Eye, Languages, HelpCircle,
  Mic, Square, Star, Info, GraduationCap, Save, BookOpenText, Trophy, PenLine
} from "lucide-react";

/* ============================================================
   NEDERLANDS — A1 → C1
   Palette: Delft blue on porcelain. Soft cards, generous radii.
   Chrome = Plus Jakarta Sans. Dutch content = Newsreader.
   ============================================================ */


/* ================= labels ================= */

/* ================= language utilities ================= */

// Concrete constraints per level. A CEFR label alone lets the model drift upward;
// clause count, sentence length and permitted tenses hold it down.
const LADDER = {
  "A1":  { words: "5 tot 8", clauses: "één hoofdzin per zin, geen bijzinnen",
           tense: "alleen tegenwoordige tijd", newMax: 1, sentences: "2" },
  "A2":  { words: "8 tot 12", clauses: "hoofdzinnen; bijzinnen alleen met omdat, dat, als",
           tense: "tegenwoordige tijd en voltooid tegenwoordige tijd (hebben/zijn + voltooid deelwoord); geen passief, geen conditionalis",
           newMax: 2, sentences: "2 tot 3" },
  "A2+": { words: "10 tot 14", clauses: "bijzinnen met omdat, dat, als, toen; relatieve bijzinnen met die/dat",
           tense: "ook onvoltooid verleden tijd van veelgebruikte werkwoorden; nog geen passief",
           newMax: 2, sentences: "2 tot 3" },
  "B1":  { words: "12 tot 18", clauses: "bijzinnen met hoewel, terwijl, zodra, om ... te",
           tense: "alle gangbare tijden, passief en conditionalis mogen",
           newMax: 3, sentences: "3 tot 4" },
  "B1+": { words: "14 tot 20", clauses: "vrije zinsbouw",
           tense: "alle tijden; vaste uitdrukkingen mogen",
           newMax: 4, sentences: "3 tot 4" },
  "B2":  { words: "16 tot 24", clauses: "complexere bijzinnen, samengestelde zinnen, nominalisaties mogen",
           tense: "alle tijden vloeiend, ook lijdende vorm en constructies met zou/zouden",
           newMax: 5, sentences: "3 tot 5" },
  "C1":  { words: "18 tot 28", clauses: "genuanceerde en complexe zinsbouw, idiomatische uitdrukkingen",
           tense: "volledige beheersing van alle tijden en stijlregisters", newMax: 6, sentences: "4 tot 5" }
};

// Share of words in a reply that fall outside the learner's vocabulary.
// Around 5% is comfortable; above 10% comprehension breaks down.
function unknownRatio(text, knownSet, haveList) {
  if (!haveList) return null;
  const words = String(text).replace(/\*\*/g, "").toLowerCase().match(/[a-zà-ü]+/g) || [];
  if (words.length < 4) return null;
  const unknown = words.filter((w) => w.length > 1 && !isKnown(w, knownSet)).length;
  return +(unknown / words.length * 100).toFixed(1);
}

// The model is asked to bold every new word, but it doesn't always comply.
// Bold anything it missed too, so the highlighting always matches unknownRatio.
function boldUnknown(text, knownSet) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p) => (p.startsWith("**") && p.endsWith("**")
    ? p
    : p.replace(/[a-zà-ü]+/gi, (w) => (w.length > 1 && !isKnown(w, knownSet) ? `**${w}**` : w))
  )).join("");
}

const CLEAN = /[^a-zàáâäèéêëìíîïòóôöùúûüçñß]/g;

function variants(raw) {
  const w = String(raw).toLowerCase().replace(CLEAN, "");
  if (w.length < 2) return [];
  const out = new Set([w]);
  const add = (s) => { if (s && s.length > 1) out.add(s); };
  const sufs = ["sten","ste","ende","end","den","ten","en","er","st","e","s","t","d","n"];
  for (const suf of sufs) {
    if (w.length > suf.length + 1 && w.endsWith(suf)) {
      const b = w.slice(0, w.length - suf.length);
      add(b);
      if (/(.)\1$/.test(b)) add(b.slice(0, -1));                      // mannen -> man
      const m = b.match(/^(.*?)([aeiou])([bcdfghklmnprstvwxz])$/);
      if (m) {                                                        // namen -> naam
        add(m[1] + m[2] + m[2] + m[3]);
        if (m[3] === "z") add(m[1] + m[2] + m[2] + "s");              // huizen -> huis
        if (m[3] === "v") add(m[1] + m[2] + m[2] + "f");              // brieven -> brief
      }
      if (b.endsWith("z")) add(b.slice(0, -1) + "s");
      if (b.endsWith("v")) add(b.slice(0, -1) + "f");
    }
  }
  const g = w.match(/^ge(.{2,})$/);
  if (g) { add(g[1]); add(g[1].replace(/[td]$/, "")); }               // gewerkt -> werk
  return [...out];
}

const buildKnownSet = (words) => {
  const s = new Set();
  for (const w of words) for (const v of variants(w)) s.add(v);
  return s;
};
const isKnown = (word, set) => variants(word).some((v) => set.has(v));

function extractWords(text) {
  const seen = new Set();
  for (const tok of String(text).toLowerCase().split(/[^a-zàáâäèéêëìíîïòóôöùúûüçñß'-]+/)) {
    const t = tok.replace(/^[''-]+|[''-]+$/g, "");
    if (t.length > 1) seen.add(t);
  }
  return [...seen];
}

function wordDiff(a, b) {
  const norm = (s) => s.toLowerCase().replace(CLEAN, "");
  const A = String(a).trim().split(/\s+/).filter(Boolean);
  const B = String(b).trim().split(/\s+/).filter(Boolean);
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = norm(A[i]) === norm(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (norm(A[i]) === norm(B[j])) { out.push({ t: "same", v: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", v: A[i] }); i++; }
    else { out.push({ t: "ins", v: B[j] }); j++; }
  }
  while (i < m) { out.push({ t: "del", v: A[i] }); i++; }
  while (j < n) { out.push({ t: "ins", v: B[j] }); j++; }
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);
const countWords = (s) => (String(s).trim().match(/\S+/g) || []).length;

/* ================= XP / gamification ================= */
// Flat per-action rewards. Vocabulary is deliberately NOT one of the 4 practice categories
// (reading/speaking/listening/writing) — it's a separate foundational term, see vocabXp() below.
const XP = { writing: 2, speaking: 3, listenFirst: 5 };
// Time-based curve shared by the Leesoefening timer and the Hands-free loop: nothing for the
// first 5 minutes, then 30 XP at the 5-minute mark, +5 XP per additional full minute.
const timeXpAt = (sec) => (sec < 300 ? 0 : 30 + 5 * Math.floor((sec - 300) / 60));
const timeXpDelta = (prevSec, newSec) => timeXpAt(newSec) - timeXpAt(prevSec);
// Words already known when the feature first activates are credited once at the higher rate
// (settings.xpVocabBaselineWords, frozen forever); every word learned after that is cheaper —
// otherwise vocabulary alone would dominate leveling forever instead of ongoing practice.
const VOCAB_BASELINE_RATE = 15;
const VOCAB_ONGOING_RATE = 3;
function vocabXp(currentWords, baselineWords) {
  const b = baselineWords || 0;
  return b * VOCAB_BASELINE_RATE + Math.max(0, currentWords - b) * VOCAB_ONGOING_RATE;
}
function emptyDay() {
  return { sec: 0, turns: 0, words: 0, corr: 0, newWords: 0,
    xp: { reading: 0, speaking: 0, listening: 0, writing: 0 } };
}
function addXp(day, category, amount) {
  if (!amount) return day;
  const base = day.xp || emptyDay().xp;
  return { ...day, xp: { ...base, [category]: base[category] + amount } };
}
function totalXp(daily, currentWords, baselineWords) {
  return vocabXp(currentWords, baselineWords) + Object.values(daily)
    .reduce((n, d) => n + (d.xp ? d.xp.reading + d.xp.speaking + d.xp.listening + d.xp.writing : 0), 0);
}
// Level n needs n²×3 XP — calibrated so B1 (2000 words at the CEFR roadmap's flat 15 XP/word)
// lands on exactly Level 100, and C1 (8000 words) on exactly Level 200.
const levelOf = (xp) => Math.floor(Math.sqrt(xp / 3));
const xpForLevel = (n) => n * n * 3;
// CEFR roadmap milestones — computed at the flat baseline rate, a reference table distinct from
// any one user's live split-rate total (see vocabXp() above).
const CEFR_ROADMAP = [
  { stage: "A1", words: 500 }, { stage: "A2", words: 1000 }, { stage: "A2+", words: 1500 },
  { stage: "B1", words: 2000 }, { stage: "B1+", words: 2800 }, { stage: "B2", words: 4000 },
  { stage: "C1", words: 8000 }
].map((s) => ({ ...s, level: levelOf(s.words * VOCAB_BASELINE_RATE) }));

// Fixed categorical order (validated for adjacent-pair CVD separation via the dataviz skill's
// validator) — never reassign per-filter, always this order, everywhere the 4 skills appear.
const SKILLS = [
  { id: "writing", nl: "Schrijven", en: "Writing", icon: PenLine, color: "#2a78d6" },
  { id: "speaking", nl: "Spreken", en: "Speaking", icon: Mic, color: "#eb6834" },
  { id: "listening", nl: "Luisteren", en: "Listening", icon: Headphones, color: "#1baf7a" },
  { id: "reading", nl: "Lezen", en: "Reading", icon: BookOpenText, color: "#eda100" }
];

// Preset text types for the reading exercise — "anders" reveals a free-text field instead.
const GENRES = [
  { id: "avontuur", nl: "Avontuur", en: "Adventure" },
  { id: "mysterie", nl: "Mysterie", en: "Mystery" },
  { id: "humor", nl: "Humor", en: "Comedy" },
  { id: "dagelijks", nl: "Dagelijks leven", en: "Slice of life" },
  { id: "dialoog", nl: "Dialoog tussen twee mensen", en: "Dialogue between two people" },
  { id: "nieuws", nl: "Nieuwsartikel", en: "News article" },
  { id: "sprookje", nl: "Sprookje", en: "Fairy tale" },
  { id: "sciencefiction", nl: "Sciencefiction", en: "Science fiction" },
  { id: "anders", nl: "Anders…", en: "Other…" }
];
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The recorder's mimeType, whichever the browser picked — the server needs to know it
// to tell Google's API how the bytes are encoded (Chrome/Firefox: webm/opus).
function pickMicMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]
    .find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ================= spaced repetition (revision mode) =================
   Each correction tracks practiceCount (times drilled) and streak (consecutive correct).
   A wrong answer always resets to the first interval; a correct answer advances one level.
   Once streak reaches the number of configured intervals, the sentence is "mastered" and
   revision mode stops surfacing it — this is re-derived live from settings, never persisted,
   so shortening/lengthening the interval list immediately changes who counts as mastered.

   Due dates are calendar days, not exact timestamps: a mistake due "on 7 August" is available
   any time that day, not only from the exact hour-of-day it was first made — otherwise the UI
   can show today's date as the next review while still hiding it for being a few hours early.
   Day arithmetic goes through Date's setDate (not raw ms + N*86400000) so it stays correct
   across DST transitions. */

const DEFAULT_INTERVALS = [1, 7, 15];

// Seeded default for settings.customInstructions — see the "OVER JOU" prompt section in
// send(). Gives the tutor a fixed (fabricated) persona and tells it to vary its replies
// instead of defaulting to a question every time; fully editable/replaceable in Settings.
const DEFAULT_CUSTOM_INSTRUCTIONS =
`Jij bent Sanne, een 34-jarige Nederlandse taaldocent uit Utrecht. Je hebt een partner en een kat
die Kaas heet. In je vrije tijd fiets je graag, kook je Italiaans en lees je detectiveromans.
Praat af en toe over jezelf: deel een korte mening, herinnering, of wat je net hebt gedaan.
Niet elk antwoord hoeft een vraag te zijn — varieer tussen een vraag, een reactie, en een eigen
opmerking of anekdote, zodat het een echt gesprek voelt en geen ondervraging.`;

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function addDays(ms, days) {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

const intervalsOf = (settings) => {
  const iv = Array.isArray(settings.revisionIntervals) ? settings.revisionIntervals : DEFAULT_INTERVALS;
  return iv.length ? iv : DEFAULT_INTERVALS;
};
const isMastered = (c, settings) => (c.streak || 0) >= intervalsOf(settings).length;
const mistakeDue = (c, settings) => {
  if (isMastered(c, settings)) return Infinity;
  return c.nextDue ?? addDays(c.at || 0, intervalsOf(settings)[0]);
};
const isDue = (c, settings) => mistakeDue(c, settings) <= startOfDay(Date.now());

/* ================= spaced repetition (word mastery) =================
   Every new word goes through 3 star levels (dictate the word -> dictate a generated sentence
   using only words you already know -> write your own sentence with it) before it's promoted
   from the ledger into the real vocabulary list. w.star is how many levels have been PASSED so
   far (0-2 while working through them; a word that reaches 3 is promoted and removed from the
   ledger immediately, so a ledger entry with star:3 should never actually be seen).

   settings.wordIntervals[i] is the cooldown, in days, before star i+1 unlocks:
   index 0 gates "word added -> star 1 available" (default 0 = same day), index 1 gates
   "star 1 passed -> star 2 available" (default 3), index 2 gates "star 2 passed -> star 3
   available" (default 7). A wrong answer at ANY level is a fixed 1-day retry — deliberately
   NOT configurable, and deliberately not the same "stays due today" behaviour as revision mode
   for corrections — the star itself never moves backward on a mistake, only the due date. */

const DEFAULT_WORD_INTERVALS = [0, 3, 7];

const wordIntervalsOf = (settings) => {
  const iv = Array.isArray(settings.wordIntervals) ? settings.wordIntervals : DEFAULT_WORD_INTERVALS;
  return iv.length ? iv : DEFAULT_WORD_INTERVALS;
};
const wordDue = (w, settings) => {
  const iv = wordIntervalsOf(settings);
  const star = Math.min(w.star || 0, iv.length - 1);
  return w.nextDue ?? addDays(startOfDay(w.at || Date.now()), iv[star]);
};
const isWordDue = (w, settings) => wordDue(w, settings) <= startOfDay(Date.now());

const hhmm = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
               : `${m}:${String(s).padStart(2,"0")}`;
};

function streakOf(daily) {
  let n = 0;
  const d = new Date();
  for (;;) {
    const k = d.toISOString().slice(0, 10);
    const rec = daily[k];
    if (rec && rec.turns > 0) n++;
    else if (n > 0 || k !== today()) break;
    d.setDate(d.getDate() - 1);
    if (n > 400) break;
  }
  return n;
}

/* ================= storage ================= */

// Files on disk, served by the local server: data/vocab.json, data/progress.json, ...
const K = { vocab: "vocab", prog: "progress", set: "settings", chat: "chat", explain: "explanations",
  reading: "reading" };

async function loadAll() {
  const r = await fetch("/api/state");
  if (!r.ok) throw new Error("Kan de server niet bereiken. Draait `npm run dev`?");
  return r.json();
}

const queue = new Map();
async function save(key, value) {
  queue.set(key, value);
  if (queue.size > 1) return true;              // a flush is already scheduled
  await new Promise((r) => setTimeout(r, 150)); // coalesce bursts
  const batch = [...queue.entries()];
  queue.clear();
  try {
    await Promise.all(batch.map(([k, v]) => fetch("/api/state/" + k, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v)
    })));
    return true;
  } catch (e) { console.error("opslaan mislukt", key, e); return false; }
}

// Quality ranking: Edge neural ("Online (Natural)") > Apple Enhanced/Premium > plain > compact.
function voiceScore(v) {
  const n = (v.name || "").toLowerCase();
  const lang = (v.lang || "").replace("_", "-").toLowerCase();
  let s = 0;
  if (/natural|neural|online/.test(n)) s += 100;
  if (/enhanced|premium/.test(n)) s += 60;
  if (/compact/.test(n)) s -= 40;
  if (lang.startsWith("nl-nl")) s += 12;
  if (v.localService === false) s += 4;
  return s;
}

function useVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const read = () => {
      const all = window.speechSynthesis.getVoices() || [];
      const nl = all.filter((v) => {
        const lang = (v.lang || "").replace("_", "-");
        return /^nl/i.test(lang) || /(dutch|nederland|vlaams|flemish)/i.test(v.name || "");
      });
      nl.sort((a, b) => voiceScore(b) - voiceScore(a));
      setVoices(nl);
    };
    read();
    window.speechSynthesis.onvoiceschanged = read;
    const t1 = setTimeout(read, 500);
    const t2 = setTimeout(read, 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return voices;
}

const G_VOICES = [
  "nl-NL-Wavenet-B", "nl-NL-Wavenet-C", "nl-NL-Wavenet-D", "nl-NL-Wavenet-E", "nl-NL-Wavenet-A",
  "nl-NL-Standard-B", "nl-NL-Standard-C", "nl-NL-Standard-D", "nl-NL-Standard-E", "nl-NL-Standard-A"
];

/* ================= app ================= */

export default function App() {
  const [tab, setTab] = useState("chat");
  const [ready, setReady] = useState(false);
  const [vocab, setVocab] = useState({ words: [], raw: "", updated: null });
  const [messages, setMessages] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [daily, setDaily] = useState({});
  // Keyed by exact sentence text, shared between chat replies and Library entries,
  // and outlives chat deletion — see getExplanation() below.
  const [explanations, setExplanations] = useState({});
  const [readingLibrary, setReadingLibrary] = useState([]);
  const [settings, setSettings] = useState({
    level: "A2", voiceURI: "", rate: 0.9, bilingualUI: true,
    targets: 2, topic: "", autoplay: true, tts: "google", gVoice: "nl-NL-Wavenet-D", model: "",
    // Off = pure-practice mode: mistakes/new words still show live in chat but aren't
    // logged to the Mistakes/Words tabs unless saved one by one — see saveCorrection/saveNewWord.
    autoSave: true,
    revisionIntervals: DEFAULT_INTERVALS, wordIntervals: DEFAULT_WORD_INTERVALS,
    customInstructions: DEFAULT_CUSTOM_INSTRUCTIONS
  });
  const [draft, setDraft] = useState("");
  // True as soon as voice input has contributed anything to the current draft — stays true even
  // through later hand-editing (still counts as speaking, not writing), reset on send.
  const [draftFromVoice, setDraftFromVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ttsWarn, setTtsWarn] = useState("");
  const [bootError, setBootError] = useState("");
  const [undo, setUndo] = useState(null);
  const [showForecast, setShowForecast] = useState(false);
  // The word behind this string is the one prompt-to-confirm is showing for; set by the
  // chat's bolded-word click and the New Words page's + button — both bypass the 3-star
  // mastery flow and add straight to the vocab list, so both need the same "are you sure"
  // gate. null = no confirmation open.
  const [confirmKnownWord, setConfirmKnownWord] = useState(null);
  // { level } while a level-up celebration is showing, null otherwise — set by awardXp() below.
  const [levelUp, setLevelUp] = useState(null);

  const voices = useVoices();
  const knownSet = useMemo(() => buildKnownSet(vocab.words), [vocab.words]);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const cacheRef = useRef(new Map());

  // Bilingual label helper: "Gesprek (Chat)" or just "Gesprek".
  const T = useCallback((nl, en) =>
    settings.bilingualUI && en ? <>{nl} <em>({en})</em></> : <>{nl}</>, [settings.bilingualUI]);
  const Ts = useCallback((nl, en) =>
    settings.bilingualUI && en ? `${nl} (${en})` : nl, [settings.bilingualUI]);

  useEffect(() => {
    (async () => {
      try {
        const st = await loadAll();
        setVocab(st.vocab || { words: [], raw: "", updated: null });
        setCorrections(st.progress?.corrections || []);
        setLedger(st.progress?.ledger || []);
        setDaily(st.progress?.daily || {});
        setExplanations(st.explanations || {});
        setReadingLibrary(st.reading || []);
        if (st.settings && Object.keys(st.settings).length) setSettings((x) => ({ ...x, ...st.settings }));
        setMessages(st.chat || []);

        // One-time XP vocabulary baseline: words already known before this feature ever ran are
        // credited once at the higher rate (see vocabXp()) — frozen forever from here on, never
        // recomputed even as the word count moves. Only set if genuinely never set before.
        if (st.settings?.xpVocabBaselineWords === undefined) {
          const baseline = (st.vocab?.words || []).length;
          setSettings((x) => ({ ...x, xpVocabBaselineWords: baseline }));
          save(K.set, { ...(st.settings || {}), xpVocabBaselineWords: baseline });
        }
      } catch (e) {
        setBootError(String(e.message || e));
      }
      setReady(true);
    })();
  }, []);

  // One-time backfill: older mistakes logged before revision mode existed have no saved
  // English translation yet. Translate them here, once, in the background — sequentially,
  // so it never bursts a pile of concurrent requests — so they're ready before the learner
  // ever opens revision mode. New mistakes get this immediately after logging instead (see
  // send()), so this effect only ever has to run once per mistake.
  useEffect(() => {
    if (!ready) return;
    const pending = corrections.filter((c) => !c.en && c.corrected && countWords(c.corrected) >= 3);
    if (!pending.length) return;
    let cancelled = false;
    (async () => {
      for (const c of pending) {
        if (cancelled) return;
        await translateAndSave(c.id, c.corrected);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => { save(K.prog, { corrections, ledger, daily }); }, 15000);
    return () => clearInterval(t);
  }, [ready, corrections, ledger, daily]);

  useEffect(() => { if (ready) save(K.set, settings); }, [ready, settings]);
  useEffect(() => { if (ready) save(K.chat, messages.slice(-100)); }, [ready, messages]);
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [messages, busy]);

  // Ask the server for an mp3. It synthesizes once, keeps the file forever,
  // and returns the same URL next time — so a replay is always free.
  // opts.voice overrides settings.gVoice (for previewing a voice without adopting it);
  // opts.library=false keeps the clip off the Library page (still cached to disk either way).
  const getClip = useCallback(async (clean, opts = {}) => {
    const voice = opts.voice || settings.gVoice;
    const library = opts.library !== false;
    const key = voice + "|" + clean;
    const hit = cacheRef.current.get(key);
    if (hit) return hit;
    const r = await fetch("/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voice, library })
    });
    const d = await r.json();
    if (!r.ok || !d.url) throw new Error(d.error || ("HTTP " + r.status));
    cacheRef.current.set(key, d.url);
    return d.url;
  }, [settings.gVoice]);

  const speak = useCallback(async (text, slow, opts) => {
    const clean = String(text || "").replace(/\*\*/g, "").trim();
    if (!clean) return;
    const rate = slow ? Math.max(0.5, settings.rate - 0.25) : settings.rate;

    if (settings.tts !== "browser") {
      try {
        const url = await getClip(clean, opts);
        if (audioRef.current) audioRef.current.pause();
        const a = new Audio(url);
        a.preservesPitch = true;
        a.playbackRate = rate;
        audioRef.current = a;
        await a.play();
        setTtsWarn("");
      } catch (e) { setTtsWarn("Audio: " + (e.message || e)); }
      return;
    }

    // Browser fallback: never speak Dutch with a non-Dutch voice.
    if (!("speechSynthesis" in window)) { setTtsWarn("novoice"); return; }
    const v = voices.find((x) => x.voiceURI === settings.voiceURI) || voices[0];
    if (!v) { setTtsWarn("novoice"); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.voice = v; u.lang = v.lang || "nl-NL"; u.rate = rate;
    window.speechSynthesis.speak(u);
    setTtsWarn("");
  }, [voices, settings.voiceURI, settings.rate, settings.tts, settings.gVoice, getClip]);

  const saveMp3 = useCallback(async (text) => {
    const clean = String(text || "").replace(/\*\*/g, "").trim();
    if (!clean) return;
    try {
      const url = await getClip(clean);
      const a = document.createElement("a");
      a.href = url;
      a.download = clean.slice(0, 48).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") + ".mp3";
      a.click();
    } catch (e) { setTtsWarn("Audio: " + (e.message || e)); }
  }, [getClip]);

  const targetWords = useMemo(() => {
    const pool = vocab.words.slice(-400).filter((w) => w.length > 3);
    const picked = [], used = new Set();
    for (let i = 0; i < 200 && picked.length < settings.targets; i++) {
      const w = pool[Math.floor(Math.random() * pool.length)];
      if (w && !used.has(w)) { used.add(w); picked.push(w); }
    }
    return picked;
  }, [vocab.words, settings.targets, messages.length]);

  // Nav badge for the Revisie tab — same eligibility/due rules RevisionPanel itself uses.
  const revisionDueCount = useMemo(() => corrections.filter((c) =>
    c.corrected && countWords(c.corrected) >= 3 && isDue(c, settings)).length,
    [corrections, settings.revisionIntervals]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const fromVoice = draftFromVoice;
    setError(""); setDraft(""); setDraftFromVoice(false); setBusy(true);
    const nWords = countWords(text);
    const history = messages.slice(-100);
    setMessages((m) => [...m, { role: "user", text, at: Date.now() }]);

    const knownSample = vocab.words.slice(-450).join(", ");

    const L = LADDER[settings.level] || LADDER["A2"];
    const newMax = Math.min(L.newMax, settings.newMax ?? L.newMax);
    const recent = messages.filter((m) => m.role === "ai" && typeof m.ratio === "number").slice(-5);
    const avgRatio = recent.length
      ? recent.reduce((n, m) => n + m.ratio, 0) / recent.length : null;
    const tooHard = messages.filter((m) => m.role === "ai" && m.hard).length;

    const sys = `Je bent een geduldige Nederlandse taaldocent en gesprekspartner. De leerling zit op niveau ${settings.level} en wil uiteindelijk C1 halen.

ANTWOORD ALTIJD MET GELDIGE JSON, met reply_nl als eerste veld. Geen markdown, geen code fences:
{"reply_nl":"","corrections":[{"original":"","corrected":"","type":"fout"}],"new_words":[{"word":"","lemma":"","en":""}]}

HOE JE ANTWOORDT — DIT IS DE BELANGRIJKSTE REGEL
Begrijpelijkheid gaat boven alles. Een antwoord dat de leerling niet begrijpt is waardeloos,
ook als het mooi Nederlands is. Houd je strikt aan deze grenzen voor niveau ${settings.level}:
- Lengte: ${L.sentences} zinnen van ${L.words} woorden. Niet langer.
- Zinsbouw: ${L.clauses}.
- Tijden: ${L.tense}.
- Woorden: gebruik ALLEEN woorden uit de lijst onderaan, plus de allergewoonste Nederlandse
  functiewoorden. Maximaal ${newMax} woord${newMax === 1 ? "" : "en"} dat de leerling nog niet kent.
- Moet je toch een onbekend woord gebruiken? Kies dan het meest frequente synoniem dat bestaat.
- Varieer hoe je een antwoord afsluit: soms een korte vraag, soms een reactie, mening of eigen
  opmerking. Niet elke beurt hoeft een vraag te zijn — dat wordt al snel een ondervraging in plaats
  van een gesprek.
${avgRatio !== null ? `- Terugkoppeling: je laatste antwoorden bevatten gemiddeld ${avgRatio.toFixed(0)}% woorden buiten de woordenlijst. ${avgRatio > 10 ? "DAT IS TE VEEL — vereenvoudig duidelijk, gebruik kortere zinnen en bekendere woorden." : avgRatio > 6 ? "Dat mag iets lager; kies waar mogelijk een bekender woord." : "Dat is goed; houd dit niveau aan."}` : ""}
${tooHard > 0 ? `- De leerling heeft ${tooHard} antwoord(en) in dit gesprek als te moeilijk gemarkeerd. Ga merkbaar eenvoudiger.` : ""}
${targetWords.length ? `- Verwerk deze bekende doelwoorden als het natuurlijk past: ${targetWords.join(", ")}.` : ""}
${settings.topic ? `- Onderwerp of situatie: ${settings.topic}.` : ""}
- Vraagt de leerling in het Engels "hoe zeg je X?", leg dat kort uit en ga daarna verder in het Nederlands.
${settings.customInstructions ? `
OVER JOU (DE DOCENT)
${settings.customInstructions}
` : ""}
CORRECTIES
- Corrigeer ALLEEN het NIEUWSTE bericht van de leerling (de laatste user-beurt, hieronder). De eerdere
  beurten in de geschiedenis zijn alleen gesprekscontext — die zijn al eerder gecorrigeerd en mogen NOOIT
  opnieuw in "corrections" verschijnen, ook niet in een licht andere vorm.
- Werk op het niveau van hele ZINNEN, niet losse woorden of fragmenten. Splits het nieuwste bericht op in
  zinnen; één object per zin die een probleem heeft. Heeft één zin meerdere problemen? Zet ze dan
  allemaal in ÉÉN object — nooit apart, en nooit het foute woord losgeknipt uit zijn zin.
- type "fout" = grammaticaal of spellingsfout. type "beter" = correct maar onnatuurlijk.
- "original" = de HELE oorspronkelijke zin van de leerling (met het probleem/de problemen erin).
- "corrected" = diezelfde hele zin, met ALLES in die zin gecorrigeerd — een complete, natuurlijke zin,
  geen fragment, want dit wordt ook hardop voorgelezen.
- Controleer ELK woord dat de leerling gebruikt: bestaat het echt in het Nederlands? Verzonnen woorden
  en letterlijk vertaalde Engelse woorden (bijv. "irregulaar" i.p.v. "irregulair" of "onregelmatig")
  zijn ook een fout (type "fout") — mis deze niet, ook al is de rest van de zin verder correct.
- Geen uitleg nodig — dat gebeurt later, apart, als de leerling daar zelf om vraagt.
- Geen fouten? Dan "corrections": []. Verzin nooit fouten.

new_words: elk woord dat JIJ ZELF in reply_nl hierboven gebruikt (niet uit het bericht van de
leerling) en dat niet voorkomt in de woordenlijst hieronder, met lemma (grondvorm) en Engelse
vertaling. (De opmaak — welke woorden vet worden — wordt hierna apart en exact bepaald op basis
van de echte woordenlijst; jij hoeft niets te markeren.)

WOORDEN DIE DE LEERLING KENT
${knownSample || "(nog geen lijst geïmporteerd — gebruik alleen de 500 meest frequente Nederlandse woorden)"}`;

    try {
      const payload = JSON.stringify({
        model: settings.model || undefined,
        system: sys,
        messages: [
          ...history.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.role === "user" ? m.text : (m.reply || "")
          })),
          { role: "user", content: text }
        ]
      });

      // The reply text stays hidden until manually revealed (see revealMessage), so
      // there's nothing to stream in progressively anymore — one plain request.
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: payload
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);

      // Bolding is fully deterministic now — a diff against the real vocab list, not the
      // model's own (unreliable) guess of what counts as "new". Strip defensively first in
      // case the model still emits ** out of habit even though it's no longer asked to.
      let reply = String(out.reply_nl || "").replace(/\*\*/g, "");
      reply = boldUnknown(reply, knownSet);
      // Keyed by lowercase for matching, value is the word as it actually appeared.
      const kept = new Map();
      reply.replace(/\*\*(.+?)\*\*/g, (mm, w) => { kept.set(w.toLowerCase(), w); return mm; });

      const stamp = Date.now();
      const cors = (out.corrections || []).map((c, i) => ({
        id: stamp + "-" + i, at: stamp,
        // Whole sentences, not fragments — see the CORRECTIES prompt above.
        original: String(c.original || ""), corrected: String(c.corrected || ""),
        type: c.type === "beter" ? "beter" : "fout",
        // English translation for revision mode — filled in the background just below,
        // right after logging, so revision never has to translate on the spot.
        en: null,
        // Auto-save off means this only lives on the message until saveCorrection() is
        // clicked — see the manual-save UI in ChatView/Strip.
        saved: settings.autoSave
      })).filter((c) => c.original && c.corrected);

      // The bolded set is the deterministic source of truth for which words are new; the
      // model's self-reported new_words only enriches matching entries with lemma/translation
      // — a word the model forgot to self-report is still bolded, so it must still be kept.
      const metaByWord = new Map(
        (out.new_words || [])
          .filter((w) => w && w.word)
          .map((w) => [String(w.word).toLowerCase(), w])
      );
      const fresh = Array.from(kept.entries())
        .filter(([lw]) => !ledger.some((l) => l.lemma === (metaByWord.get(lw)?.lemma || lw)))
        .map(([lw, original]) => {
          const meta = metaByWord.get(lw);
          return {
            word: meta ? String(meta.word) : original,
            lemma: String(meta?.lemma || lw), en: String(meta?.en || ""),
            context: reply.replace(/\*\*/g, ""), at: stamp,
            // Mastery progress toward promotion into the real vocab list — see wordDue() above.
            star: 0,
            // See cors[].saved above — same manual-save behavior for new words.
            saved: settings.autoSave
          };
        });

      const ratio = unknownRatio(reply, knownSet, vocab.words.length > 200);
      setMessages((m) => [...m, { role: "ai", reply, corrections: cors, newWords: fresh, at: stamp, ratio, revealed: false }]);
      if (settings.autoSave) {
        setCorrections((c) => [...c, ...cors]);
        if (fresh.length) setLedger((l) => [...l, ...fresh]);
        // Fire-and-forget: doesn't block the reply, but by the time the learner reaches
        // revision mode the translation is almost always already cached and saved. Only
        // worth doing for corrections that are actually persisted — see saveCorrection()
        // for the manual-save equivalent.
        cors.forEach((c) => { if (countWords(c.corrected) >= 3) translateAndSave(c.id, c.corrected); });
      }

      setDaily((d) => {
        const k = today();
        const r = d[k] || emptyDay();
        const next = { ...d, [k]: { ...r, turns: r.turns + 1, words: r.words + nWords,
          corr: r.corr + (settings.autoSave ? cors.length : 0),
          newWords: r.newWords + (settings.autoSave ? fresh.length : 0) } };
        save(K.prog, settings.autoSave
          ? { corrections: [...corrections, ...cors], ledger: [...ledger, ...fresh], daily: next }
          : { corrections, ledger, daily: next });
        return next;
      });

      if (nWords >= 2) awardXp(fromVoice ? "speaking" : "writing", fromVoice ? XP.speaking : XP.writing);

      if (reply && settings.autoplay) setTimeout(() => speak(reply), 220);
    } catch (e) {
      setError(String(e.message || e));
      setMessages((m) => m.filter((x) => !(x.role === "user" && x.text === text)));
      setDraft(text); setDraftFromVoice(fromVoice);
    } finally { setBusy(false); }
  }

  // Manual equivalent of the auto-save path in send(), for when autoSave is off: marks this
  // one correction "saved" on its message (so the button flips to a checkmark) and logs it
  // for real, same as if auto-save had done it at send time.
  function saveCorrection(c) {
    setMessages((ms) => ms.map((m) => (m.corrections
      ? { ...m, corrections: m.corrections.map((x) => (x.id === c.id ? { ...x, saved: true } : x)) }
      : m)));
    setCorrections((list) => {
      const next = [...list, { ...c, saved: true }];
      setDaily((d) => {
        const k = today();
        const r = d[k] || emptyDay();
        const nd = { ...d, [k]: { ...r, corr: r.corr + 1 } };
        save(K.prog, { corrections: next, ledger, daily: nd });
        return nd;
      });
      return next;
    });
    if (countWords(c.corrected) >= 3) translateAndSave(c.id, c.corrected);
  }

  // Manual equivalent for a single new word — same dedupe-by-lemma rule as the automatic
  // path in send() applies, since the same word can appear bolded across several messages.
  function saveNewWord(w) {
    if (ledger.some((l) => l.lemma === w.lemma)) return;
    setMessages((ms) => ms.map((m) => (m.newWords
      ? { ...m, newWords: m.newWords.map((x) => (x.lemma === w.lemma ? { ...x, saved: true } : x)) }
      : m)));
    setLedger((list) => {
      const next = [...list, { ...w, saved: true }];
      setDaily((d) => {
        const k = today();
        const r = d[k] || emptyDay();
        const nd = { ...d, [k]: { ...r, newWords: r.newWords + 1 } };
        save(K.prog, { corrections, ledger: next, daily: nd });
        return nd;
      });
      return next;
    });
  }

  // Clicking a bolded word means "I already know this".
  function markKnown(word) {
    const w = String(word).toLowerCase().replace(CLEAN, "");
    if (!w) return;

    // Store the dictionary form too, so every inflection matches from now on:
    // clicking "gewerkt" should also cover "werk", "werkt", "werken".
    const entry = ledger.find((l) => l.word.toLowerCase() === w || l.lemma.toLowerCase() === w);
    const lemma = entry ? String(entry.lemma).toLowerCase().replace(CLEAN, "") : "";
    const add = [w, lemma].filter((x) => x && !vocab.words.includes(x));

    if (add.length) {
      const v = { ...vocab, words: [...vocab.words, ...add], updated: Date.now() };
      setVocab(v); save(K.vocab, v);
    }

    // It is no longer a new word, so drop it from the ledger.
    if (entry) {
      const next = ledger.filter((l) => l !== entry);
      setLedger(next);
      save(K.prog, { corrections, ledger: next, daily });
    }

    // Un-bold it everywhere in this conversation.
    const safe = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setMessages((m) => m.map((x) => x.role === "ai"
      ? { ...x, reply: x.reply.replace(new RegExp(`\\*\\*(${safe})\\*\\*`, "gi"), "$1") } : x));
    setUndo({ words: add, entry });
  }

  // Both the chat's "click a bolded word" shortcut and the New Words page's + button skip the
  // 3-star mastery flow entirely — they're an explicit escape hatch for words you're already
  // confident on, gated behind a confirmation instead of the tasks. See markKnown() above for
  // what actually happens once confirmed.
  function requestMarkKnown(word) {
    setConfirmKnownWord(word);
  }

  function goLearn() {
    setTab("learn");
  }

  function flagHard(at) {
    setMessages((m) => m.map((x) => (x.at === at && x.role === "ai") ? { ...x, hard: !x.hard } : x));
  }

  // The reply text stays hidden — behind a "reveal" button — until the learner has had a
  // chance to listen to the audio first, without reading along. Corrections and audio are
  // unaffected: this only gates the reply-txt block below.
  function revealMessage(at) {
    setMessages((m) => m.map((x) => (x.at === at && x.role === "ai") ? { ...x, revealed: true } : x));
  }

  function removeCorrection(id) {
    const next = corrections.filter((c) => c.id !== id);
    setCorrections(next);
    save(K.prog, { corrections: next, ledger, daily });
  }

  // Ledger entries have no unique id, so match by reference — safe since shown/filtered
  // views in WordsView derive from this same array without cloning its items.
  function removeWord(word) {
    const next = ledger.filter((w) => w !== word);
    setLedger(next);
    save(K.prog, { corrections, ledger: next, daily });
  }

  // Called by the Learn page after each star attempt, to update a word's mastery progress
  // (star/nextDue — see wordDue() above). Matched by reference, like removeWord().
  function updateWordStats(entry, patch) {
    setLedger((l) => {
      const next = l.map((w) => (w === entry ? { ...w, ...patch } : w));
      save(K.prog, { corrections, ledger: next, daily });
      return next;
    });
  }

  // Called by revision mode after each practice round to update the underlying mistake's
  // practiceCount/streak/nextDue — see the spaced-repetition helpers above.
  function updateMistakeStats(id, patch) {
    setCorrections((cs) => {
      const next = cs.map((c) => (c.id === id ? { ...c, ...patch } : c));
      save(K.prog, { corrections: next, ledger, daily });
      return next;
    });
  }

  // Best-effort background translate + persist. Called right after a mistake is logged
  // (see send()) and once at startup to backfill any older mistakes still missing "en" —
  // so revision mode always reads a saved translation instead of asking the AI on the spot.
  async function translateAndSave(id, nl) {
    try {
      const r = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nl, model: settings.model || undefined })
      });
      const d = await r.json();
      if (r.ok && d.en) updateMistakeStats(id, { en: d.en });
    } catch { /* not fatal — revision mode falls back to translating on demand */ }
  }

  // Removes a single word from the known-vocabulary list — the only way to shrink it now
  // that "replace list" is gone (too easy to wipe everything by accident, see VocabView).
  function removeVocabWord(word) {
    const words = vocab.words.filter((w) => w !== word);
    const v = { ...vocab, words };
    setVocab(v); save(K.vocab, v);
  }

  // The single place every XP award goes through — so there's exactly one spot that can detect
  // a level transition and fire the celebration modal. Never call addXp()/setDaily() directly
  // at an earning site.
  function awardXp(category, amount) {
    if (!amount) return;
    setDaily((d) => {
      const before = levelOf(totalXp(d, vocab.words.length, settings.xpVocabBaselineWords));
      const k = today();
      const next = { ...d, [k]: addXp(d[k] || emptyDay(), category, amount) };
      const after = levelOf(totalXp(next, vocab.words.length, settings.xpVocabBaselineWords));
      if (after > before) setLevelUp({ level: after });
      save(K.prog, { corrections, ledger, daily: next });
      return next;
    });
  }

  // Distinguishes a clip's first play (worth more) from a replay — the flag lives on the
  // message itself, not on Player, since a fresh Player instance has no memory across renders.
  // Checks-and-sets "already listened" inside the setMessages updater itself, not from the
  // closed-over m — two Player onPlay calls that land close together (e.g. a rapid double
  // click racing Player's own async toggle()) would otherwise both read the same stale
  // m.listened === false and both award XP for what's really only one first play.
  function awardChatListen(m) {
    let already = false;
    setMessages((ms) => ms.map((x) => {
      if (x.at !== m.at) return x;
      already = !!x.listened;
      return already ? x : { ...x, listened: true };
    }));
    if (!already) awardXp("listening", XP.listenFirst);
  }

  // Reading-exercise stories are saved plain (no ** markers) so bolding always reflects the
  // CURRENT vocab list when reopened later, not a frozen snapshot from when it was generated.
  function saveReadingStory(story) {
    const next = [{ id: Date.now(), ...story }, ...readingLibrary];
    setReadingLibrary(next); save(K.reading, next);
  }
  function removeReadingStory(id) {
    const next = readingLibrary.filter((s) => s.id !== id);
    setReadingLibrary(next); save(K.reading, next);
  }

  // On-demand only — never called automatically. Cached by exact sentence text, so the
  // same explanation is reused everywhere that sentence appears (chat, Library) and
  // survives clearing the chat; a given sentence is only ever sent to the AI once.
  // opts.mistake: the learner's original wrong phrasing, when explaining a logged mistake
  // rather than a plain sentence — shifts the cache key too, since the explanation itself
  // is different (focused on that specific error) from a plain explanation of the same text.
  async function getExplanation(text, { force = false, mistake = "" } = {}) {
    const clean = String(text || "").replace(/\*\*/g, "").trim();
    if (!clean) return null;
    const mistakeClean = String(mistake || "").replace(/\*\*/g, "").trim();
    const key = mistakeClean ? `${mistakeClean}→${clean}` : clean;
    if (!force && explanations[key]) return explanations[key];
    const r = await fetch("/api/explain", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, mistake: mistakeClean || undefined, model: settings.model || undefined })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
    setExplanations((ex) => {
      const next = { ...ex, [key]: d };
      save(K.explain, next);
      return next;
    });
    return d;
  }

  function undoKnown() {
    if (!undo) return;
    if (undo.words.length) {
      const v = { ...vocab, words: vocab.words.filter((x) => !undo.words.includes(x)), updated: Date.now() };
      setVocab(v); save(K.vocab, v);
    }
    if (undo.entry) {
      const next = [...ledger, undo.entry];
      setLedger(next);
      save(K.prog, { corrections, ledger: next, daily });
    }
    setUndo(null);
  }

  if (!ready) return (
    <div className="nl">
      <div style={{ margin: "auto", color: "var(--muted)" }}>Laden…</div>
    </div>
  );

  if (bootError) return (
    <div className="nl">
      <div style={{ margin: "auto", maxWidth: 460, padding: 24 }}>
        <div className="note err">
          <b>De server reageert niet.</b><br />{bootError}
          <br /><br />Start hem met <code>npm run dev</code> in de projectmap, en ververs deze pagina.
        </div>
      </div>
    </div>
  );

  // Grouped by role, not alphabetically or by when each was added: the 3 active practice
  // modes first (uninterrupted), then the 2 logs practice feeds into, then the foundational
  // vocab reference, then the supplementary listening tool, then tracking, then config last.
  const NAV = [
    ["chat", MessageSquare, "Gesprek", "Chat", null],
    ["reading", BookOpenText, "Leesoefening", "Reading", readingLibrary.length],
    ["revision", Languages, "Revisie", "Revision", revisionDueCount],
    ["mistakes", AlertCircle, "Fouten", "Mistakes", corrections.length],
    ["words", Sparkles, "Nieuwe woorden", "New words", ledger.length],
    ["vocab", BookOpen, "Woordenlijst", "Vocabulary", vocab.words.length],
    ["library", Headphones, "Audiobibliotheek", "Audio library", null],
    ["progress", TrendingUp, "Voortgang", "Progress", null],
    ["settings", Settings, "Instellingen", "Settings", null]
  ];
  // "learn" is deliberately not in NAV above — it's only reachable via the "Ga oefenen"
  // button on the New Words page, not its own left-panel item, so the panel stays short.
  // It still needs a page title/info blurb like every other tab, hence the entries here.
  const titles = {
    chat: ["Gesprek", "Chat"], reading: ["Leesoefening", "Reading"], vocab: ["Woordenlijst", "Vocabulary"],
    mistakes: ["Fouten", "Mistakes"], revision: ["Revisie", "Revision"],
    words: ["Nieuwe woorden", "New words"], learn: ["Leren", "Learn"],
    library: ["Audiobibliotheek", "Audio library"], progress: ["Voortgang", "Progress"],
    settings: ["Instellingen", "Settings"]
  };
  // Concise, plain-language blurb for the info icon in each page's header — always
  // available regardless of the bilingualUI toggle (Ts()/T() below handle hiding English).
  const PAGE_INFO = {
    chat: ["Praat vrij met de AI-docent. Fouten worden onderaan elk antwoord getoond — klik erop voor uitleg. Nieuwe woorden verschijnen vetgedrukt.",
      "Chat freely with the AI tutor. Mistakes show up under each reply — click one for an explanation. New words appear in bold."],
    reading: ["Laat een tekst genereren op jouw niveau: kies een soort tekst, waar het over moet gaan, hoeveel nieuwe woorden erin mogen zitten en hoe lang hij moet zijn. Vetgedrukte woorden kun je aanklikken om ze meteen aan je woordenlijst toe te voegen.",
      "Generate a text at your level: pick a type of text, what it should be about, how many new words it may contain, and how long it should be. Click any bolded word to add it straight to your vocabulary."],
    vocab: ["Alles hierin geldt als bekend: de assistent kiest die woorden bij voorkeur en markeert alles daarbuiten vet in het gesprek. Voeg elke dag je nieuwe batch toe.",
      "Everything here counts as known — the assistant prefers these words and bolds anything outside the list. Add your new batch every day."],
    mistakes: ["Elke fout uit je gesprekken, verzameld op één plek. Klik 'Uitleg' bij een fout voor een volledige, op die fout gerichte uitleg.",
      "Every mistake from your conversations, collected in one place. Click 'Explain' on any mistake for a full, mistake-focused breakdown."],
    revision: ["Herhaal zinnen uit je foutenlogboek met spaced repetition: vertaal de Engelse zin terug naar het Nederlands. Fout? Dan komt hij later vandaag terug.",
      "Practice sentences from your mistake log with spaced repetition: translate the English sentence back into Dutch. Get it wrong and it comes back later today."],
    words: ["Nieuwe woorden die de AI in het gesprek heeft gemarkeerd. Klik 'Ga oefenen' om een woord via 3 oefenniveaus naar je echte woordenlijst te brengen.",
      "New words the AI has flagged in conversation. Click 'Practice now' to work a word through 3 practice levels into your real vocabulary list."],
    learn: ["Drie sterren per woord: het woord naschrijven vanaf audio, een AI-zin naschrijven (alleen bekende woorden), en zelf een zin schrijven. Alle 3 gehaald? Dan staat het woord in je woordenlijst.",
      "Three stars per word: write the word back from audio, write back an AI sentence (known words only), then write your own sentence. Pass all 3 and the word joins your vocabulary list."],
    library: ["Elke uitgesproken zin blijft hier als mp3 staan — gratis om opnieuw te beluisteren. Filter op datum en zet een selectie om in één bestand voor je telefoon.",
      "Every spoken sentence stays here as an mp3 — free to replay. Filter by date and bundle a selection into one file for your phone."],
    progress: [`Niveau en XP: elke oefening levert XP op in 4 categorieën — schrijven, spreken, luisteren, lezen. Bekende woorden tellen ook mee. Je niveau stijgt automatisch; de CEFR-route laat zien waar A1 t/m C1 ongeveer liggen.

Jouw opbouw: de spinnenwebgrafiek laat zien welke vaardigheid je het meest oefent.

Onderaan: grafieken van foutenpercentage en dagelijkse activiteit.`,
      `Level & XP: every exercise earns XP in 4 categories — writing, speaking, listening, reading. Known words count too. Your level rises automatically; the CEFR roadmap shows roughly where A1 through C1 fall.

Your build: the radar chart shows which skill you practice most.

Below: charts of error rate and daily activity.`],
    settings: ["Stem, model, gespreksniveau, revisie- en leerinterval, en je gegevens (back-up, terugzetten, alles wissen) — alle instellingen van de app op één plek.",
      "Voice, model, conversation level, revision and learning intervals, and your data (backup, restore, erase all) — every app setting in one place."]
  };
  const pct = Math.min(100, Math.round((vocab.words.length / 8000) * 100));

  return (
    <div className="nl">

      <nav className="nav">
        <div className="brand">
          <div className="brand-dot">NL</div>
          <div className="brand-t">Nederlands<small>{settings.level} → C1</small></div>
        </div>
        {NAV.map(([id, Icon, nl, en, count]) => (
          <button key={id} className={"nav-i" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
            <Icon strokeWidth={2} />
            <span>{T(nl, en)}</span>
            {count > 0 && <b>{count}</b>}
          </button>
        ))}
        <div className="nav-foot">
          <div className="lbl"><span>{Ts("Woordenschat", "Vocabulary")}</span><b>{pct}%</b></div>
          <div className="track"><i style={{ width: pct + "%" }} /></div>
        </div>
      </nav>

      <div className="stage">
        <div className="col">
          <div className="top">
            <h1>{T(titles[tab][0], titles[tab][1])}
              {PAGE_INFO[tab] && (
                <span className="page-info" tabIndex={0} data-tip={Ts(PAGE_INFO[tab][0], PAGE_INFO[tab][1])}>
                  <Info strokeWidth={2.2} />
                </span>
              )}
            </h1>
            {tab === "chat" && (
              <div className="stat-pills">
                <button className={"spill" + (settings.autoSave ? " on" : "")}
                  onClick={() => setSettings((s) => ({ ...s, autoSave: !s.autoSave }))}
                  title={settings.autoSave
                    ? "Fouten en nieuwe woorden worden automatisch opgeslagen — klik voor puur oefenen zonder opslaan.\nMistakes and new words are saved automatically — click for pure practice with no saving."
                    : "Puur oefenen: niets wordt automatisch opgeslagen — je kunt per fout of woord zelf kiezen.\nPure practice: nothing is saved automatically — save individual mistakes or words yourself."}>
                  <Save strokeWidth={2.2} />
                  <span>{settings.autoSave ? Ts("Auto-opslaan", "Auto-save") : Ts("Puur oefenen", "Pure practice")}</span>
                </button>
                <button className="spill" title="Nieuw gesprek — Start a new chat"
                  onClick={async () => {
                    if (messages.length && !window.confirm(
                      "Nieuw gesprek beginnen? Je fouten en woorden blijven bewaard.\nStart a new chat? Your mistakes and words are kept.")) return;
                    setMessages([]);
                    await save(K.chat, []);
                  }}>
                  <Plus strokeWidth={2.4} /><span>{Ts("Nieuw", "New chat")}</span>
                </button>
              </div>
            )}
            {tab === "revision" && (
              <div className="stat-pills">
                <button className={"spill" + (showForecast ? " on" : "")}
                  onClick={() => setShowForecast((v) => !v)}
                  title={Ts("Vooruitblik tonen of verbergen", "Show or hide the forecast")}>
                  <TrendingUp strokeWidth={2.2} /><span>{Ts("Vooruitblik", "Forecast")}</span>
                </button>
              </div>
            )}
          </div>

          {tab === "chat" && <ChatView {...{ messages, busy, error, draft, setDraft, setDraftFromVoice,
            send, speak, settings, markKnown: requestMarkKnown, vocab, streamRef, T, Ts, ttsWarn, setTtsWarn,
            setTab, saveMp3, undo, undoKnown, setUndo, getClip, flagHard, revealMessage, saveCorrection,
            saveNewWord, awardChatListen, explanations, getExplanation }} />}
          {tab === "reading" && <ReadingView {...{ vocab, knownSet, settings, setSettings,
            markKnown: requestMarkKnown, getClip, readingLibrary, saveReadingStory, removeReadingStory,
            awardXp, T, Ts }} />}
          {tab === "vocab" && <VocabView {...{ vocab, setVocab, removeVocabWord, T, Ts }} />}
          {tab === "mistakes" && <MistakesView {...{ corrections, speak, settings, T, Ts, removeCorrection,
            explanations, getExplanation }} />}
          {tab === "revision" && <RevisionPanel {...{ speak, settings, T, Ts, corrections, updateMistakeStats,
            explanations, getExplanation, showForecast, getClip, awardXp }} />}
          {tab === "words" && <WordsView {...{ ledger, speak, T, Ts, removeWord,
            requestMarkKnown, settings, goLearn }} />}
          {tab === "learn" && <LearnPanel {...{ ledger, vocab, speak, settings, T, Ts,
            updateWordStats, markKnown }} />}
          {tab === "library" && <LibraryView {...{ settings, T, Ts, explanations, getExplanation, awardXp }} />}
          {tab === "progress" && <ProgressView {...{ daily, corrections, ledger, vocab, settings, T, Ts }} />}
          {tab === "settings" && <SettingsView {...{ settings, setSettings, voices, speak, getClip, vocab,
            corrections, ledger, daily, setVocab, setCorrections, setLedger, setDaily,
            setMessages, T, Ts, ttsWarn, setTtsWarn }} />}
        </div>

        {tab === "chat" && (
          <aside className="aside">
            <div className="rail">
              <div className="rail-h"><Clock strokeWidth={2.2} /><span className="lbl">{T("Vandaag", "Today")}</span></div>
              <div className="card">
                <div className="mrow"><span>{Ts("Beurten", "Turns")}</span><b>{(daily[today()] || {}).turns || 0}</b></div>
                <div className="mrow"><span>{Ts("Reeks", "Streak")}</span><b>{streakOf(daily)}</b></div>
              </div>
            </div>

            {targetWords.length > 0 && (
              <div className="rail">
                <div className="rail-h"><Sparkles strokeWidth={2.2} /><span className="lbl">{T("Doelwoorden", "Target words")}</span></div>
                {targetWords.map((w) => (
                  <button key={w} className="tw" onClick={() => speak(w, false, { library: false })}>
                    <strong>{w}</strong>
                    <span><Volume2 strokeWidth={2.2} />{Ts("beluisteren", "listen")}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      {confirmKnownWord && (
        <div className="modal-backdrop" onClick={() => setConfirmKnownWord(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{Ts("Direct naar woordenlijst?", "Add straight to vocabulary?")}</h3>
            <p>{T(`Je hebt de 3 oefenniveaus voor "${confirmKnownWord}" nog niet gehaald. Je kunt het
              woord alsnog direct toevoegen als je al zeker weet dat je het kent — maar dan sla je het
              oefenen ervan over.`,
              `You haven't completed the 3 practice levels for "${confirmKnownWord}" yet. You can still
              add it straight to your vocabulary if you're already confident — but you'll skip practicing it.`)}</p>
            <div className="btns" style={{ marginTop: 16 }}>
              <button className="btn g" onClick={() => setConfirmKnownWord(null)}>{Ts("Annuleren", "Cancel")}</button>
              <button className="btn" onClick={() => { markKnown(confirmKnownWord); setConfirmKnownWord(null); }}>
                <Check strokeWidth={2.2} />{Ts("Toch toevoegen", "Add anyway")}</button>
            </div>
          </div>
        </div>
      )}

      {levelUp && (
        <div className="modal-backdrop" onClick={() => setLevelUp(null)}>
          <div className="modal levelup" onClick={(e) => e.stopPropagation()}>
            <div className="levelup-badge"><Trophy strokeWidth={2} /></div>
            <h3>{Ts("Niveau omhoog!", "Level up!")}</h3>
            <div className="levelup-n">{levelUp.level}</div>
            <p>{Ts("Goed bezig — blijf zo doorgaan.", "Great work — keep it up.")}</p>
            <button className="btn" onClick={() => setLevelUp(null)}>{Ts("Verder", "Continue")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= audio player with seek ================= */

let CURRENT = null;   // only one clip plays at a time

function Player({ text, getClip, rate, onSave, onPlay, Ts }) {
  const [url, setUrl] = useState("");
  const [on, setOn] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [slow, setSlow] = useState(false);
  const el = useRef(null);

  const speed = slow ? Math.max(0.5, rate - 0.25) : rate;
  useEffect(() => { if (el.current) el.current.playbackRate = speed; }, [speed]);
  useEffect(() => () => { if (el.current) el.current.pause(); }, []);

  async function toggle() {
    if (el.current && on) { el.current.pause(); setOn(false); return; }
    setErr("");
    let src = url;
    if (!src) {
      setBusy(true);
      try { src = await getClip(String(text).replace(/\*\*/g, "").trim()); setUrl(src); }
      catch (e) { setErr(String(e.message || e)); setBusy(false); return; }
      setBusy(false);
    }
    if (!el.current) {
      const a = new Audio(src);
      a.preservesPitch = true;
      a.ontimeupdate = () => setT(a.currentTime);
      a.onloadedmetadata = () => setDur(a.duration || 0);
      a.onended = () => { setOn(false); setT(0); a.currentTime = 0; };
      el.current = a;
    }
    if (CURRENT && CURRENT !== el.current) CURRENT.pause();
    CURRENT = el.current;
    el.current.playbackRate = speed;
    try { await el.current.play(); setOn(true); onPlay?.(); }
    catch (e) { setErr(String(e.message || e)); }
  }

  function seek(v) {
    setT(v);
    if (el.current) el.current.currentTime = v;
  }

  const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;

  return (
    <div className="player">
      <button className="pbtn" onClick={toggle} disabled={busy}
        aria-label={on ? "pauze" : "afspelen"}>
        {busy ? <span className="mini-dots"><i /><i /><i /></span>
              : on ? <Pause strokeWidth={2.6} /> : <Play strokeWidth={2.6} />}
      </button>
      <input className="scrub" type="range" min="0" max={dur || 1} step="0.05" value={t}
        disabled={!dur} onChange={(e) => seek(parseFloat(e.target.value))}
        aria-label="positie in de opname"
        style={{ "--pct": (dur ? (t / dur) * 100 : 0) + "%" }} />
      <span className="ptime">{dur ? `${mmss(t)} / ${mmss(dur)}` : "–:––"}</span>
      <button className={"pchip" + (slow ? " on" : "")} onClick={() => setSlow((x) => !x)}
        title="Langzamer — Slower">{speed.toFixed(2)}×</button>
      {onSave && <button className="pchip" onClick={onSave} title="Bewaar als MP3">
        <Download strokeWidth={2.3} /></button>}
      {err && <span className="perr">{err}</span>}
    </div>
  );
}

/* ================= chat ================= */

function Rendered({ text, onWord }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <b key={i} title="Klik als je dit woord al kent — Click if you already know this word"
          onClick={() => onWord(p.slice(2, -2))}>{p.slice(2, -2)}</b>
      : <span key={i}>{p}</span>
  )}</>;
}

function Strip({ c, speak, bilingual, onRemove, showStats, settings, Ts, explanations, getExplanation,
  onSave, saved }) {
  const d = wordDiff(c.original, c.corrected);
  const mastered = showStats && isMastered(c, settings);
  const totalStars = showStats ? intervalsOf(settings).length : 0;
  const fmt = (ms) => new Date(ms).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
  return (
    <div className={"strip " + (mastered ? "mastered" : c.type)}>
      <div className="strip-h">
        <span className={"pill " + (mastered ? "mastered" : c.type)}>
          {mastered ? (bilingual ? "onder de knie · mastered" : "onder de knie")
            : c.type === "fout" ? (bilingual ? "fout · error" : "fout") : (bilingual ? "beter · better" : "beter")}
        </span>
        {showStats && (
          <StarRow star={Math.min(c.streak || 0, totalStars)} total={totalStars} color="var(--jade)" />
        )}
        <button className="aud" onClick={() => speak(c.full || c.corrected)}><Play strokeWidth={2.4} />Goed</button>
        {onSave && <button className="aud" title="Opslaan bij Fouten — Save to Mistakes" onClick={onSave}>
          <Save strokeWidth={2.4} />{bilingual ? "Opslaan · Save" : "Opslaan"}</button>}
        {saved && <span className="pill mastered">
          <Check strokeWidth={2.4} />{bilingual ? "Opgeslagen · Saved" : "Opgeslagen"}</span>}
        {onRemove && <button className="aud del-btn" title="Verwijderen — Remove" onClick={onRemove}>
          <Trash2 strokeWidth={2.4} /></button>}
      </div>
      <div className="strip-b">
        <div className="old">
          {d.filter((x) => x.t !== "ins").map((x, i) =>
            <span key={i} className={x.t === "del" ? "del" : ""}>{x.v} </span>)}
        </div>
        <div className="new">
          {d.filter((x) => x.t !== "del").map((x, i) =>
            <span key={i} className={x.t === "ins" ? "ins" : ""}>{x.v} </span>)}
        </div>
        {getExplanation && (
          <div className="explain-wrap" style={{ padding: "10px 0 0" }}>
            <ExplainButton text={c.full || c.corrected} mistake={c.original}
              explanations={explanations} getExplanation={getExplanation} Ts={Ts} />
          </div>
        )}
        {showStats && (
          <div className="rev-stats">
            <span>{bilingual ? "geoefend · practiced" : "geoefend"} <b>{c.practiceCount || 0}×</b></span>
            <span>{bilingual ? "laatst geoefend · last practiced" : "laatst geoefend"} <b>
              {c.lastPracticedAt ? fmt(c.lastPracticedAt) : (bilingual ? "nog niet · not yet" : "nog niet")}
            </b></span>
            <span>{bilingual ? "op rij goed · correct in a row" : "op rij goed"} <b>{c.streak || 0}</b></span>
            <span>{bilingual ? "volgende revisie · next revision" : "volgende revisie"} <b>
              {mastered ? (bilingual ? "onder de knie · mastered" : "onder de knie") : fmt(mistakeDue(c, settings))}
            </b></span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= explanation ================= */

function ExplanationCard({ data, Ts, onRegenerate, busy }) {
  return (
    <div className="explain">
      {data.mistake_note && (
        <div className="explain-mistake">
          <span className="lbl">{Ts("Wat ging er mis", "What went wrong")}</span>
          <p>{data.mistake_note}</p>
        </div>
      )}
      <div className="explain-tr">{data.translation}</div>
      {data.literal && <div className="explain-lit"><i>{Ts("letterlijk", "literally")}:</i> {data.literal}</div>}
      {data.words.length > 0 && (
        <div className="explain-words">
          {data.words.map((w, i) => (
            <div className="explain-word" key={i}>
              <b>{w.nl}</b><span>{w.en}</span>{w.note && <i>{w.note}</i>}
            </div>
          ))}
        </div>
      )}
      {data.examples && data.examples.length > 0 && (
        <div className="explain-sec">
          <span className="lbl">{Ts("Zelfde patroon", "Same pattern")}</span>
          {data.examples.map((x, i) => (
            <div className="explain-example" key={i}><b>{x.nl}</b><span>{x.en}</span></div>
          ))}
        </div>
      )}
      {data.notes && (
        <div className="explain-sec">
          <span className="lbl">{Ts("Opmerkingen", "Notes")}</span>
          <p>{data.notes}</p>
        </div>
      )}
      {onRegenerate && (
        <button className="aud" style={{ marginTop: 12 }} onClick={onRegenerate} disabled={busy}>
          <RotateCcw strokeWidth={2.2} />{busy ? Ts("Laden…", "Loading…") : Ts("Opnieuw genereren", "Regenerate")}
        </button>
      )}
    </div>
  );
}

// Shared between the chat view, the Library, revision mode, and the Fouten page — same
// cache, same key (sentence text, plus the original wrong phrasing when given), so a
// sentence explained once never gets re-sent to the AI from any of those places.
// "Regenerate" bypasses the cache on purpose — for when the explanation style has since
// improved and an older cached entry is stuck sounding like the old prompt.
function ExplainButton({ text, mistake, explanations, getExplanation, Ts }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const clean = String(text || "").replace(/\*\*/g, "").trim();
  const mistakeClean = mistake ? String(mistake).replace(/\*\*/g, "").trim() : "";
  const key = mistakeClean ? `${mistakeClean}→${clean}` : clean;
  const cached = explanations[key];

  async function load(force) {
    setBusy(true); setErr("");
    try { await getExplanation(clean, { force, mistake: mistakeClean }); } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  async function toggle() {
    if (open) { setOpen(false); return; }
    if (!cached) await load(false);
    setOpen(true);
  }

  return (
    <>
      <button className="aud" onClick={toggle} disabled={busy}>
        <HelpCircle strokeWidth={2.4} />
        {busy ? Ts("Laden…", "Loading…") : open ? Ts("Uitleg verbergen", "Hide explanation") : Ts("Uitleg", "Explain")}
      </button>
      {err && <div className="note err" style={{ margin: "10px 14px 0" }}>{err}</div>}
      {open && cached && <ExplanationCard data={cached} Ts={Ts} busy={busy} onRegenerate={() => load(true)} />}
    </>
  );
}

// Push-to-talk: click to start, click again to stop. The clip goes to /api/stt and the
// transcript lands in the caller's draft — appended, never auto-sent, so it can be checked
// (and corrected) before the learner decides to send it.
function MicButton({ onText, Ts, disabled }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeRef = useRef("");

  async function start() {
    setErr("");
    const mimeType = pickMicMime();
    if (!mimeType) {
      setErr(Ts("Spraakinvoer wordt niet ondersteund in deze browser.", "Voice input isn't supported in this browser."));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType });
      mimeRef.current = mimeType;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (!blob.size) return;
        setBusy(true);
        try {
          const audio = await blobToBase64(blob);
          const r = await fetch("/api/stt", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio, mimeType })
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
          if (d.text) onText(d.text);
        } catch (e) { setErr(String(e.message || e)); }
        setBusy(false);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      setErr(Ts("Microfoon niet beschikbaar — geef toegang in de browser.",
        "Microphone unavailable — grant access in the browser.") + " (" + (e.message || e) + ")");
    }
  }

  function stop() {
    recRef.current?.stop();
    setRecording(false);
  }

  return (
    <>
      <button type="button" className={"mic-btn" + (recording ? " rec" : "")} disabled={disabled || busy}
        onClick={recording ? stop : start}
        title={recording ? Ts("Stop opname", "Stop recording") : Ts("Spreek in — voice input", "Speak — voice input")}>
        {recording ? <Square strokeWidth={2.4} /> : <Mic strokeWidth={2.4} />}
      </button>
      {err && <div className="note err" style={{ margin: "8px 0 0" }}>
        {err}<button className="btn g" style={{ marginLeft: 10, padding: "4px 10px", fontSize: 12 }}
          onClick={() => setErr("")}>OK</button></div>}
    </>
  );
}

function ChatView({ messages, busy, error, draft, setDraft, setDraftFromVoice, send, speak, settings,
  markKnown, vocab, streamRef, T, Ts, ttsWarn, setTtsWarn, setTab, saveMp3, undo, undoKnown, setUndo,
  getClip, flagHard, revealMessage, saveCorrection, saveNewWord, awardChatListen, explanations,
  getExplanation }) {
  return (
    <>
      <div className="stream" ref={streamRef}>
        <div className="wrap">
          {ttsWarn === "novoice" && (
            <div className="note err" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <VolumeX strokeWidth={2.2} style={{ width: 17, height: 17, flexShrink: 0, marginTop: 1 }} />
              <div>
                <b>Geen Nederlandse stem gevonden — no Dutch voice installed.</b><br />
                Ik weiger de tekst voor te lezen met een Engelse stem: dat leert je de verkeerde uitspraak.
                Kies bij Instellingen een echte Nederlandse stem of een Google-stem.
                <div style={{ marginTop: 9 }}>
                  <button className="btn g" onClick={() => { setTtsWarn(""); setTab("settings"); }}>
                    {Ts("Audio instellen", "Set up audio")}</button>
                </div>
              </div>
            </div>
          )}
          {ttsWarn && ttsWarn !== "novoice" && (
            <div className="note err">{ttsWarn}
              <button className="btn g" style={{ marginLeft: 10, padding: "4px 10px", fontSize: 12 }}
                onClick={() => setTtsWarn("")}>OK</button>
            </div>
          )}
          {messages.length === 0 && (
            <div className="empty">
              <div className="ico"><MessageSquare strokeWidth={2} /></div>
              <h3>Waar wil je het over hebben?</h3>
              <p>Schrijf iets in het Nederlands. Ik corrigeer je zin, leg uit wat er misging, en praat verder.
                {vocab.words.length === 0 && " Importeer eerst je woordenlijst bij Woordenlijst."}</p>
              <div className="btns" style={{ justifyContent: "center" }}>
                {["Hoi! Ik heet…", "Vandaag heb ik gewerkt.", "Ik woon in Rotterdam."].map((s) => (
                  <button key={s} className="btn g" onClick={() => setDraft(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div className="turn" key={i}>
              {m.role === "user"
                ? <div style={{ display: "flex" }}><div className="you">{m.text}</div></div>
                : (
                  <div className="reply">
                    {m.corrections && m.corrections.length > 0
                      ? m.corrections.map((c) => (
                          <Strip key={c.id} c={c} speak={speak} bilingual={settings.bilingualUI}
                            Ts={Ts} explanations={explanations} getExplanation={getExplanation}
                            onSave={!settings.autoSave && !c.saved ? () => saveCorrection(c) : null}
                            saved={!settings.autoSave && c.saved} />))
                      : <div className="clean"><Check strokeWidth={3} />{Ts("Geen fouten", "No mistakes")}</div>}
                    {m.revealed
                      ? <div className="reply-txt"><Rendered text={m.reply} onWord={markKnown} /></div>
                      : (
                        <div className="reply-hidden">
                          <button className="btn g" onClick={() => revealMessage(m.at)}>
                            <Eye strokeWidth={2.2} />{Ts("Tekst onthullen", "Reveal text")}
                          </button>
                          <span className="lbl">{Ts("Luister eerst — lees daarna.", "Listen first — read after.")}</span>
                        </div>
                      )}
                    {!settings.autoSave && m.newWords && m.newWords.length > 0 && (
                      <div className="new-words-row">
                        <span className="lbl"><Sparkles strokeWidth={2} />{Ts("Nieuwe woorden", "New words")}</span>
                        {m.newWords.map((w) => (
                          <button key={w.lemma} className={"nw-chip" + (w.saved ? " on" : "")}
                            disabled={w.saved} onClick={() => saveNewWord(w)}
                            title={w.saved
                              ? "Opgeslagen in Woorden — Saved to Words"
                              : "Opslaan in Woorden — Save to Words"}>
                            {w.saved ? <Check strokeWidth={2.6} /> : <Plus strokeWidth={2.6} />}
                            {w.word}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="reply-foot">
                      <Player text={m.reply} getClip={getClip} rate={settings.rate}
                        Ts={Ts} onSave={settings.tts === "google" ? () => saveMp3(m.reply) : null}
                        onPlay={() => awardChatListen(m)} />
                    </div>
                    {m.revealed && (
                      <div className="explain-wrap">
                        <ExplainButton text={m.reply} explanations={explanations}
                          getExplanation={getExplanation} Ts={Ts} />
                      </div>
                    )}
                    <div className="reply-meta">
                      {typeof m.ratio === "number" && (
                        <span className={"ratio " + (m.ratio > 10 ? "hi" : m.ratio > 6 ? "mid" : "ok")}
                          title="Aandeel woorden buiten je woordenlijst — share of words outside your list">
                          {m.ratio}% {Ts("onbekend", "unknown")}
                        </span>
                      )}
                      <button className={"hard" + (m.hard ? " on" : "")} onClick={() => flagHard(m.at)}>
                        {m.hard ? "\u2713 " : ""}{Ts("Te moeilijk", "Too hard")}
                      </button>
                    </div>
                  </div>
                )}
            </div>
          ))}

          {busy && <div className="dots"><i /><i /><i /></div>}
          {error && <div className="note err"><b>Er ging iets mis (Something went wrong)</b><br />{error}</div>}
        </div>
      </div>

      <div className="comp">
        {undo && (
          <div className="undobar">
            <Check strokeWidth={2.6} />
            <span>{undo.words.length
              ? `Toegevoegd aan je woordenlijst: ${undo.words.join(", ")}`
              : "Al bekend"}</span>
            <button onClick={undoKnown}>{Ts("Ongedaan maken", "Undo")}</button>
            <button onClick={() => setUndo(null)} aria-label="sluiten"><X strokeWidth={2.6} /></button>
          </div>
        )}
        <div className="comp-in">
          <textarea rows={2} value={draft} placeholder="Schrijf in het Nederlands… (Write in Dutch…)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <div className="comp-r">
            <span className="hint"><kbd>Enter</kbd> versturen · <kbd>Shift+Enter</kbd> nieuwe regel</span>
            <span className="hint">{countWords(draft)}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
              <MicButton Ts={Ts} disabled={busy}
                onText={(text) => { setDraftFromVoice(true);
                  setDraft((cur) => (cur.trim() ? `${cur.trim()} ${text}` : text)); }} />
              <button className="btn" style={{ marginLeft: 0 }} onClick={send} disabled={busy || !draft.trim()}>
                <Send strokeWidth={2.3} />{Ts("Stuur", "Send")}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ================= revision mode =================
   Pulls a random sentence from the mistake log, shows its English translation, and has the
   learner transcribe it back into Dutch. Each round then reveals: correction of the attempt
   -> the original logged sentence (for comparison, since a translation can be phrased more
   than one correct way) -> the English prompt for the next round. Practice attempts here are
   ephemeral — they are not written back into the mistake log. */

// Module-level, not component state: remembers the previous session's opening pick for as
// long as the tab stays open, so re-entering revision mode doesn't risk opening on the same
// sentence again purely by chance (a real risk with a small due-pool and independent
// Math.random() draws — a full shuffle plus this one swap fixes it).
let lastRevisionFirstId = null;

function RevisionPanel({ speak, settings, T, Ts, corrections, updateMistakeStats, explanations, getExplanation,
  showForecast, getClip, awardXp }) {
  const [rounds, setRounds] = useState([]);
  const [draft, setDraft] = useState("");
  const [draftFromVoice, setDraftFromVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadingFirst, setLoadingFirst] = useState(true);
  const queueRef = useRef([]);
  const startedRef = useRef(false);
  const streamRef = useRef(null);

  // Only whole, reasonably-sized sentences make good revision material — a stray short
  // fragment from older data wouldn't translate into a useful transcription exercise.
  const eligible = useMemo(() => corrections.filter((c) => c.corrected && countWords(c.corrected) >= 3),
    [corrections]);
  // Due today (or earlier), and not yet mastered — see the spaced-repetition helpers above.
  const duePool = useMemo(() => eligible.filter((c) => isDue(c, settings)),
    [eligible, settings.revisionIntervals]);
  const allMastered = eligible.length > 0 && eligible.every((c) => isMastered(c, settings));
  const nextDueAt = useMemo(() => {
    const upcoming = eligible.filter((c) => !isMastered(c, settings)).map((c) => mistakeDue(c, settings));
    return upcoming.length ? Math.min(...upcoming) : null;
  }, [eligible, settings.revisionIntervals]);

  // How many sentences become due each of the next 30 days, given the current interval
  // settings — overdue/due-today items all collapse into day 0 (today's bucket).
  const forecast = useMemo(() => {
    const todayStart = startOfDay(Date.now());
    const buckets = new Map();
    eligible.forEach((c) => {
      if (isMastered(c, settings)) return;
      const due = Math.max(startOfDay(mistakeDue(c, settings)), todayStart);
      buckets.set(due, (buckets.get(due) || 0) + 1);
    });
    const out = [];
    for (let i = 0; i < 30; i++) {
      const day = addDays(todayStart, i);
      out.push({
        label: new Date(day).toLocaleDateString("nl-NL", { day: "numeric", month: "numeric" }),
        count: buckets.get(day) || 0
      });
    }
    return out;
  }, [eligible, settings.revisionIntervals]);

  async function translate(nl) {
    const r = await fetch("/api/translate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: nl, model: settings.model || undefined })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
    return String(d.en || "");
  }

  function pickTarget() {
    if (!queueRef.current.length) {
      if (!duePool.length) return null;
      let order = shuffle(duePool);
      // Don't reopen on the exact same sentence as last time, when there's a choice.
      if (order.length > 1 && order[0].id === lastRevisionFirstId) {
        [order[0], order[1]] = [order[1], order[0]];
      }
      lastRevisionFirstId = order[0].id;
      queueRef.current = order;
    }
    return queueRef.current.shift();
  }

  async function queueNextRound() {
    const pick = pickTarget();
    if (!pick) return null;
    // The normal case: translation was already saved when the mistake was logged (or
    // backfilled) — no API call needed. Only a fresh, not-yet-backfilled mistake falls
    // back to translating here, and that result gets saved too, so it's cached from now on.
    let en = pick.en;
    if (!en) {
      en = await translate(pick.corrected);
      updateMistakeStats(pick.id, { en });
    }
    const round = { id: Date.now() + "-" + Math.random().toString(36).slice(2),
      sourceId: pick.id, targetNl: pick.corrected, en, attempt: null, result: null };
    setRounds((rs) => [...rs, round]);
    return round;
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (duePool.length) queueNextRound().catch((e) => setError(String(e.message || e))).finally(() => setLoadingFirst(false));
    else setLoadingFirst(false);
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [rounds, busy]);

  async function submit() {
    const attempt = draft.trim();
    const current = rounds[rounds.length - 1];
    if (!attempt || busy || !current || current.result) return;
    const fromVoice = draftFromVoice;
    setBusy(true); setError(""); setDraft(""); setDraftFromVoice(false);

    // If it matches the known-good original word for word (modulo case/punctuation), it is
    // unambiguously correct — skip the AI entirely rather than risk it proposing some other
    // "better" phrasing purely because it was never shown the sentence it's actually being
    // compared against.
    const exactMatch = normSentence(attempt) === normSentence(current.targetNl);

    const sys = `Je bent een Nederlandse taaldocent. De leerling vertaalt de Engelse zin "${current.en}"
naar het Nederlands. Het origineel uit het foutenlogboek — een bekend goede vertaling — is: "${current.targetNl}"

ANTWOORD ALTIJD MET GELDIGE JSON, geen markdown:
{"reply_nl":"","corrections":[{"original":"","corrected":"","type":"fout"}],"new_words":[]}
Beoordeel de Nederlandse zin die de leerling schreef (de gebruikersboodschap) op grammatica, spelling en
woordkeuze, met het origineel hierboven als referentie voor wat een goede vertaling is. Sta ook andere
natuurlijke formuleringen toe die dezelfde betekenis correct overbrengen, ook als ze anders geformuleerd
zijn dan het origineel — corrigeer ALLEEN echte fouten (grammatica, spelling, woordkeuze), nooit puur
stilistische verschillen met het origineel. Is de zin al correct? Dan "corrections": [].
Verzin nooit fouten. Laat "reply_nl" en "new_words" leeg (dus "" en []).`;

    try {
      const [chatData, nextRound] = await Promise.all([
        exactMatch ? Promise.resolve({ corrections: [] }) : fetch("/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: settings.model || undefined, system: sys,
            messages: [{ role: "user", content: attempt }]
          })
        }).then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
          return d;
        }),
        queueNextRound()
      ]);

      const cors = (chatData.corrections || [])
        .map((c, i) => ({
          id: current.id + "-r" + i,
          original: String(c.original || attempt), corrected: String(c.corrected || ""),
          type: c.type === "beter" ? "beter" : "fout"
        }))
        .filter((c) => c.corrected);
      const correct = cors.length === 0;

      setRounds((rs) => rs.map((r) => (r.id === current.id ? { ...r, attempt, result: cors } : r)));
      if (countWords(attempt) >= 2) awardXp(fromVoice ? "speaking" : "writing", fromVoice ? XP.speaking : XP.writing);
      if (settings.autoplay) setTimeout(() => speak(current.targetNl), 220);

      // Advance this sentence's spaced-repetition state: correct -> next interval level
      // (or mastered, once streak reaches the number of configured intervals). Wrong ->
      // streak resets to 0, but it stays due TODAY (not pushed out to the first interval) —
      // so it keeps reappearing, in random order, for the rest of today's session until
      // it's finally answered correctly at least once. It only moves beyond today once
      // that happens, per the interval schedule above.
      const iv = intervalsOf(settings);
      const mistake = corrections.find((c) => c.id === current.sourceId);
      if (mistake) {
        const practiceCount = (mistake.practiceCount || 0) + 1;
        const streak = correct ? (mistake.streak || 0) + 1 : 0;
        const nextDue = correct
          ? (streak >= iv.length ? null : addDays(Date.now(), iv[streak]))
          : startOfDay(Date.now());
        updateMistakeStats(mistake.id, { practiceCount, streak, nextDue, lastPracticedAt: Date.now() });
      }

      if (!nextRound) {
        setError(Ts("Geen andere zinnen meer klaar voor revisie — kom later terug.",
          "No more sentences due for revision right now — check back later."));
      }
    } catch (e) {
      setError(String(e.message || e));
      setDraft(attempt); setDraftFromVoice(fromVoice);
    } finally {
      setBusy(false);
    }
  }

  // Same first-play/replay split as chat's awardChatListen(), against this panel's own
  // rounds array instead of the chat message list.
  // Same atomic check-and-set as awardChatListen() in App() — see the comment there.
  function awardListen(round) {
    let already = false;
    setRounds((rs) => rs.map((r) => {
      if (r.id !== round.id) return r;
      already = !!r.listened;
      return already ? r : { ...r, listened: true };
    }));
    if (!already) awardXp("listening", XP.listenFirst);
  }

  const forecastCard = (
    <div className="card pad" style={{ marginBottom: 14 }}>
      <span className="lbl">{Ts("Vooruitblik — volgende 30 dagen", "Forecast — next 30 days")}</span>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={forecast} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="#EFF1F5" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "Plus Jakarta Sans, sans-serif", fill: "#7C8598" }}
            interval={4} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fontFamily: "Plus Jakarta Sans, sans-serif", fill: "#7C8598" }}
            axisLine={false} tickLine={false} allowDecimals={false} width={22} />
          <Tooltip contentStyle={{ fontSize: 12, fontFamily: "Plus Jakarta Sans, sans-serif",
            border: "1px solid #E6E9EF", borderRadius: 10 }} />
          <Bar dataKey="count" name={Ts("te oefenen", "to practice")} fill="#2A55C8"
            radius={[4, 4, 0, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  if (loadingFirst) return (
    <div className="panel"><div className="pin"><div className="empty">
      <div className="ico"><Languages strokeWidth={2} /></div><h3>…</h3>
    </div></div></div>
  );

  if (!eligible.length) return (
    <div className="panel"><div className="pin"><div className="empty">
      <div className="ico"><Languages strokeWidth={2} /></div>
      <h3>Nog geen zinnen om te oefenen</h3>
      <p>Schrijf eerst een tijdje in het gewone gesprek — revisie gebruikt zinnen uit je foutenlogboek.
        <span style={{ color: "var(--faint)" }}> Write a bit in normal chat first — revision draws its
        sentences from your mistake log.</span></p>
    </div></div></div>
  );

  if (!duePool.length && !rounds.length) return (
    <div className="panel"><div className="pin">
      {showForecast && forecastCard}
      <div className="empty">
      <div className="ico"><Languages strokeWidth={2} /></div>
      <h3>{allMastered ? "Alles onder de knie!" : "Niets klaar voor revisie"}</h3>
      <p>{allMastered
        ? "Je hebt elke zin in je foutenlogboek onder de knie."
        : nextDueAt ? `De volgende zin is beschikbaar op ${new Date(nextDueAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}.` : ""}
        <span style={{ color: "var(--faint)" }}> {allMastered
          ? "You've mastered every sentence in your mistake log."
          : nextDueAt ? `The next sentence becomes available on ${new Date(nextDueAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.` : ""}</span></p>
    </div></div></div>
  );

  return (
    <>
      <div className="stream" ref={streamRef}>
        <div className="wrap">
          {showForecast && forecastCard}
          {rounds.map((r) => (
            <div className="turn" key={r.id}>
              <div className="reply">
                <div className="strip-h" style={{ padding: "12px 16px 0" }}>
                  <span className="lbl">{Ts("Vertaal naar het Nederlands", "Translate into Dutch")}</span>
                </div>
                <div className="reply-txt">{r.en}</div>
              </div>

              {r.attempt && (
                <div style={{ display: "flex", marginTop: 10 }}><div className="you">{r.attempt}</div></div>
              )}

              {r.result && (
                <div className="reply" style={{ marginTop: 10 }}>
                  {r.result.length
                    ? r.result.map((c) => <Strip key={c.id} c={c} speak={speak}
                        bilingual={settings.bilingualUI} Ts={Ts}
                        explanations={explanations} getExplanation={getExplanation} />)
                    : <div className="clean"><Check strokeWidth={3} />{Ts("Helemaal goed!", "Spot on!")}</div>}

                  <div className="strip-h" style={{ padding: "12px 16px 0" }}>
                    <span className="lbl">{Ts("Origineel uit je foutenlogboek", "Original from your mistake log")}</span>
                  </div>
                  <div className="reply-txt">{r.targetNl}</div>
                  <div className="reply-foot">
                    <Player text={r.targetNl} getClip={getClip} rate={settings.rate} Ts={Ts}
                      onPlay={() => awardListen(r)} />
                  </div>
                  <div className="explain-wrap">
                    <ExplainButton text={r.targetNl} explanations={explanations}
                      getExplanation={getExplanation} Ts={Ts} />
                  </div>
                </div>
              )}
            </div>
          ))}
          {busy && <div className="dots"><i /><i /><i /></div>}
          {error && <div className="note err">{error}</div>}
        </div>
      </div>

      <div className="comp">
        <div className="comp-in">
          <textarea rows={2} value={draft}
            placeholder={Ts("Schrijf je Nederlandse vertaling…", "Write your Dutch translation…")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <div className="comp-r">
            <span className="hint"><kbd>Enter</kbd> versturen · <kbd>Shift+Enter</kbd> nieuwe regel</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
              <MicButton Ts={Ts} disabled={busy}
                onText={(text) => { setDraftFromVoice(true);
                  setDraft((cur) => (cur.trim() ? `${cur.trim()} ${text}` : text)); }} />
              <button className="btn" style={{ marginLeft: 0 }} onClick={submit} disabled={busy || !draft.trim()}>
                <Send strokeWidth={2.3} />{Ts("Stuur", "Send")}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ================= vocabulary ================= */

/* ================= reading exercise ================= */

function ReadingView({ vocab, knownSet, settings, setSettings, markKnown, getClip,
  readingLibrary, saveReadingStory, removeReadingStory, awardXp, T, Ts }) {
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  const [genre, setGenre] = useState(settings.readingGenre || "avontuur");
  const [customGenre, setCustomGenre] = useState(settings.readingCustomGenre || "");
  const [topic, setTopic] = useState("");
  const [newWordPercent, setNewWordPercent] = useState(
    settings.readingNewWordPercent !== undefined ? settings.readingNewWordPercent : 10);
  const [wordCount, setWordCount] = useState(settings.readingWordCount || 200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [readSec, setReadSec] = useState(0);
  const [reading, setReading] = useState(false);

  // The clock only runs when started. Each tick awards whatever XP the 5-min-then-per-min
  // curve implies for crossing from readSec to readSec+1.
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => {
      setReadSec((s) => {
        awardXp("reading", timeXpDelta(s, s + 1));
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [reading]);

  const haveList = vocab.words.length > 200;

  async function generate() {
    setError(""); setBusy(true);
    const g = genre === "anders" ? customGenre.trim() : (GENRES.find((x) => x.id === genre)?.nl || "");
    set("readingGenre", genre); set("readingCustomGenre", customGenre);
    set("readingNewWordPercent", newWordPercent); set("readingWordCount", wordCount);

    try {
      // A 0% target is a hard promise, not a suggestion — the model can still slip a stray
      // word through, so retry a couple of times and keep the cleanest attempt rather than
      // trusting the prompt alone.
      const attempts = newWordPercent === 0 ? 3 : 1;
      let best = null;
      for (let i = 0; i < attempts; i++) {
        const r = await fetch("/api/reading", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            genre: g, topic: topic.trim(), wordCount, newWordPercent,
            knownWords: vocab.words, model: settings.model || undefined
          })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        const text = String(d.text || "").trim();
        const actualPercent = unknownRatio(text, knownSet, haveList);
        // Stored plain (no ** markers) — bolding is computed at render time from the CURRENT
        // vocab list, so a saved story never stays bold on words you've since learned.
        const attempt = {
          title: String(d.title || ""), text, translation: String(d.translation || ""),
          actualPercent, actualWordCount: countWords(text), savedId: null
        };
        best = attempt;
        if (actualPercent === null || actualPercent === 0) break;
      }
      setShowTranslation(false);
      setResult(best);
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  }

  function openStory(story) {
    setShowTranslation(false);
    setResult({
      title: story.title, text: story.text, translation: story.translation || "",
      actualPercent: story.newWordPercent ?? null, actualWordCount: story.wordCount,
      savedId: story.id
    });
  }

  function saveCurrent() {
    if (!result || result.savedId) return;
    const story = {
      title: result.title.trim() || Ts("Naamloos verhaal", "Untitled story"),
      text: result.text, translation: result.translation,
      wordCount: result.actualWordCount, newWordPercent: result.actualPercent, at: Date.now()
    };
    saveReadingStory(story);
    setResult((r) => ({ ...r, savedId: true })); // just marks "already saved", not the real id
  }

  return (
    <div className="panel"><div className="pin">
      <p className="sub">{Ts("Laat een tekst genereren om te lezen, precies op jouw niveau.",
        "Generate a text to read, tuned exactly to your level.")}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={"sess" + (reading ? " on" : "")} onClick={() => setReading((r) => !r)}
          title={reading ? "Leesklok pauzeren — Pause the reading clock" : "Leesklok starten — Start the reading clock"}>
          {reading ? <Pause strokeWidth={2.6} /> : <Play strokeWidth={2.6} />}
          <b>{hhmm(readSec)}</b>
          <span>{reading ? Ts("Lezen…", "Reading…") : Ts("Start lezen", "Start reading")}</span>
        </button>
      </div>

      <div className="card pad">
        <label className="field">
          <span className="lbl">{T("Soort tekst", "Type of text")}</span>
          <select className="inp" value={genre} onChange={(e) => setGenre(e.target.value)}>
            {GENRES.map((g) => <option key={g.id} value={g.id}>{Ts(g.nl, g.en)}</option>)}
          </select>
        </label>

        {genre === "anders" && (
          <label className="field">
            <span className="lbl">{T("Welk soort tekst?", "What kind of text?")}</span>
            <input className="inp" type="text" value={customGenre}
              onChange={(e) => setCustomGenre(e.target.value)}
              placeholder={Ts("bijv. een recept, een brief, een liedje…", "e.g. a recipe, a letter, a song…")} />
          </label>
        )}

        <label className="field">
          <span className="lbl">{T("Waarover moet het gaan? (optioneel)", "What should it be about? (optional)")}</span>
          <textarea className="inp" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder={Ts("bijv. een reis naar de bergen, twee vrienden die ruzie hebben…",
              "e.g. a trip to the mountains, two friends having an argument…")} />
        </label>

        <label className="field">
          <span className="lbl">{T("Nieuwe woorden", "New words")} — <b>{newWordPercent}%</b></span>
          <input className="rng" type="range" min={0} max={30} step={5} value={newWordPercent}
            onChange={(e) => setNewWordPercent(Number(e.target.value))} />
          <span className="sub" style={{ fontSize: 11.5, marginTop: 4, display: "block" }}>
            {newWordPercent === 0
              ? Ts("Alleen woorden uit je woordenlijst — nooit nieuwe woorden.",
                   "Only words from your vocabulary — never any new words.")
              : Ts(`Tot ${newWordPercent}% van de woorden mag nieuw zijn.`,
                   `Up to ${newWordPercent}% of the words may be new.`)}
          </span>
        </label>

        <label className="field">
          <span className="lbl">{T("Lengte", "Length")} — <b>{wordCount} {Ts("woorden", "words")}</b></span>
          <input className="rng" type="range" min={50} max={1000} step={25} value={wordCount}
            onChange={(e) => setWordCount(Number(e.target.value))} />
        </label>

        {error && <div className="note err">{error}</div>}

        <div className="btns">
          <button className="btn" onClick={generate} disabled={busy}>
            {busy
              ? Ts("Bezig met schrijven…", "Writing…")
              : result ? Ts("Nieuwe tekst genereren", "Generate new text") : Ts("Genereren", "Generate")}
          </button>
        </div>
      </div>

      {result && (
        <div className="card pad" style={{ marginTop: 14 }}>
          <div className="tiles">
            <div className="tile"><span className="lbl">{T("Woorden", "Words")}</span><b>{result.actualWordCount}</b></div>
            <div className="tile"><span className="lbl">{T("Nieuwe woorden", "New words")}</span>
              <b>{result.actualPercent === null ? "—" : `${result.actualPercent}%`}</b></div>
          </div>
          <div className="btns" style={{ marginTop: 14, alignItems: "center" }}>
            <input className="inp story-title" value={result.title}
              onChange={(e) => setResult((r) => ({ ...r, title: e.target.value }))}
              placeholder={Ts("Titel…", "Title…")} style={{ flex: "1 1 220px" }} />
            <button className="btn g" onClick={saveCurrent} disabled={!!result.savedId}>
              {result.savedId
                ? <><Check strokeWidth={2.4} />{Ts("Bewaard", "Saved")}</>
                : <><Save strokeWidth={2.2} />{Ts("Bewaren", "Save")}</>}
            </button>
          </div>

          <div className="reply-foot" style={{ marginTop: 10 }}>
            <Player text={result.title + ". " + result.text} getClip={getClip} rate={settings.rate} Ts={Ts} />
          </div>

          <div className="reply-txt reading-body" style={{ padding: 0, marginTop: 14 }}>
            <Rendered text={boldUnknown(result.text, knownSet)} onWord={markKnown} />
          </div>

          {result.translation && (
            <>
              <label className="tog" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={showTranslation}
                  onChange={(e) => setShowTranslation(e.target.checked)} />
                {T("Engelse vertaling tonen", "Show English translation")}
              </label>
              {showTranslation && (
                <div className="reply-txt" style={{ padding: 0, marginTop: 8, fontSize: 15.5, color: "var(--muted)" }}>
                  {result.translation}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {readingLibrary.length > 0 && (
        <div className="card pad" style={{ marginTop: 14 }}>
          <span className="lbl">{Ts(`${readingLibrary.length} bewaarde verhalen`, `${readingLibrary.length} saved stories`)}</span>
          <div style={{ marginTop: 10 }}>
            {readingLibrary.map((s) => (
              <div key={s.id} className="story-row">
                <button className="story-row-open" onClick={() => openStory(s)}>
                  <strong>{s.title}</strong>
                  <span>{s.wordCount} {Ts("woorden", "words")} · {new Date(s.at).toLocaleDateString("nl-NL",
                    { day: "numeric", month: "long", year: "numeric" })}</span>
                </button>
                <button className="spill" title={Ts("Verwijderen", "Remove")}
                  onClick={() => removeReadingStory(s.id)} aria-label={`verwijder ${s.title}`}>
                  <X strokeWidth={2.4} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div></div>
  );
}

function VocabView({ vocab, setVocab, removeVocabWord, T, Ts }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");

  function add() {
    const found = extractWords(text);
    const words = [...new Set([...vocab.words, ...found])];
    const v = { words, raw: (vocab.raw + "\n" + text).slice(-400000), updated: Date.now() };
    setVocab(v); save(K.vocab, v);
    setMsg(`${found.length} woorden gelezen — de lijst bevat nu ${words.length} woorden. (${found.length} words read — list now holds ${words.length}.)`);
    setText("");
  }

  const q = search.trim().toLowerCase();
  // Searching looks across the whole list; with no search, just the tail end (most
  // recently added) so the page doesn't have to render thousands of chips by default.
  const shown = q ? vocab.words.filter((w) => w.includes(q)) : vocab.words.slice(-300);

  return (
    <div className="panel"><div className="pin">
      <p className="sub">{Ts("Plak hier zinnen of woorden die je al kent.", "Paste sentences or words you already know here.")}</p>

      <div className="tiles">
        <div className="tile"><span className="lbl">{T("Bekende woorden", "Known words")}</span><b>{vocab.words.length}</b></div>
        <div className="tile"><span className="lbl">{T("Bijgewerkt", "Updated")}</span>
          <b style={{ fontSize: 17 }}>{vocab.updated ? new Date(vocab.updated).toLocaleDateString("nl-NL") : "—"}</b></div>
        <div className="tile"><span className="lbl">{T("Richting C1", "Toward C1")}</span>
          <b>{Math.min(100, Math.round((vocab.words.length / 8000) * 100))}<i>%</i></b></div>
      </div>

      <div className="card pad">
        <label className="field">
          <span className="lbl">{T("Zinnen of woorden plakken", "Paste sentences or words")}</span>
          <textarea className="inp" rows={9} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={"Ik ga morgen naar de markt.\nHij heeft de deur dichtgedaan.\n…"} />
        </label>
        {msg && <div className="note ok">{msg}</div>}
        <div className="btns">
          <button className="btn" onClick={add} disabled={!text.trim()}>
            <Plus strokeWidth={2.4} />{Ts("Toevoegen aan lijst", "Add to list")}</button>
        </div>
      </div>

      {vocab.words.length > 0 && (
        <div className="card pad" style={{ marginTop: 14 }}>
          <label className="vocab-search">
            <Search strokeWidth={2.2} />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={Ts("Zoek in je woordenlijst…", "Search your vocabulary…")} />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="wissen — clear">
                <X strokeWidth={2.4} />
              </button>
            )}
          </label>

          <span className="lbl" style={{ marginTop: 14, display: "block" }}>
            {q ? Ts(`${shown.length} resultaten`, `${shown.length} results`)
               : T("Laatste 300 woorden", "Last 300 words")}
          </span>
          {shown.length > 0
            ? (
              <p className="words" style={{ marginTop: 12 }}>
                {shown.map((w) => (
                  <span key={w}>
                    {w}
                    <button type="button" onClick={() => removeVocabWord(w)}
                      title="Verwijderen — Remove" aria-label={`verwijder ${w} — remove ${w}`}>
                      <X strokeWidth={2.6} />
                    </button>
                  </span>
                ))}
              </p>
            )
            : <p className="note" style={{ marginTop: 12 }}>{Ts("Geen woorden gevonden.", "No words found.")}</p>}
        </div>
      )}
    </div></div>
  );
}

/* ================= mistakes ================= */

function MistakesView({ corrections, speak, settings, T, Ts, removeCorrection, explanations, getExplanation }) {
  const [type, setType] = useState("alles");
  const [starFilter, setStarFilter] = useState("alle"); // "alle" | 0..totalStars

  const totalStars = intervalsOf(settings).length;
  const starsOf = (c) => Math.min(c.streak || 0, totalStars);

  const shown = corrections
    .filter((c) => type === "alles" || c.type === type)
    .filter((c) => starFilter === "alle" || starsOf(c) === starFilter)
    .slice().reverse();

  if (!corrections.length) return (
    <div className="panel"><div className="pin"><div className="empty">
      <div className="ico"><AlertCircle strokeWidth={2} /></div>
      <h3>Nog geen correcties</h3>
      <p>Zodra je gaat schrijven verschijnt hier je volledige foutenlogboek.
        (Your full mistake log will appear here.)</p>
    </div></div></div>
  );

  return (
    <div className="panel"><div className="pin">
      <p className="sub">{Ts(`${corrections.length} correcties bewaard.`, `${corrections.length} corrections saved.`)}</p>

      <div className="seg" style={{ marginBottom: 12 }}>
        {[["alles", "all"], ["fout", "errors"], ["beter", "phrasing"]].map(([t, en]) => (
          <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>
            {settings.bilingualUI ? `${t} · ${en}` : t}</button>
        ))}
      </div>

      <div className="chips" style={{ marginBottom: 18 }}>
        <button className={"chip" + (starFilter === "alle" ? " on" : "")} onClick={() => setStarFilter("alle")}>
          {Ts("alle sterren", "all stars")}</button>
        {Array.from({ length: totalStars + 1 }, (_, n) => (
          <button key={n} className={"chip" + (starFilter === n ? " on" : "")} onClick={() => setStarFilter(n)}>
            <StarRow star={n} total={totalStars} color="var(--jade)" />
          </button>
        ))}
      </div>

      {shown.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: 10, paddingBottom: 14 }}>
          <div className="lbl" style={{ padding: "12px 16px 0" }}>
            {new Date(c.at).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}
          </div>
          <Strip c={c} speak={speak} bilingual={settings.bilingualUI} Ts={Ts}
            onRemove={() => removeCorrection(c.id)} showStats settings={settings}
            explanations={explanations} getExplanation={getExplanation} />
        </div>
      ))}
    </div></div>
  );
}

/* ================= new words ================= */

// Generic ★★☆-style progress row — used for word mastery (amber, fixed 3) and, with a green
// color and a user-configurable total, for revision mastery on the Fouten page.
function StarRow({ star, total = 3, color = "var(--amber)" }) {
  return (
    <span className="star-row">
      {Array.from({ length: total }, (_, i) => (
        <Star key={i} strokeWidth={2} size={13}
          fill={i < star ? color : "none"}
          style={{ color: i < star ? color : "var(--faint)", transition: "color .2s, fill .2s" }} />
      ))}
    </span>
  );
}

function WordsView({ ledger, speak, T, Ts, removeWord, requestMarkKnown, settings, goLearn }) {
  const [q, setQ] = useState("");
  const shown = ledger.slice().reverse().filter((w) => !q ||
    w.word.toLowerCase().includes(q.toLowerCase()) || (w.en || "").toLowerCase().includes(q.toLowerCase()));

  function exportCsv() {
    const csv = "woord,lemma,engels,context\n" + ledger.map((w) =>
      [w.word, w.lemma, w.en, w.context].map((f) => `"${String(f || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "nieuwe-woorden.csv"; a.click();
  }

  if (!ledger.length) return (
    <div className="panel"><div className="pin"><div className="empty">
      <div className="ico"><Sparkles strokeWidth={2} /></div>
      <h3>Nog niets verzameld</h3>
      <p>Woorden die vet in het gesprek verschijnen komen hier automatisch terecht, met vertaling en de zin
        waarin je ze tegenkwam. (Bolded words are collected here automatically, with translation and context.)</p>
    </div></div></div>
  );

  const dueCount = ledger.filter((w) => isWordDue(w, settings)).length;

  return (
    <div className="panel"><div className="pin">
      <p className="sub">{Ts(`${ledger.length} woorden ontmoet in gesprekken.`, `${ledger.length} words met in conversation.`)}</p>

      <div className="card pad" style={{ marginBottom: 16, display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="lbl">{T("Klaar om te oefenen", "Due to practice")}</span>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{dueCount}</div>
        </div>
        <button className="btn" disabled={!dueCount} onClick={() => goLearn()}>
          <GraduationCap strokeWidth={2.2} />{Ts("Ga oefenen", "Practice now")}
        </button>
      </div>

      <div className="btns" style={{ marginBottom: 16, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "0 1 260px" }}>
          <Search strokeWidth={2.2} style={{ position: "absolute", left: 11, top: 10, width: 15, height: 15,
            color: "var(--faint)" }} />
          <input className="inp" style={{ paddingLeft: 33 }} value={q}
            placeholder={Ts("Zoeken…", "Search…")} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn g" onClick={exportCsv}><Download strokeWidth={2.2} />CSV</button>
      </div>
      <div className="wgrid">
        {shown.map((w, i) => {
          const star = w.star || 0;
          const due = isWordDue(w, settings);
          const dueAt = wordDue(w, settings);
          return (
            <div className="wc" key={i}>
              <div className="wc-actions">
                <button className="add" title="Toevoegen aan woordenlijst — Add to word list"
                  onClick={() => requestMarkKnown(w.word)}><Plus strokeWidth={2.6} /></button>
                <button className="del" title="Verwijderen — Remove" onClick={() => removeWord(w)}>
                  <X strokeWidth={2.6} /></button>
              </div>
              <strong onClick={() => speak(w.word, false, { library: false })}>{w.word}<Volume2 strokeWidth={2.4} /></strong>
              <span>{w.en}</span>
              {w.context && <q>{w.context.slice(0, 90)}</q>}
              <div className="wc-learn">
                <StarRow star={star} />
                <span className="lbl" style={{ color: "var(--faint)", fontWeight: 400 }}>
                  {due ? Ts("klaar om te oefenen", "due to practice")
                    : Ts("volgende oefening", "next practice") + ": " +
                      new Date(dueAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div></div>
  );
}

/* ================= word mastery (Leren) =================
   Three star levels per word, each a different task, gated by settings.wordIntervals — see
   the wordDue()/isWordDue() helpers near the top of this file for the exact scheduling rules.
   Passing star 3 promotes the word into the real vocabulary list immediately (via the same
   markKnown() the chat/New Words shortcuts use) and it drops out of the ledger.

   Deliberately NOT a browsable list you pick a word from — seeing the word's text before you
   attempt it defeats stars 1 and 2, which are dictation (write back what you HEAR, not what
   you just read). The page always auto-picks a random due word for you, the same way revision
   mode does for corrections. Star 3 is the one exception: writing your own sentence WITH the
   word obviously requires knowing what the word is, so it's the only star that reveals it. */

const normWord = (s) => String(s).toLowerCase().replace(CLEAN, "");
const normSentence = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

function LearnPanel({ ledger, vocab, speak, settings, T, Ts, updateWordStats, markKnown }) {
  const [current, setCurrent] = useState(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null); // { ok, correct, note, corrections, mastered } | null
  const [busy, setBusy] = useState(false);
  const [sentence, setSentence] = useState("");     // star 2's generated dictation sentence
  const [genErr, setGenErr] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [streak, setStreak] = useState(0);          // this-session-only, ephemeral — pure gamification
  const startedRef = useRef(false);
  const iv = wordIntervalsOf(settings);
  const star = current ? (current.star || 0) : 0;   // 0,1,2 — index of the star being attempted

  function pickNext() {
    // Every word is attempted at most once a day (pass advances it, fail pushes it to
    // tomorrow), so there's no repeat-avoidance needed — just draw fresh from whatever's
    // still due right now.
    const pool = ledger.filter((w) => isWordDue(w, settings));
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setCurrent(pickNext());
    // eslint-disable-next-line
  }, []);

  // Star 2's sentence is generated once per attempt, using ONLY the learner's real known
  // words — a fresh one each time, so there's nothing to memorize on a retry.
  useEffect(() => {
    if (!current || star !== 1) return;
    let cancelled = false;
    setGenBusy(true); setGenErr("");
    fetch("/api/word-sentence", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word: current.word, lemma: current.lemma, en: current.en,
        knownWords: vocab.words, model: settings.model || undefined
      })
    }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
      if (!cancelled) setSentence(String(d.sentence || ""));
    }).catch((e) => { if (!cancelled) setGenErr(String(e.message || e)); })
      .finally(() => { if (!cancelled) setGenBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [current, star]);

  function next() {
    setAnswer(""); setResult(null); setSentence(""); setGenErr("");
    setCurrent(pickNext());
  }

  function pass() {
    setStreak((s) => s + 1);
    if (star >= 2) {
      // Star 3 just passed — promote straight into the real vocabulary list, same action the
      // confirm-and-add shortcuts use, and drop out of the ledger entirely.
      markKnown(current.word);
      setResult({ ok: true, mastered: true });
      return;
    }
    const nextDue = addDays(startOfDay(Date.now()), iv[star + 1] ?? 0);
    updateWordStats(current, { star: star + 1, nextDue });
    setResult({ ok: true, mastered: false, unlockAt: nextDue });
  }

  function fail(extra) {
    setStreak(0);
    updateWordStats(current, { nextDue: addDays(startOfDay(Date.now()), 1) });
    setResult({ ok: false, ...extra });
  }

  function checkStar1() {
    const a = normWord(answer);
    if (!a) return;
    const ok = a === normWord(current.word) || a === normWord(current.lemma);
    setBusy(true);
    if (ok) pass(); else fail({ correct: current.word });
    setBusy(false);
  }

  function checkStar2() {
    const a = normSentence(answer);
    if (!a || !sentence) return;
    const ok = a === normSentence(sentence);
    setBusy(true);
    if (ok) pass(); else fail({ correct: sentence });
    setBusy(false);
  }

  async function checkStar3() {
    const s = answer.trim();
    if (!s || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/word-check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: current.word, lemma: current.lemma, sentence: s, model: settings.model || undefined })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
      if (d.usesWord && d.corrections.length === 0) pass();
      else fail({ note: d.note, corrections: d.corrections, usesWord: d.usesWord });
    } catch (e) { setGenErr(String(e.message || e)); }
    setBusy(false);
  }

  if (!ledger.length) return (
    <div className="panel"><div className="pin"><div className="empty">
      <div className="ico"><GraduationCap strokeWidth={2} /></div>
      <h3>Nog geen woorden om te leren</h3>
      <p>Nieuwe woorden uit je gesprekken verschijnen hier zodra ze zijn gemarkeerd.
        <span style={{ color: "var(--faint)" }}> New words from your conversations appear here once flagged.</span></p>
    </div></div></div>
  );

  const totalStars = ledger.reduce((n, w) => n + (w.star || 0), 0);
  const dueCount = ledger.filter((w) => isWordDue(w, settings)).length;
  const statsRow = (
    <div className="tiles" style={{ marginBottom: 18 }}>
      <div className="tile"><span className="lbl">{T("Klaar om te oefenen", "Due to practice")}</span><b>{dueCount}</b></div>
      <div className="tile"><span className="lbl">{T("Woorden in training", "Words in training")}</span><b>{ledger.length}</b></div>
      <div className="tile"><span className="lbl">{T("Sterren behaald", "Stars earned")}</span>
        <b>{totalStars}<i>/{ledger.length * 3}</i></b></div>
    </div>
  );

  // ---- nothing due right now (either never was, or just finished today's batch) ----
  if (!current) return (
    <div className="panel"><div className="pin">
      {statsRow}
      <div className="empty">
        <div className="ico"><GraduationCap strokeWidth={2} /></div>
        <h3>{streak > 0 || totalStars > 0 ? "Voor nu klaar!" : "Niets te oefenen"}</h3>
        <p>Kom morgen terug voor de volgende woorden.
          <span style={{ color: "var(--faint)" }}> Come back tomorrow for the next batch of words.</span></p>
      </div>
    </div></div>
  );

  // ---- active challenge: one blindly-picked word, whichever star it's currently on ----
  const stepLabels = [
    ["Ster 1 — schrijf het woord dat je hoort", "Star 1 — write the word you hear"],
    ["Ster 2 — schrijf de zin die je hoort", "Star 2 — write the sentence you hear"],
    ["Ster 3 — schrijf je eigen zin", "Star 3 — write your own sentence"]
  ];

  return (
    <div className="panel"><div className="pin">
      {statsRow}

      <div className="card pad" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span className="lbl">{Ts(stepLabels[star][0], stepLabels[star][1])}</span>
          <StarRow star={star} />
        </div>
        {streak > 1 && (
          <div className="note ok" style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5 }}>
            🔥 {Ts(`${streak} op rij goed`, `${streak} correct in a row`)}
          </div>
        )}
      </div>

      {!result && star === 0 && (
        <div className="card pad">
          <p className="lbl" style={{ marginBottom: 12, fontWeight: 400 }}>
            {T("Luister en schrijf het Nederlandse woord op.", "Listen and write down the Dutch word.")}
          </p>
          <button className="btn g" style={{ marginBottom: 14 }}
            onClick={() => speak(current.word, false, { library: false })}>
            <Play strokeWidth={2.2} />{Ts("Beluister", "Listen")}
          </button>
          <input className="inp" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") checkStar1(); }}
            placeholder={Ts("Typ het woord…", "Type the word…")} />
          <button className="btn" style={{ marginTop: 12 }} disabled={!answer.trim() || busy} onClick={checkStar1}>
            <Check strokeWidth={2.2} />{Ts("Controleren", "Check")}
          </button>
        </div>
      )}

      {!result && star === 1 && (
        <div className="card pad">
          <p className="lbl" style={{ marginBottom: 12, fontWeight: 400 }}>
            {T("Luister naar een zin — alleen woorden die je al kent worden gebruikt, plus dit ene nieuwe woord.",
              "Listen to a sentence — only words you already know are used, plus this one new word.")}
          </p>
          {genErr && <div className="note err">{genErr}</div>}
          {genBusy && <div className="lbl">{Ts("Zin maken…", "Generating sentence…")}</div>}
          {sentence && !genBusy && (
            <button className="btn g" style={{ marginBottom: 14 }}
              onClick={() => speak(sentence, false, { library: false })}>
              <Play strokeWidth={2.2} />{Ts("Beluister", "Listen")}
            </button>
          )}
          <input className="inp" value={answer} onChange={(e) => setAnswer(e.target.value)}
            disabled={genBusy} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") checkStar2(); }}
            placeholder={Ts("Typ de zin…", "Type the sentence…")} />
          <button className="btn" style={{ marginTop: 12 }} disabled={!answer.trim() || busy || genBusy} onClick={checkStar2}>
            <Check strokeWidth={2.2} />{Ts("Controleren", "Check")}
          </button>
        </div>
      )}

      {!result && star === 2 && (
        <div className="card pad">
          <p className="lbl" style={{ marginBottom: 12, fontWeight: 400 }}>
            {T(`Schrijf zelf een Nederlandse zin met het woord "${current.word}"${current.en ? ` (${current.en})` : ""}. Hoe langer, hoe beter!`,
              `Write your own Dutch sentence using the word "${current.word}"${current.en ? ` (${current.en})` : ""}. The longer, the better!`)}
          </p>
          <textarea className="inp" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus
            placeholder={Ts("Schrijf hier je zin…", "Write your sentence here…")} />
          <div className="lbl" style={{ marginTop: 6, color: "var(--faint)" }}>{countWords(answer)} {Ts("woorden", "words")}</div>
          <button className="btn" style={{ marginTop: 12 }} disabled={!answer.trim() || busy} onClick={checkStar3}>
            <Check strokeWidth={2.2} />{busy ? Ts("Bezig…", "Checking…") : Ts("Controleren", "Check")}
          </button>
        </div>
      )}

      {result && (
        <div className={"note " + (result.ok ? "ok" : "err")} style={{ marginTop: 14 }}>
          {result.ok ? (
            result.mastered ? (
              <div>
                <b>🏆 {Ts(`Gefeliciteerd! "${current.word}" staat nu in je woordenlijst.`,
                  `Congratulations! "${current.word}" is now in your vocabulary list.`)}</b>
              </div>
            ) : (
              <div>
                <b>⭐ {Ts(`Goed gedaan! Het woord was "${current.word}".`, `Well done! The word was "${current.word}".`)}</b>{" "}
                {Ts(
                  `Ster ${star + 2} is beschikbaar op ${new Date(result.unlockAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}.`,
                  `Star ${star + 2} unlocks on ${new Date(result.unlockAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.`)}
              </div>
            )
          ) : (
            <div>
              <b>{Ts("Nog niet helemaal goed.", "Not quite right.")}</b>{" "}
              {result.correct && Ts(`Het juiste antwoord was: "${result.correct}".`, `The correct answer was: "${result.correct}".`)}
              {result.note && <p style={{ margin: "6px 0 0" }}>{result.note}</p>}
              {result.corrections && result.corrections.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {result.corrections.map((c, i) => {
                    const d = wordDiff(c.original, c.corrected);
                    return (
                      <div key={i} style={{ marginTop: i ? 8 : 0 }}>
                        <div className="old">{d.filter((x) => x.t !== "ins").map((x, j) =>
                          <span key={j} className={x.t === "del" ? "del" : ""}>{x.v} </span>)}</div>
                        <div className="new">{d.filter((x) => x.t !== "del").map((x, j) =>
                          <span key={j} className={x.t === "ins" ? "ins" : ""}>{x.v} </span>)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p style={{ margin: "8px 0 0" }}>{Ts("Morgen kun je het opnieuw proberen.", "You can try again tomorrow.")}</p>
            </div>
          )}
          <div className="btns" style={{ marginTop: 12 }}>
            <button className="btn" onClick={next}>{Ts("Volgende woord", "Next word")}</button>
          </div>
        </div>
      )}
    </div></div>
  );
}

/* ================= audio library ================= */

// Plain "YYYY-MM-DD" (from an <input type="date">) parsed as a LOCAL midnight, not UTC —
// the native Date constructor treats date-only ISO strings as UTC, which is off by a day
// in any timezone west of it. Matches the local-day convention startOfDay()/addDays() use.
function parseDateLocal(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function LibraryView({ settings, T, Ts, explanations, getExplanation, awardXp }) {
  const [data, setData] = useState({ items: [], bytes: 0, monthChars: 0 });
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rate, setRate] = useState(settings.rate || 1);
  const [playing, setPlaying] = useState("");
  const [err, setErr] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState("");
  const [exportErr, setExportErr] = useState("");
  const audio = useRef(null);

  const fromTs = dateFrom ? parseDateLocal(dateFrom) : -Infinity;
  const toTs = dateTo ? addDays(parseDateLocal(dateTo), 1) : Infinity; // exclusive, so "to" day is included whole
  const shown = data.items.filter((i) =>
    (!q || i.text.toLowerCase().includes(q.toLowerCase())) && i.at >= fromTs && i.at < toTs);
  const mb = (data.bytes / 1048576).toFixed(1);

  // Hands-free loop: cycles through the (filtered) clips, playing each one through a
  // configurable sequence of {speed, pause} repeats before moving to the next clip.
  const [order, setOrder] = useState("sequential"); // "sequential" | "random"
  const [steps, setSteps] = useState([{ speed: 1, pause: 3 }, { speed: 0.75, pause: 3 }]);
  const [loopStatus, setLoopStatus] = useState(null); // { hash, text, step, total } while running
  const loopRef = useRef({ on: false, queue: [], clipIdx: 0, stepIdx: 0, timer: null });
  const stepsRef = useRef(steps);
  const orderRef = useRef(order);
  const shownRef = useRef(shown);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { shownRef.current = shown; }, [shown]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/library");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  function stopLoop() {
    loopRef.current.on = false;
    if (loopRef.current.timer) { clearTimeout(loopRef.current.timer); loopRef.current.timer = null; }
    if (audio.current) { audio.current.onended = null; audio.current.pause(); }
    setPlaying("");
    setLoopStatus(null);
    // Same 5-min-then-per-min curve as the Leesoefening timer, but awarded as one lump sum on
    // stop rather than ticking every second — the loop's own start/stop lifecycle already is
    // the activity signal, no separate timer button needed here.
    if (loopRef.current.startedAt) {
      const elapsedSec = Math.floor((Date.now() - loopRef.current.startedAt) / 1000);
      awardXp("listening", timeXpDelta(0, elapsedSec));
      loopRef.current.startedAt = null;
    }
  }
  useEffect(() => () => stopLoop(), []); // stop audio/timers if we navigate away mid-loop

  function play(item) {
    stopLoop();
    if (audio.current) audio.current.pause();
    const a = new Audio(item.url);
    a.preservesPitch = true;
    a.playbackRate = rate;
    a.onended = () => setPlaying("");
    audio.current = a;
    setPlaying(item.hash);
    a.play().catch((e) => { setErr(String(e.message || e)); setPlaying(""); });
  }

  async function remove(hash) {
    await fetch("/api/library/" + hash, { method: "DELETE" });
    refresh();
  }

  // Bakes the current (filtered) clip set into one mp3, replaying the exact same per-repeat
  // speed/pause steps the hands-free loop above uses — just rendered once into a file instead
  // of live playback, so it can be saved to a phone and played with no app or network needed.
  async function exportForPhone() {
    if (!shown.length || exporting) return;
    setExporting(true); setExportErr(""); setExportUrl("");
    try {
      const ordered = order === "random" ? shuffle(shown) : shown;
      const r = await fetch("/api/library/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: ordered.map((i) => i.hash), steps })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
      setExportUrl(d.url);
    } catch (e) { setExportErr(String(e.message || e)); }
    setExporting(false);
  }

  function addStep() {
    setSteps((s) => [...s, { ...s[s.length - 1] }]);
  }
  function removeStep(i) {
    setSteps((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s));
  }
  function updateStep(i, patch) {
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }

  function playLoopStep() {
    const L = loopRef.current;
    if (!L.on) return;
    if (L.clipIdx >= L.queue.length) {
      L.queue = orderRef.current === "random" ? shuffle(shownRef.current) : shownRef.current.slice();
      L.clipIdx = 0;
    }
    if (!L.queue.length) { stopLoop(); return; }

    const item = L.queue[L.clipIdx];
    const seq = stepsRef.current.length ? stepsRef.current : [{ speed: 1, pause: 0 }];
    const step = seq[L.stepIdx] || seq[0];
    setLoopStatus({ hash: item.hash, text: item.text, step: L.stepIdx + 1, total: seq.length });
    setPlaying(item.hash);

    if (audio.current) audio.current.pause();
    const a = new Audio(item.url);
    a.preservesPitch = true;
    a.playbackRate = step.speed;
    audio.current = a;
    a.onended = () => {
      if (!loopRef.current.on) return;
      loopRef.current.timer = setTimeout(() => {
        if (!loopRef.current.on) return;
        if (L.stepIdx + 1 < seq.length) { L.stepIdx += 1; }
        else { L.stepIdx = 0; L.clipIdx += 1; }
        playLoopStep();
      }, Math.max(0, step.pause) * 1000);
    };
    a.play().catch((e) => { setErr(String(e.message || e)); stopLoop(); });
  }

  function startLoop() {
    if (!shown.length) return;
    loopRef.current = {
      on: true,
      queue: order === "random" ? shuffle(shown) : shown.slice(),
      clipIdx: 0, stepIdx: 0, timer: null, startedAt: Date.now()
    };
    playLoopStep();
  }

  return (
    <div className="panel"><div className="pin">
      <div className="tiles">
        <div className="tile"><span className="lbl">{T("Clips", "Clips")}</span><b>{data.items.length}</b></div>
        <div className="tile"><span className="lbl">{T("Op schijf", "On disk")}</span><b>{mb}<i>MB</i></b></div>
        <div className="tile"><span className="lbl">{T("Tekens deze maand", "Characters this month")}</span>
          <b style={{ fontSize: 20 }}>{data.monthChars.toLocaleString("nl-NL")}</b></div>
        <div className="tile"><span className="lbl">{T("Gratis limiet", "Free allowance")}</span>
          <b style={{ fontSize: 20 }}>1.000.000</b></div>
      </div>

      {err && <div className="note err">{err}</div>}

      <div className="btns" style={{ marginBottom: 8, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "0 1 280px" }}>
          <Search strokeWidth={2.2} style={{ position: "absolute", left: 11, top: 10, width: 15,
            height: 15, color: "var(--faint)" }} />
          <input className="inp" style={{ paddingLeft: 33 }} value={q}
            placeholder={Ts("Zoek in zinnen…", "Search sentences…")} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn g" onClick={refresh}><RotateCcw strokeWidth={2.2} />{Ts("Vernieuwen", "Refresh")}</button>
      </div>

      <div className="btns" style={{ marginBottom: 16, alignItems: "center" }}>
        <span className="lbl" style={{ flexShrink: 0 }}>{Ts("Datum", "Date")}</span>
        <input className="inp" type="date" style={{ flex: "0 1 150px" }} value={dateFrom}
          max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="lbl">{Ts("t/m", "to")}</span>
        <input className="inp" type="date" style={{ flex: "0 1 150px" }} value={dateTo}
          min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
        {(dateFrom || dateTo) && (
          <button className="aud" onClick={() => { setDateFrom(""); setDateTo(""); }}
            title={Ts("Datumfilter wissen", "Clear date filter")}>
            <X strokeWidth={2.2} /></button>
        )}
      </div>

      <div className="card pad" style={{ marginBottom: 16 }}>
        <span className="lbl">{T("Afspeelsnelheid", "Playback speed")} — {rate.toFixed(2)}×</span>
        <input className="rng" style={{ marginTop: 8 }} type="range" min="0.4" max="1.2" step="0.05"
          value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} />
      </div>

      <div className="card pad" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <span className="lbl">{T("Hands-free loop", "Hands-free loop")}</span>
          <div className="seg">
            <button className={order === "sequential" ? "on" : ""} onClick={() => setOrder("sequential")}>
              {Ts("Op volgorde", "In order")}</button>
            <button className={order === "random" ? "on" : ""} onClick={() => setOrder("random")}>
              {Ts("Willekeurig", "Random")}</button>
          </div>
        </div>

        <p className="lbl" style={{ marginTop: 10, marginBottom: 8, fontWeight: 400, color: "var(--faint)" }}>
          {T("Elke zin wordt zo vaak herhaald als er stappen zijn — elk met zijn eigen snelheid en pauze, dan de volgende zin.",
            "Each sentence repeats once per step below — each with its own speed and pause, then the next sentence.")}
        </p>

        {steps.map((st, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span className="lbl" style={{ width: 56, flexShrink: 0 }}>{Ts(`Stap ${i + 1}`, `Step ${i + 1}`)}</span>
            <span style={{ fontSize: 12, color: "var(--faint)", width: 40, flexShrink: 0 }}>{st.speed.toFixed(2)}×</span>
            <input className="rng" style={{ flex: "1 1 100px" }} type="range" min="0.4" max="1.2" step="0.05"
              value={st.speed} onChange={(e) => updateStep(i, { speed: parseFloat(e.target.value) })} />
            <span style={{ fontSize: 12, color: "var(--faint)", width: 56, flexShrink: 0 }}>
              {st.pause}s {Ts("pauze", "pause")}</span>
            <input className="rng" style={{ flex: "1 1 100px" }} type="range" min="0" max="15" step="0.5"
              value={st.pause} onChange={(e) => updateStep(i, { pause: parseFloat(e.target.value) })} />
            {steps.length > 1 && (
              <button className="aud" style={{ flexShrink: 0, color: "var(--rose)" }} onClick={() => removeStep(i)}>
                <Trash2 strokeWidth={2.2} /></button>
            )}
          </div>
        ))}
        <div className="btns" style={{ marginTop: 4, marginBottom: loopStatus ? 14 : 4 }}>
          <button className="btn g" onClick={addStep}>
            <Plus strokeWidth={2.2} />{Ts("Herhaling toevoegen", "Add repeat")}</button>
        </div>

        {loopStatus && (
          <div className="note ok" style={{ marginBottom: 10 }}>
            {Ts("Speelt", "Playing")}: "{loopStatus.text}" — {Ts("stap", "step")} {loopStatus.step}/{loopStatus.total}
          </div>
        )}

        <button className={"btn" + (loopStatus ? " d" : "")} disabled={!shown.length}
          onClick={() => (loopStatus ? stopLoop() : startLoop())}>
          {loopStatus ? <Pause strokeWidth={2.2} /> : <Play strokeWidth={2.2} />}
          {loopStatus ? Ts("Loop stoppen", "Stop loop") : Ts("Loop starten", "Start loop")}
        </button>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <button className="btn g" disabled={!shown.length || exporting} onClick={exportForPhone}>
            <Download strokeWidth={2.2} />
            {exporting
              ? Ts("Bezig met samenvoegen…", "Merging…")
              : Ts(`Downloaden voor telefoon (${shown.length})`, `Download for phone (${shown.length})`)}
          </button>
          <p className="lbl" style={{ marginTop: 8, marginBottom: 0, fontWeight: 400, color: "var(--faint)" }}>
            {T("Zet de gefilterde zinnen (met de instellingen hierboven) om in één mp3-bestand — werkt overal, ook in de Muziek- of Bestanden-app op de iPhone.",
              "Bakes the filtered sentences (using the settings above) into one mp3 file — plays everywhere, including the iPhone's Music or Files app.")}
          </p>
          {exportErr && <div className="note err" style={{ marginTop: 10 }}>{exportErr}</div>}
          {exportUrl && (
            <div className="note ok" style={{ marginTop: 10, display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span>{Ts("Klaar!", "Ready!")}</span>
              <a className="btn" href={exportUrl} download="oefening.mp3">
                <Download strokeWidth={2.2} />{Ts("Downloaden", "Download")}</a>
            </div>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <div className="ico"><Headphones strokeWidth={2} /></div>
          <h3>{data.items.length ? "Niets gevonden" : "Nog geen audio"}</h3>
          <p>{data.items.length
            ? "Geen zin komt overeen met je zoekopdracht."
            : "Zodra je een antwoord laat voorlezen, verschijnt het hier en blijft het bewaard."}</p>
        </div>
      ) : shown.map((i) => (
        <div className="card" key={i.hash} style={{ marginBottom: 8, padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <button className="aud" style={{ flexShrink: 0 }} onClick={() => play(i)}>
              {playing === i.hash ? <Pause strokeWidth={2.4} /> : <Play strokeWidth={2.4} />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--serif)", fontSize: 16.5, lineHeight: 1.5 }}>{i.text}</div>
              <div className="lbl" style={{ marginTop: 5, fontSize: 10 }}>
                {i.voice} · {new Date(i.at).toLocaleDateString("nl-NL")} · {Math.round((i.bytes || 0) / 1024)} kB
              </div>
            </div>
            <a className="aud" href={i.url} download style={{ flexShrink: 0, textDecoration: "none" }}>
              <Download strokeWidth={2.2} /></a>
            <button className="aud" style={{ flexShrink: 0, color: "var(--rose)" }}
              onClick={() => remove(i.hash)}><Trash2 strokeWidth={2.2} /></button>
          </div>
          <div style={{ marginTop: 10 }}>
            <ExplainButton text={i.text} explanations={explanations} getExplanation={getExplanation} Ts={Ts} />
          </div>
        </div>
      ))}
    </div></div>
  );
}

/* ================= progress ================= */

function ProgressView({ daily, corrections, ledger, vocab, settings, T, Ts }) {
  const [range, setRange] = useState(30);

  const days = useMemo(() => {
    const out = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      const r = daily[k] || emptyDay();
      out.push({
        label: d.toLocaleDateString("nl-NL", { day: "numeric", month: "numeric" }),
        turns: r.turns, words: r.words, corr: r.corr,
        rate: r.words > 20 ? +((r.corr / r.words) * 100).toFixed(1) : null,
        xp: r.xp || emptyDay().xp
      });
    }
    return out;
  }, [daily, range]);

  // Caps every chart's x-axis at ~7 visible labels regardless of range — "preserveStartEnd"
  // alone tries to cram in far more than that and the dates overlap into an unreadable mess
  // once there are 30-90 of them.
  const tickInterval = Math.max(0, Math.ceil(days.length / 7) - 1);

  const totals = useMemo(() => {
    const v = Object.values(daily);
    return {
      turns: v.reduce((n, r) => n + (r.turns || 0), 0),
      words: v.reduce((n, r) => n + (r.words || 0), 0),
      days: v.filter((r) => r.turns > 0).length
    };
  }, [daily]);

  // All-time XP/level — the hero tile and CEFR roadmap always reflect the full history,
  // independent of the 7/30/90-day range toggle below (that toggle only scopes the charts).
  const baselineWords = settings.xpVocabBaselineWords;
  const xpAll = useMemo(() => totalXp(daily, vocab.words.length, baselineWords), [daily, vocab.words.length, baselineWords]);
  const level = levelOf(xpAll);
  const levelFloor = xpForLevel(level), levelCeil = xpForLevel(level + 1);
  const levelPct = Math.min(100, Math.round(((xpAll - levelFloor) / (levelCeil - levelFloor)) * 100));

  // Per-skill totals, all-time (skill tiles) and within the selected range (radar "build").
  const skillTotalsAll = useMemo(() => {
    const out = { reading: 0, speaking: 0, listening: 0, writing: 0 };
    for (const d of Object.values(daily)) {
      if (!d.xp) continue;
      out.reading += d.xp.reading; out.speaking += d.xp.speaking;
      out.listening += d.xp.listening; out.writing += d.xp.writing;
    }
    return out;
  }, [daily]);
  const radarData = useMemo(() => SKILLS.map((s) => ({
    skill: Ts(s.nl, s.en),
    value: days.reduce((n, d) => n + d.xp[s.id], 0)
  })), [days, settings.bilingualUI]);
  const hasPractice = radarData.some((s) => s.value > 0);

  // Stops sit at even spacing (not proportional to their level number, which would crowd the
  // low end and strand C1 way out on its own) — only the "you are here" marker is interpolated
  // between whichever two stops bracket the real level, so its position still means something.
  const cefrYouPct = useMemo(() => {
    const n = CEFR_ROADMAP.length;
    const idx = CEFR_ROADMAP.findIndex((s) => level < s.level);
    if (idx === -1) return 100;
    if (idx === 0) return 0;
    const prev = CEFR_ROADMAP[idx - 1], next = CEFR_ROADMAP[idx];
    const frac = Math.max(0, Math.min(1, (level - prev.level) / (next.level - prev.level)));
    return ((idx - 1 + frac) / (n - 1)) * 100;
  }, [level]);

  const rated = days.filter((d) => d.rate !== null);
  const half = Math.ceil(rated.length / 2);
  const avg = (a) => a.length ? a.reduce((n, d) => n + d.rate, 0) / a.length : null;
  const trend = (rated.length > 3) ? avg(rated.slice(half)) - avg(rated.slice(0, half)) : null;

  const axis = { fontSize: 11, fontFamily: "Plus Jakarta Sans, sans-serif", fill: "#7C8598" };
  const tip = { fontSize: 12, fontFamily: "Plus Jakarta Sans, sans-serif", border: "1px solid #E6E9EF",
    borderRadius: 10, boxShadow: "0 6px 16px rgba(17,24,39,.08)" };

  return (
    <div className="panel"><div className="pin">
      <div className="card pad hero-xp">
        <div className="hero-xp-top">
          <div className="levelup-badge sm"><Trophy strokeWidth={2} /></div>
          <div>
            <span className="lbl">{Ts("Niveau", "Level")}</span>
            <div className="hero-xp-level">{level}</div>
          </div>
          <div className="hero-xp-total">
            <span className="lbl">{Ts("Totale XP", "Total XP")}</span>
            <b>{xpAll.toLocaleString("nl-NL")}</b>
          </div>
        </div>
        <div className="track"><i style={{ width: levelPct + "%" }} /></div>
        <span className="sub" style={{ fontSize: 11.5, marginTop: 6, display: "block" }}>
          {Ts(`${(levelCeil - xpAll).toLocaleString("nl-NL")} XP tot niveau ${level + 1}`,
            `${(levelCeil - xpAll).toLocaleString("nl-NL")} XP to level ${level + 1}`)}
        </span>
      </div>

      <div className="card pad" style={{ marginTop: 14 }}>
        <span className="lbl">{Ts("CEFR-route", "CEFR roadmap")}</span>
        <div className="cefr-track">
          <div className="cefr-you" style={{ left: cefrYouPct + "%" }}>
            <b>{Ts("Jij", "You")} · {level}</b>
            <i />
          </div>
          <div className="cefr-line"><i style={{ width: cefrYouPct + "%" }} /></div>
          {CEFR_ROADMAP.map((s, i) => (
            <div key={s.stage} className={"cefr-stop" + (level >= s.level ? " done" : "")}
              style={{ left: (i / (CEFR_ROADMAP.length - 1)) * 100 + "%" }}>
              <i />
              <span>{s.stage}<b>{s.level}</b></span>
            </div>
          ))}
        </div>
      </div>

      <div className="tiles" style={{ marginTop: 14 }}>
        {SKILLS.map((s) => (
          <div key={s.id} className="tile skill-tile">
            <span className="lbl" style={{ color: s.color }}><s.icon strokeWidth={2.2} />{T(s.nl, s.en)}</span>
            <b>{skillTotalsAll[s.id].toLocaleString("nl-NL")}<i>xp</i></b>
          </div>
        ))}
      </div>

      <div className="seg" style={{ marginTop: 14, marginBottom: 14 }}>
        {[7, 30, 90].map((r) => (
          <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}d</button>
        ))}
      </div>

      <div className="chart">
        <div className="chart-h"><span className="lbl">{Ts("Jouw opbouw", "Your build")}</span></div>
        <div style={{ position: "relative" }}>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData} outerRadius="70%">
              <PolarGrid stroke="#E6E9EF" />
              <PolarAngleAxis dataKey="skill" tick={axis} />
              <PolarRadiusAxis tick={false} axisLine={false} tickCount={4} />
              <Radar dataKey="value" stroke="#2A55C8" fill="#2A55C8" fillOpacity={0.28} strokeWidth={2} />
              <Tooltip contentStyle={tip} formatter={(v) => [`${v} XP`, ""]} />
            </RadarChart>
          </ResponsiveContainer>
          {!hasPractice && (
            <p className="sub radar-empty">
              {Ts("Nog geen oefeningen in deze periode.", "No practice yet in this period.")}
            </p>
          )}
        </div>
      </div>

      <div className="chart">
        <div className="chart-h"><span className="lbl">{Ts("XP per dag", "XP per day")}</span></div>
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={days} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#EFF1F5" vertical={false} />
            <XAxis dataKey="label" tick={axis} interval={tickInterval} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tip} cursor={{ fill: "#F5F6F9" }}
              formatter={(v, name) => [`${v} XP`, name]} />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: "Plus Jakarta Sans, sans-serif" }} />
            {SKILLS.map((s, i) => (
              <Bar key={s.id} dataKey={`xp.${s.id}`} name={Ts(s.nl, s.en)} stackId="xp" fill={s.color}
                radius={i === SKILLS.length - 1 ? [5, 5, 0, 0] : 0} maxBarSize={26} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="tiles">
        <div className="tile"><span className="lbl">{T("Reeks", "Streak")}</span>
          <b>{streakOf(daily)}<i>d</i></b></div>
        <div className="tile"><span className="lbl">{T("Actieve dagen", "Active days")}</span><b>{totals.days}</b></div>
        <div className="tile"><span className="lbl">{T("Beurten", "Turns")}</span><b>{totals.turns}</b></div>
        <div className="tile"><span className="lbl">{T("Woorden getypt", "Words typed")}</span><b>{totals.words}</b></div>
        <div className="tile"><span className="lbl">{T("Correcties", "Corrections")}</span><b>{corrections.length}</b></div>
        <div className="tile"><span className="lbl">{T("Bekende woorden", "Known words")}</span><b>{vocab.words.length}</b></div>
        <div className="tile"><span className="lbl">{T("Nieuw ontmoet", "New met")}</span><b>{ledger.length}</b></div>
      </div>

      <div className="chart">
        <div className="chart-h">
          <span className="lbl">{T("Fouten per 100 woorden", "Errors per 100 words")}</span>
          {trend !== null && (
            <span className={"delta " + (trend < 0 ? "up" : "dn")}>
              {trend < 0 ? "↓" : "↑"} {Math.abs(trend).toFixed(1)} {Ts("t.o.v. eerste helft", "vs first half")}
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={days} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#EFF1F5" vertical={false} />
            <XAxis dataKey="label" tick={axis} interval={tickInterval} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tip} />
            <Line type="monotone" dataKey="rate" name="fouten/100w" stroke="#CE3F3F" strokeWidth={2.5}
              dot={{ r: 2.5, strokeWidth: 0, fill: "#CE3F3F" }} activeDot={{ r: 5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

    </div></div>
  );
}

/* ================= settings ================= */

const VOICE_TEST_PHRASE = "Waarom gooit Jantje een emmer water over zijn computer? Hij wil over het internet surfen!";

function SettingsView({ settings, setSettings, voices, speak, getClip, vocab, corrections, ledger, daily,
  setVocab, setCorrections, setLedger, setDaily, setMessages, T, Ts, ttsWarn, setTtsWarn }) {
  const [note, setNote] = useState("");
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseText, setEraseText] = useState("");
  const ERASE_PHRASE = "I confirm I want to erase all data.";
  const [gVoices, setGVoices] = useState([]);
  const [loadingV, setLoadingV] = useState(false);
  const [models, setModels] = useState([]);
  const [current, setCurrent] = useState("");
  const [loadingM, setLoadingM] = useState(false);
  const [provider, setProvider] = useState("");
  const [previewClips, setPreviewClips] = useState({});
  const [previewPlaying, setPreviewPlaying] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewProgress, setPreviewProgress] = useState({ done: 0, total: 0 });
  const previewAudioRef = useRef(null);
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  // Generates the test phrase for every voice up front, once, so comparing voices
  // afterwards is just instant local playback — no repeat synthesis per click.
  async function previewAllVoices() {
    const list = gVoices.length ? gVoices.map((v) => v.name) : G_VOICES;
    setPreviewBusy(true);
    setPreviewProgress({ done: 0, total: list.length });
    for (const v of list) {
      if (!previewClips[v]) {
        try {
          const url = await getClip(VOICE_TEST_PHRASE, { voice: v, library: false });
          setPreviewClips((c) => ({ ...c, [v]: url }));
        } catch (e) { setNote(`Stem ${v} mislukt: ${e.message || e}`); }
      }
      setPreviewProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setPreviewBusy(false);
  }

  // A single voice preview also caches on first click, so this works standalone too.
  async function playPreview(v) {
    try {
      let url = previewClips[v];
      if (!url) {
        url = await getClip(VOICE_TEST_PHRASE, { voice: v, library: false });
        setPreviewClips((c) => ({ ...c, [v]: url }));
      }
      if (previewAudioRef.current) previewAudioRef.current.pause();
      const a = new Audio(url);
      a.preservesPitch = true;
      a.playbackRate = settings.rate;
      a.onended = () => setPreviewPlaying("");
      previewAudioRef.current = a;
      setPreviewPlaying(v);
      await a.play();
    } catch (e) { setTtsWarn("Audio: " + (e.message || e)); setPreviewPlaying(""); }
  }

  function backup() {
    const blob = new Blob([JSON.stringify({ v: 1, vocab, corrections, ledger, daily, settings }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nederlands-backup-${today()}.json`; a.click();
  }

  function restore(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const d = JSON.parse(String(r.result));
        if (d.vocab) { setVocab(d.vocab); await save(K.vocab, d.vocab); }
        setCorrections(d.corrections || []); setLedger(d.ledger || []); setDaily(d.daily || {});
        await save(K.prog, { corrections: d.corrections || [], ledger: d.ledger || [], daily: d.daily || {} });
        if (d.settings) setSettings((s) => ({ ...s, ...d.settings }));
        setNote("Back-up teruggezet. (Backup restored.)");
      } catch { setNote("Dat bestand kon ik niet lezen. (Could not read that file.)"); }
    };
    r.readAsText(f);
  }

  return (
    <div className="panel"><div className="pin">
      <p className="sub">Alles blijft in deze artifact bewaard. Maak wekelijks een back-up — dat is je enige
        kopie. <span style={{ color: "var(--faint)" }}>Everything is stored inside this artifact. Back up
        weekly; it's your only copy.</span></p>

      <div className="card pad" style={{ marginBottom: 14 }}>
        <span className="lbl">{T("Uitspraak", "Pronunciation")}</span>
        <div className="seg" style={{ margin: "10px 0 16px" }}>
          <button className={settings.tts === "google" ? "on" : ""} onClick={() => set("tts", "google")}>
            Google Cloud · {Ts("opgeslagen", "saved to disk")}</button>
          <button className={settings.tts === "browser" ? "on" : ""} onClick={() => set("tts", "browser")}>
            {Ts("Browserstem", "Browser voice")} · {Ts("noodoplossing", "fallback")}</button>
        </div>

        {settings.tts === "google" ? (
          <>
            <label className="field">
              <span className="lbl">{T("Nederlandse stem", "Dutch voice")}</span>
              <select className="inp" value={settings.gVoice} onChange={(e) => set("gVoice", e.target.value)}>
                {(gVoices.length ? gVoices.map((v) => v.name) : G_VOICES).map((v) =>
                  <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <div className="btns" style={{ marginBottom: 14 }}>
              <button className="btn g" disabled={loadingV} onClick={async () => {
                setLoadingV(true);
                try {
                  const r = await fetch("/api/voices");
                  const d = await r.json();
                  if (!r.ok) throw new Error(d.error);
                  setGVoices(d.voices || []);
                  setNote(`${(d.voices || []).length} stemmen opgehaald. Chirp 3 HD staat bovenaan.`);
                } catch (e) { setNote("Stemmen ophalen mislukt: " + (e.message || e)); }
                setLoadingV(false);
              }}>{loadingV ? "…" : Ts("Stemmen ophalen", "Fetch voices")}</button>
              <button className="btn g" onClick={() => playPreview(settings.gVoice)}>
                <Volume2 strokeWidth={2.2} />{Ts("Stem testen", "Test voice")}</button>
              <button className="btn g" disabled={previewBusy} onClick={previewAllVoices}>
                <Sparkles strokeWidth={2.2} />
                {previewBusy
                  ? `${previewProgress.done}/${previewProgress.total}…`
                  : Ts("Alle stemmen genereren", "Generate all voices")}
              </button>
            </div>
            <div className="note ok" style={{ fontSize: 12.5, marginBottom: 14 }}>
              Je sleutel staat in <code>.env</code> op deze computer en verlaat de server nooit.
              Elke zin wordt één keer omgezet en daarna als mp3 bewaard op schijf — opnieuw luisteren
              kost niets. Stemtests komen niet in je Bibliotheek terecht.
              <span style={{ color: "var(--faint)" }}> Voice tests are cached to disk but never
              listed on the Library page.</span>
            </div>
            <div className="chips" style={{ marginBottom: 14 }}>
              {(gVoices.length ? gVoices.map((v) => v.name) : G_VOICES).map((v) => (
                <button key={v} className={"chip" + (settings.gVoice === v ? " on" : "")}
                  onClick={() => playPreview(v)} title={Ts("Beluisteren", "Listen")}>
                  {previewPlaying === v ? <Pause strokeWidth={2.4} /> : <Play strokeWidth={2.4} />} {v}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span className="lbl">{T("Nederlandse stem", "Dutch voice")}</span>
              <select className="inp" value={settings.voiceURI} onChange={(e) => set("voiceURI", e.target.value)}>
                <option value="">{voices.length
                  ? Ts("Beste beschikbare", "Best available") + " — " + voices[0].name
                  : Ts("Geen stem gevonden", "No voice found")}</option>
                {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} — {v.lang}{/natural|neural|online|enhanced|premium/i.test(v.name) ? "  \u2605" : ""}
                </option>)}
              </select>
            </label>
            {voices.length === 0 && <div className="note err">Geen Nederlandse stem op dit apparaat.
              Gebruik Google Cloud hierboven. <br />No Dutch voice installed — use Google Cloud instead.</div>}
            <button className="btn g" onClick={() => { setTtsWarn(""); speak(VOICE_TEST_PHRASE); }}>
              <Volume2 strokeWidth={2.2} />{Ts("Stem testen", "Test voice")}</button>
          </>
        )}

        <label className="field" style={{ marginTop: 16 }}>
          <span className="lbl">{T("Snelheid", "Speed")} — {settings.rate.toFixed(2)}×</span>
          <input className="rng" type="range" min="0.5" max="1.2" step="0.05" value={settings.rate}
            onChange={(e) => set("rate", parseFloat(e.target.value))} />
        </label>
        <label className="tog">
          <input type="checkbox" checked={settings.autoplay} onChange={(e) => set("autoplay", e.target.checked)} />
          {T("Antwoord automatisch afspelen", "Auto-play each reply")}
        </label>
        {ttsWarn && ttsWarn !== "novoice" && <div className="note err" style={{ marginTop: 12 }}>{ttsWarn}</div>}
      </div>

      <div className="card pad" style={{ marginBottom: 14 }}>
        <span className="lbl">{T("Model", "Model")}</span>
        {provider && <div className="lbl" style={{ marginTop: 8, fontSize: 11,
          color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>{provider}</div>}
        <label className="field" style={{ marginTop: 10 }}>
          <input className="inp" list="modellijst" value={settings.model}
            placeholder={current || "gemini-2.5-flash"}
            onChange={(e) => set("model", e.target.value.trim())} />
          <datalist id="modellijst">
            {(models.length ? models : []).map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
        <div className="btns">
          <button className="btn g" disabled={loadingM} onClick={async () => {
            setLoadingM(true);
            try {
              const r = await fetch("/api/models?model=" + encodeURIComponent(settings.model || ""));
              const d = await r.json();
              if (!r.ok) throw new Error(d.error);
              setModels(d.models || []); setCurrent(d.current || ""); setProvider(d.provider || "");
              const which = settings.model ? `"${d.tested}" (uit dit veld)` : `"${d.tested}" (uit .env)`;
              setNote(d.listable
                ? (d.exists === false
                    ? `Sleutel werkt, maar ${which} staat niet in de lijst van dit account. Kies een naam uit de suggesties.`
                    : `Sleutel en model ${which} werken. ${(d.models || []).length} modellen beschikbaar.`)
                : `Sleutel en model ${which} werken via ${d.provider}. Express mode kan geen modellijst geven, dus de suggesties zijn handmatig — elke naam is toegestaan.`);
            } catch (e) { setNote("Mislukt: " + (e.message || e)); }
            setLoadingM(false);
          }}>{loadingM ? "…" : Ts("Sleutel testen", "Test key")}</button>
        </div>
        <div className="note ok" style={{ marginTop: 12, fontSize: 12.5 }}>
          Leeg laten gebruikt <code>MODEL_NAME</code> uit <code>.env</code>. Een Flash-model is
          ruim genoeg voor correcties. Bij foutmelding 429 is de limiet bereikt — kies dan
          <code>gemini-2.5-flash-lite</code>. Wisselen tussen Vertex en AI Studio doe je met
          <code>MODEL_PROVIDER</code> in <code>.env</code>.
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 14 }}>
        <span className="lbl">{T("Gesprek", "Conversation")}</span>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="lbl">{T("Niveau van de assistent", "Assistant level")}</span>
          <select className="inp" value={settings.level} onChange={(e) => set("level", e.target.value)}>
            {["A1", "A2", "A2+", "B1", "B1+", "B2", "C1"].map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="lbl">{T("Onderwerp of situatie", "Topic or scenario")}</span>
          <input className="inp" value={settings.topic} onChange={(e) => set("topic", e.target.value)}
            placeholder="bijv. bij de huisarts, sollicitatiegesprek, koffie met een collega" />
        </label>
        <label className="field">
          <span className="lbl">{T("Extra instructies voor de docent", "Extra instructions for the tutor")}</span>
          <textarea className="inp" rows={5} value={settings.customInstructions}
            onChange={(e) => set("customInstructions", e.target.value)}
            placeholder="bijv. een persona, een vaste toon, iets dat de docent altijd moet doen of vermijden…" />
        </label>
        <p className="lbl" style={{ marginTop: -4, marginBottom: 14, fontWeight: 400, color: "var(--faint)" }}>
          {T("Dit wordt bij elk gesprek meegestuurd — pas het gerust aan of maak het leeg.",
            "This gets sent along with every chat turn — feel free to edit or clear it.")}
        </p>
        <label className="field">
          <span className="lbl">{T("Maximaal nieuwe woorden per antwoord", "New words per reply, max")}
            {" — "}{settings.newMax ?? (LADDER[settings.level] || LADDER["A2"]).newMax}</span>
          <input className="rng" type="range" min="0" max="4" step="1"
            value={settings.newMax ?? (LADDER[settings.level] || LADDER["A2"]).newMax}
            onChange={(e) => set("newMax", parseInt(e.target.value, 10))} />
        </label>
        <div className="note ok" style={{ marginBottom: 16, fontSize: 12.5 }}>
          Niveau <b>{settings.level}</b> betekent nu: {(LADDER[settings.level] || LADDER["A2"]).sentences} zinnen
          van {(LADDER[settings.level] || LADDER["A2"]).words} woorden, {(LADDER[settings.level] || LADDER["A2"]).clauses},
          {" "}{(LADDER[settings.level] || LADDER["A2"]).tense}. Onder elk antwoord staat het gemeten
          percentage onbekende woorden; blijft dat boven 10%, zet het niveau lager.
        </div>
        <label className="field">
          <span className="lbl">{T("Doelwoorden per antwoord", "Target words per reply")} — {settings.targets}</span>
          <input className="rng" type="range" min="0" max="5" step="1" value={settings.targets}
            onChange={(e) => set("targets", parseInt(e.target.value, 10))} />
        </label>
        <label className="tog">
          <input type="checkbox" checked={settings.bilingualUI}
            onChange={(e) => set("bilingualUI", e.target.checked)} />
          {T("Engelse labels in de interface", "English labels in the interface")}
        </label>
      </div>

      <div className="card pad" style={{ marginBottom: 14 }}>
        <span className="lbl">{T("Revisie-interval", "Revision interval")}</span>
        <p className="lbl" style={{ marginTop: 8, marginBottom: 10, fontWeight: 400, color: "var(--faint)" }}>
          {T("Hoe lang wachten tot de 1e, 2e, 3e… herhaling na een goed antwoord. Fout? Dan terug naar stap 1. Zodra alle stappen goed gaan, achter elkaar, is die zin ‘onder de knie’ en verschijnt hij niet meer bij revisie. Stap 1 op 0 dagen zetten betekent: ook dezelfde dag al opnieuw oefenen.",
            "How long to wait before the 1st, 2nd, 3rd… review after a correct answer. Wrong? Back to step 1. Once every step goes right, in a row, that sentence is ‘mastered’ and stops appearing in revision. Setting step 1 to 0 days means: eligible again the same day.")}
        </p>
        {(settings.revisionIntervals || DEFAULT_INTERVALS).map((days, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span className="lbl" style={{ width: 60, flexShrink: 0 }}>{Ts(`Stap ${i + 1}`, `Step ${i + 1}`)}</span>
            <input className="inp" type="number" min="0" max="365" style={{ width: 80, flex: "none" }}
              value={days}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10);
                const v = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
                const iv = settings.revisionIntervals || DEFAULT_INTERVALS;
                set("revisionIntervals", iv.map((d, idx) => (idx === i ? v : d)));
              }} />
            <span className="lbl">{Ts("dagen", "days")}</span>
            {(settings.revisionIntervals || DEFAULT_INTERVALS).length > 1 && (
              <button className="aud" style={{ color: "var(--rose)" }}
                onClick={() => {
                  const iv = settings.revisionIntervals || DEFAULT_INTERVALS;
                  set("revisionIntervals", iv.filter((_, idx) => idx !== i));
                }}><Trash2 strokeWidth={2.2} /></button>
            )}
          </div>
        ))}
        <button className="btn g" onClick={() => {
          const iv = settings.revisionIntervals || DEFAULT_INTERVALS;
          set("revisionIntervals", [...iv, iv[iv.length - 1] * 2]);
        }}><Plus strokeWidth={2.2} />{Ts("Stap toevoegen", "Add step")}</button>
      </div>

      <div className="card pad" style={{ marginBottom: 14 }}>
        <span className="lbl">{T("Leerinterval (nieuwe woorden)", "Learning interval (new words)")}</span>
        <p className="lbl" style={{ marginTop: 8, marginBottom: 10, fontWeight: 400, color: "var(--faint)" }}>
          {T("Elk nieuw woord doorloopt 3 sterren (woord naschrijven → AI-zin naschrijven → eigen zin schrijven) voor het je woordenlijst bereikt. Elk getal hieronder is hoeveel dagen wachten voordat de VOLGENDE ster beschikbaar komt, na het halen van de vorige. Een fout antwoord (op elke ster) betekent altijd: morgen opnieuw proberen — dat is vast, niet instelbaar.",
            "Every new word goes through 3 stars (write the word back → write an AI sentence back → write your own sentence) before it reaches your vocabulary list. Each number below is how many days to wait before the NEXT star unlocks, after passing the previous one. A wrong answer (on any star) always means: try again tomorrow — that part is fixed, not configurable.")}
        </p>
        {[
          ["Ster 1 beschikbaar na woord toevoegen", "Star 1 available after word is added"],
          ["Ster 2 beschikbaar na Ster 1", "Star 2 available after Star 1"],
          ["Ster 3 beschikbaar na Ster 2", "Star 3 available after Star 2"]
        ].map(([nl, en], i) => {
          const iv = wordIntervalsOf(settings);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <span className="lbl" style={{ flex: "1 1 220px" }}>{Ts(nl, en)}</span>
              <input className="inp" type="number" min="0" max="365" style={{ width: 80, flex: "none" }}
                value={iv[i]}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  const v = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
                  set("wordIntervals", iv.map((d, idx) => (idx === i ? v : d)));
                }} />
              <span className="lbl">{Ts("dagen", "days")}</span>
            </div>
          );
        })}
      </div>

      <div className="card pad">
        <span className="lbl">{T("Gegevens", "Data")}</span>
        {note && <div className="note ok" style={{ marginTop: 12, marginBottom: 0 }}>{note}</div>}
        <div className="btns" style={{ marginTop: 14 }}>
          <button className="btn" onClick={backup}><Download strokeWidth={2.2} />
            {Ts("Back-up downloaden", "Download backup")}</button>
          <label className="btn g" style={{ cursor: "pointer" }}>
            <Upload strokeWidth={2.2} />{Ts("Terugzetten", "Restore")}
            <input type="file" accept="application/json" style={{ display: "none" }} onChange={restore} />
          </label>
          <button className="btn g" onClick={async () => { setMessages([]); await save(K.chat, []); }}>
            <X strokeWidth={2.2} />{Ts("Gesprek wissen", "Clear chat")}</button>
          <button className="btn d" onClick={() => { setEraseText(""); setEraseOpen(true); }}>
            <Trash2 strokeWidth={2.2} />{Ts("Alles wissen", "Erase all")}</button>
        </div>
      </div>

      {eraseOpen && (
        <div className="modal-backdrop" onClick={() => setEraseOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{Ts("Alles wissen?", "Erase everything?")}</h3>
            <p>{T("Je woordenlijst, foutenlogboek, nieuwe woorden, voortgang en gesprek gaan allemaal permanent verloren. Dit kan niet ongedaan worden gemaakt — maak eerst een back-up als je twijfelt.",
              "Your word list, mistake log, new words, progress, and chat all get permanently deleted. This cannot be undone — download a backup first if you're unsure.")}</p>
            <p style={{ marginTop: 12 }}>
              {T("Typ de volgende zin exact om te bevestigen:", "Type the following sentence exactly to confirm:")}
            </p>
            <p style={{ margin: "4px 0 10px" }}><code>{ERASE_PHRASE}</code></p>
            <input className="inp" value={eraseText} onChange={(e) => setEraseText(e.target.value)}
              placeholder={ERASE_PHRASE} autoFocus />
            <div className="btns" style={{ marginTop: 16 }}>
              <button className="btn g" onClick={() => setEraseOpen(false)}>{Ts("Annuleren", "Cancel")}</button>
              <button className="btn d" disabled={eraseText !== ERASE_PHRASE} onClick={async () => {
                setVocab({ words: [], raw: "", updated: null }); setCorrections([]); setLedger([]);
                setDaily({}); setMessages([]);
                await save(K.vocab, { words: [], raw: "", updated: null });
                await save(K.prog, { corrections: [], ledger: [], daily: {} });
                await save(K.chat, []);
                setEraseOpen(false); setEraseText("");
                setNote("Alles gewist. (Everything erased.)");
              }}><Trash2 strokeWidth={2.2} />{Ts("Definitief wissen", "Permanently erase")}</button>
            </div>
          </div>
        </div>
      )}
    </div></div>
  );
}

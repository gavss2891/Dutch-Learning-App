# Nederlands — A1 → B1

A Dutch conversation tutor that corrects what you write, explains why, speaks the corrections
aloud in a real Dutch voice, and keeps every audio clip on disk so replaying is always free.

Runs entirely on your own machine. Your keys stay in `.env`, your data stays in `data/`.

---

## Setup (about 15 minutes, once)

### 1. Install Node.js

You need version 20 or newer. Check with:

```bash
node -v
```

If that fails or shows something below v20, get it from https://nodejs.org (take the LTS build).

### 2. Install the app

Open a terminal in this folder and run:

```bash
npm install
```

### 3. Get your two keys

**Google Text-to-Speech** — you already have this one.
In the Cloud Console, open your *API key for text-to-speech* and click **Show key**.

**Vertex AI (express mode)** — the API key bound to your `vertex-express@…` service account
in the Cloud Console. Usage is billed through Cloud Billing, so free trial credits apply.

> Your Text-to-Speech key is restricted to that one API and cannot be used for the model.
> Two separate keys is the right setup — a leaked key can then only do one thing.

If you would rather use a Gemini Developer API key from https://aistudio.google.com/apikey,
set `MODEL_PROVIDER=aistudio` and fill in `GEMINI_API_KEY` instead.

### 4. Create your `.env`

Copy the template and fill in the two keys:

```bash
cp .env.example .env
```

Then open `.env` in any text editor:

```
GOOGLE_TTS_KEY=AIza...your text-to-speech key
GOOGLE_TTS_VOICE=nl-NL-Wavenet-D

MODEL_PROVIDER=vertex
VERTEX_API_KEY=AIza...your express-mode key
MODEL_NAME=gemini-2.5-flash

PORT=8787
```

### 5. Run it

```bash
npm run dev
```

Your browser opens at http://localhost:5173. Every morning after this, `npm run dev` is the
only command you need.

---

## First five minutes

1. **Instellingen → Stemmen ophalen.** Pick a voice, press *Stem testen*. Chirp 3 HD voices sort
   to the top of the list; try one of those first.
2. **Instellingen → Sleutel testen.** Sends a one-token request to confirm the model key works.
   Do this before you rely on it mid-conversation. Express mode has no model-list endpoint, so
   the model box is a free-text field with suggestions — leave it empty to use `MODEL_NAME`.
3. **Woordenlijst.** Paste your Clozemaster sentences. Everything in there counts as known —
   the tutor prefers those words and bolds anything outside the list. Add each new batch daily.
4. **Gesprek.** Press ▶ to start the session clock, then write something in Dutch.

---

## How it works

**Corrections** are split into *fout* (actually wrong) and *beter* (correct but not how a Dutch
person says it), each tagged with a grammar category. The strip shows a word-level diff — the
deletion struck through above, the insertion highlighted below — so you see exactly what changed.

**Audio** is synthesized once per sentence and written to `audio/<hash>.mp3`. The same sentence
is never charged twice, no matter how often you replay it, and slow playback is done in the
player rather than by re-synthesizing. At roughly 30 turns a day you will use about 240,000
characters a month against a free allowance of 1,000,000. The Audiobibliotheek tab shows the
running total.

**Weak spots feed back.** Your three most frequent recent error categories are sent with every
request, and the tutor is told to steer the conversation so those forms come up again.

**Bolding** marks words outside your Clozemaster list. Dutch inflection defeats exact matching,
so there is a stemmer, and it is not perfect — click any bolded word you already know and it is
added to your list permanently.

---

## Your data

Everything is plain, readable files in this folder:

```
data/vocab.json         your known words
data/progress.json      corrections, new-word ledger, daily stats
data/settings.json      voice, model, level, preferences
data/chat.json          current conversation
data/audio-index.json   what each mp3 contains
audio/*.mp3             the audio library
```

**Back it up** by copying `data/` and `audio/` somewhere safe, or by putting the folder in
Dropbox or a git repo. `.gitignore` already excludes `.env`, so your keys will not be committed.

Instellingen also has a JSON export if you want a single-file snapshot.

---

## When something breaks

**"De server reageert niet"** — the Node server is not running. Use `npm run dev`, not just
`vite`.

**429** — rate limit. Wait a minute, or put `gemini-2.5-flash-lite` in the model box, which has
a larger allowance. On Vertex express the limits are per-project rather than the AI Studio
free-tier caps.

**404 on the model name** — Vertex express and AI Studio do not expose an identical model list.
If a name is rejected, try `gemini-2.5-flash`, which is available on both.

**"GOOGLE_TTS_KEY ontbreekt"** — the key is missing from `.env`, or you edited `.env` while the
server was running. Restart it. Note that clips already on disk still play without any key.

**Audio 403** — Cloud Text-to-Speech requires billing to be enabled on the GCP project even
while you stay inside the free tier. Enabling billing does not by itself charge you.

**Port already in use** — change `PORT` in `.env` and the proxy target in `vite.config.js` to
match.

---

## Running it as a normal app

```bash
npm start
```

Builds the frontend and serves everything from http://localhost:8787 on one process. Slightly
faster to load; you lose hot reloading, which you do not need day to day.

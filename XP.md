# XP & levels — current calculation scheme

Reference for the gamification system in the Dutch app. Source of truth is the code — all
constants below live in one place near the top of `src/App.jsx` (search for `const XP =`),
so if you retune anything, this file may drift; check the source if numbers look off.

## The 4 XP categories

XP is split into **writing, speaking, listening, reading** — never mixed together at the
point of earning (only summed for the total/level).

| Action | Category | XP |
|---|---|---|
| Message sent in Gesprek or Revisie, typed only, ≥2 words | writing | **+2** |
| Message sent in Gesprek or Revisie, voice contributed at any point, ≥2 words | speaking | **+3** |
| Chat/Revisie audio — first play of that clip | listening | **+5** |
| Chat/Revisie audio — any replay of that same clip | listening | **+0** (no repeat credit) |
| Leesoefening reading timer — first 5 continuous minutes | reading | **+30** |
| Leesoefening reading timer — each additional full minute | reading | **+5** |
| Hands-free loop (Audiobibliotheek) — first 5 continuous minutes | listening | **+30** |
| Hands-free loop — each additional full minute | listening | **+5** |

A message under 2 words earns nothing (blocks one-word spam). Voice input counts as speaking
even if you hand-edit the text afterward — once voice touches the draft, it's speaking until
you send or clear it.

## Vocabulary — a separate, one-time-plus-ongoing term

Vocabulary is **not** one of the 4 categories — it's a standing "foundation" score added into
your total on top of the 4:

- **Baseline** — however many words you already knew the moment this feature first activated,
  frozen forever at **15 XP/word**. Stored once in `settings.xpVocabBaselineWords`, never
  recalculated even as your list grows.
- **Ongoing** — every word learned *after* that baseline, at **3 XP/word**, live (grows as your
  vocab list grows).

```
vocab XP = (baseline words × 15) + (max(0, current words − baseline words) × 3)
```

## Level formula

```
total XP = vocab XP + (all-time writing + speaking + listening + reading XP)
level    = floor( sqrt( total XP / 3 ) )
```

Level *n* needs `n² × 3` total XP:

| Level | Total XP needed |
|---|---|
| 1 | 3 |
| 10 | 300 |
| 50 | 7,500 |
| 100 (≈ B1) | 30,000 |
| 200 (≈ C1) | 120,000 |

Crossing a level boundary triggers the celebration popup.

## CEFR roadmap

A reference table only — computed at a flat 15 XP/word (not the live baseline/ongoing split),
so it represents "what level this vocabulary size implies," independent of any one person's
history:

| CEFR stage | ~known words | ~Level |
|---|---|---|
| A1 | 500 | 50 |
| A2 | 1,000 | 70 |
| A2+ | 1,500 | 86 |
| B1 | 2,000 | 100 |
| B1+ | 2,800 | 118 |
| B2 | 4,000 | 141 |
| C1 | 8,000 | 200 |

Shown as the "you are here" marker on Voortgang's CEFR-route track.

## Worked examples — how much of each pillar to reach a level

Starting from 0 XP (a brand-new install — no vocab baseline bonus, so all vocab growth counts
at the 3 XP/word ongoing rate), split evenly across the 4 pillars:

**To Level 100 / ≈B1 — 30,000 XP total, 7,500 XP per pillar:**

| Pillar | Amount | Notes |
|---|---|---|
| New words | ~2,500 words | at 3 XP/word |
| Messages | ~3,750 typed, or ~2,500 voice, or ~3,000 mixed | at 2 / 3 XP each |
| Listening (chat/revisie plays) | ~1,500 distinct new clips | replays don't count |
| Listening (hands-free loop) | ~1,499 min (~25 hrs) | alternate path, same pool |
| Reading (Leesoefening timer) | ~1,499 min (~25 hrs) | |

Over the app's own 5-month (~150 day) B1 goal: **~17 words/day, ~20 messages/day, ~10 min/day
reading, ~10 min/day loop-listening** (or ~10 new clips/day via chat instead).

**To Level 200 / ≈C1 — 120,000 XP total, 30,000 XP per pillar:**

| Pillar | Amount | Notes |
|---|---|---|
| New words | ~10,000 words | |
| Messages | ~15,000 typed, or ~10,000 voice, or ~12,000 mixed | |
| Listening (chat/revisie plays) | ~6,000 distinct new clips | |
| Listening (hands-free loop) | ~5,999 min (~100 hrs) | alternate path |
| Reading (Leesoefening timer) | ~5,999 min (~100 hrs) | |

Over an illustrative ~2-year C1 horizon: **~14 words/day, ~16 messages/day, ~8 min/day
reading, ~8 min/day loop-listening.**

These are illustrative (assumes an even split across pillars and a brand-new baseline) — in
practice XP arrives unevenly and vocabulary you already knew before this feature existed gives
a head start (15 XP/word instead of 3).

## Where this lives in code

All tunable — one edit each, in `src/App.jsx`:
- `XP` — the writing/speaking/listenFirst constants
- `timeXpAt` / `timeXpDelta` — the reading/loop time curve
- `VOCAB_BASELINE_RATE` / `VOCAB_ONGOING_RATE` — the two vocab rates
- `levelOf` / `xpForLevel` — the `/ 3` divisor that sets how fast levels come
- `CEFR_ROADMAP` — the word-count milestones for the roadmap table

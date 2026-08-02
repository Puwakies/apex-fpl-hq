# APEX FPL HQ — Project Guide for Claude Code

## System Overview
Three-engine weekly FPL brief: YOU (real squad) vs GEMINI (Apps Script) vs CLAUDE (the-gaffer).
All data flows through GitHub Pages (puwakies.github.io/apex-fpl-hq).

## Weekly Flow (every Thursday ~20:45 ICT)
```
Apps Script 20:00 → runWeeklyPipeline() → squad/xpts/news/price/league
Apps Script 20:45 → runExport3Way() → gemini.json + push all cache
Claude Code 21:00 → /brief (GW number) → reads cache → director.json pushed to main
Office (any time) → Load Reports → 3-way scoreboard + click cards for full team
```

## Commands
- `/brief [gw]` — weekly 3-way brief (agents: data-lab, news-desk, medical-bay, fixture-room,
  market-desk, sim-lab, intel, the-rival, the-gaffer, the-director)
- `/backtest [from] [to]` — blind season backtest batch (e.g. /backtest 1 10)
- `/backtest-holdout` — train GW1-19 / test GW20-38 split to guard overfitting

## Cache files (pushed by Apps Script)
- data/cache/squad.json — real 15 players + captain + chips
- data/cache/xpts.json — calculated xPts per player
- data/cache/gemini.json — Gemini picks (captain/xi/bench/transfer)
- data/cache/news.json, price.json, league.json

## APEX Protocol — What's been proven (do not re-tune without fresh unseen season)

### Captaincy (LOCKED after 7 holdout rounds)
captain = season cum_pts leader (nailed premium, not GK)
Evidence: floor/matchup/form-3/form-5/table/venue all tested → none beat cum_pts on unseen data
Human manager beat all models in TEST (47% vs 42%) using real-time injury/lineup info → trust human override
DO NOT add new captain signals without a holdout on a completely fresh season

### Consistency Rules (added after 25/26 audit: 70% of sub-40 GWs fixable)
(A) Rotation-Risk Gate: bench any player with blind mins <60 OR sub <60 in 2+ of last 3 games
(B) Blank Check: no fixture this GW → bench only
(C) Chip Timing:
  - WC: 3+ starters rotation-flagged OR 3-GW rolling avg <55
  - TC: confirmed DGW for best captain (plays twice)
  - BB: DGW where 10+ of 15 play twice
  - FH: BGW where 4+ starters have no fixture
  Save chips — using at wrong time costs more than saving

### What's NOT worth tuning
- Bench selection (CLAUDE bench already +5.6 pts/GW vs YOU — don't touch)
- Captaincy formula (7 rounds proved it — accept ~60% irreducible variance)
- Transfer logic (counterfactual ≈ +34 CLAUDE vs +33 YOU — near-optimal already)

## APEX Decision Principles (6 core — added 26/27, every agent must apply)

### 1. Fixture + Stats > Form
Good fixtures CREATE good form — form is a lagging, noisy output, not an input. Rank by upcoming
FDR **and** underlying stats first; use form only as a tiebreaker.
Rule: never transfer IN on a 2–3 GW form spike alone — fixture ease AND underlying stats must agree.
→ Pillars: fixture-room (FDR-X) + data-lab + the-gaffer.

### 2. Poker mindset — judge DECISION QUALITY, not the weekly outcome
FPL is a long-run game. Grade yourself on the quality of the decision given the best info available
**at the time**, not on the GW score. A bad score ≠ a wrong decision (variance); a captain haul ≠ a
right decision (could be luck). Process > results — don't rage-transfer after one bad week, don't
over-anchor on a lucky haul. Reinforces the "accept ~60% irreducible captaincy variance" rule.
→ Pillars: the-gaffer + the-director (decision-quality framing in every verdict).

### 3. xG delta (finishing over/underperformance, multi-year)
xG = probability a shot becomes a goal. **xG delta = actual goals − xG, backtested over MULTIPLE
seasons** to classify a player (like a stock's multi-year earnings record):
- sustained POSITIVE delta → elite finisher / pen-taker → trust to keep beating xG (buy)
- NEGATIVE delta → xG overstates them → fade / expect downward regression
- HIGH variance → boom/bust → weight the floor (sim-lab)
→ Pillars: sim-lab + data-lab. **DATA GAP:** needs per-player actual-goals-vs-xG history across
seasons — NOT in the FPL bootstrap; requires an xG-history source (FBref/Understat).

### 4. Attacking quality — BC, BCC, SiB (not raw xG)
Judge the QUALITY of the xG, not the raw number: **Big Chance (BC)**, **Big Chance Created (BCC)**,
**Shots in the Box (SiB)** alongside xG. Many BC + SiB = high-quality xG profile = more reliable
returns than a player padding xG with low-quality long shots.
→ Pillars: data-lab + the-gaffer (attacker selection). **DATA GAP:** BC/BCC/SiB are NOT in the FPL
bootstrap — need Opta/FBref/Understat.

### 5. Defensive-weakness targeting — BC conceded, SiB conceded, xGC
Find teams that CONCEDE many Big Chances + Shots in the Box (high xGC) → target the OPPONENTS'
attackers in those matchups. Inverse for clean-sheet picks: buy DEF/GK of teams that concede FEW.
→ Pillars: fixture-room (opponent defensive quality) + data-lab. **DATA:** xGC IS available
(expected_goals_conceded); BC-conceded / SiB-conceded need an external source.

### 6. %ownership → differentials for rank climbing
Only AFTER a player passes #1–#4 (good fixtures + strong stats), use %ownership to find low-owned
DIFFERENTIALS. Calculated risk: right → rank jumps (gain on non-owners); wrong → just take the −4,
remove, fix the team long-term. Cost is bounded and small vs the upside.
→ Pillar: intel (ELITE-OWN). Guardrail: differentials MUST first pass #1–#4 (never punt on ownership
alone), and still respect template-captain protection (backtest: fading the template captain lost pts).

### Data availability for these principles
- ✅ In pipeline now (fpl_fetch): xG, xA, xGI, xGI/90, **xGC**, %ownership, form, FDR, minutes/starts
- ✅ `scripts/fetch_advanced_stats.py` → `data/advanced_stats.json` (enables #3/#4/#5 with FPL proxies):
  - #3 xG-delta: `goals − xG` per player (single-season) + finisher_class (over/under/neutral)
  - #4 attack quality: **Threat** (≈ SiB/shot-danger) + **Creativity** (≈ BCC) + xGI → `attack_quality` z-score
  - #5 def weakness: team `xGC/90` ranking → target opponents' attackers vs the leakiest 6
- ❌ Still external-only (Opta/Understat/FBref): **true BC/BCC/SiB, BC-conceded, SiB-conceded, multi-year
  xG-delta**. The fetcher ATTEMPTS Understat for multi-year xG but the egress policy blocks it here (403);
  it degrades to the FPL proxies above and records `understat_note`. Re-run where Understat is reachable
  to upgrade #3 to a multi-year record and #4/#5 to true Opta chance-quality.

## Season backtest (the-historian)
1. Apps Script: blindSimPrep() then exportBacktestData() → data/backtest/
2. /backtest 1 10 → ... → 31 38 (batches)
3. office/backtest.html → season review
Note: "GEMINI" in backtest = cum_pts baseline. Real Gemini used only in weekly live brief.

## Known backtest limitations
- holdout_results.json vs results.json may diverge (historian Python != .md spec exactly)
- chips_used = {} in backtest (chip sim in .md not fully implemented in Python scripts)
- Use live 26/27 season as the true holdout — more reliable than re-running 25/26

## Repo
github.com/Puwakies/apex-fpl-hq (Public)
Pages: https://puwakies.github.io/apex-fpl-hq/office/
Backtest: https://puwakies.github.io/apex-fpl-hq/office/backtest.html

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

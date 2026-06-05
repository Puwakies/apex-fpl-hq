# APEX FPL HQ — Multi-Agent Fantasy Premier League Operation

A 3-way FPL decision system. The Apps Script (Gemini) pipeline fetches FPL, computes xPts,
and pushes JSON into data/cache/. Claude Code reads that cache, forms its own independent
opinion, and the Director compares THREE sides — the user's real team vs Gemini vs Claude.

## Architecture (3-way)
```
                 THE DIRECTOR  (3-way compare + AI consensus + verdict)
              /         |          \
         YOU         GEMINI        CLAUDE
     real squad   gemini.json    the-gaffer (opus)
     + xpts.json  (Apps Script)  + 6 specialists
```

## Data source: Apps Script cache (no FPL API in Claude Code)
The Apps Script weekly pipeline writes these into the repo (via GitHub API):
  data/cache/squad.json   — user's real 15-man squad, bank, chips (team 6023024)
  data/cache/xpts.json    — per-player xPts ALREADY CALCULATED (trust, don't recompute)
  data/cache/league.json  — mini-league template/differential
  data/cache/news.json, price.json, gemini.json
Claude Code only READS these — no network/allowlist needed.

## Execution order (/brief <GW>)
1. data-lab — read data/cache/*.json
2. specialists (parallel): news-desk, medical-bay, fixture-room, market-desk, sim-lab, intel
3. engines (parallel): gemini-read (relay Gemini) + the-gaffer (Claude's own picks) + the-rival
4. the-director — 3-way compare, measure consensus (do Gemini & Claude agree?), verdict

## The point of 3-way
- Gemini and Claude agree on captain → HIGH conviction, trust the pick
- They disagree → SPLIT, Director flags it, user makes the final call
- Always grounded in the user's REAL squad + REAL calculated xPts

## Pillars (APEX PROTOCOL v1.0) → agent mapping
- **FDR-X** → fixture-room (weighted next-5 fixture difficulty, DGW/BGW)
- **WRPPM-5D** → sim-lab (Monte Carlo xPts, captain EV, haul probability)
- **PRICE-VEL** → market-desk (transfer velocity → price change)
- **ELITE-OWN** → intel (effective ownership, template vs differential)
- **SET-PIECE** → surfaced in features (pens_order, set_piece_note); used by sim-lab + intel
- **CHIP-CAL** → the-gaffer (chip timing decision)

## Key rule: subagents start with a FRESH context
A subagent cannot see this conversation. The ONLY channel is the prompt string when it
is invoked, plus files on disk. So: data-lab writes `data/features.json`, and every other
agent reads it. Always pass the target GW (and rival STRATEGY) in the invocation prompt.

## Running on Claude Code on the web (cloud sandbox)
Push this repo to GitHub, connect it at claude.com/code, then run `/brief 38 top10k`.
The cloud sandbox restricts network access, so you MUST allowlist the FPL domain or the
ETL will 403. In the session's network configuration, allow:
  - fantasy.premierleague.com
Without it, run the ETL locally and commit data/features.json, then let the agents run in cloud.
Note: cloud sessions share your Claude Code rate limit; the parallel fan-out uses it quickly.

## Models
Reasoning-heavy agents use Opus; data/filter agents use Sonnet (cost balance):
  opus   → the-director, the-gaffer, sim-lab, intel, the-rival
  sonnet → data-lab, news-desk, medical-bay, fixture-room, market-desk
Change the `model:` line in any agent's frontmatter to adjust.

## Data source
FPL public API (no auth): `https://fantasy.premierleague.com/api/`
- `bootstrap-static/` — players, teams, events, ownership, prices, xGI
- `fixtures/` — fixture difficulty, home/away, DGW/BGW
Run `python3 scripts/fpl_fetch.py --gw <N>` to refresh features.

## Visual office
`office/index.html` is the pixel dashboard. It can read `data/reports/*.json` to animate
each character's status and render the Gaffer brief + Director head-to-head.

## Project layout
```
.claude/agents/      9 subagents (one .md each)
.claude/commands/    /brief slash command
scripts/fpl_fetch.py ETL: FPL API → features.json
data/features.json   preprocessed feature table (data-lab output)
data/reports/*.json  per-agent reports
office/index.html    pixel-office UI
```

## Season backtest (the-historian)
Blind backtest of 2025/26 — YOU (real) vs GEMINI (template baseline) vs CLAUDE (APEX).
1. Apps Script: run `blindSimPrep()` then `exportBacktestData()` → pushes
   data/backtest/history.json (per-GW player stats) + my_picks.json (your real squad each GW).
2. Claude Code: `/backtest 1 10` (run in batches) → the-historian replays under the strict BLIND rule
   (only data gw < N when picking; results revealed only in post-mortem) → data/backtest/results.json
3. View: office/backtest.html → cumulative chart + per-GW table + transfer counterfactuals + season review.
Note: "GEMINI" in backtest = a template/safe strategy baseline (we do NOT call Gemini 38x); live weekly briefs use real Gemini.

# APEX FPL HQ — Multi-Agent Fantasy Premier League Operation

A pixel-office multi-agent system. Each "character" is a Claude Code subagent that
does one job, writes a JSON report, and the managers synthesize a weekly brief and a
head-to-head contest against an autonomous rival AI.

## Run a gameweek
```
/brief 38 top10k        # GW 38, rival plays the top-10k strategy
```
Or manually: ask Claude to "run the GW 38 briefing" and it will follow the order below.

## Architecture (org chart)
```
THE DIRECTOR        ← summarizes every AI + judges YOU vs RIVAL (runs last)
   ├── THE GAFFER   ← orchestrates YOUR team, writes the weekly brief
   │     └── 6 specialists (parallel):
   │         news-desk · medical-bay · data-lab · fixture-room · market-desk · sim-lab · intel
   └── THE RIVAL    ← builds its OWN squad by strategy, competes head-to-head
```

## Execution order (strict)
1. `data-lab` — ETL, MUST finish first. Pulls FPL public API → `data/features.json`.
2. Parallel fan-out: `news-desk`, `medical-bay`, `fixture-room`, `market-desk`, `sim-lab`, `intel`, `the-rival`.
   Each reads `data/features.json`, writes `data/reports/<name>.json`.
3. `the-gaffer` — reads all specialist reports → `data/reports/gaffer.json`.
4. `the-director` — reads everything incl. gaffer + rival → `data/reports/director.json`.

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

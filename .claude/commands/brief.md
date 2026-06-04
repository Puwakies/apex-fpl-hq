---
description: Run the 3-way GW briefing — YOU vs GEMINI vs CLAUDE — from the Apps Script cache.
argument-hint: [GW number]
---
Run the 3-way gameweek briefing for **GW $1**. Data comes from the Apps Script cache already committed to data/cache/ (no FPL API calls).

Execute in this order:

1. **data-lab** — read data/cache/*.json (squad, xpts, league, news, price, gemini). If anything is missing, STOP.

2. **Specialists in parallel** — news-desk, medical-bay, fixture-room, market-desk, sim-lab, intel. Each reads the cache + writes data/reports/<name>.json.

3. **Two engines in parallel:**
   - **gemini-read** → relays Gemini's picks → data/reports/gemini.json
   - **the-gaffer** (CLAUDE) → independent second opinion → data/reports/claude.json
   - **the-rival** (optional sparring) → data/reports/rival.json

4. **the-director** — 3-way compare YOU vs GEMINI vs CLAUDE, measure consensus, pick best plan → data/reports/director.json

Finally print a Thai brief: each engine's captain + projected xPts, whether Gemini and Claude AGREE (conviction), the best plan, and the one highest-leverage action. Flag clearly if the engines disagree.

---
description: Run the full APEX FPL HQ gameweek briefing.
argument-hint: [GW number] [rival strategy: template|differential|top10k]
---
Run a complete gameweek briefing for **GW $1** with rival strategy **$2** (default: top10k).

Execute in this exact order:

1. **Data Lab first (blocking).** Use the `data-lab` subagent to run the ETL for GW $1. Wait for `data/features.json`. If it fails, STOP and report.

2. **Fan out specialists + the rival in parallel.** Launch together, each reads `data/features.json` and writes `data/reports/*.json`:
   - `news-desk`, `medical-bay`, `fixture-room`, `market-desk`, `sim-lab`, `intel`
   - `the-rival` (pass STRATEGY=$2)

3. **The Gaffer.** Use `the-gaffer` to read all specialist reports → `data/reports/gaffer.json`.

4. **The Director.** Use `the-director` to read everything incl. gaffer.json and rival.json → `data/reports/director.json`.

Finally, print a Thai brief: transfers, captain, chip, top risks, and the YOU-vs-RIVAL scoreline with the Director's verdict.

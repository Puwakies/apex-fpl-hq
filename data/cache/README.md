# data/cache/

Apps Script (Gemini) pipeline writes JSON here via the GitHub API after each weekly run:
- squad.json   — your real 15-man squad, bank, chips (FPL team 6023024)
- xpts.json    — per-player xPts already calculated (trust these, don't recompute)
- league.json  — mini-league standings + template/differential
- news.json, price.json
- gemini.json  — Gemini's structured picks (captain, transfers, projected_xpts)

Claude Code only READS these — no FPL API call, no network allowlist needed.

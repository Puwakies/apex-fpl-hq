---
description: Over-fit guard — tune captaincy on GW1-26, measure on the unseen GW27-38.
argument-hint: (no args)
---
Run a HOLDOUT backtest with the-historian to check the captaincy rule generalizes (not just fits the past).

Rules:
1. The captaincy/matchup rule is FIXED before GW27. The-historian may only use GW<27 to justify any tuning.
2. Replay all 38 GW under the strict blind rule, but REPORT two windows separately:
   - TRAIN (GW1-26): regret, captain return, top-3 captain hit-rate
   - TEST  (GW27-38): same metrics — this window's rule never saw these results
3. Compare CLAUDE's TEST-window captain regret/return against the OLD APEX numbers for the same window
   (from the previous results.json if available), and against YOU/GEMINI in the TEST window.

Print a Thai table: TRAIN vs TEST metrics for YOU/GEMINI/CLAUDE.
Verdict: did CLAUDE's captaincy improve in the UNSEEN test window? If yes → the matchup rule generalizes.
If it only improved in train but not test → we overfit; say so plainly.

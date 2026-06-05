---
description: Run the blind season backtest (YOU vs GEMINI vs CLAUDE) for a GW range.
argument-hint: [from_gw] [to_gw]   e.g. /backtest 1 10
---
Run the blind backtest for **GW $1 to GW $2** of season 2025/26 using the-historian.

1. Confirm data/backtest/history.json + my_picks.json exist (pushed by Apps Script `exportBacktestData()`). If missing, STOP and say so.
2. Use the **the-historian** subagent to replay GW $1..$2 under the strict BLIND rule (only data gw < N when picking; results revealed only in post-mortem).
3. Merge into data/backtest/results.json (keep earlier GWs).
4. Print a Thai table: each GW's points for YOU/GEMINI/CLAUDE, running totals, captain misses, and any transfer counterfactual where not-transferring would have been better.

Tip: run in batches (e.g. /backtest 1 10, then 11 20, ...) to stay within limits. After GW38, ask the-historian for the season_review (best engine, your strategy flaws, 3 key lessons).

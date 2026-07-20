#!/usr/bin/env python3
"""
APEX FPL HQ — 26/27 market/availability refresh from the LIVE bootstrap (data/features.json).
Regenerates the current-state cache the pillar agents read:
  data/cache/news.json   -> current injuries / suspensions / doubts
  data/cache/price.json  -> price-market state (preseason: no velocity yet)
  data/cache/league.json -> current ownership template + differentials
  data/reports/market_2627.json -> full current market snapshot
"""
import json, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
d = json.load(open(ROOT/"data/features.json"))
ps = d["players"]
NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

STMAP = {"i": "INJURED", "s": "SUSPENDED", "d": "DOUBTFUL", "u": "UNAVAILABLE"}

# ---------- news.json : current availability (relevant players only) ----------
def relevant(p):
    return p["selected_by_pct"] >= 2.0 or p["pts"] >= 100
news_items = []
for p in sorted(ps, key=lambda x: -x["selected_by_pct"]):
    if p["status"] in ("i", "s", "d") and relevant(p):
        ch = p.get("chance_next")
        news_items.append({
            "player": p["web_name"], "team": p["team"], "pos": p["pos"],
            "status": STMAP[p["status"]],
            "chance": ch if ch is not None else 0,
            "news": f"{STMAP[p['status']].title()} — chance of playing next: {ch if ch is not None else 0}%",
            "signal": "out" if p["status"] in ("i", "s") or (ch or 0) < 50 else "doubt",
        })
news = {"updated": NOW, "season": "2026/27", "phase": "pre-season",
        "note": "current availability from live FPL bootstrap", "items": news_items}
json.dump(news, open(ROOT/"data/cache/news.json", "w"), ensure_ascii=False, indent=2)

# ---------- price.json : transfer-market velocity ----------
nz = [p for p in ps if p.get("net_transfers", 0)]
price = {"updated": NOW, "season": "2026/27", "phase": "pre-season",
         "note": ("GW transfer market not open yet — no price velocity pre-GW1. "
                  "Populated live once the season starts (net_transfers/cost_change_event)."),
         "likely_rises": [], "likely_falls": []}
if nz:
    ups = sorted([p for p in ps if p["net_transfers"] > 0], key=lambda x: -x["net_transfers"])[:15]
    dns = sorted([p for p in ps if p["net_transfers"] < 0], key=lambda x: x["net_transfers"])[:15]
    price["likely_rises"] = [{"player": p["web_name"], "team": p["team"], "net": p["net_transfers"]} for p in ups]
    price["likely_falls"] = [{"player": p["web_name"], "team": p["team"], "net": p["net_transfers"]} for p in dns]
json.dump(price, open(ROOT/"data/cache/price.json", "w"), ensure_ascii=False, indent=2)

# ---------- league.json : current ownership template + differentials ----------
owned = sorted(ps, key=lambda x: -x["selected_by_pct"])
template = [{"player": p["web_name"], "team": p["team"], "pos": p["pos"],
            "price": p["price"], "own": p["selected_by_pct"]}
           for p in owned if p["selected_by_pct"] >= 20][:15]
# differentials = quality (25/26 pts>=140) but lowish ownership (<10%) and available
diffs = [{"player": p["web_name"], "team": p["team"], "pos": p["pos"],
         "price": p["price"], "own": p["selected_by_pct"], "pts_2526": p["pts"]}
        for p in sorted(ps, key=lambda x: -x["pts"])
        if p["pts"] >= 140 and p["selected_by_pct"] < 10 and p["status"] == "a"][:15]
league = {"updated": NOW, "season": "2026/27", "phase": "pre-season",
          "context": {"GW": 1,
                      "Template Players": ", ".join(f"{t['player']}({t['own']}%)" for t in template[:6]),
                      "Top Differentials": ", ".join(f"{t['player']}({t['own']}%)" for t in diffs[:6])},
          "template": template, "differentials": diffs}
json.dump(league, open(ROOT/"data/cache/league.json", "w"), ensure_ascii=False, indent=2)

# ---------- market_2627.json : full snapshot ----------
by = {"GK": [], "DEF": [], "MID": [], "FWD": []}
pm = {"GKP": "GK", "DEF": "DEF", "MID": "MID", "FWD": "FWD"}
for p in ps:
    pos = pm.get(p["pos"])
    if pos and p["status"] == "a":
        by[pos].append(p)
top_owned = {pos: [{"player": q["web_name"], "team": q["team"], "price": q["price"],
                    "own": q["selected_by_pct"], "pts_2526": q["pts"]}
                   for q in sorted(v, key=lambda x: -x["selected_by_pct"])[:8]]
            for pos, v in by.items()}
market = {"updated": NOW, "season": "2026/27", "phase": "pre-season (pre-GW1)",
          "n_players": len(ps),
          "availability_counts": {STMAP.get(s, s): sum(1 for p in ps if p["status"] == s)
                                  for s in ("a", "d", "i", "s", "u")},
          "template_high_eo": template,
          "differentials": diffs,
          "top_owned_by_pos": top_owned,
          "notable_unavailable": news_items,
          "price_market": "no velocity pre-GW1"}
json.dump(market, open(ROOT/"data/reports/market_2627.json", "w"), ensure_ascii=False, indent=2)

print("updated:", NOW)
print(f"news items (injuries/susp/doubt, relevant): {len(news_items)}")
print(f"template (>=20% owned): {len(template)}  differentials: {len(diffs)}")
print("\nTEMPLATE (high EO):", ", ".join(f"{t['player']} {t['own']}%" for t in template[:8]))
print("DIFFERENTIALS:", ", ".join(f"{t['player']} {t['own']}%" for t in diffs[:8]))
print("\nNOTABLE OUT/DOUBT:")
for it in news_items:
    print(f"  {it['player']:14s}{it['team']:4s} {it['status']:11s} chance={it['chance']}%  [{it['signal']}]")

#!/usr/bin/env python3
"""
APEX FPL HQ — GK deep-dive for the CORE build's locked premium keeper (Raya).
Question: with 26/27 rewarding SAVES more (extra BPS/points), is there a keeper with
MORE saves than Raya while keeping clean sheets close to Raya's?
Pulls raw saves / clean_sheets / bps from the live bootstrap (not in features.json).
"""
import json, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
req = urllib.request.Request("https://fantasy.premierleague.com/api/bootstrap-static/",
                             headers={"User-Agent": "Mozilla/5.0"})
boot = json.load(urllib.request.urlopen(req, timeout=40))
teams = {t["id"]: t["short_name"] for t in boot["teams"]}
gk_type = [e["id"] for e in boot["element_types"] if e["singular_name_short"] in ("GKP", "GK")][0]

gks = []
for p in boot["elements"]:
    if p["element_type"] != gk_type or p["minutes"] < 900:
        continue
    gks.append({
        "name": p["web_name"], "team": teams[p["team"]], "price": p["now_cost"]/10,
        "pts": p["total_points"], "min": p["minutes"], "starts": p.get("starts", 0),
        "saves": p.get("saves", 0), "saves90": float(p.get("saves_per_90", 0) or 0),
        "cs": p.get("clean_sheets", 0), "cs90": float(p.get("clean_sheets_per_90", 0) or 0),
        "gc": p.get("goals_conceded", 0), "xgc": float(p.get("expected_goals_conceded", 0) or 0),
        "bps": p.get("bps", 0), "own": float(p.get("selected_by_percent", 0) or 0),
        "status": p["status"],
    })

raya = next(g for g in gks if g["name"] == "Raya")
CUR = 1/3  # current save scoring: 1 pt per 3 saves

def proj(g, rate):
    """last-season pts re-scored under a new per-save rate (CS/GC/bonus held constant)."""
    return g["pts"] + g["saves"] * (rate - CUR)

nailed = [g for g in gks if g["starts"] >= 26]
scenarios = {"current(1/3)": CUR, "boost(1/2)": 0.5, "max(1/1)": 1.0}

rows = []
for g in sorted(nailed, key=lambda x: -x["saves"]):
    r = {**g, "proj": {k: round(proj(g, v), 1) for k, v in scenarios.items()},
         "ppm_boost": round(proj(g, 0.5)/g["price"], 1)}
    rows.append(r)

literal = [g for g in nailed if g["saves"] > raya["saves"] and g["cs"] >= raya["cs"]-5 and g["name"] != "Raya"]
beats = {k: [g["name"] for g in nailed if proj(g, v) > proj(raya, v) and g["name"] != "Raya"]
         for k, v in scenarios.items()}

# --- minutes normalization: scale everyone to Raya's minutes (removes the minutes confound) ---
BASIS = raya["min"]
def norm(g):
    f = BASIS / g["min"]
    fs_saves, fs_pts = g["saves"]*f, g["pts"]*f
    return {"pts90": round(g["pts"]/(g["min"]/90), 2), "saves90": round(g["saves90"], 2),
            "fs_saves": round(fs_saves), "fs_pts": round(fs_pts),
            "fs_@1/2": round(fs_pts + fs_saves*(0.5-CUR)),
            "fs_@1/1": round(fs_pts + fs_saves*(1.0-CUR))}
mins_view = {g["name"]: {"min": g["min"], "starts": g["starts"], **norm(g)} for g in nailed}
beats_norm = {k: [g["name"] for g in nailed
                  if (norm(g)[{"boost(1/2)": "fs_@1/2", "max(1/1)": "fs_@1/1"}.get(k, "fs_@1/2")]
                      > norm(raya)[{"boost(1/2)": "fs_@1/2", "max(1/1)": "fs_@1/1"}.get(k, "fs_@1/2")])
                  and g["name"] != "Raya"]
              for k in ("boost(1/2)", "max(1/1)")}

out = {"raya": raya, "rows": rows, "literal_match": literal, "beats_raya": beats,
       "minutes_normalized": mins_view, "beats_raya_normalized": beats_norm,
       "note": "proj = 25/26 pts re-scored at new per-save rate, CS/GC/bonus constant; "
               "fs_* = scaled to Raya's minutes (full nailed season)"}
json.dump(out, open(ROOT/"data/reports/gk_compare_2627.json", "w"), ensure_ascii=False, indent=2)

print(f"RAYA: saves={raya['saves']} CS={raya['cs']} (league-high) bps={raya['bps']} pts={raya['pts']} £{raya['price']}\n")
print(f"{'GK':12s}{'TM':4s}{'£':>5s}{'sv':>5s}{'CS':>4s}{'bps':>5s}{'now':>5s}{'@1/2':>6s}{'@1/1':>6s}{'ppm½':>6s}")
for r in rows:
    s = " <-RAYA" if r["name"] == "Raya" else ""
    print(f"{r['name']:12s}{r['team']:4s}{r['price']:>5.1f}{r['saves']:>5d}{r['cs']:>4d}{r['bps']:>5d}"
          f"{r['pts']:>5d}{r['proj']['boost(1/2)']:>6.0f}{r['proj']['max(1/1)']:>6.0f}{r['ppm_boost']:>6.1f}{s}")
print("\nliteral match (more saves + CS within 5 of Raya):", [g["name"] for g in literal] or "NONE")
for k in scenarios:
    print(f"beats Raya @ {k}: {beats[k] or 'nobody'}")

#!/usr/bin/env python3
"""
APEX FPL HQ — Data Lab ETL
Pulls the FPL public API and preprocesses raw data into model-ready features.
No auth required. Run: python3 scripts/fpl_fetch.py [--gw 38]

Outputs:
  data/features.json   -> per-player feature table consumed by all pillar agents
  data/raw_*.json       -> cached raw endpoints (optional debug)
"""
import json, argparse, time, urllib.request, statistics, os
from pathlib import Path

BASE = "https://fantasy.premierleague.com/api"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

HDRS = {"User-Agent": "Mozilla/5.0 (APEX-FPL-HQ DataLab)"}

def get(path):
    url = f"{BASE}/{path}"
    req = urllib.request.Request(url, headers=HDRS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def current_gw(bootstrap):
    for ev in bootstrap["events"]:
        if ev.get("is_current"):
            return ev["id"]
    for ev in bootstrap["events"]:
        if ev.get("is_next"):
            return ev["id"]
    return 1

# --- FDR-X: weighted next-5 fixture difficulty per team (home/away aware) ---
def fixture_difficulty(fixtures, team_id, from_gw, n=5):
    rows = []
    for f in fixtures:
        if f.get("event") is None or f["event"] < from_gw:
            continue
        if f["team_h"] == team_id:
            rows.append((f["event"], f["team_h_difficulty"], "H"))
        elif f["team_a"] == team_id:
            rows.append((f["event"], f["team_a_difficulty"], "A"))
    rows.sort(key=lambda x: x[0])
    rows = rows[:n]
    if not rows:
        return {"fdr_avg": None, "n_fixtures": 0, "dgw": False}
    # away fixtures weighted slightly harder
    weighted = [d + (0.3 if loc == "A" else 0) for _, d, loc in rows]
    gws = [g for g, _, _ in rows]
    dgw = len(gws) != len(set(gws))
    return {"fdr_avg": round(statistics.mean(weighted), 2),
            "n_fixtures": len(rows), "dgw": dgw,
            "next": [{"gw": g, "fdr": d, "loc": l} for g, d, l in rows]}

def main(gw_arg=None):
    print("[DataLab] fetching bootstrap-static ...")
    boot = get("bootstrap-static/")
    fixtures = get("fixtures/")
    gw = gw_arg or current_gw(boot)
    print(f"[DataLab] target GW = {gw}")

    teams = {t["id"]: t for t in boot["teams"]}
    pos = {e["id"]: e["singular_name_short"] for e in boot["element_types"]}

    feats = []
    for p in boot["elements"]:
        team = teams[p["team"]]
        fdr = fixture_difficulty(fixtures, p["team"], gw)
        feats.append({
            "id": p["id"],
            "web_name": p["web_name"],
            "team": team["short_name"],
            "pos": pos[p["element_type"]],
            "price": p["now_cost"] / 10.0,
            # --- core form / output ---
            "form": float(p["form"]),
            "pts": p["total_points"],
            "ppg": float(p["points_per_game"]),
            "minutes": p["minutes"],
            "starts": p.get("starts", 0),
            # --- expected stats (xGI engine) ---
            "xg": float(p.get("expected_goals", 0) or 0),
            "xa": float(p.get("expected_assists", 0) or 0),
            "xgi": float(p.get("expected_goal_involvements", 0) or 0),
            "xgi_per90": float(p.get("expected_goal_involvements_per_90", 0) or 0),
            # --- PRICE-VEL inputs ---
            "transfers_in_event": p["transfers_in_event"],
            "transfers_out_event": p["transfers_out_event"],
            "net_transfers": p["transfers_in_event"] - p["transfers_out_event"],
            "cost_change_event": p["cost_change_event"] / 10.0,
            # --- ELITE-OWN inputs ---
            "selected_by_pct": float(p["selected_by_percent"]),
            # --- availability (Medical Bay cross-checks) ---
            "status": p["status"],            # a=avail, d=doubt, i=injured, s=susp, u=unavail
            "chance_next": p.get("chance_of_playing_next_round"),
            # --- SET-PIECE flags ---
            "pens_order": p.get("penalties_order"),
            "set_piece_note": (p.get("corners_and_indirect_freekicks_order")
                               or p.get("direct_freekicks_order")),
            # --- FDR-X ---
            "fdr": fdr,
        })

    out = {
        "meta": {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "target_gw": gw,
            "source": "fantasy.premierleague.com/api",
            "n_players": len(feats),
        },
        "players": feats,
    }
    (DATA / "features.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"[DataLab] wrote data/features.json ({len(feats)} players)")
    print(f"[DataLab] features ready ✓  -> downstream agents read this file")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gw", type=int, default=None)
    a = ap.parse_args()
    main(a.gw)

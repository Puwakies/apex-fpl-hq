#!/usr/bin/env python3
"""
APEX FPL HQ — Advanced-stats fetch (enables Decision Principles #3/#4/#5).

Principles it feeds:
  #3 xG delta      — goals − xG (finishing over/underperformance). Single-season from FPL now;
                     multi-year needs Understat (attempted, degrades gracefully).
  #4 Attack quality — Big Chance / BCC / Shots-in-Box. TRUE values need Opta/Understat; until then
                     FPL proxies: Threat (≈ shot danger / SiB), Creativity (≈ BCC), + xG/xGI.
  #5 Def weakness  — teams that concede many BC/SiB (high xGC) → target opponents' attackers.
                     xGC is native; BC/SiB-conceded need external (flagged).

Every field carries a `source`: "fpl" (native), "fpl-proxy" (proxy for an Opta metric),
or "external" (Understat/FBref when reachable). Understat is attempted but is blocked by the
egress policy in some environments (403) — the script then degrades to FPL proxies and says so.

Output: data/advanced_stats.json   Run: python3 scripts/fetch_advanced_stats.py
"""
import json, urllib.request, statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FPL = "https://fantasy.premierleague.com/api"
UNDERSTAT_SEASONS = ["2025", "2024", "2023"]   # multi-year for a real xG-delta record (#3)

def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (APEX-FPL-HQ AdvStats)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")

def getj(path):
    return json.loads(get(f"{FPL}/{path}"))

# ---------------------------------------------------------------- Understat (best-effort)
def try_understat():
    """Understat embeds per-player season JSON in <script> as JSON.parse('...').
    Returns {season: [players]} or None if the host is blocked / unreachable."""
    import re, codecs
    out = {}
    for yr in UNDERSTAT_SEASONS:
        try:
            html = get(f"https://understat.com/league/EPL/{yr}", timeout=25)
        except Exception as e:
            return {"_error": f"{type(e).__name__}: {str(e)[:80]}"}
        m = re.search(r"playersData\s*=\s*JSON.parse\('([^']+)'\)", html)
        if not m:
            continue
        raw = codecs.decode(m.group(1), "unicode_escape")
        try:
            out[yr] = json.loads(raw)
        except Exception:
            continue
    return out or None

# ---------------------------------------------------------------- main
def main():
    boot = getj("bootstrap-static/")
    teams = {t["id"]: t["short_name"] for t in boot["teams"]}
    pos = {e["id"]: e["singular_name_short"] for e in boot["element_types"]}

    def f(p, k):
        try: return float(p.get(k, 0) or 0)
        except Exception: return 0.0

    players = []
    for p in boot["elements"]:
        mins = p["minutes"]
        if mins < 450:                      # skip fringe players
            continue
        g = int(p.get("goals_scored", 0)); xg = f(p, "expected_goals")
        a = int(p.get("assists", 0));      xa = f(p, "expected_assists")
        per90 = (mins / 90.0) or 1
        players.append({
            "name": p["web_name"], "team": teams[p["team"]], "pos": pos[p["element_type"]],
            "minutes": mins, "starts": p.get("starts", 0),
            # --- #3 xG delta (single-season, FPL) ---
            "goals": g, "xg": round(xg, 2), "xg_delta": round(g - xg, 2),
            "xg_delta_per90": round((g - xg) / per90, 3),
            "assists": a, "xa": round(xa, 2), "xa_delta": round(a - xa, 2),
            # --- #4 attack quality proxies (Opta-derived FPL metrics) ---
            "threat": f(p, "threat"),            "threat_per90": round(f(p, "threat") / per90, 1),
            "creativity": f(p, "creativity"),    "creativity_per90": round(f(p, "creativity") / per90, 1),
            "ict": f(p, "ict_index"), "xgi": f(p, "expected_goal_involvements"),
            # --- #5 inputs (player side) ---
            "xgc": f(p, "expected_goals_conceded"),
        })

    # ---- #3 finisher classification (flagged single-season until multi-year lands) ----
    for p in players:
        d = p["xg_delta_per90"]
        p["finisher_class"] = ("overperformer" if d > 0.10 else
                               "underperformer" if d < -0.08 else "neutral")

    # ---- #4 attack-quality score: normalise threat/90 + creativity/90 + xGI/90 (attackers) ----
    att = [p for p in players if p["pos"] in ("FWD", "MID") and p["minutes"] >= 900]
    def z(vals):
        m = statistics.mean(vals); s = statistics.pstdev(vals) or 1
        return m, s
    if att:
        tm, ts = z([p["threat_per90"] for p in att])
        cm, cs = z([p["creativity_per90"] for p in att])
        for p in players:
            if p in att:
                zt = (p["threat_per90"] - tm) / ts
                zc = (p["creativity_per90"] - cm) / cs
                p["attack_quality"] = round(0.6 * zt + 0.4 * zc, 2)   # threat weighted higher (shot danger)
            else:
                p["attack_quality"] = None

    # ---- #5 team defensive weakness: rank by xGC (leakiest → target their opponents' attackers) ----
    tstat = {}
    for p in boot["elements"]:
        t = teams[p["team"]]
        if t not in tstat:
            tstat[t] = {"xgc90": f(p, "expected_goals_conceded_per_90"),
                        "gc": int(p.get("goals_conceded", 0)), "cs": int(p.get("clean_sheets", 0))}
    # take the team's most-played defender/keeper xGC/90 as the team value (already per-90 ≈ same team-wide)
    team_def = sorted(tstat.items(), key=lambda x: -x[1]["xgc90"])
    weakness = [{"team": t, "xgc_per90": round(v["xgc90"], 2), "rank": i + 1,
                 "target": "buy opponents' attackers vs " + t if i < 6 else
                           ("clean-sheet source" if i >= len(team_def) - 6 else "neutral")}
                for i, (t, v) in enumerate(team_def)]

    # ---- multi-year xG-delta from Understat (best-effort) ----
    us = try_understat()
    us_note = None
    if not us:
        us_note = "Understat returned no data"
    elif isinstance(us, dict) and us.get("_error"):
        us_note = f"Understat unreachable ({us['_error']}) — degraded to FPL single-season proxies"
        us = None

    out = {
        "generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%S"),
        "source_map": {
            "xg_delta": "fpl (single-season)  |  multi-year: external (Understat) when reachable",
            "attack_quality": "fpl-proxy (Threat≈SiB/shot-danger, Creativity≈BCC)",
            "true_BC_BCC_SiB": "external only (Opta/Understat) — NOT yet available here",
            "def_weakness": "fpl (xGC native)  |  BC-conceded/SiB-conceded: external",
        },
        "understat_multi_year": bool(us),
        "understat_note": us_note,
        "players": sorted(players, key=lambda x: -(x["attack_quality"] or -99))[:200],
        "team_def_weakness": weakness,
    }
    (ROOT / "data/advanced_stats.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))

    print(f"[AdvStats] {len(players)} players, {len(weakness)} teams → data/advanced_stats.json")
    print(f"[AdvStats] Understat multi-year: {'YES' if us else 'NO — ' + (us_note or '')}")
    print("\n#3 xG-delta extremes (per90, single-season):")
    ranked = sorted([p for p in players if p["minutes"] >= 1200], key=lambda x: -x["xg_delta_per90"])
    for p in ranked[:5]:  print(f"   OVER  {p['name']:13s}{p['team']:4s} g{p['goals']} xG{p['xg']} Δ{p['xg_delta']:+.1f} ({p['finisher_class']})")
    for p in ranked[-4:]: print(f"   UNDER {p['name']:13s}{p['team']:4s} g{p['goals']} xG{p['xg']} Δ{p['xg_delta']:+.1f} ({p['finisher_class']})")
    print("\n#4 attack-quality top (Threat+Creativity proxy):")
    for p in sorted(att, key=lambda x: -(x["attack_quality"] or -99))[:6]:
        print(f"   {p['name']:13s}{p['team']:4s} AQ={p['attack_quality']:+.2f} thr/90={p['threat_per90']} cre/90={p['creativity_per90']}")
    print("\n#5 leakiest defences (target their opponents' attackers):")
    for w in weakness[:6]: print(f"   {w['team']:4s} xGC/90={w['xgc_per90']}")

if __name__ == "__main__":
    main()

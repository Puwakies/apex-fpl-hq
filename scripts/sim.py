#!/usr/bin/env python3
"""SIM LAB (WRPPM-5D): Monte Carlo captain EV / haul probability.

features.json (GW38) carries pre-computed per-player xPts plus an FDR proxy
rather than raw xgi_per90/form/minutes. We build the prior from xpts (easier
fixture nudges the mean up) and simulate a right-skewed single-game return
distribution to estimate captain EV, haul probability, and variance.
"""
import json, math, random, os

random.seed(38)
ROOT = "/home/user/apex-fpl-hq"
feat = json.load(open(os.path.join(ROOT, "data/features.json")))
GW = feat["meta"]["gw"]

starters = set(feat["squad"]["starters"])
pool = [p for p in feat["xpts_squad_players"]
        if p.get("xpts") is not None and p["name"] in starters]

fdr_lookup = {r["name"]: r.get("fdr", 3) for r in feat["xpts_top10_overall"]}

N = 10000

def simulate(player):
    base = player["xpts"]
    fdr = fdr_lookup.get(player["name"], 3)
    mean = base * (1.0 + (3 - fdr) * 0.04)   # easier fixture => higher
    sigma = 0.55                              # right-skew tail (hauls)
    draws, hauls = [], 0
    for _ in range(N):
        floor = max(0.0, random.gauss(mean * 0.5, mean * 0.18))
        tail = math.exp(random.gauss(math.log(max(mean, 0.5)), sigma)) - mean * 0.5
        pts = max(0.0, floor + max(0.0, tail))
        draws.append(pts * 2)                 # captain doubling
        if pts >= 8.0:                         # >=2 returns proxy
            hauls += 1
    n = len(draws)
    mu = sum(draws) / n
    var = sum((d - mu) ** 2 for d in draws) / n
    return round(mu, 2), round(hauls / n, 3), round(var, 2)

results = []
for p in pool:
    ev, ph, var = simulate(p)
    results.append({"player": p["name"], "ev_xpts": ev,
                    "p_haul": ph, "variance": var})

results.sort(key=lambda r: r["ev_xpts"], reverse=True)
ceiling = max(results, key=lambda r: r["variance"])

report = {
    "gw": GW,
    "captain_ranking": results,
    "recommend_c": results[0]["player"],
    "recommend_vc": results[1]["player"] if len(results) > 1 else None,
    "high_ceiling_differential": {
        "player": ceiling["player"],
        "variance": ceiling["variance"],
        "p_haul": ceiling["p_haul"],
    },
}

os.makedirs(os.path.join(ROOT, "data/reports"), exist_ok=True)
for name in ("sim.json", "sim-lab.json"):
    json.dump(report, open(os.path.join(ROOT, "data/reports", name), "w"), indent=2)
print(json.dumps(report, indent=2))

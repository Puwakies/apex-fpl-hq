import json, random, statistics, os

random.seed(38)
N = 10000

# GW38: xpts.json zeroed -> use Gemini baseline (Haaland captain_xpts=14 => raw mean ~7.0).
# Other candidates anchored to role/form relative to Haaland; fdr neutral (~3) for all.
candidates = {
    "Haaland":     {"pos":"FWD","p_play":0.88,"lam_goal":0.78,"lam_assist":0.18,"cs_pts":0,"base":2.0},
    "Bowen":       {"pos":"FWD","p_play":0.95,"lam_goal":0.40,"lam_assist":0.28,"cs_pts":0,"base":2.0},
    "Saka":        {"pos":"MID","p_play":0.90,"lam_goal":0.35,"lam_assist":0.38,"cs_pts":1,"base":2.0},
    "B.Fernandes": {"pos":"MID","p_play":0.95,"lam_goal":0.30,"lam_assist":0.38,"cs_pts":1,"base":2.0},
}
goal_pts = {"FWD":4,"MID":5}

def draw(c):
    if random.random() > c["p_play"]:
        return 0.0, 0
    pts = c["base"]
    g = 0
    while random.random() < c["lam_goal"]/(1+g):
        g += 1
        if g > 3: break
    a = 1 if random.random() < c["lam_assist"] else 0
    if random.random() < c["lam_assist"]*0.3: a += 1
    pts += g*goal_pts[c["pos"]] + a*3
    if c["cs_pts"] and random.random() < 0.30:
        pts += c["cs_pts"]
    returns = g + a
    if returns >= 1 and random.random() < 0.45:
        pts += random.choice([1,2,3])
    return float(pts), returns

ranking = []
for name, c in candidates.items():
    samples, hauls = [], 0
    for _ in range(N):
        p, r = draw(c)
        samples.append(p)
        if r >= 2: hauls += 1
    ev = statistics.mean(samples)
    ranking.append({
        "player": name,
        "ev_xpts": round(ev,2),
        "ev_captain_xpts": round(ev*2,2),
        "p_haul": round(hauls/N,3),
        "variance": round(statistics.pvariance(samples),2),
    })

ranking.sort(key=lambda x: x["ev_xpts"], reverse=True)
hi_var = max(ranking, key=lambda x: x["variance"])

report = {
    "gw": 38,
    "method": "Monte Carlo 10k draws; GW38 priors anchored to Gemini baseline (Haaland captain_xpts=14)",
    "captain_ranking": [{k:r[k] for k in ("player","ev_xpts","p_haul","variance")} for r in ranking],
    "ev_captain_doubled": {r["player"]: r["ev_captain_xpts"] for r in ranking},
    "high_ceiling_differential": hi_var["player"],
    "recommend_c": ranking[0]["player"],
    "recommend_vc": ranking[1]["player"],
}

os.makedirs("/home/user/apex-fpl-hq/data/reports", exist_ok=True)
for path in ("/home/user/apex-fpl-hq/data/reports/sim.json",
             "/home/user/apex-fpl-hq/data/reports/sim-lab.json"):
    json.dump(report, open(path,"w"), indent=2)
print(json.dumps(report, indent=2))

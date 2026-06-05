import json, random, statistics, os

random.seed(38)
N = 10000

# GW38: xpts.json/features.json zeroed (final-GW pipeline did not populate per-player
# xPts) -> fall back to Gemini baseline as proxy (Haaland captain_xpts=14 => raw mean
# ~7.0, projected_xpts 85 for the XI). Candidates = realistic armband options from the
# user's starting XI + bench (Haaland) + the high-ceiling differential. fdr ~3 neutral.
candidates = {
    "Haaland":     {"pos":"FWD","p_play":0.82,"lam_goal":0.78,"lam_assist":0.18,"cs_pts":0,"base":2.0},
    "M.Salah":     {"pos":"MID","p_play":0.95,"lam_goal":0.45,"lam_assist":0.35,"cs_pts":1,"base":2.0},
    "Bowen":       {"pos":"FWD","p_play":0.95,"lam_goal":0.40,"lam_assist":0.28,"cs_pts":0,"base":2.0},
    "Mbeumo":      {"pos":"MID","p_play":0.90,"lam_goal":0.38,"lam_assist":0.30,"cs_pts":1,"base":2.0},
    "Mateta":      {"pos":"FWD","p_play":0.90,"lam_goal":0.42,"lam_assist":0.18,"cs_pts":0,"base":2.0},
    "Rogers":      {"pos":"MID","p_play":0.85,"lam_goal":0.30,"lam_assist":0.32,"cs_pts":1,"base":2.0},
}
goal_pts = {"FWD":4,"MID":5}

NOTES = {
    "Haaland": "Gemini C anchor (captain_xpts=14). Top floor+ceiling, best brace odds. Rotation risk on final GW.",
    "M.Salah": "Owned VC. Elite minutes + goal/assist threat -> strongest minutes-adjusted floor.",
    "Bowen": "Current armband. Reliable starter, decent returns, capped ceiling vs Haaland/Salah.",
    "Mbeumo": "In-form MUN attacker; balanced goal+assist profile.",
    "Mateta": "CRY penalty taker; good goal lambda, thinner assist/bonus floor.",
    "Rogers": "High-ceiling differential (AVL). Lower owned -> rank-swing upside, higher variance.",
}

def draw(c):
    if random.random() > c["p_play"]:
        return 0.0, 0
    pts = c["base"]; g = 0
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
        "p_haul": round(hauls/N,3),
        "variance": round(statistics.pvariance(samples),2),
        "note": NOTES[name],
    })

ranking.sort(key=lambda x: x["ev_xpts"], reverse=True)
# high-ceiling differential noted separately: highest variance outside top-2 EV
hi_var = max(ranking[2:], key=lambda x: x["variance"]) if len(ranking) > 2 else ranking[-1]
rec_c, rec_vc = ranking[0]["player"], ranking[1]["player"]

report = {
    "gw": 38,
    "pillar": "WRPPM-5D",
    "method": "Monte Carlo 10k draws; priors anchored to Gemini projected_xpts (Haaland C=14) as GW38 xpts cache is placeholder",
    "captain_ranking": ranking,
    "recommend_c": rec_c,
    "recommend_vc": rec_vc,
    "high_ceiling_differential": hi_var["player"],
}

os.makedirs("/home/user/apex-fpl-hq/data/reports", exist_ok=True)
json.dump(report, open("/home/user/apex-fpl-hq/data/reports/sim-lab.json","w"), indent=2)
print(json.dumps(report, indent=2))

import json, random, statistics, os

random.seed(38)
N = 10000

# GW38: xpts.json/features.json zeroed (final-GW pipeline did not populate per-player
# xPts) -> fall back to Gemini baseline as proxy (Haaland captain_xpts=14 => raw mean
# ~7.0, projected_xpts 85 for the XI). Other candidates anchored to role/quality
# relative to Haaland; fdr neutral (~3) for all GW38 fixtures.
candidates = {
    "Haaland":     {"pos":"FWD","p_play":0.88,"lam_goal":0.78,"lam_assist":0.18,"cs_pts":0,"base":2.0},
    "Saka":        {"pos":"MID","p_play":0.90,"lam_goal":0.35,"lam_assist":0.38,"cs_pts":1,"base":2.0},
    "B.Fernandes": {"pos":"MID","p_play":0.95,"lam_goal":0.30,"lam_assist":0.38,"cs_pts":1,"base":2.0},
    "Bowen":       {"pos":"FWD","p_play":0.95,"lam_goal":0.40,"lam_assist":0.28,"cs_pts":0,"base":2.0},
    "Thiago":      {"pos":"FWD","p_play":0.92,"lam_goal":0.45,"lam_assist":0.15,"cs_pts":0,"base":2.0},
}
goal_pts = {"FWD":4,"MID":5}

NOTES = {
    "Haaland": "Gemini C anchor (captain_xpts=14). Top floor+ceiling, dominant brace odds. Watch rotation risk.",
    "Saka": "Elite ceiling differential - goal+assist threat for ARS; highest variance alternative.",
    "B.Fernandes": "Pens + creativity give a stable floor; lower brace odds than the forwards.",
    "Bowen": "Current squad armband. Reliable minutes, decent return rate, capped ceiling vs Haaland.",
    "Thiago": "Penalty-box poacher - good goal lambda but thin assist/bonus floor.",
}

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
        "name": name,
        "ev": round(ev,2),
        "haul_prob_pct": round(100*hauls/N,1),
        "variance": round(statistics.pvariance(samples),2),
        "notes": NOTES[name],
    })

ranking.sort(key=lambda x: x["ev"], reverse=True)
hi_var = max(ranking, key=lambda x: x["variance"])
rec_c = ranking[0]["name"]
rec_vc = ranking[1]["name"]

# Squad total: anchor to Gemini projected_xpts (85, already prices a captain double),
# adjusted for the EV gap between our recommended C and the squad's default (Bowen).
bowen_ev = next(r["ev"] for r in ranking if r["name"] == "Bowen")
projected_squad_total = round(85 + (ranking[0]["ev"] - bowen_ev))

report = {
    "gw": 38,
    "captain_rankings": [{k:r[k] for k in ("name","ev","haul_prob_pct","notes")} for r in ranking],
    "recommended_captain": rec_c,
    "recommended_vice": rec_vc,
    "projected_squad_total": projected_squad_total,
}

os.makedirs("/home/user/apex-fpl-hq/data/reports", exist_ok=True)
json.dump(report, open("/home/user/apex-fpl-hq/data/reports/sim-lab.json","w"), indent=2)
print(json.dumps({"ranking_detail": ranking, "high_variance_alt": hi_var["name"],
                  "rec_c": rec_c, "rec_vc": rec_vc,
                  "projected_squad_total": projected_squad_total}, indent=2))

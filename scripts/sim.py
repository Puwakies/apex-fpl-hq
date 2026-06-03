import json, datetime, random
import numpy as np

random.seed(38); np.random.seed(38)
ROOT = "/home/user/apex-fpl-hq"
d = json.load(open(f"{ROOT}/data/features.json"))
players = d["players"]

# Position appearance/clean-sheet point structure
POS_APP = {"GKP":2,"DEF":2,"MID":2,"FWD":2}
GOAL_PTS = {"GKP":6,"DEF":6,"MID":5,"FWD":4}
ASSIST_PTS = 3
CS_PTS = {"GKP":4,"DEF":4,"MID":1,"FWD":0}

N = 10000

def prior(p):
    f = p["fdr"]["fdr_avg"]
    # easier fixture (lower fdr) -> multiplier > 1; scale around 3.0
    fixture_mult = 1.0 + (3.0 - f) * 0.12
    # availability
    avail = (p.get("chance_next") or 100) / 100.0
    minutes_factor = min(1.0, p["minutes"] / 3000.0)
    # split xgi into goals vs assists using xg/xa ratio
    xg, xa = p["xg"], p["xa"]
    tot = max(xg + xa, 1e-6)
    g_share, a_share = xg/tot, xa/tot
    base_inv = p["xgi_per90"] * fixture_mult * minutes_factor
    # blend with recent form (form is pts/gw)
    return {
        "lam_g": base_inv * g_share,
        "lam_a": base_inv * a_share,
        "form": p["form"],
        "fixture_mult": fixture_mult,
        "avail": avail,
        "minutes_factor": minutes_factor,
    }

results = []
for p in players:
    pr = prior(p)
    pos = p["pos"]
    pts = np.zeros(N)
    for i in range(N):
        if random.random() > pr["avail"]:
            pts[i] = 0; continue
        # start probability from minutes
        plays = random.random() < (0.6 + 0.4*pr["minutes_factor"])
        if not plays:
            pts[i] = random.choice([0,1]); continue
        app = POS_APP[pos]
        goals = np.random.poisson(pr["lam_g"])
        assists = np.random.poisson(pr["lam_a"])
        # clean sheet prob: better with easier fixture
        cs_prob = max(0.05, min(0.55, 0.30 + (3.0 - p["fdr"]["fdr_avg"])*0.10))
        cs = (random.random() < cs_prob) and CS_PTS[pos] > 0
        bonus = 0
        ret = goals + assists
        if ret >= 2: bonus = np.random.choice([2,3])
        elif ret == 1: bonus = np.random.choice([0,1,2])
        # form nudge: small noise reflecting underlying hot/cold
        form_nudge = np.random.normal((pr["form"]-5.0)*0.15, 0.5)
        total = app + goals*GOAL_PTS[pos] + assists*ASSIST_PTS + (CS_PTS[pos] if cs else 0) + bonus + form_nudge
        pts[i] = max(0, total)
    ev = float(pts.mean())
    var = float(pts.var())
    haul = float((pts >= 8).mean())   # haul as captain-worthy >=8 base pts
    p_returns2 = haul
    results.append({
        "name": p["web_name"], "team": p["team"], "pos": pos, "price": p["price"],
        "ev": round(ev,2), "ev_captain": round(ev*2,2), "haul_prob": round(haul,3),
        "variance": round(var,2), "sel": p["selected_by_pct"],
        "fdr": p["fdr"]["fdr_avg"], "loc": (p["fdr"]["next"][0]["loc"] if p["fdr"]["next"] else "?"),
    })

results.sort(key=lambda r: r["ev"], reverse=True)
json.dump(results, open(f"{ROOT}/data/reports/_sim_raw.json","w"), indent=2)
for r in results:
    print(r["name"], "ev", r["ev"], "capEV", r["ev_captain"], "haul", r["haul_prob"], "var", r["variance"], "sel", r["sel"])

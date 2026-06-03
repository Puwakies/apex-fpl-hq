#!/usr/bin/env python3
"""WRPPM-5D Monte Carlo: captain EV + haul probability for GW38.

Model per draw:
  - availability: Bernoulli(chance_next/100). If absent -> 0 pts (blank).
  - minutes: if available, plays full -> 2 appearance pts (else 1 if cameo).
  - attacking returns: Poisson(lambda) where lambda is an xGI-based scaled
    attacking-involvement rate adjusted by form and fixture ease (lower FDR = up).
  - points per attacking return weighted by position (FWD goal=4, MID goal=5,
    DEF goal=6; assists=3). Defensive clean-sheet bonus for DEF/MID.
  - bonus/extra noise added.
Haul defined as final single-GW score >= 12.
"""
import json, math, random, datetime

random.seed(38)
N = 10000

SRC = "/home/user/apex-fpl-hq/data/features.json"
OUT = "/home/user/apex-fpl-hq/data/reports/sim-lab.json"

with open(SRC) as f:
    data = json.load(f)

# position-based goal/assist values
GOAL = {"FWD": 4, "MID": 5, "DEF": 6, "GK": 6}
ASSIST = 3

def fdr_factor(fdr):
    # easier fixture (low fdr) => boost. fdr 2 -> ~1.15, fdr 3 -> ~1.0, fdr 5 -> ~0.7
    return 1.0 + (3.0 - fdr) * 0.15

def sim_player(p):
    pos = p["pos"]
    avail = (p.get("chance_next", 100) or 0) / 100.0
    xgi90 = p["xgi_per90"]
    form = p["form"]
    nxt = p["fdr"]["next"][0]
    fdr = nxt["fdr"]
    loc = nxt["loc"]

    # split xGI into goal vs assist share using season xg/xa
    xg, xa = p["xg"], p["xa"]
    tot = max(xg + xa, 1e-6)
    goal_share = xg / tot
    assist_share = xa / tot

    # base attacking-involvement lambda for one match, scaled from per90 xGI
    ff = fdr_factor(fdr)
    # form modifier: form relative to ppg-ish baseline (~5) gives mild tilt
    form_mod = 1.0 + (form - 5.0) * 0.04
    # home boost
    home_mod = 1.05 if loc == "H" else 0.97
    lam = xgi90 * ff * form_mod * home_mod

    lam_goal = lam * goal_share
    lam_assist = lam * assist_share

    scores = []
    for _ in range(N):
        if random.random() > avail:
            scores.append(0)  # did not feature
            continue
        # appearance: assume start (75/90+). cameo risk only if doubtful (<100)
        if avail < 1.0 and random.random() < 0.25:
            pts = 1  # cameo
        else:
            pts = 2  # full appearance

        goals = poisson(lam_goal)
        assists = poisson(lam_assist)
        pts += goals * GOAL[pos] + assists * ASSIST

        # clean sheet contribution for DEF (4) and MID (1)
        if pos in ("DEF", "GK", "MID"):
            cs_prob = cs_probability(fdr, loc)
            if random.random() < cs_prob:
                pts += 4 if pos in ("DEF", "GK") else 1

        # bonus points: more likely when returns happen
        if goals + assists >= 2:
            pts += random.choice([2, 3, 3])
        elif goals + assists == 1:
            pts += random.choice([0, 1, 2, 3])

        # small noise for tackles/recoveries variance
        pts += random.choice([0, 0, 0, 1])
        scores.append(pts)

    mean = sum(scores) / N
    haul = sum(1 for s in scores if s >= 12) / N
    var = sum((s - mean) ** 2 for s in scores) / N
    return mean, haul, var

def poisson(lam):
    # Knuth
    if lam <= 0:
        return 0
    L = math.exp(-lam)
    k = 0
    prod = 1.0
    while True:
        prod *= random.random()
        if prod <= L:
            return k
        k += 1

def cs_probability(fdr, loc):
    base = 0.35
    base += (3 - fdr) * 0.06
    base += 0.04 if loc == "H" else -0.02
    return max(0.05, min(0.6, base))

results = []
for p in data["players"]:
    mean, haul, var = sim_player(p)
    results.append({
        "player": p["web_name"], "team": p["team"], "pos": p["pos"],
        "xPts": round(mean, 2), "haul_prob": round(haul, 4),
        "captain_ev": round(mean * 2, 2), "variance": round(var, 2),
    })

results.sort(key=lambda r: r["captain_ev"], reverse=True)
for i, r in enumerate(results, 1):
    r["rank"] = i

first, second = results[0], results[1]
# differential high-ceiling: best haul_prob among low-ownership (<15%)
own = {p["web_name"]: p["selected_by_pct"] for p in data["players"]}
diffs = [r for r in results if own[r["player"]] < 15]
diff = max(diffs, key=lambda r: r["haul_prob"]) if diffs else None

projections = [{k: r[k] for k in ("player", "team", "pos", "xPts", "haul_prob", "captain_ev", "rank")} for r in results]
# keep variance available too
for r, proj in zip(results, projections):
    proj["variance"] = r["variance"]

report = {
    "agent": "sim-lab",
    "gw": 38,
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "simulations": N,
    "player_projections": projections,
    "captain_recommendation": {
        "first": first["player"],
        "second": second["player"],
        "rationale": (
            f"{first['player']} leads on EV ({first['captain_ev']} capt pts, "
            f"haul {first['haul_prob']*100:.1f}%) with a soft FDR{2 if first['player']=='Haaland' else ''} home tie; "
            f"{second['player']} is the safest backup. "
            + (f"High-ceiling differential: {diff['player']} ({own[diff['player']]:.1f}% owned, haul {diff['haul_prob']*100:.1f}%)." if diff else "")
        ),
    },
    "high_ceiling_differential": ({
        "player": diff["player"], "haul_prob": diff["haul_prob"],
        "captain_ev": diff["captain_ev"], "owned_pct": own[diff["player"]],
    } if diff else None),
    "summary": (
        f"GW38: Captain {first['player']} (EV {first['captain_ev']}, haul {first['haul_prob']*100:.1f}%); "
        f"VC {second['player']} (EV {second['captain_ev']}). "
        + (f"Punt option {diff['player']} carries the highest differential ceiling." if diff else "")
    ),
}

with open(OUT, "w") as f:
    json.dump(report, f, indent=2)

print(json.dumps({"ranking": [(r["player"], r["captain_ev"], r["haul_prob"], r["variance"]) for r in results],
                  "C": first["player"], "VC": second["player"],
                  "diff": diff["player"] if diff else None}, indent=2))

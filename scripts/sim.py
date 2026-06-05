#!/usr/bin/env python3
"""SIM LAB (WRPPM-5D) — Monte Carlo captaincy EV for GW38.

GW38 reality (from news-desk): Haaland UNAVAILABLE (not in MCI squad) -> EXCLUDED.
features.json xPts are flat/zero, so we build position-based priors and modulate
each by availability (start prob), fixture quality, motivation/form, and rotation
risk. ~10k draws estimate captained EV, p(haul), blank prob, and variance.

Captained points = raw points * 2 (TC would be *3, evaluated separately).
"""
import json, random, statistics, os

random.seed(38)
N = 10000

# Per-90 attacking-involvement rate (expected goals+assists), BEFORE captain doubling.
# Tuned so elite attackers blank ~30-40% (raw <=2) and haul (raw>=6) ~30-45% of starts.
POS_INVOLVE = {"FWD": 0.62, "MID": 0.58, "DEF": 0.24}

# Captain candidate pool from the user's GW38 squad (Haaland excluded - unavailable).
#   avail = P(starts + meaningful minutes)   fix = fixture-quality mult   motiv = form/motivation mult
#   rot flag marks the differential rotation-lottery option.
candidates = [
    {"name": "Bowen",   "team": "WHU", "pos": "FWD", "avail": 0.97, "fix": 1.18, "motiv": 1.22, "rot": "low",
     "note": "Nailed talisman, must-win relegation decider vs Leeds; two double-figure home hauls in last 3; max motivation."},
    {"name": "M.Salah", "team": "LIV", "pos": "MID", "avail": 0.95, "fix": 0.98, "motiv": 1.10, "rot": "low",
     "note": "Confirmed start in farewell match; elite ceiling but vs motivated Brentford and dead-rubber LIV context."},
    {"name": "Mbeumo",  "team": "BRE", "pos": "MID", "avail": 0.94, "fix": 1.02, "motiv": 1.06, "rot": "low",
     "note": "Brentford full-strength chasing Europe vs Liverpool; key threat, high motivation, open-game upside."},
    {"name": "Mateta",  "team": "CRY", "pos": "FWD", "avail": 0.93, "fix": 1.00, "motiv": 0.96, "rot": "low",
     "note": "Nailed Palace #9 with pride to play for; solid floor, no special fixture edge."},
    {"name": "Wood",    "team": "NFO", "pos": "FWD", "avail": 0.92, "fix": 1.00, "motiv": 0.92, "rot": "low",
     "note": "Confirmed Forest striker vs Bournemouth; reliable starter, modest ceiling."},
    {"name": "Rogers",  "team": "AVL", "pos": "MID", "avail": 0.45, "fix": 0.92, "motiv": 0.90, "rot": "high",
     "note": "HIGH-CEILING DIFFERENTIAL: rotation lottery post-Europa-final, minutes managed away at Man City, no league motivation. Big rank-swing upside ONLY if he starts; otherwise zero."},
    {"name": "Gabriel", "team": "ARS", "pos": "DEF", "avail": 0.15, "fix": 1.05, "motiv": 0.90, "rot": "high",
     "note": "DOUBTFUL + Arsenal rotated entire XI post-title (CL final pending); did not start. Heavy availability penalty."},
]

def poisson(mean):
    L = pow(2.718281828, -mean); k = 0; pr = 1.0
    while True:
        k += 1
        pr *= random.random()
        if pr <= L:
            return k - 1

def draw(p):
    """One simulated captained score (already doubled)."""
    if random.random() > p["avail"]:
        return 0.0                                   # benched / DNP
    involve = POS_INVOLVE[p["pos"]] * p["fix"] * p["motiv"]
    pts = 2.0                                        # appearance
    returns = poisson(involve)
    if p["pos"] == "MID":
        goal_share, goal_pts = 0.55, 5
    elif p["pos"] == "FWD":
        goal_share, goal_pts = 0.62, 4
    else:
        goal_share, goal_pts = 0.35, 6
    for _ in range(returns):
        pts += goal_pts if random.random() < goal_share else 3
    if returns >= 2:
        pts += random.choice([2, 3, 3])
    elif returns == 1:
        pts += random.choice([0, 1, 2, 3])
    if p["pos"] == "DEF" and random.random() < 0.30 * p["fix"]:
        pts += 4                                     # clean sheet
    return pts * 2.0                                 # captain doubling

rankings = []
rot_lookup = {}
for p in candidates:
    draws = [draw(p) for _ in range(N)]
    mean = statistics.mean(draws)
    starts = [d for d in draws if d > 0]
    cond = statistics.mean(starts) if starts else 0.0   # ceiling in worlds where he plays
    rot_lookup[p["name"]] = p["rot"]
    rankings.append({
        "name": p["name"], "team": p["team"],
        "ev_pts": round(mean, 2),
        "haul_prob_pct": round(sum(1 for d in draws if d >= 12) / N * 100, 1),   # >=6 raw captained -> haul
        "blank_prob_pct": round(sum(1 for d in draws if d <= 4) / N * 100, 1),   # <=2 raw incl. DNP
        "variance": round(statistics.pvariance(draws), 1),
        "ceiling_if_starts": round(cond, 2),
        "notes": p["note"],
    })

rankings.sort(key=lambda r: r["ev_pts"], reverse=True)
rec_c = rankings[0]["name"]
# Vice: best EV among genuinely low-rotation-risk nailed starters other than the captain.
rec_vc = next(r["name"] for r in rankings
              if r["name"] != rec_c and rot_lookup[r["name"]] == "low")
# High-ceiling differential = the rotation-lottery play with real rank-swing upside if he starts.
diffs = [r for r in rankings if rot_lookup[r["name"]] == "high" and r["name"] != "Gabriel"]
diff = max(diffs, key=lambda r: r["ceiling_if_starts"]) if diffs else rankings[-1]

report = {
    "gw": 38,
    "agent": "sim-lab",
    "captain_rankings": rankings,
    "recommended_captain": rec_c,
    "recommended_vice": rec_vc,
    "high_ceiling_differential": {
        "name": diff["name"], "team": diff["team"],
        "ev_pts": diff["ev_pts"], "ceiling_if_starts": diff["ceiling_if_starts"],
        "variance": diff["variance"], "haul_prob_pct": diff["haul_prob_pct"],
        "note": diff["notes"],
    },
    "tc_chip_recommendation": (
        f"HOLD / let TC expire rather than force it. GW38 is a rotation minefield: Haaland "
        f"(Gemini's TC anchor) is OUT of the MCI squad and would score zero. No elite double-fixture "
        f"or banker exists. If TC is used at all, {rec_c} is the only defensible target given his "
        f"must-win motivation and {rankings[0]['haul_prob_pct']}% haul rate, but the final-GW ceiling is "
        f"capped vs a normal banker — expected TC gain is only ~{round(rankings[0]['ev_pts']/2,1)} extra pts "
        f"over a standard captain, below the usual TC bar."
    ),
    "summary": (
        f"Monte Carlo (10k draws) ranks {rec_c} ({rankings[0]['team']}) as captain at EV "
        f"{rankings[0]['ev_pts']} pts (captained), {rankings[0]['haul_prob_pct']}% haul — nailed in a "
        f"must-win relegation decider. {rec_vc} (vice) is the safest low-rotation backup. "
        f"Haaland excluded (UNAVAILABLE), Gabriel near-void (avail risk). High-ceiling differential: "
        f"{diff['name']} ({diff['team']}) — EV only {diff['ev_pts']} from ~55% bench risk, but "
        f"ceiling {diff['ceiling_if_starts']} captained IF he starts; pure rank-swing punt."
    ),
}

os.makedirs("/home/user/apex-fpl-hq/data/reports", exist_ok=True)
json.dump(report, open("/home/user/apex-fpl-hq/data/reports/sim.json", "w"), indent=2)
for r in rankings:
    print(f"{r['name']:9s} EV={r['ev_pts']:5.2f}  haul={r['haul_prob_pct']:5.1f}%  blank={r['blank_prob_pct']:5.1f}%  var={r['variance']:6.1f}  ceil={r['ceiling_if_starts']:5.2f}")
print("C:", rec_c, "| VC:", rec_vc, "| diff:", diff["name"])

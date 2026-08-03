#!/usr/bin/env python3
"""
APEX FPL HQ — Monte Carlo GW1-7: compare teams x strategies, find the best.
Model (per player, per GW):
  ppg      = last-season pts / starts (talent per appearance)
  play     = Bernoulli(0.6 + 0.4*starts/34)               (nailed-ness)
  mult     = (3.3 / eff_fdr)^0.7  clamped [0.75,1.4]       (that GW's fixture, away +0.3)
  points   ~ Gamma(k_pos, mean=ppg*mult)  if plays else 0  (k lower => more boom/bust)
Team GW score = XI draws + auto-sub for non-players (non-BB) OR all-15 (BB),
  plus captain extra (best-mu owned player; x2, or x3 on the TC gameweek).
Runs N sims, reports mean / P10 / P50 / P90 and pairwise win-rate.
"""
import json, random, urllib.request, statistics
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
def get(p):
    r=urllib.request.Request("https://fantasy.premierleague.com/api/"+p,headers={"User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=40))
boot=get("bootstrap-static/"); fx=get("fixtures/")
short={t["id"]:t["short_name"] for t in boot["teams"]}
# per-team fixture (fdr, away?) for GW1-7
fixt={}
for f in fx:
    ev=f.get("event")
    if ev is None or ev>7: continue
    fixt[(short[f["team_h"]],ev)]=(f["team_h_difficulty"],0)
    fixt[(short[f["team_a"]],ev)]=(f["team_a_difficulty"],1)
def mult(team,gw):
    v=fixt.get((team,gw))
    if not v: return 0.9
    eff=v[0]+0.3*v[1]
    return max(0.75,min(1.4,(3.3/eff)**0.7))
K={"GK":4.0,"DEF":3.0,"MID":2.2,"FWD":1.8}

def load(name):
    d=json.load(open(ROOT/f"data/reports/{name}.json"))
    xi=d["xi"]; bench=d["bench"]
    sq=[]
    for grp,is_xi in ((xi,True),(bench,False)):
        for p in grp:
            st=p.get("starts",0) or 0
            ppg=p["pts"]/max(st,1) if st else p["pts"]/38
            sq.append({"name":p["name"],"team":p["team"],"pos":p["pos"],
                       "ppg":min(ppg,9.0),"play":min(0.97,0.60+0.40*st/34),"xi":is_xi})
    return sq

TEAMS={n:load(n) for n in ["bb_gw2_adv","bb_gw2_nohaaland"]}

def draw_gw(sq, gw, rng):
    """return dict name->points for this GW (0 if didn't play)."""
    out={}
    for p in sq:
        if rng.random()>p["play"]: out[p["name"]]=0.0; continue
        mu=p["ppg"]*mult(p["team"],gw)
        k=K[p["pos"]]
        out[p["name"]]=rng.gammavariate(k, mu/k)
    return out

def gw_score(sq, pts, bb, tc, rng):
    xi=[p for p in sq if p["xi"]]; bench=[p for p in sq if not p["xi"]]
    # captain = highest expected (use realised mu proxy = ppg*mult) among XI
    cap=max(xi, key=lambda p: p["ppg"]*mult(p["team"],GW_CTX[0]))
    cmul=3 if tc else 2
    if bb:
        base=sum(pts[p["name"]] for p in sq)          # all 15 count
    else:
        s=0; subs=sorted([b for b in bench if b["pos"]!="GK"], key=lambda b:-b["ppg"])
        used=0
        for p in xi:
            v=pts[p["name"]]
            if v==0 and p["pos"]!="GK" and used<len(subs):   # auto-sub a non-playing outfielder
                v=pts[subs[used]["name"]]; used+=1
            s+=v
        base=s
    return base + pts[cap["name"]]*(cmul-1)

def gw_score2(sq, pts, gw, bb, tc):
    xi=[p for p in sq if p["xi"]]; bench=[p for p in sq if not p["xi"]]
    cap=max(xi, key=lambda p: p["ppg"]*mult(p["team"],gw))
    cmul=3 if tc else 2
    if bb:
        base=sum(pts[p["name"]] for p in sq)
    else:
        subs=sorted([b for b in bench if b["pos"]!="GK"], key=lambda b:-b["ppg"]); used=0; s=0
        for p in xi:
            v=pts[p["name"]]
            if v==0 and p["pos"]!="GK" and used<len(subs):
                v=pts[subs[used]["name"]]; used+=1
            s+=v
        base=s
    return base + pts[cap["name"]]*(cmul-1)

# union of all players (common random numbers across strategies)
UNION={}
for sq in TEAMS.values():
    for p in sq: UNION[(p["name"],p["team"],p["pos"])]=p

def simulate_all(strats, N=5000, seed=42):
    rng=random.Random(seed)
    tot={n:[] for n in strats}
    for _ in range(N):
        run={n:0.0 for n in strats}
        for gw in range(1,8):
            # draw every union player ONCE this GW (shared)
            pts={}
            for (nm,team,pos),p in UNION.items():
                if rng.random()>p["play"]: pts[nm]=0.0
                else:
                    mu=p["ppg"]*mult(team,gw); k=K[pos]
                    pts[nm]=rng.gammavariate(k,mu/k)
            for n,fn in strats.items():
                sqn,bb,tc=fn(gw)
                run[n]+=gw_score2(TEAMS[sqn],pts,gw,bb,tc)
        for n in strats: tot[n].append(run[n])
    out={}
    for n,tl in tot.items():
        s=sorted(tl)
        out[n]={"mean":statistics.mean(s),"p10":s[int(.10*N)],"p50":s[int(.50*N)],
                "p90":s[int(.90*N)],"raw":tl}
    return out

# ---- strategy defs: gw -> (squad, BB?, TC?) ----
def S1(gw): return ("bb_gw2_adv",         gw==2, gw==7)   # Haaland-anchor + BB2 + TC7
def S2(gw): return (("bb_gw2_nohaaland" if gw<7 else "bb_gw2_adv"), gw==2, gw==7)  # no-Haaland ->reshape GW7 +TC7
def S3(gw): return ("bb_gw2_nohaaland",   gw==2, False)   # no-Haaland + BB2, save TC
def S4(gw): return ("bb_gw2_adv",         gw==2, False)   # Haaland + BB2, save TC
def S5(gw): return ("bb_gw2_adv",         False, False)   # Haaland, no chips (baseline)

STRATS={
 "S1 Haaland+BB2+TC7":       S1,
 "S2 NoHaaland->GW7+BB2+TC7":S2,
 "S3 NoHaaland+BB2 (saveTC)":S3,
 "S4 Haaland+BB2 (saveTC)":  S4,
 "S5 Haaland no-chips":      S5,
}
N=6000
res=simulate_all(STRATS,N=N,seed=42)
order=sorted(res, key=lambda n:-res[n]["mean"])
print(f"=== Monte Carlo GW1-7  (N={N} sims, common random numbers) ===")
print(f"{'strategy':30s}{'mean':>7s}{'P10':>7s}{'P50':>7s}{'P90':>7s}{'ceiling':>8s}")
for n in order:
    r=res[n]; print(f"{n:30s}{r['mean']:>7.1f}{r['p10']:>7.0f}{r['p50']:>7.0f}{r['p90']:>7.0f}{r['p90']-r['p10']:>8.0f}")
best=order[0]
print(f"\nP({best.split()[0]} beats X)  [paired sims]:")
for n in order[1:]:
    a=res[best]["raw"]; b=res[n]["raw"]
    wins=sum(1 for x,y in zip(a,b) if x>y)/N
    print(f"  vs {n:30s} {wins*100:.0f}%")
json.dump({n:{k:r[k] for k in ('mean','p10','p50','p90')} for n,r in res.items()},
          open(ROOT/"data/reports/montecarlo_gw1_7.json","w"),indent=2)

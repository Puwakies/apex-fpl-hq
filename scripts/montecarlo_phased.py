#!/usr/bin/env python3
"""
APEX FPL HQ — Monte Carlo GW3-12: BALANCED-PHASED vs LOCK-4 (captain matrix).
Same captain matrix for both (Haaland odd GWs / Bruno GW6,8,12 / Palmer GW4 / ARS GW10).

  LOCK4      — WC GW3 fab-four (Haaland+Bruno+Palmer+Saka from GW3), cheap D/bench.
               GW10 captain = Saka (owned, £9.5).
  BAL(fund)  — balanced GW3 (Haaland+Palmer + strong D), phase premiums in:
               GW6  −Gibbs-White +Bruno  AND  −Virgil +cheapDEF (£4.5) to FUND Bruno.
               GW10 −Anderson +Tzolis.   GW10 captain = Tzolis (owned, £6.5).
  BAL(pure)  — same phasing but WITHOUT the Virgil funding downgrade (optimistic bound).

Engine = montecarlo_wc3: team-correlated match shock (concentrated squads blank together),
Gamma per player, bench autosubs, captain ×2. Captain is FORCED by the matrix (not model).
Early 26/27 => ppg from last-season pts/38 (live totals ~0). Output: montecarlo_phased.json
"""
import json, random, statistics, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def get(p):
    r=urllib.request.Request("https://fantasy.premierleague.com/api/"+p,headers={"User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=40))
boot=get("bootstrap-static/"); fx=get("fixtures/")
short={t["id"]:t["short_name"] for t in boot["teams"]}
elem={(e["web_name"],short[e["team"]]):e for e in boot["elements"]}

FX={}
for f in fx:
    ev=f.get("event")
    if ev is None or ev<3 or ev>12: continue
    FX[(short[f["team_h"]],ev)]=(f["team_h_difficulty"],0)
    FX[(short[f["team_a"]],ev)]=(f["team_a_difficulty"],1)
def mult(team,gw):
    v=FX.get((team,gw))
    if not v: return 0.9
    return max(0.75,min(1.4,(3.3/(v[0]+0.3*v[1]))**0.7))

K={"GK":4.0,"DEF":3.0,"MID":2.2,"FWD":1.8}; kT=4.0

def mkp(name,team,pos,pts,xi):
    e=elem.get((name,team)); st=(e.get("starts",0) or 0) if e else 0
    ppg=(e["total_points"]/max(st,1)) if (e and st) else pts/38
    return {"name":name,"team":team,"pos":pos,"xi":xi,
            "ppg":min(ppg,9.0),"nail":min(0.97,0.60+0.40*st/34),"k":K[pos]}

def load(fnm):
    d=json.load(open(ROOT/f"data/reports/{fnm}.json")); sq=[]
    for grp,xi in ((d["xi"],True),(d["bench"],False)):
        for p in grp: sq.append(mkp(p["name"],p["team"],p["pos"],p.get("pts",40),xi))
    return sq

# added players (last-season pts; Tzolis was abroad 25/26 -> conservative estimate)
BRUNO=mkp("B.Fernandes","MUN","MID",235,True)
TZOLIS=mkp("Tzolis","ARS","MID",120,True)          # punt: no PL history, est. ppg~3.2
CHEAPDEF=mkp("_cheapDEF","MCI","DEF",100,True)     # £4.5 nailed-ish def (funds Bruno via Virgil sale)
# note CHEAPDEF team set to a filler; its shock just needs to exist in the universe

LOCK4=load("wc_gw3_captain_matrix")   # fab-four, fixed all GWs
BAL0 =load("wc_gw3_balanced")         # balanced GW3 base

def swap(sq, out_name, newp):
    """return copy of sq with out_name replaced by newp (inherits xi flag)."""
    out=[p for p in sq if p["name"]==out_name][0]
    np=dict(newp); np["xi"]=out["xi"]
    return [np if p["name"]==out_name else p for p in sq]

# BAL phased squads
def bal_fund(gw):
    sq=[dict(p) for p in BAL0]
    if gw>=6:
        sq=swap(sq,"Gibbs-White",BRUNO)
        sq=swap(sq,"Virgil",CHEAPDEF)     # funding downgrade
    if gw>=10:
        sq=swap(sq,"Anderson",TZOLIS)
    return sq
def bal_pure(gw):
    sq=[dict(p) for p in BAL0]
    if gw>=6: sq=swap(sq,"Gibbs-White",BRUNO)
    if gw>=10: sq=swap(sq,"Anderson",TZOLIS)
    return sq
def lock4(gw): return [dict(p) for p in LOCK4]

# captain matrix
def cap_key(team_variant, gw):
    m={3:("Haaland","MCI"),4:("Palmer","CHE"),5:("Haaland","MCI"),6:("B.Fernandes","MUN"),
       7:("Haaland","MCI"),8:("B.Fernandes","MUN"),9:("Haaland","MCI"),
       11:("Haaland","MCI"),12:("B.Fernandes","MUN")}
    if gw==10:
        return ("Saka","ARS") if team_variant=="LOCK4" else ("Tzolis","ARS")
    return m[gw]

STRATS={  # name -> (squad_fn, variant_tag)
 "LOCK4 (fab-four, Saka@10)":     (lock4,   "LOCK4"),
 "BAL fund (Bruno@6 Tzolis@10)":  (bal_fund,"BAL"),
 "BAL pure (no funding cost)":    (bal_pure,"BAL"),
}

def score(sq,gw,pts,played,cap):
    xi=[p for p in sq if p["xi"]]; bench=[p for p in sq if not p["xi"]]
    def V(p): return pts.get((p["name"],p["team"]),0.0)
    subs=sorted([b for b in bench if b["pos"]!="GK"],key=lambda b:-b["ppg"]); used=0; s=0.0
    for p in xi:
        if played.get((p["name"],p["team"])): s+=V(p)
        elif p["pos"]!="GK" and used<len(subs):
            sb=subs[used]; used+=1
            if played.get((sb["name"],sb["team"])): s+=V(sb)
    if played.get(cap): s+=pts.get(cap,0.0)   # captain doubles (×2 => +1 extra)
    return s

def simulate(N=6000,seed=7):
    rng=random.Random(seed)
    union={}
    for fn,_ in STRATS.values():
        for gw in range(3,13):
            for p in fn(gw): union[(p["name"],p["team"])]=p
    teams=list({t for (_,t) in union})
    tot={n:[] for n in STRATS}; split={n:{"early":[],"late":[]} for n in STRATS}
    for _ in range(N):
        run={n:0.0 for n in STRATS}; ear={n:0.0 for n in STRATS}; lat={n:0.0 for n in STRATS}
        for gw in range(3,13):
            tshock={t:rng.gammavariate(kT,1.0/kT) for t in teams}
            pts={}; played={}
            for key,p in union.items():
                pl=rng.random()<=p["nail"]; played[key]=pl
                mu=max(0.05,p["ppg"]*mult(p["team"],gw)*tshock[p["team"]])
                pts[key]=rng.gammavariate(p["k"], mu/p["k"]) if pl else 0.0
            for n,(fn,var) in STRATS.items():
                sc=score(fn(gw),gw,pts,played,cap_key(var,gw))
                run[n]+=sc
                if gw<=5: ear[n]+=sc
                else:     lat[n]+=sc
        for n in STRATS:
            tot[n].append(run[n]); split[n]["early"].append(ear[n]); split[n]["late"].append(lat[n])
    out={}
    for n,tl in tot.items():
        s=sorted(tl)
        out[n]={"mean":statistics.mean(s),"p10":s[int(.1*N)],"p50":s[int(.5*N)],"p90":s[int(.9*N)],
                "early_mean":statistics.mean(split[n]["early"]),"late_mean":statistics.mean(split[n]["late"]),
                "std":statistics.pstdev(s),"raw":tl}
    return out

N=6000; res=simulate(N=N)
order=sorted(res,key=lambda n:-res[n]["mean"])
print(f"=== MC GW3-12  (N={N}, captain matrix forced, team-correlated shocks, no TC) ===")
print(f"{'strategy':30s}{'mean':>7s}{'GW3-5':>7s}{'GW6-12':>8s}{'P10':>6s}{'P50':>6s}{'P90':>6s}{'std':>6s}")
for n in order:
    r=res[n]
    print(f"{n:30s}{r['mean']:>7.0f}{r['early_mean']:>7.0f}{r['late_mean']:>8.0f}{r['p10']:>6.0f}{r['p50']:>6.0f}{r['p90']:>6.0f}{r['std']:>6.0f}")
base="LOCK4 (fab-four, Saka@10)"
print(f"\nhead-to-head vs {base} (paired sims, GW3-12 total):")
for n in order:
    if n==base: continue
    w=sum(1 for x,y in zip(res[n]['raw'],res[base]['raw']) if x>y)/N
    d=res[n]['mean']-res[base]['mean']
    print(f"  {n:30s} P(beat LOCK4)={w*100:4.0f}%   Δmean={d:+.1f}")
# GW3-5 ceiling comparison (the tradeoff the user asked about)
print(f"\nGW3-5 'ceiling' (early_mean, the window BAL sacrifices):")
for n in order: print(f"  {n:30s} {res[n]['early_mean']:.1f}")
json.dump({n:{k:round(res[n][k],1) for k in ('mean','early_mean','late_mean','p10','p50','p90','std')} for n in res},
          open(ROOT/"data/reports/montecarlo_phased.json","w"),indent=2)
print("\nsaved -> data/reports/montecarlo_phased.json")

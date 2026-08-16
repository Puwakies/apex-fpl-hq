#!/usr/bin/env python3
"""
APEX FPL HQ — Monte Carlo GW3-7 for the WC-GW3 plan.
Compares the DIVERSIFIED + attacking-DEF team vs the ORIGINAL team, and tests the
FT-swap timing (bank->swap CVL@GW6 vs swap@GW4 vs no-swap), all with TC Haaland@GW7.

Two model upgrades the user asked for:
  (1) TEAM-CORRELATED match shock: each (team,GW) draws ONE shared shock ~Gamma(kT)
      applied to every player of that club. => a squad concentrated in few clubs has
      correlated blanks (higher variance); a diversified squad averages the noise out.
      This is what makes "spread the risk" actually score in the sim.
  (2) ATTACKING-DEFENDER ceiling: fullbacks/wingbacks pushed forward (Hume-type) get a
      small mu bump + LOWER k (fatter goal/assist upside) on top of clean sheets.

Per player/GW: play~Bernoulli(nailed); pts~Gamma(k_pos, mean=ppg*fdr_mult*team_shock).
Common random numbers: one shared points dict per GW drives every strategy. N sims.
Output: data/reports/montecarlo_wc3.json
"""
import json, random, urllib.request, statistics
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
    if ev is None or ev<3 or ev>7: continue
    FX[(short[f["team_h"]],ev)]=(f["team_h_difficulty"],0)
    FX[(short[f["team_a"]],ev)]=(f["team_a_difficulty"],1)
def mult(team,gw):
    v=FX.get((team,gw))
    if not v: return 0.9
    return max(0.75,min(1.4,(3.3/(v[0]+0.3*v[1]))**0.7))

# attacking-DEF z-index from live boot (same formula as the builder)
def _z(vals):
    m=statistics.mean(vals); s=statistics.pstdev(vals) or 1.0; return m,s
_de=[e for e in boot["elements"] if e["element_type"]==2 and (e.get("starts",0) or 0)>=10]
def _x90(e): return (float(e.get("expected_goal_involvements",0) or 0)/max(e.get("minutes",0) or 1,1))*90
mt,st_=_z([float(e.get("threat",0) or 0) for e in _de])
mc,sc =_z([float(e.get("creativity",0) or 0) for e in _de])
mx,sx =_z([_x90(e) for e in _de])
def atkz(nm,tm):
    e=elem.get((nm,tm))
    if not e or e["element_type"]!=2: return 0.0
    return (float(e.get("threat",0) or 0)-mt)/st_+(float(e.get("creativity",0) or 0)-mc)/sc+(_x90(e)-mx)/sx

K={"GK":4.0,"DEF":3.0,"MID":2.2,"FWD":1.8}
K_ATKDEF=2.4   # attacking DEF: fatter tail (goal/assist spikes on top of clean sheets)
kT=4.0         # team-shock concentration (higher => weaker team correlation)

def mkp(p):
    e=elem.get((p["name"],p["team"]))
    st=(e.get("starts",0) or 0) if e else 0
    ppg=(e["total_points"]/max(st,1)) if (e and st) else p.get("pts",40)/38
    z=atkz(p["name"],p["team"]); is_atk=(p["pos"]=="DEF" and z>=1.0)
    return {"name":p["name"],"team":p["team"],"pos":p["pos"],"xi":p.get("xi",True),
            "ppg":min(ppg,9.0),"nail":min(0.97,0.60+0.40*st/34),
            "k":(K_ATKDEF if is_atk else K[p["pos"]]),
            "mub":(1.0+0.03*min(4.0,max(0.0,z)) if is_atk else 1.0),"atk":is_atk}

def load(name):
    d=json.load(open(ROOT/f"data/reports/{name}.json")); sq=[]
    for grp,xi in ((d["xi"],True),(d["bench"],False)):
        for p in grp: q=dict(p); q["xi"]=xi; sq.append(mkp(q))
    return sq

DIV=load("wc_gw3_div"); ORIG=load("wc_gw3_final")
PREM4=load("wc_gw3_prem4"); PREM=load("wc_gw3_prem")   # no-Bruno premium-mid variants
_w=elem[("Woltemade","NEW")]; _wst=_w.get("starts",0) or 0
WOLT={"name":"Woltemade","team":"NEW","pos":"FWD","xi":True,
      "ppg":min(_w["total_points"]/max(_wst,1),9.0),"nail":min(0.97,0.60+0.40*_wst/34),
      "k":K["FWD"],"mub":1.0,"atk":False}
def apply_swap(sq): return [WOLT if p["name"]=="Calvert-Lewin" else p for p in sq]

def score(sq,gw,pts,played,tc):
    xi=[p for p in sq if p["xi"]]; bench=[p for p in sq if not p["xi"]]
    def V(p): return pts[(p["name"],p["team"])]
    cap=max(xi,key=lambda p:p["ppg"]*mult(p["team"],gw))
    subs=sorted([b for b in bench if b["pos"]!="GK"],key=lambda b:-b["ppg"]); used=0; s=0.0
    for p in xi:
        if played[(p["name"],p["team"])]: s+=V(p)
        elif p["pos"]!="GK" and used<len(subs):
            sb=subs[used]; used+=1
            if played[(sb["name"],sb["team"])]: s+=V(sb)
    cmul=3 if tc else 2
    if played[(cap["name"],cap["team"])]: s+=V(cap)*(cmul-1)
    return s

def simulate(strats,N=6000,seed=7):
    rng=random.Random(seed)
    union={}
    for sq in (DIV,ORIG,PREM4,PREM,[WOLT]):
        for p in sq: union[(p["name"],p["team"])]=p
    teams=list({t for (_,t) in union})
    tot={n:[] for n in strats}
    for _ in range(N):
        run={n:0.0 for n in strats}
        for gw in range(3,8):
            tshock={t:rng.gammavariate(kT,1.0/kT) for t in teams}   # shared team match shock
            pts={}; played={}
            for key,p in union.items():
                pl=rng.random()<=p["nail"]; played[key]=pl
                if not pl: pts[key]=0.0
                else:
                    mu=p["ppg"]*p["mub"]*mult(p["team"],gw)*tshock[p["team"]]
                    pts[key]=rng.gammavariate(p["k"], mu/p["k"])
            for n,fn in strats.items():
                sqn,tc=fn(gw); run[n]+=score(sqn,gw,pts,played,tc)
        for n in strats: tot[n].append(run[n])
    out={}
    for n,tl in tot.items():
        s=sorted(tl); out[n]={"mean":statistics.mean(s),"p10":s[int(.10*N)],"p50":s[int(.5*N)],
                              "p90":s[int(.9*N)],"raw":tl}
    return out

def S_div(gw):   return (apply_swap(DIV)  if gw>=6 else DIV),  (gw==7)   # Bruno-locked (winner so far)
def S_prem4(gw): return (apply_swap(PREM4) if gw>=6 else PREM4),(gw==7)  # no-Bruno, Semenyo 4-4-2
def S_prem(gw):  return (apply_swap(PREM) if gw>=6 else PREM), (gw==7)   # no-Bruno, 5-3-2 premium DEF
def S_orig(gw):  return (apply_swap(ORIG) if gw>=6 else ORIG), (gw==7)
STRATS={
 "DIV (Bruno) bank->swap6":     S_div,
 "PREM4 (Semenyo 4mid) swap6":  S_prem4,
 "PREM (Semenyo 5-3-2) swap6":  S_prem,
 "ORIG (Bruno) swap6":          S_orig,
}
N=6000
res=simulate(STRATS,N=N,seed=7)
order=sorted(res,key=lambda n:-res[n]["mean"])
print(f"=== Monte Carlo GW3-7  (N={N}, team-correlated shocks + attacking-DEF ceiling) ===")
print(f"{'strategy':26s}{'mean':>7s}{'P10':>7s}{'P50':>7s}{'P90':>7s}{'range':>7s}")
for n in order:
    r=res[n]; print(f"{n:26s}{r['mean']:>7.1f}{r['p10']:>7.0f}{r['p50']:>7.0f}{r['p90']:>7.0f}{r['p90']-r['p10']:>7.0f}")
best=order[0]
print(f"\nwin-rate of [{best}] (paired sims):")
for n in order[1:]:
    a=res[best]["raw"]; b=res[n]["raw"]; w=sum(1 for x,y in zip(a,b) if x>y)/N
    print(f"  vs {n:26s} {w*100:.0f}%")
# diversity variance check: std of each team
print("\nvariance (std of GW3-7 total):")
for n in order:
    print(f"  {n:26s} std={statistics.pstdev(res[n]['raw']):.1f}")
json.dump({n:{k:round(r[k],1) for k in ('mean','p10','p50','p90')} for n,r in res.items()},
          open(ROOT/"data/reports/montecarlo_wc3.json","w"),indent=2)
print("\nsaved -> data/reports/montecarlo_wc3.json")

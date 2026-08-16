#!/usr/bin/env python3
"""
APEX FPL HQ — RANK-vs-TEMPLATE Monte Carlo (GW3-7).
Raw points said NOHAA wins. Rank is measured vs the FIELD, so we build an explicit
TEMPLATE manager (owns the most-owned XI, CAPTAINS Haaland, TC Haaland @GW7 — the
popular spots) and score each of my teams as (my_score − field_score) per GW, common RNG.

Green arrow  = my_score > field_score (I climb rank that week/window).
The Haaland tax is now real: on a Haaland-haul week the field triples him and my
NOHAA team (fading him) drops well below the field; PREM owns+captains him and rides along.

Variants:
  PREM        — owns Haaland, TC Haaland @GW7
  NOHAA TC7   — fades Haaland, Bruno captain, TC Bruno @GW7 (away vs LEE, weak)
  NOHAA TC14  — fades Haaland, NO TC in window (banked for GW14 Bruno H vs COV)
Reports mean/P10/P90 of (my−field), P(green), P(big red < −15). TC@GW14 value added separately.
Output: data/reports/montecarlo_rank.json
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
POSm={1:"GK",2:"DEF",3:"MID",4:"FWD"}

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

def _z(vals):
    m=statistics.mean(vals); s=statistics.pstdev(vals) or 1.0; return m,s
_de=[e for e in boot["elements"] if e["element_type"]==2 and (e.get("starts",0) or 0)>=10]
def _x90(e): return (float(e.get("expected_goal_involvements",0) or 0)/max(e.get("minutes",0) or 1,1))*90
mt,st_=_z([float(e.get("threat",0) or 0) for e in _de])
mc,sc =_z([float(e.get("creativity",0) or 0) for e in _de])
mx,sx =_z([_x90(e) for e in _de])
def atkz(e):
    if e["element_type"]!=2: return 0.0
    return (float(e.get("threat",0) or 0)-mt)/st_+(float(e.get("creativity",0) or 0)-mc)/sc+(_x90(e)-mx)/sx
K={"GK":4.0,"DEF":3.0,"MID":2.2,"FWD":1.8}; K_ATKDEF=2.4; kT=4.0

def model(e):
    st=e.get("starts",0) or 0; pos=POSm[e["element_type"]]
    ppg=e["total_points"]/max(st,1) if st else e["total_points"]/38
    z=atkz(e); is_atk=(pos=="DEF" and z>=1.0)
    return {"name":e["web_name"],"team":short[e["team"]],"pos":pos,"ppg":min(ppg,9.0),
            "nail":min(0.97,0.60+0.40*st/34),"k":(K_ATKDEF if is_atk else K[pos]),
            "mub":(1.0+0.03*min(4.0,max(0.0,z)) if is_atk else 1.0)}

def load(name):
    d=json.load(open(ROOT/f"data/reports/{name}.json")); sq=[]
    for grp,xi in ((d["xi"],True),(d["bench"],False)):
        for p in grp:
            e=elem.get((p["name"],p["team"]))
            if e: m=model(e); m["xi"]=xi; sq.append(m)
    return sq
PREM=load("wc_gw3_prem"); NOHAA=load("wc_gw3_nohaa_bruno")

# TEMPLATE / field XI = most-owned valid XI, captain Haaland
def T(nm,tm): return model(elem[(nm,tm)])
TEMPLATE=[T("Raya","ARS"), T("Gabriel","ARS"),T("Shaw","MUN"),T("Pedro Porro","TOT"),T("Calafiori","ARS"),
          T("B.Fernandes","MUN"),T("Szoboszlai","LIV"),T("Mbeumo","MUN"),T("Semenyo","MCI"),
          T("Haaland","MCI"),T("João Pedro","CHE")]
for p in TEMPLATE: p["xi"]=True
HAA=("Haaland","MCI")

def draw(gw,rng,uni,tshock):
    pts={}; played={}
    for key,p in uni.items():
        pl=rng.random()<=p["nail"]; played[key]=pl
        mu=max(0.05,p["ppg"]*p["mub"]*mult(p["team"],gw)*tshock[p["team"]])
        pts[key]=0.0 if not pl else rng.gammavariate(p["k"], mu/p["k"])
    return pts,played

def score(sq,gw,pts,played,cap_key,tc):
    xi=[p for p in sq if p["xi"]]; bench=[p for p in sq if not p["xi"]]
    def V(p): return pts[(p["name"],p["team"])]
    subs=sorted([b for b in bench if b["pos"]!="GK"],key=lambda b:-b["ppg"]); used=0; s=0.0
    for p in xi:
        k=(p["name"],p["team"])
        if played[k]: s+=V(p)
        elif p["pos"]!="GK" and used<len(subs):
            sb=subs[used]; used+=1
            if played[(sb["name"],sb["team"])]: s+=V(sb)
    if played.get(cap_key): s+=pts[cap_key]*((3 if tc else 2)-1)
    return s

def cap_of(sq,gw):
    c=max([p for p in sq if p["pos"]!="GK"],key=lambda p:p["ppg"]*mult(p["team"],gw)); return (c["name"],c["team"])

def sim(N=8000,seed=11):
    rng=random.Random(seed)
    uni={}
    for sq in (PREM,NOHAA,TEMPLATE):
        for p in sq: uni[(p["name"],p["team"])]=p
    tset=list({t for (_,t) in uni})
    variants={"PREM (owns Haaland)":[],"NOHAA TC7":[],"NOHAA TC14 (defer)":[]}
    for _ in range(N):
        acc={k:0.0 for k in variants}
        for gw in range(3,8):
            tshock={t:rng.gammavariate(kT,1.0/kT) for t in tset}
            pts,played=draw(gw,rng,uni,tshock)
            field=score(TEMPLATE,gw,pts,played,HAA,tc=(gw==7))               # field: (C)Haaland, TC@7
            prem =score(PREM,gw,pts,played,cap_of(PREM,gw),tc=(gw==7))       # PREM owns Haaland; TC@7
            ncap =cap_of(NOHAA,gw)
            n7   =score(NOHAA,gw,pts,played,ncap,tc=(gw==7))                 # NOHAA TC Bruno @7
            n14  =score(NOHAA,gw,pts,played,ncap,tc=False)                   # NOHAA no TC in window
            acc["PREM (owns Haaland)"]+=prem-field
            acc["NOHAA TC7"]+=n7-field
            acc["NOHAA TC14 (defer)"]+=n14-field
        for k in variants: variants[k].append(acc[k])
    out={}
    for k,v in variants.items():
        s=sorted(v)
        out[k]={"mean":statistics.mean(s),"p10":s[int(.1*N)],"p50":s[int(.5*N)],"p90":s[int(.9*N)],
                "p_green":sum(1 for x in s if x>0)/N,"p_bigred":sum(1 for x in s if x<-15)/N,"raw":v}
    return out

N=8000; res=sim(N=N)
print(f"=== RANK vs TEMPLATE (my_score − field_score) GW3-7, N={N} ===")
print("field = most-owned XI, (C)Haaland, TC Haaland@GW7.  >0 = beat the field (green)\n")
print(f"{'variant':22s}{'mean':>7s}{'P10':>7s}{'P50':>7s}{'P90':>7s}{'P(green)':>9s}{'P(<-15)':>9s}")
for k in ("PREM (owns Haaland)","NOHAA TC7","NOHAA TC14 (defer)"):
    r=res[k]; print(f"{k:22s}{r['mean']:>7.1f}{r['p10']:>7.0f}{r['p50']:>7.0f}{r['p90']:>7.0f}{r['p_green']*100:>8.0f}%{r['p_bigred']*100:>8.0f}%")
# head-to-head PREM vs NOHAA on rank
a=res["PREM (owns Haaland)"]["raw"]; b=res["NOHAA TC7"]["raw"]
print(f"\nP(PREM beats field by more than NOHAA) = {sum(1 for x,y in zip(a,b) if x>y)/N*100:.0f}%")

# ---- TC timing: Bruno TC value GW7 (A vs LEE) vs GW14 (H vs COV) ----
bru=elem[("B.Fernandes","MUN")]; bppg=bru["total_points"]/max(bru.get("starts",1),1)
m7=mult("MUN",7)                                  # GW7 MUN away LEE (fdr3)
m14=max(0.75,min(1.4,(3.3/2.0)**0.7))             # GW14 MUN home COV (fdr2)
print(f"\n=== TC timing for Bruno (no-Haaland) — extra pts from the 3rd multiple ===")
print(f"  TC@GW7  Bruno A vs LEE (fdr3): +{bppg*m7:.1f} exp  (mult {m7:.2f})")
print(f"  TC@GW14 Bruno H vs COV (fdr2): +{bppg*m14:.1f} exp  (mult {m14:.2f})")
print(f"  => deferring TC 7->14 gains ~+{bppg*m14-bppg*m7:.1f} exp pts on the chip (before COV soft-fixture upside)")
json.dump({k:{kk:round(res[k][kk],1) for kk in ('mean','p10','p50','p90','p_green','p_bigred')} for k in res},
          open(ROOT/"data/reports/montecarlo_rank.json","w"),indent=2)
print("\nsaved -> data/reports/montecarlo_rank.json")

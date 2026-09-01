#!/usr/bin/env python3
"""
APEX FPL HQ — FINAL confirmation MC (GW3-12) for wc_gw3_final (Raya GK, 3-5-2, phased).
Compares vs LOCK4 fab-four (same form-blend basis) and a TEMPLATE/field manager.

  FINAL   — Raya+Haaland+Palmer spine; phase Bruno in @GW6 (−Anderson, +funding
            downgrade Gomez→£4.5); GW10 keeps team, captains Bruno (no ARS punt).
            captain matrix: Haaland odd / Bruno 6,8,10,12 / Palmer 4.
  FINALp  — same but WITHOUT the Gomez funding downgrade (optimistic bound).
  LOCK4   — fab-four fixed all GWs (form-blend), captain matrix (Saka@10).
  FIELD   — most-owned template, captains Haaland EVERY GW (the naive default).

Engine: team-correlated shocks + Gamma + autosubs; captain forced. Early season =>
ppg from last-season pts/38 (only ~2 GW played). +TC@GW7 (Haaland ×3) variant.
Output: data/reports/montecarlo_final.json
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
feat={(p["web_name"],p["team"]):p for p in json.load(open(ROOT/"data/features.json"))["players"]}
GW_EL=sum(1 for e in boot["events"] if e.get("finished") or e.get("data_checked"))  or 2
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

def blended_pts(name,team,fallback=110):
    last=feat.get((name,team),{}).get("pts",fallback)
    e=elem.get((name,team)); std=(e["total_points"] if e else 0) or 0
    return 0.7*last+0.3*min(260,std/GW_EL*38)

def mkp(name,team,pos,pts,xi,key=None):
    e=elem.get((name,team)); st=(e.get("starts",0) or 0) if e else 0
    nail=min(0.97,0.72+0.25*min(st,34)/34.0)
    return {"name":name,"team":team,"pos":pos,"xi":xi,"key":key or (name,team),
            "ppg":min(pts/38.0,9.0),"nail":nail,"k":K[pos]}

def load(fnm):
    d=json.load(open(ROOT/f"data/reports/{fnm}.json")); sq=[]
    for grp,xi in ((d["xi"],True),(d["bench"],False)):
        for p in grp: sq.append(mkp(p["name"],p["team"],p["pos"],p.get("pts",40),xi))
    return sq
FINAL0=load("wc_gw3_final"); LOCK4=load("wc_gw3_lock4_form")
BRUNO=mkp("B.Fernandes","MUN","MID",blended_pts("B.Fernandes","MUN"),True)
CHEAPMID=mkp("_cheapMID","BOU","MID",110,True,key=("_cheapMID","BOU"))

# FIELD / template: most-owned, cap Haaland every GW
FIELD=[("Raya","ARS","GK"),("Calafiori","ARS","DEF"),("Gabriel","ARS","DEF"),("Guéhi","MCI","DEF"),
       ("B.Fernandes","MUN","MID"),("Semenyo","MCI","MID"),("Mbeumo","MUN","MID"),("Palmer","CHE","MID"),("Saka","ARS","MID"),
       ("Haaland","MCI","FWD"),("João Pedro","CHE","FWD")]
FIELD=[mkp(n,t,p,blended_pts(n,t),True) for n,t,p in FIELD]

def swap(sq,out_name,newp):
    out=[p for p in sq if p["name"]==out_name][0]; np=dict(newp); np["xi"]=out["xi"]
    return [np if p["name"]==out_name else p for p in sq]
def final_sq(gw, fund=True):
    sq=[dict(p) for p in FINAL0]
    if gw>=6:
        sq=swap(sq,"Anderson",BRUNO)
        if fund: sq=swap(sq,"Gomez",CHEAPMID)
    return sq
def lock4_sq(gw): return [dict(p) for p in LOCK4]
def field_sq(gw): return [dict(p) for p in FIELD]

MATRIX={3:("Haaland","MCI"),4:("Palmer","CHE"),5:("Haaland","MCI"),6:("B.Fernandes","MUN"),
        7:("Haaland","MCI"),8:("B.Fernandes","MUN"),9:("Haaland","MCI"),10:("B.Fernandes","MUN"),
        11:("Haaland","MCI"),12:("B.Fernandes","MUN")}
def cap_final(gw): return MATRIX[gw]
def cap_lock4(gw): return ("Saka","ARS") if gw==10 else MATRIX[gw]
def cap_field(gw): return ("Haaland","MCI")           # naive: always Haaland

def score(sq,gw,pts,played,cap,tc_gw):
    xi=[p for p in sq if p["xi"]]; bench=[p for p in sq if not p["xi"]]
    def V(p): return pts.get(p["key"],0.0)
    subs=sorted([b for b in bench if b["pos"]!="GK"],key=lambda b:-b["ppg"]); used=0; s=0.0
    for p in xi:
        if played.get(p["key"]): s+=V(p)
        elif p["pos"]!="GK" and used<len(subs):
            sb=subs[used]; used+=1
            if played.get(sb["key"]): s+=V(sb)
    if played.get(cap): s+=pts.get(cap,0.0)*((3 if gw==tc_gw else 2)-1)
    return s

STR={"FINAL (Raya, phased)":(final_sq,cap_final,True),
     "FINALp (no fund cost)":(lambda g:final_sq(g,False),cap_final,False),
     "LOCK4 (fab-four)":(lock4_sq,cap_lock4,False),
     "FIELD (template, capHaa)":(field_sq,cap_field,False)}

def sim(tc_gw=None,N=6000,seed=7):
    rng=random.Random(seed); uni={}
    for fn,_,_ in STR.values():
        for gw in range(3,13):
            for p in fn(gw): uni[p["key"]]=p
    teams=list({p["team"] for p in uni.values()})
    tot={n:[] for n in STR}
    for _ in range(N):
        run={n:0.0 for n in STR}
        for gw in range(3,13):
            tshock={t:rng.gammavariate(kT,1.0/kT) for t in teams}
            pts={}; played={}
            for key,p in uni.items():
                pl=rng.random()<=p["nail"]; played[key]=pl
                mu=max(0.05,p["ppg"]*mult(p["team"],gw)*tshock[p["team"]])
                pts[key]=rng.gammavariate(p["k"], mu/p["k"]) if pl else 0.0
            for n,(fn,cap,_) in STR.items():
                run[n]+=score(fn(gw),gw,pts,played,cap(gw),tc_gw)
        for n in STR: tot[n].append(run[n])
    out={}
    for n,tl in tot.items():
        s=sorted(tl)
        out[n]={"mean":statistics.mean(s),"p10":s[int(.1*N)],"p50":s[int(.5*N)],"p90":s[int(.9*N)],"std":statistics.pstdev(s),"raw":tl}
    return out

N=6000
for tc,label in ((None,"NO TC"),(7,"TC@GW7 (Haaland ×3)")):
    res=sim(tc_gw=tc,N=N)
    order=sorted(res,key=lambda n:-res[n]["mean"])
    print(f"\n=== FINAL MC GW3-12  [{label}]  N={N} ===")
    print(f"{'strategy':26s}{'mean':>7s}{'P10':>7s}{'P50':>7s}{'P90':>7s}{'std':>6s}")
    for n in order:
        r=res[n]; print(f"{n:26s}{r['mean']:>7.0f}{r['p10']:>7.0f}{r['p50']:>7.0f}{r['p90']:>7.0f}{r['std']:>6.0f}")
    fin="FINAL (Raya, phased)"
    print(f"win-rate of [{fin}] (paired):")
    for n in order:
        if n==fin: continue
        w=sum(1 for x,y in zip(res[fin]['raw'],res[n]['raw']) if x>y)/N
        print(f"   vs {n:26s} {w*100:3.0f}%   Δmean {res[fin]['mean']-res[n]['mean']:+.1f}")
    if tc is None:
        json.dump({n:{k:round(res[n][k],1) for k in ('mean','p10','p50','p90','std')} for n in res},
                  open(ROOT/"data/reports/montecarlo_final.json","w"),indent=2)
print("\nsaved -> data/reports/montecarlo_final.json")

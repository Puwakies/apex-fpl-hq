#!/usr/bin/env python3
"""
APEX FPL HQ — FREE HIT GW9 builder (one-week team to dodge big-match crossfire).
GW9 has two premium clashes (CHE v MUN, LIV v ARS, all fdr4) that mutually suppress
the template's returns/clean-sheets. FH pivots to a 1-week XI loaded from teams with
EASY, ISOLATED GW9 fixtures (MCI v BHA fdr2, BOU v LEE, AVL v FUL, TOT v CRY, ...).

Scoring = single-GW (GW9 only): blended_pts/38 × GW9 fixture mult × reliability.
Blend = 0.7·last-season pts + 0.3·GW1-2 pace (same FORM basis as the WC3 build).
Constraints: 2/5/5/3, £100m, max 3/club. Captain = Haaland (MCI home BHA, protocol).
Output: data/reports/fh_gw9.json
"""
import json, random, statistics, urllib.request, os
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def get(p):
    r=urllib.request.Request("https://fantasy.premierleague.com/api/"+p,headers={"User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=40))
boot=get("bootstrap-static/"); fx=get("fixtures/")
short={t["id"]:t["short_name"] for t in boot["teams"]}
feat={(p["web_name"],p["team"]):p for p in json.load(open(ROOT/"data/features.json"))["players"]}
GW_EL=sum(1 for e in boot["events"] if e.get("finished") or e.get("data_checked")) or 2
POS={1:"GK",2:"DEF",3:"MID",4:"FWD"}; GW=9

# GW9 fixture difficulty per team (home/away)
FX={}
for f in fx:
    if f.get("event")!=GW: continue
    FX[short[f["team_h"]]]=(f["team_h_difficulty"],"H",short[f["team_a"]])
    FX[short[f["team_a"]]]=(f["team_a_difficulty"],"A",short[f["team_h"]])
def mult(tm):
    v=FX.get(tm)
    if not v: return 0.0                       # no GW9 fixture -> unusable in FH
    return max(0.70,min(1.45,(3.3/(v[0]+0.3*(v[1]=="A")))**0.85))
def fxs(tm):
    v=FX.get(tm); return f"{v[0]}{v[1]}v{v[2]}" if v else "BLANK"

def blended(name,team):
    # proven last-season pts dominate (0.8); GW1-2 form is a modest, capped tiebreaker (0.2).
    # newcomers (not in features, e.g. promoted HUL/COV) get a low prior so a 2-GW fluke
    # can't extrapolate to a 400-pt season and hijack the FH.
    e=elem.get((name,team)); std=(e["total_points"] if e else 0) or 0
    pace=std/GW_EL*38
    last=feat.get((name,team),{}).get("pts")
    if last is None: last=min(90.0, pace*0.40)          # unproven prior
    last=min(250.0,last)
    return min(240.0, 0.8*last+0.2*min(180.0,pace))

elem={(e["web_name"],short[e["team"]]):e for e in boot["elements"]}
LOCK=[("Haaland","MCI")]   # FH captain — MCI home BHA fdr2
pool=[]
for e in boot["elements"]:
    tm=short[e["team"]]; nm=e["web_name"]; pos=POS[e["element_type"]]
    if mult(tm)==0.0: continue                                   # no GW9 fixture
    if e["status"]!="a" and (nm,tm) not in LOCK: continue
    st=e.get("starts",0) or 0
    if (nm,tm) not in LOCK and st<2 and (e.get("minutes",0) or 0)<120: continue  # must be playing
    bp=blended(nm,tm)
    rel=0.55+0.45*min(1.0,st/6.0)                                # early-season reliability
    ppg=min(bp/38.0,9.0)
    score=ppg*mult(tm)*rel
    pool.append({"id":e["id"],"name":nm,"team":tm,"pos":pos,"price":e["now_cost"]/10,
                 "bp":round(bp,1),"mult":round(mult(tm),2),"fix":fxs(tm),"score":score})
byid={p["id"]:p for p in pool}
LOCK_IDS=[next(p["id"] for p in pool if p["name"]==n and p["team"]==t) for n,t in LOCK]

NEED={"GK":2,"DEF":5,"MID":5,"FWD":3}; lset=set(LOCK_IDS)
bypos={k:sorted([p for p in pool if p["pos"]==k],key=lambda x:-x["score"]) for k in NEED}
cheap_gk=sorted([p for p in bypos["GK"] if p["price"]<=4.5],key=lambda x:(x["price"],-x["score"]))
FORMS=[(d,m,f) for d in range(3,6) for m in range(2,6) for f in range(1,4) if d+m+f==10]
def bxi(sq):
    g=sorted([p for p in sq if p["pos"]=="GK"],key=lambda x:-x["score"])
    de=sorted([p for p in sq if p["pos"]=="DEF"],key=lambda x:-x["score"])
    mi=sorted([p for p in sq if p["pos"]=="MID"],key=lambda x:-x["score"])
    fw=sorted([p for p in sq if p["pos"]=="FWD"],key=lambda x:-x["score"])
    bv,bb=-1,None
    for d,m,f in FORMS:
        if d>len(de) or m>len(mi) or f>len(fw): continue
        xi=[g[0]]+de[:d]+mi[:m]+fw[:f]; v=sum(x["score"] for x in xi)
        if v>bv: bv,bb=v,(xi,(1,d,m,f))
    return bv,bb
def feas(sq):
    if sum(p["price"] for p in sq)>100.0+1e-9: return False
    c={}
    for p in sq:
        c[p["team"]]=c.get(p["team"],0)+1
        if c[p["team"]]>3: return False
    pc={"GK":0,"DEF":0,"MID":0,"FWD":0}
    for p in sq: pc[p["pos"]]+=1
    if pc!=NEED: return False
    gks=sorted([p for p in sq if p["pos"]=="GK"],key=lambda x:-x["score"])
    if len(gks)==2 and gks[1]["price"]>4.5: return False
    return True
def obj(sq): xv,_=bxi(sq); return xv+0.10*(sum(p["score"] for p in sq)-xv)
def rv(rng):
    sq=[byid[i] for i in LOCK_IDS]
    sq.append(rng.choice(cheap_gk[:6]))
    need={k:NEED[k]-sum(1 for p in sq if p["pos"]==k) for k in NEED}
    for _ in range(need["GK"]):
        c=[x for x in bypos["GK"] if x["id"] not in {p["id"] for p in sq}][:12]; sq.append(rng.choice(c))
    for pos in ("DEF","MID","FWD"):
        c=[x for x in bypos[pos] if x["id"] not in {p["id"] for p in sq}][:40]
        sq+=rng.sample(c,max(0,NEED[pos]-sum(1 for p in sq if p["pos"]==pos)))
    t=0
    while not feas(sq) and t<4000:
        t+=1; cc={}
        for p in sq: cc[p["team"]]=cc.get(p["team"],0)+1
        over=[k for k,v in cc.items() if v>3]
        if over:
            vic=[p for p in sq if p["team"]==over[0] and p["id"] not in lset]
            if not vic: return None
            v=rng.choice(vic)
        elif sum(p["price"] for p in sq)>100:
            outs=[p for p in sq if p["id"] not in lset and not (p["pos"]=="GK" and p["price"]<=4.5)]
            v=max(outs,key=lambda p:p["price"])
        else: break
        alt=[c for c in bypos[v["pos"]] if c["id"] not in {p["id"] for p in sq} and c["price"]<=v["price"]]
        if not alt:
            alt=[c for c in bypos[v["pos"]] if c["id"] not in {p["id"] for p in sq}]
            if not alt: break
            repl=sorted(alt,key=lambda x:x["price"])[0]
        else: repl=rng.choice(alt[:15])
        sq=[repl if p["id"]==v["id"] else p for p in sq]
    return sq if feas(sq) else None
def hc(sq,rng,it):
    cur=obj(sq)
    for _ in range(it):
        v=rng.choice([p for p in sq if p["id"] not in lset])
        alt=[c for c in bypos[v["pos"]] if c["id"] not in {p["id"] for p in sq}]
        if not alt: continue
        new=[rng.choice(alt[:60]) if p["id"]==v["id"] else p for p in sq]
        if feas(new):
            nv=obj(new)
            if nv>cur: sq,cur=new,nv
    return sq,cur
rng=random.Random(9); best=None; bo=-1
for _ in range(1500):
    s=rv(rng)
    if s is None: continue
    s,v=hc(s,rng,1200)
    if v>bo: bo,best=v,s
best,_=hc(best,rng,60000)
xv,(xi,form)=bxi(best); xids={p["id"] for p in xi}
bench=[p for p in best if p["id"] not in xids]
order={"GK":0,"DEF":1,"MID":2,"FWD":3}
xi_s=sorted(xi,key=lambda x:(order[x["pos"]],-x["score"]))
bench_s=sorted(bench,key=lambda x:(order[x["pos"]],-x["score"]))
cap=next((p for p in xi if p["id"] in lset), None) or max([p for p in xi if p["pos"]!="GK"],key=lambda p:p["score"])  # (C) Haaland (protocol)
print(f"FREE HIT GW9  {form[1]}-{form[2]}-{form[3]}  £{sum(p['price'] for p in best):.1f}m   (C) {cap['name']} {cap['team']} {cap['fix']}")
print(f"{'PLAYER':15s}{'TM':5s}{'POS':4s}{'£':>6s}{'GW9fix':>8s}{'mult':>6s}{'bp':>6s}")
for lbl,grp in [("XI",xi_s),("BENCH",bench_s)]:
    print(f"-- {lbl} --")
    for p in grp:
        c=" (C)" if p["id"]==cap["id"] else (" 🔒" if p["id"] in lset else "")
        print(f"{p['name']+c:15s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['fix']:>8s}{p['mult']:>6.2f}{p['bp']:>6.1f}")
from collections import Counter
print("clubs:",dict(Counter(p['team'] for p in best)))
out={"chip":"Free Hit","gw":GW,"formation":f"{form[1]}-{form[2]}-{form[3]}","spend":round(sum(p['price'] for p in best),1),
     "captain":{"name":cap["name"],"team":cap["team"],"fix":cap["fix"]},
     "crossfire_avoided":["CHE v MUN (fdr4)","LIV v ARS (fdr4)"],
     "xi":[{k:p[k] for k in ("name","team","pos","price","fix","mult","bp")} for p in xi_s],
     "bench":[{k:p[k] for k in ("name","team","pos","price","fix","mult","bp")} for p in bench_s]}
json.dump(out,open(ROOT/"data/reports/fh_gw9.json","w"),ensure_ascii=False,indent=2)
print("saved -> data/reports/fh_gw9.json")

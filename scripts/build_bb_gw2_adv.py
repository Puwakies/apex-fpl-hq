#!/usr/bin/env python3
"""
APEX FPL HQ — BENCH BOOST GW2 build + Decision Principles #3/#4/#5.
BB counts all 15, so: every player nailed for GW2, objective = sum of all 15, GW2-fixture weighted.
Advanced layer:
  #3 xG-delta regression (overperformer x0.88 / underperformer x1.06)
  #4 attack quality (Threat+Creativity z-score boost)
  #5 GW2-opponent leakiness — each player's GW2 opponent xGC/90 (attackers vs leaky = boost)
Keeps: lock Haaland + B.Fernandes; ban Gabriel + Raya.
Output: data/reports/bb_gw2_adv.json
"""
import json, random, statistics, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
feat = json.load(open(ROOT/"data/features.json"))
hist = json.load(open(ROOT/"data/backtest/history.json"))
adv  = json.load(open(ROOT/"data/advanced_stats.json"))

def get(p):
    r=urllib.request.Request("https://fantasy.premierleague.com/api/"+p,headers={"User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=40))
boot=get("bootstrap-static/"); fx=get("fixtures/")
short={t["id"]:t["short_name"] for t in boot["teams"]}

team_xgc={w["team"]:w["xgc_per90"] for w in adv["team_def_weakness"]}
LG_XGC=statistics.mean(team_xgc.values())

# GW2 fixture per team + GW2 opponent xGC (#5)
g2={}
for f in fx:
    if f.get("event")!=2: continue
    g2[short[f["team_h"]]]=(f["team_h_difficulty"],"H",short[f["team_a"]])
    g2[short[f["team_a"]]]=(f["team_a_difficulty"],"A",short[f["team_h"]])
gw2_fdr={t:v[0]+(0.3 if v[1]=="A" else 0) for t,v in g2.items()}
gw2_seq={t:f"{v[0]}{v[1]} vs {v[2]}" for t,v in g2.items()}
gw2_opp_xgc={t:team_xgc.get(v[2],LG_XGC) for t,v in g2.items()}

adv_by={(p["name"],p["team"]):p for p in adv["players"]}
hcon={}
for p in hist["players"]:
    pl=[g for g in p["gws"] if g["min"]>0]
    if pl: hcon[p["name"]]={"am":statistics.mean(g["min"] for g in pl)}

POS={"GKP":"GK","DEF":"DEF","MID":"MID","FWD":"FWD"}
LOCKED_SPEC=[("Haaland","MCI"),("B.Fernandes","MUN")]; BANNED_SPEC=[("Gabriel","ARS"),("Raya","ARS")]
LOCKED_IDS=[next(p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t) for n,t in LOCKED_SPEC]
BANNED_IDS={next((p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t),None) for n,t in BANNED_SPEC}
LF,A=3.10,1.30; STARTS_FLOOR=25

def mods(p,pos):
    a=adv_by.get((p["web_name"],p["team"])); fF=aqF=1.0; tags=[]
    if a and pos in ("FWD","MID"):
        if a.get("finisher_class")=="overperformer": fF=0.88; tags.append(f"OVER Δ{a['xg_delta']:+.1f}")
        elif a.get("finisher_class")=="underperformer": fF=1.06; tags.append(f"under Δ{a['xg_delta']:+.1f}")
        aq=a.get("attack_quality")
        if aq is not None:
            aqF=1.0+0.06*max(-2.0,min(3.0,aq))
            if aq>=1.5: tags.append(f"AQ{aq:+.1f}")
    olF=1.0
    if pos in ("FWD","MID","DEF"):
        w=0.5 if pos!="DEF" else 0.2
        olF=(gw2_opp_xgc.get(p["team"],LG_XGC)/LG_XGC)**w
    return fF,aqF,olF,tags

def mk(p):
    team=p["team"]; pos=POS[p["pos"]]
    fa=gw2_fdr.get(team); ff=(LF/fa)**A
    st=p.get("starts",0) or 0; rel=0.50+0.50*min(1.0,st/32.0)
    h=hcon.get(p["web_name"])
    if h: rel*=(0.90+0.10*min(1.0,h["am"]/85.0))
    fF,aqF,olF,tags=mods(p,pos)
    return {"id":p["id"],"name":p["web_name"],"team":team,"pos":pos,"price":p["price"],
            "pts":p["pts"],"starts":st,"gw2_fdr":round(fa,2),"gw2":gw2_seq.get(team,""),
            "opp_xgc":round(gw2_opp_xgc.get(team,LG_XGC),2),"adj":round(fF*aqF*olF,3),
            "tags":" ".join(tags),"score":p["pts"]*ff*rel*fF*aqF*olF}

pool,byid=[],{}
for p in feat["players"]:
    if p["pos"] not in POS or p["id"] in BANNED_IDS: continue
    if p["id"] not in LOCKED_IDS and p["status"] in ("i","s","u","d"): continue
    if p["team"] not in gw2_fdr: continue
    if p["id"] not in LOCKED_IDS and (p.get("starts",0) or 0)<STARTS_FLOOR: continue
    m=mk(p); pool.append(m); byid[p["id"]]=m

LOCKED=[byid[i] for i in LOCKED_IDS]; NEED={"GK":2,"DEF":5,"MID":5,"FWD":3}
free_need={k:NEED[k]-sum(1 for p in LOCKED if p["pos"]==k) for k in NEED}; lset=set(LOCKED_IDS)
bypos={k:sorted([p for p in pool if p["pos"]==k and p["id"] not in lset],key=lambda x:-x["score"]) for k in NEED}
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
    return pc==NEED
def obj(sq): return sum(p["score"] for p in sq)   # BB: all 15 equal
def rv(rng):
    sq=list(LOCKED)
    for pos in ("GK","DEF","MID","FWD"):
        need=free_need[pos]
        if need<=0: continue
        c=[x for x in bypos[pos] if x["id"] not in {p["id"] for p in sq}][:45]
        if len(c)<need: return None
        sq+=rng.sample(c,need)
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
            v=max([p for p in sq if p["id"] not in lset],key=lambda p:p["price"])
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
        new=[rng.choice(alt[:70]) if p["id"]==v["id"] else p for p in sq]
        if feas(new):
            nv=obj(new)
            if nv>cur: sq,cur=new,nv
    return sq,cur

rng=random.Random(4); best=None; bo=-1
for _ in range(1400):
    s=rv(rng)
    if s is None: continue
    s,v=hc(s,rng,1400)
    if v>bo: bo,best=v,s
best,bo=hc(best,rng,70000)

xv,(xi,form)=bxi(best); xids={p["id"] for p in xi}
bench=[p for p in best if p["id"] not in xids]
order={"GK":0,"DEF":1,"MID":2,"FWD":3}
xi_s=sorted(xi,key=lambda x:(order[x["pos"]],-x["score"])); bench_s=sorted(bench,key=lambda x:(order[x["pos"]],-x["score"]))
def tag(p): return " 🔒" if p["id"] in lset else ""
sq_fdr=sum(p["gw2_fdr"] for p in best)/15
print(f"BB GW2 +ADV  {form[1]}-{form[2]}-{form[3]}  £{sum(p['price'] for p in best):.1f}m  avg GW2-FDR={sq_fdr:.2f}")
print(f"{'PLAYER':15s}{'TM':5s}{'POS':4s}{'£':>6s}{'pts':>5s}{'GW2':>13s}{'oppxGC':>7s}{'adj':>6s}  #3/#4")
for lbl,grp in [("XI",xi_s),("BENCH (score in BB)",bench_s)]:
    print(f"-- {lbl} --")
    for p in grp:
        print(f"{p['name']+tag(p):17s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>5d}{p['gw2']:>13s}{p['opp_xgc']:>7.2f}{p['adj']:>6.2f}  {p['tags']}")
clubs={}
for p in best: clubs[p["team"]]=clubs.get(p["team"],0)+1
print("clubs>1:", {k:v for k,v in sorted(clubs.items(),key=lambda x:-x[1]) if v>1})
print("all15 nailed?", all(p["starts"]>=25 or p["id"] in lset for p in best))
out={"mode":"bb-gw2+adv","chip":"BB@GW2","formation":f"{form[1]}-{form[2]}-{form[3]}",
     "spend":round(sum(p['price'] for p in best),1),"avg_squad_gw2_fdr":round(sq_fdr,2),
     "xi":[{k:p[k] for k in ("name","team","pos","price","pts","gw2","opp_xgc","adj","tags")} for p in xi_s],
     "bench":[{k:p[k] for k in ("name","team","pos","price","pts","gw2","opp_xgc","adj","tags")} for p in bench_s]}
json.dump(out,open(ROOT/"data/reports/bb_gw2_adv.json","w"),ensure_ascii=False,indent=2)

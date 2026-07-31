#!/usr/bin/env python3
"""
APEX FPL HQ — BENCH BOOST GW2 build.
BB counts ALL 15 players, so this build maximizes the whole squad's GW2 output:
  - every one of the 15 must be a nailed GW2 starter (no cheap non-playing bench fodder)
  - fixture weight = the SINGLE GW2 fixture per team (home/away aware), strong weight
  - objective = SUM of all 15 (equal weight) — bench counts as much as the XI under BB
  - even the 2nd GK must play GW2 (drop the "cheap bench GK" rule)
Keeps: lock Haaland + B.Fernandes; ban Gabriel + Raya.
"""
import json, random, statistics, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
feat = json.load(open(ROOT/"data/features.json"))
hist = json.load(open(ROOT/"data/backtest/history.json"))
g2 = json.load(open("/tmp/g2.json"))                       # {team: [fdr, venue, opp]}
gw2_fdr = {t: v[0] + (0.3 if v[1] == "A" else 0) for t, v in g2.items()}
gw2_seq = {t: f"{v[0]}{v[1]} vs {v[2]}" for t, v in g2.items()}

hcon = {}
for p in hist["players"]:
    pl = [g for g in p["gws"] if g["min"] > 0]
    if pl:
        hcon[p["name"]] = {"am": statistics.mean(g["min"] for g in pl)}

POS = {"GKP":"GK","DEF":"DEF","MID":"MID","FWD":"FWD"}
LOCKED_SPEC = [("Haaland","MCI"), ("B.Fernandes","MUN")]
BANNED_SPEC = [("Gabriel","ARS"), ("Raya","ARS")]
LOCKED_IDS = [next(p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t) for n,t in LOCKED_SPEC]
BANNED_IDS = {next((p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t), None) for n,t in BANNED_SPEC}
LF, A = 3.10, 1.30
STARTS_FLOOR = 25          # all 15 must be nailed GW2 starters (BB counts everyone)

def mk(p):
    fa = gw2_fdr.get(p["team"])
    ff = (LF/fa) ** A
    st = p.get("starts",0) or 0
    rel = 0.50 + 0.50*min(1.0, st/32.0)
    h = hcon.get(p["web_name"])
    if h: rel *= (0.90 + 0.10*min(1.0, h["am"]/85.0))
    return {"id":p["id"],"name":p["web_name"],"team":p["team"],"pos":POS[p["pos"]],
            "price":p["price"],"pts":p["pts"],"starts":st,"gw2_fdr":round(fa,2),
            "gw2":gw2_seq.get(p["team"],""),"ff":round(ff,3),"rel":round(rel,3),
            "score":p["pts"]*ff*rel}

pool, byid = [], {}
for p in feat["players"]:
    if p["pos"] not in POS or p["id"] in BANNED_IDS: continue
    if p["id"] not in LOCKED_IDS and p["status"] in ("i","s","u","d"): continue
    if p["team"] not in gw2_fdr: continue
    if p["id"] not in LOCKED_IDS and (p.get("starts",0) or 0) < STARTS_FLOOR: continue
    m = mk(p); pool.append(m); byid[p["id"]] = m

LOCKED = [byid[i] for i in LOCKED_IDS]
NEED = {"GK":2,"DEF":5,"MID":5,"FWD":3}
free_need = {k: NEED[k]-sum(1 for p in LOCKED if p["pos"]==k) for k in NEED}
lset = set(LOCKED_IDS)
bypos = {k: sorted([p for p in pool if p["pos"]==k and p["id"] not in lset], key=lambda x:-x["score"]) for k in NEED}
FORMS = [(d,m,f) for d in range(3,6) for m in range(2,6) for f in range(1,4) if d+m+f==10]

def bxi(sq):   # only for reporting a sensible XI; BB scores all 15 anyway
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

def obj(sq):   # BB: equal weight to ALL 15
    return sum(p["score"] for p in sq)

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
            outs=[p for p in sq if p["id"] not in lset]
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
        new=[rng.choice(alt[:70]) if p["id"]==v["id"] else p for p in sq]
        if feas(new):
            nv=obj(new)
            if nv>cur: sq,cur=new,nv
    return sq,cur

rng=random.Random(4); best=None; bo=-1
for _ in range(1500):
    s=rv(rng)
    if s is None: continue
    s,v=hc(s,rng,1500)
    if v>bo: bo,best=v,s
best,bo=hc(best,rng,80000)

xv,(xi,form)=bxi(best); xids={p["id"] for p in xi}
bench=[p for p in best if p["id"] not in xids]
order={"GK":0,"DEF":1,"MID":2,"FWD":3}
xi_s=sorted(xi,key=lambda x:(order[x["pos"]],-x["score"]))
bench_s=sorted(bench,key=lambda x:(order[x["pos"]],-x["score"]))
total=sum(p["price"] for p in best)
sq_fdr=sum(p["gw2_fdr"] for p in best)/15
def tag(p): return " 🔒" if p["id"] in lset else ""
print(f"BB GW2  {form[1]}-{form[2]}-{form[3]}  SPEND £{total:.1f}m  avg SQUAD(15) GW2-FDR={sq_fdr:.2f}")
print("="*92)
print(f"{'PLAYER':15s}{'TM':5s}{'POS':4s}{'£':>6s}{'25pts':>6s}{'st':>4s}{'GW2fdr':>7s}  GW2")
for lbl,grp in [("XI (11)",xi_s),("BENCH (4) — also score in BB",bench_s)]:
    print(f"-- {lbl} --")
    for p in grp:
        print(f"{p['name']+tag(p):17s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>6d}{p['starts']:>4d}{p['gw2_fdr']:>7.2f}  {p['gw2']}")
clubs={}
for p in best: clubs[p["team"]]=clubs.get(p["team"],0)+1
print("clubs>1:", {k:v for k,v in sorted(clubs.items(),key=lambda x:-x[1]) if v>1})
print(f"all 15 nailed (>=25 starts)? {'YES' if all(p['starts']>=25 or p['id'] in lset for p in best) else 'NO'}")

out={"mode":"bb-gw2","chip":"BB@GW2","formation":f"{form[1]}-{form[2]}-{form[3]}","spend":round(total,1),
     "avg_squad_gw2_fdr":round(sq_fdr,2),
     "xi":[{k:p[k] for k in ("name","team","pos","price","pts","starts","gw2_fdr","gw2")} for p in xi_s],
     "bench":[{k:p[k] for k in ("name","team","pos","price","pts","starts","gw2_fdr","gw2")} for p in bench_s]}
json.dump(out, open(ROOT/"data/reports/bb_gw2.json","w"), ensure_ascii=False, indent=2)

#!/usr/bin/env python3
"""
APEX FPL HQ — GW1-6 SPRINT build (Wildcard planned at GW7).
Because WC7 rebuilds everything, this squad only has to win GW1-6:
  - FDR weighted over the FIRST 6 GWs (not 5), strong weight (this is a fixture sprint)
  - season-long durability NOT required — only need players nailed to START now (starts>=22)
  - value concentrated in the XI; cheap bench is fine (thrown away at WC7)
Keeps: lock Haaland + B.Fernandes; ban Gabriel + Raya (per earlier instructions).
"""
import json, random, statistics, urllib.request
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
feat = json.load(open(ROOT/"data/features.json"))
hist = json.load(open(ROOT/"data/backtest/history.json"))

def get(p):
    r = urllib.request.Request("https://fantasy.premierleague.com/api/"+p, headers={"User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r, timeout=40))

# --- compute weighted next-6 FDR per team from the live fixtures (from GW1) ---
boot = get("bootstrap-static/"); fx = get("fixtures/")
short = {t["id"]: t["short_name"] for t in boot["teams"]}
start_gw = next((e["id"] for e in boot["events"] if e.get("is_next")), 1)
byteam = defaultdict(list)
for f in fx:
    ev = f.get("event")
    if ev is None or ev < start_gw:
        continue
    if f["team_h"]:
        byteam[f["team_h"]].append((ev, f["team_h_difficulty"], "H"))
    if f["team_a"]:
        byteam[f["team_a"]].append((ev, f["team_a_difficulty"], "A"))
team_fdr6 = {}; team_seq6 = {}
for tid, rows in byteam.items():
    rows.sort(key=lambda x: x[0]); rows = rows[:6]
    weighted = [d + (0.3 if loc == "A" else 0) for _, d, loc in rows]   # away slightly harder
    team_fdr6[short[tid]] = round(statistics.mean(weighted), 3)
    team_seq6[short[tid]] = [{"gw": g, "fdr": d, "loc": l} for g, d, l in rows]

hcon = {}
for p in hist["players"]:
    pl = [g for g in p["gws"] if g["min"] > 0]
    if pl:
        hcon[p["name"]] = {"b": sum(1 for g in pl if g["pts"] <= 2)/len(pl),
                           "am": statistics.mean(g["min"] for g in pl)}

import os
POS = {"GKP":"GK","DEF":"DEF","MID":"MID","FWD":"FWD"}
def _spec(env, default):
    v = os.environ.get(env)
    if v is None: return default
    v = v.strip()
    if not v: return []
    return [tuple(x.split(":")) for x in v.split(",")]     # "Haaland:MCI,B.Fernandes:MUN"
LOCKED_SPEC = _spec("LOCKS", [("Haaland","MCI"), ("B.Fernandes","MUN")])
BANNED_SPEC = _spec("BANS", [("Gabriel","ARS"), ("Raya","ARS")])
OUT_NAME = os.environ.get("OUT", "gw1_6_sprint")
LOCKED_IDS = [next(p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t) for n,t in LOCKED_SPEC]
BANNED_IDS = {next((p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t), None) for n,t in BANNED_SPEC}
LF = 3.30
A = float(os.environ.get("ALPHA", "1.35"))   # STRONG fixture weight default; ~0 = pure cum_pts (Gemini baseline)
STARTS_FLOOR = 22           # nailed-to-start proxy (season durability irrelevant pre-WC7)

def mk(p):
    fa = team_fdr6.get(p["team"])
    ff = (LF/fa) ** A
    st = p.get("starts",0) or 0
    rel = 0.45 + 0.55*min(1.0, st/30.0)          # "will he start GW1-6" proxy
    h = hcon.get(p["web_name"])
    if h:
        rel *= (0.90 + 0.10*min(1.0, h["am"]/85.0))
    return {"id":p["id"],"name":p["web_name"],"team":p["team"],"pos":POS[p["pos"]],
            "price":p["price"],"pts":p["pts"],"starts":st,"sel":p["selected_by_pct"],
            "fdr6":fa,"fdr_seq":team_seq6.get(p["team"]),
            "ff":round(ff,3),"rel":round(rel,3),"score":p["pts"]*ff*rel}

pool, byid = [], {}
for p in feat["players"]:
    if p["pos"] not in POS or p["id"] in BANNED_IDS:
        continue
    if p["id"] not in LOCKED_IDS and p["status"] in ("i","s","u","d"):
        continue
    fa = team_fdr6.get(p["team"])
    if not fa:
        continue
    if p["id"] not in LOCKED_IDS and (p.get("starts",0) or 0) < STARTS_FLOOR:
        continue
    m = mk(p); pool.append(m); byid[p["id"]] = m

LOCKED = [byid[i] for i in LOCKED_IDS]
NEED = {"GK":2,"DEF":5,"MID":5,"FWD":3}
free_need = {k: NEED[k]-sum(1 for p in LOCKED if p["pos"]==k) for k in NEED}
lset = set(LOCKED_IDS)
bypos = {k: sorted([p for p in pool if p["pos"]==k and p["id"] not in lset], key=lambda x:-x["score"]) for k in NEED}
cheap_gk = sorted([p for p in bypos["GK"] if p["price"] <= 4.5], key=lambda x:(x["price"], -x["score"]))
FORMS = [(d,m,f) for d in range(3,6) for m in range(2,6) for f in range(1,4) if d+m+f==10]

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

def obj(sq):
    xv,_=bxi(sq); return xv+0.12*(sum(p["score"] for p in sq)-xv)   # bench matters little (WC7)

def rv(rng):
    sq=list(LOCKED); gneed=free_need["GK"]
    if gneed>=1: sq.append(rng.choice(cheap_gk[:6])); gneed-=1
    for _ in range(gneed):
        c=[x for x in bypos["GK"] if x["id"] not in {p["id"] for p in sq}][:12]; sq.append(rng.choice(c))
    for pos in ("DEF","MID","FWD"):
        need=free_need[pos]
        if need<=0: continue
        c=[x for x in bypos[pos] if x["id"] not in {p["id"] for p in sq}][:45]; sq+=rng.sample(c,need)
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
        new=[rng.choice(alt[:70]) if p["id"]==v["id"] else p for p in sq]
        if feas(new):
            nv=obj(new)
            if nv>cur: sq,cur=new,nv
    return sq,cur

rng=random.Random(9); best=None; bo=-1
for _ in range(1500):
    s=rv(rng)
    if s is None: continue
    s,v=hc(s,rng,1500)
    if v>bo: bo,best=v,s
best,bo=hc(best,rng,80000)

xv,(xi,form)=bxi(best); xids={p["id"] for p in xi}
bench=[p for p in best if p["id"] not in xids]
bgk=[p for p in bench if p["pos"]=="GK"]; bout=sorted([p for p in bench if p["pos"]!="GK"],key=lambda x:-x["score"])
bench_ord=bgk+bout
order={"GK":0,"DEF":1,"MID":2,"FWD":3}; xi_s=sorted(xi,key=lambda x:(order[x["pos"]],-x["score"]))
total=sum(p["price"] for p in best); xi_fdr=sum(p["fdr6"] for p in xi)/len(xi)

def tag(p): return " 🔒" if p["id"] in lset else ""
print(f"GW1-6 SPRINT  {form[1]}-{form[2]}-{form[3]}  SPEND £{total:.1f}m  BANK £{100-total:.1f}m  avg XI FDR6={xi_fdr:.2f}")
print("="*100)
print(f"{'PLAYER':15s}{'TM':5s}{'POS':4s}{'£':>6s}{'25pts':>6s}{'st':>4s}{'FDR6':>6s}{'score':>7s}  6 เกมแรก")
print("-- STARTING XI --")
for p in xi_s:
    seq=" ".join(f"{n['fdr']}{n['loc']}" for n in p["fdr_seq"]) if p["fdr_seq"] else ""
    print(f"{p['name']+tag(p):17s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>6d}{p['starts']:>4d}{p['fdr6']:>6.2f}{p['score']:>7.0f}  {seq}")
print("-- BENCH --")
for p in bench_ord:
    seq=" ".join(f"{n['fdr']}{n['loc']}" for n in p["fdr_seq"]) if p["fdr_seq"] else ""
    print(f"{p['name']+tag(p):17s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>6d}{p['starts']:>4d}{p['fdr6']:>6.2f}{p['score']:>7.0f}  {seq}")
clubs={}
for p in best: clubs[p["team"]]=clubs.get(p["team"],0)+1
print("clubs>1:", {k:v for k,v in sorted(clubs.items(),key=lambda x:-x[1]) if v>1})

out={"mode":"gw1-6-sprint","wc":"GW7","formation":f"{form[1]}-{form[2]}-{form[3]}","spend":round(total,1),
     "bank":round(100-total,1),"avg_xi_fdr6":round(xi_fdr,2),
     "xi":[{k:p[k] for k in ("name","team","pos","price","pts","starts","fdr6","score")}|{"locked":p["id"] in lset} for p in xi_s],
     "bench":[{k:p[k] for k in ("name","team","pos","price","pts","starts","fdr6","score")} for p in bench_ord]}
json.dump(out, open(ROOT/f"data/reports/{OUT_NAME}.json","w"), ensure_ascii=False, indent=2)

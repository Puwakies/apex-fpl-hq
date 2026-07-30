#!/usr/bin/env python3
"""
APEX FPL HQ — 26/27 pre-season squad builder.
Mandate: last-season (25/26) output = quality anchor; first-5 FDR (26/27) = PRIMARY driver.
Legal 15: 2GK/5DEF/5MID/3FWD, <=3 per club, <=100.0m. Bench GK forced cheap so budget lands in the XI.

Usage: python3 scripts/build_2627.py [anchor|spread]
  anchor = allow an elite premium (e.g. Haaland) despite hard fixtures
  spread = FDR-pure, cap any single player at 11.0m, deeper starting bench
"""
import json, random, statistics, sys
from pathlib import Path

MODE = sys.argv[1] if len(sys.argv) > 1 else "spread"
PRICE_CAP = 99.0 if MODE == "anchor" else 11.0

ROOT = Path(__file__).resolve().parent.parent
feat = json.load(open(ROOT/"data/features.json"))
hist = json.load(open(ROOT/"data/backtest/history.json"))

hcon = {}
for p in hist["players"]:
    pl = [g for g in p["gws"] if g["min"] > 0]
    if pl:
        hcon[p["name"]] = {"b": sum(1 for g in pl if g["pts"] <= 2)/len(pl),
                           "am": statistics.mean(g["min"] for g in pl)}

POS = {"GKP":"GK","DEF":"DEF","MID":"MID","FWD":"FWD"}
LF, A = 3.30, 1.35

def mk(p):
    fa = p["fdr"].get("fdr_avg")
    ff = (LF/fa)**A
    st = p.get("starts",0) or 0
    rel = 0.55 + 0.45*min(1, st/30)
    h = hcon.get(p["web_name"])
    if h:
        rel *= (1 - 0.30*h["b"]); rel *= (0.85 + 0.15*min(1, h["am"]/85))
    return {"id":p["id"],"name":p["web_name"],"team":p["team"],"pos":POS[p["pos"]],
            "price":p["price"],"pts":p["pts"],"starts":st,"min":p["minutes"],"xgi":p["xgi"],
            "sel":p["selected_by_pct"],"fdr":fa,"fdr_seq":p["fdr"].get("next"),
            "ff":round(ff,3),"rel":round(rel,3),"score":p["pts"]*ff*rel}

pool = []
for p in feat["players"]:
    if p["pos"] not in POS or p["status"] in ("i","s","u"):
        continue
    fa = p["fdr"].get("fdr_avg"); n = p["fdr"].get("n_fixtures",0)
    if not fa or n < 5 or p["price"] > PRICE_CAP:
        continue
    pool.append(mk(p))

NEED = {"GK":2,"DEF":5,"MID":5,"FWD":3}
bypos = {k:sorted([p for p in pool if p["pos"]==k], key=lambda x:-x["score"]) for k in NEED}
# candidate pool for the cheap 2nd GK: playing backups only
cheap_gk = sorted([p for p in bypos["GK"] if p["price"] <= 4.6], key=lambda x:(x["price"], -x["score"]))
FORMS = [(d,m,f) for d in range(3,6) for m in range(2,6) for f in range(1,4) if d+m+f==10]

def bxi(sq):
    g = sorted([p for p in sq if p["pos"]=="GK"], key=lambda x:-x["score"])
    de = sorted([p for p in sq if p["pos"]=="DEF"], key=lambda x:-x["score"])
    mi = sorted([p for p in sq if p["pos"]=="MID"], key=lambda x:-x["score"])
    fw = sorted([p for p in sq if p["pos"]=="FWD"], key=lambda x:-x["score"])
    bv, bb = -1, None
    for d,m,f in FORMS:
        if d>len(de) or m>len(mi) or f>len(fw): continue
        xi = [g[0]]+de[:d]+mi[:m]+fw[:f]; v = sum(x["score"] for x in xi)
        if v>bv: bv, bb = v, (xi,(1,d,m,f))
    return bv, bb

def feas(sq):
    if sum(p["price"] for p in sq) > 100.0+1e-9:
        return False
    c = {}
    for p in sq:
        c[p["team"]] = c.get(p["team"],0)+1
        if c[p["team"]] > 3: return False
    # exactly one cheap bench GK: the 2nd GK by score must be a <=4.6 keeper
    gks = sorted([p for p in sq if p["pos"]=="GK"], key=lambda x:-x["score"])
    if len(gks)==2 and gks[1]["price"] > 4.6:
        return False
    return True

def obj(sq):
    xv,_ = bxi(sq)
    return xv + 0.20*(sum(p["score"] for p in sq)-xv)

def rv(rng):
    sq = list(rng.choice(cheap_gk)) if False else []
    sq.append(rng.choice(cheap_gk[:6]))           # cheap bench GK locked
    # starting GK (any)
    sq.append(rng.choice([g for g in bypos["GK"] if g["id"]!=sq[0]["id"]][:12]))
    for pos in ("DEF","MID","FWD"):
        c = bypos[pos][:45]; sq += rng.sample(c, NEED[pos])
    t = 0
    while not feas(sq) and t < 4000:
        t += 1; cc = {}
        for p in sq: cc[p["team"]] = cc.get(p["team"],0)+1
        over = [k for k,v in cc.items() if v>3]
        if over:
            v = rng.choice([p for p in sq if p["team"]==over[0] and p["price"]>4.6 or p["team"]==over[0]])
        elif sum(p["price"] for p in sq) > 100:
            outs = [p for p in sq if not (p["pos"]=="GK" and p["price"]<=4.6)]
            v = max(outs, key=lambda p:p["price"])
        else:
            break
        alt = [c for c in bypos[v["pos"]] if c["id"] not in {p["id"] for p in sq} and c["price"]<=v["price"]]
        if not alt:
            alt = [c for c in bypos[v["pos"]] if c["id"] not in {p["id"] for p in sq}]
            if not alt: break
            repl = sorted(alt, key=lambda x:x["price"])[0]
        else:
            repl = rng.choice(alt[:15])
        sq = [repl if p["id"]==v["id"] else p for p in sq]
    return sq if feas(sq) else None

def hc(sq, rng, it):
    cur = obj(sq)
    for _ in range(it):
        v = rng.choice(sq); held = {p["id"] for p in sq}
        # keep the cheap bench GK cheap: if swapping a GK, respect the constraint via feas()
        alt = [c for c in bypos[v["pos"]] if c["id"] not in held]
        if not alt: continue
        new = [rng.choice(alt[:70]) if p["id"]==v["id"] else p for p in sq]
        if feas(new):
            nv = obj(new)
            if nv > cur: sq, cur = new, nv
    return sq, cur

rng = random.Random(3); best=None; bo=-1
for _ in range(500):
    s = rv(rng)
    if s is None: continue
    s, v = hc(s, rng, 1200)
    if v > bo: bo, best = v, s
best, bo = hc(best, rng, 25000)

xv,(xi,form) = bxi(best)
xids = {p["id"] for p in xi}
bench = [p for p in best if p["id"] not in xids]
bgk = [p for p in bench if p["pos"]=="GK"]
bout = sorted([p for p in bench if p["pos"]!="GK"], key=lambda x:-x["score"])
bench_ord = bgk + bout
order = {"GK":0,"DEF":1,"MID":2,"FWD":3}
xi_s = sorted(xi, key=lambda x:(order[x["pos"]], -x["score"]))
total = sum(p["price"] for p in best)

print(f"MODE={MODE}  FORMATION {form[1]}-{form[2]}-{form[3]}  SPEND £{total:.1f}m  BANK £{100-total:.1f}m")
print("="*100)
hdr=f"{'PLAYER':14s}{'TM':5s}{'POS':4s}{'£':>6s}{'25pts':>6s}{'st':>4s}{'fdr5':>6s}{'ff':>6s}{'rel':>6s}{'score':>7s}  first-5 (fdr+venue)"
print("-- STARTING XI --\n"+hdr)
for p in xi_s:
    seq=" ".join(f"{n['fdr']}{n['loc']}" for n in p["fdr_seq"])
    print(f"{p['name']:14s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>6d}{p['starts']:>4d}{p['fdr']:>6.2f}{p['ff']:>6.2f}{p['rel']:>6.2f}{p['score']:>7.0f}  {seq}")
print("-- BENCH (auto-sub order) --")
for p in bench_ord:
    seq=" ".join(f"{n['fdr']}{n['loc']}" for n in p["fdr_seq"])
    print(f"{p['name']:14s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>6d}{p['starts']:>4d}{p['fdr']:>6.2f}{p['ff']:>6.2f}{p['rel']:>6.2f}{p['score']:>7.0f}  {seq}")
clubs={}
for p in best: clubs[p["team"]]=clubs.get(p["team"],0)+1
print("clubs>1:", {k:v for k,v in sorted(clubs.items(),key=lambda x:-x[1]) if v>1})

out={"mode":MODE,"formation":f"{form[1]}-{form[2]}-{form[3]}","spend":round(total,1),"bank":round(100-total,1),
     "xi":[{k:p[k] for k in ("name","team","pos","price","pts","starts","fdr","score")} for p in xi_s],
     "bench":[{k:p[k] for k in ("name","team","pos","price","pts","starts","fdr","score")} for p in bench_ord]}
json.dump(out, open(ROOT/f"data/reports/preseason_2627_{MODE}.json","w"), ensure_ascii=False, indent=2)

#!/usr/bin/env python3
"""
APEX FPL HQ — 26/27 CORE build (premium-anchored, set-and-forget, reduce unnecessary FT).
Philosophy shift from the FDR-first builds:
  - LOCK 4 premiums all season: Haaland, B.Fernandes, Gabriel, Raya (premium GK).
  - Fill the rest with DURABLE, nailed starters (high starts / low blank rate) so the squad
    rarely needs a transfer. First-5 FDR kept only as a MILD secondary tiebreaker.
Legal 15: 2GK/5DEF/5MID/3FWD, <=3 per club, <=100.0m, one cheap bench GK.
"""
import json, random, statistics
from pathlib import Path

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
# locked premiums resolved by (web_name, team) so it survives new-season id changes
LOCKED_SPEC = [("Haaland","MCI"), ("B.Fernandes","MUN"), ("Gabriel","ARS"), ("Raya","ARS")]
LOCKED_IDS = [next(p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t)
              for n,t in LOCKED_SPEC]
LF, A = 3.30, 0.60                      # MILD fdr tilt (was 1.35 in FDR-first build)

def mk(p):
    fa = p["fdr"].get("fdr_avg")
    ff = (LF/fa) ** A                                   # mild fixture factor
    st = p.get("starts", 0) or 0
    rel = 0.30 + 0.70*min(1.0, st/34.0)                 # durability dominates
    h = hcon.get(p["web_name"])
    if h:
        rel *= (1 - 0.25*h["b"])                        # blank-rate penalty
        rel *= (0.90 + 0.10*min(1.0, h["am"]/85.0))     # minutes reliability
    return {"id":p["id"],"name":p["web_name"],"team":p["team"],"pos":POS[p["pos"]],
            "price":p["price"],"pts":p["pts"],"starts":st,"min":p["minutes"],
            "sel":p["selected_by_pct"],"fdr":fa,"fdr_seq":p["fdr"].get("next"),
            "ff":round(ff,3),"rel":round(rel,3),
            "score":p["pts"] * ff * (rel ** 1.3)}       # ^1.3 => reward proven nailed

pool, byid = [], {}
for p in feat["players"]:
    if p["pos"] not in POS:
        continue
    if p["id"] not in LOCKED_IDS and p["status"] in ("i","s","u","d"):
        continue   # set-and-forget: only fully-available players (exclude doubtful)
    fa = p["fdr"].get("fdr_avg"); n = p["fdr"].get("n_fixtures",0)
    if not fa or (n < 5 and p["id"] not in LOCKED_IDS):
        continue
    # durability floor: every non-locked pick must be a proven starter (reduce FT / auto-sub safe)
    if p["id"] not in LOCKED_IDS and (p.get("starts",0) or 0) < 25:
        continue
    m = mk(p); pool.append(m); byid[p["id"]] = m

LOCKED = [byid[i] for i in LOCKED_IDS]
NEED = {"GK":2,"DEF":5,"MID":5,"FWD":3}
locked_by = {k:[p for p in LOCKED if p["pos"]==k] for k in NEED}
free_need = {k:NEED[k]-len(locked_by[k]) for k in NEED}
locked_cost = sum(p["price"] for p in LOCKED)
lset = set(LOCKED_IDS)

# candidate pools (exclude locked); durability filter for outfield starters
bypos = {k:sorted([p for p in pool if p["pos"]==k and p["id"] not in lset], key=lambda x:-x["score"]) for k in NEED}
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
    if sum(p["price"] for p in sq) > 100.0+1e-9: return False
    c = {}
    for p in sq:
        c[p["team"]] = c.get(p["team"],0)+1
        if c[p["team"]] > 3: return False
    gks = sorted([p for p in sq if p["pos"]=="GK"], key=lambda x:-x["score"])
    if len(gks)==2 and gks[1]["price"] > 4.6: return False
    return True

def obj(sq):
    xv,_ = bxi(sq)
    return xv + 0.20*(sum(p["score"] for p in sq)-xv)

def rv(rng):
    sq = list(LOCKED)
    sq.append(rng.choice(cheap_gk[:6]))                 # cheap 2nd GK
    for pos in ("DEF","MID","FWD"):
        need = free_need[pos]
        if need <= 0: continue
        c = [x for x in bypos[pos] if x["id"] not in {p["id"] for p in sq}][:45]
        sq += rng.sample(c, need)
    t = 0
    while not feas(sq) and t < 4000:
        t += 1; cc = {}
        for p in sq: cc[p["team"]] = cc.get(p["team"],0)+1
        over = [k for k,v in cc.items() if v>3]
        if over:
            vic = [p for p in sq if p["team"]==over[0] and p["id"] not in lset]
            if not vic: return None
            v = rng.choice(vic)
        elif sum(p["price"] for p in sq) > 100:
            outs = [p for p in sq if p["id"] not in lset and not (p["pos"]=="GK" and p["price"]<=4.6)]
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
        v = rng.choice([p for p in sq if p["id"] not in lset])   # never swap locked
        alt = [c for c in bypos[v["pos"]] if c["id"] not in {p["id"] for p in sq}]
        if not alt: continue
        new = [rng.choice(alt[:70]) if p["id"]==v["id"] else p for p in sq]
        if feas(new):
            nv = obj(new)
            if nv > cur: sq, cur = new, nv
    return sq, cur

rng = random.Random(5); best=None; bo=-1
for _ in range(1600):
    s = rv(rng)
    if s is None: continue
    s, v = hc(s, rng, 1500)
    if v > bo: bo, best = v, s
best, bo = hc(best, rng, 80000)

xv,(xi,form) = bxi(best)
xids = {p["id"] for p in xi}
bench = [p for p in best if p["id"] not in xids]
bgk = [p for p in bench if p["pos"]=="GK"]
bout = sorted([p for p in bench if p["pos"]!="GK"], key=lambda x:-x["score"])
bench_ord = bgk + bout
order = {"GK":0,"DEF":1,"MID":2,"FWD":3}
xi_s = sorted(xi, key=lambda x:(order[x["pos"]], -x["score"]))
total = sum(p["price"] for p in best)

def tag(p): return " 🔒" if p["id"] in lset else ""
print(f"CORE  FORMATION {form[1]}-{form[2]}-{form[3]}  SPEND £{total:.1f}m  BANK £{100-total:.1f}m  (locked £{locked_cost:.1f}m)")
print("="*104)
hdr=f"{'PLAYER':14s}{'TM':5s}{'POS':4s}{'£':>6s}{'25pts':>6s}{'st':>4s}{'fdr5':>6s}{'rel':>6s}{'score':>7s}  first-5"
print("-- STARTING XI --\n"+hdr)
for p in xi_s:
    seq=" ".join(f"{n['fdr']}{n['loc']}" for n in p["fdr_seq"]) if p["fdr_seq"] else ""
    print(f"{p['name']+tag(p):16s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>6d}{p['starts']:>4d}{p['fdr']:>6.2f}{p['rel']:>6.2f}{p['score']:>7.0f}  {seq}")
print("-- BENCH --")
for p in bench_ord:
    seq=" ".join(f"{n['fdr']}{n['loc']}" for n in p["fdr_seq"]) if p["fdr_seq"] else ""
    print(f"{p['name']+tag(p):16s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>6d}{p['starts']:>4d}{p['fdr']:>6.2f}{p['rel']:>6.2f}{p['score']:>7.0f}  {seq}")
clubs={}
for p in best: clubs[p["team"]]=clubs.get(p["team"],0)+1
print("clubs>1:", {k:v for k,v in sorted(clubs.items(),key=lambda x:-x[1]) if v>1})
nailed = sum(1 for p in best if p["starts"]>=30)
print(f"set-and-forget check: {nailed}/15 players had >=30 starts last season")

out={"mode":"core","formation":f"{form[1]}-{form[2]}-{form[3]}","spend":round(total,1),"bank":round(100-total,1),
     "locked":[p["name"] for p in LOCKED],
     "xi":[{k:p[k] for k in ("name","team","pos","price","pts","starts","fdr","score")}|{"locked":p["id"] in lset} for p in xi_s],
     "bench":[{k:p[k] for k in ("name","team","pos","price","pts","starts","fdr","score")}|{"locked":p["id"] in lset} for p in bench_ord]}
json.dump(out, open(ROOT/"data/reports/preseason_2627_core.json","w"), ensure_ascii=False, indent=2)

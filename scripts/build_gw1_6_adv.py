#!/usr/bin/env python3
"""
APEX FPL HQ — GW1-6 sprint build WITH Decision Principles #3/#4/#5 layered on.
Base = build_gw1_6 (6-GW FDR, nailed, locks Haaland+Bruno, bans Gabriel+Raya).
Modifiers on the attacker/attacking side:
  #3 xG-delta regression  — discount overperformers (unsustainable finishing), nudge underperformers up
  #4 attack quality       — reward Threat(≈SiB)+Creativity(≈BCC) z-score
  #5 def-weakness target   — reward attackers whose GW1-6 opponents leak most (avg opponent xGC/90)
Reads data/advanced_stats.json (from scripts/fetch_advanced_stats.py).
"""
import json, random, statistics, urllib.request, os
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
feat = json.load(open(ROOT/"data/features.json"))
hist = json.load(open(ROOT/"data/backtest/history.json"))
adv  = json.load(open(ROOT/"data/advanced_stats.json"))

def get(p):
    r=urllib.request.Request("https://fantasy.premierleague.com/api/"+p,headers={"User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=40))
boot=get("bootstrap-static/"); fx=get("fixtures/")
short={t["id"]:t["short_name"] for t in boot["teams"]}
id_by_short={v:k for k,v in short.items()}
start_gw=int(os.environ.get("START", next((str(e["id"]) for e in boot["events"] if e.get("is_next")),"1")))
# --- FORM blend (data update): fold GW1-2 actual pace into the last-season pts baseline.
#     Fixture+Stats>Form => keep the weight modest & cap the 2-GW pace (avoid hot-start noise).
GW_ELAPSED=sum(1 for e in boot["events"] if e.get("finished") or e.get("data_checked")
               or (e.get("is_current") and __import__("datetime").datetime.now().isoformat()>e.get("deadline_time","")))
FORM_W  =float(os.environ.get("FORM","0"))     # 0=off; 0.3 = 30% weight on GW1-2 pace
FORM_CAP=float(os.environ.get("FORMCAP","260")) # cap extrapolated season pace (Bruno 25pts/2*38=475 -> 260)

# --- attacking-defender index (fullbacks/wingbacks pushed forward who add
#     goals+assists on top of clean sheets, e.g. Hume SUN). Built from LIVE boot:
#     z(threat)+z(creativity)+z(xGI/90) among defenders => higher = more attacking.
def _z(vals):
    m=statistics.mean(vals); s=statistics.pstdev(vals) or 1.0; return m,s
_defel=[e for e in boot["elements"] if e["element_type"]==2 and (e.get("starts",0) or 0)>=10]
def _x90(e): return (float(e.get("expected_goal_involvements",0) or 0)/max(e.get("minutes",0) or 1,1))*90
def_atk={}
if _defel:
    mt,st_=_z([float(e.get("threat",0) or 0) for e in _defel])
    mc,sc =_z([float(e.get("creativity",0) or 0) for e in _defel])
    mx,sx =_z([_x90(e) for e in _defel])
    for e in _defel:
        z=(float(e.get("threat",0) or 0)-mt)/st_+(float(e.get("creativity",0) or 0)-mc)/sc+(_x90(e)-mx)/sx
        def_atk[(e["web_name"],short[e["team"]])]=round(z,2)
ATK_DEF=os.environ.get("ATK_DEF","1")!="0"   # attacking-defender boost on by default
ATK_W  =float(os.environ.get("ATK_W","0.05")) # per-z boost weight for DEF attacking returns
DIV_W  =float(os.environ.get("DIV","0.0"))    # diversity: reward per distinct club (spread risk)
_m3=os.environ.get("MAX3_CLUBS")              # clubs allowed 3 (title contenders); others capped 2
MAX3_CLUBS=set(_m3.split(",")) if _m3 not in (None,"") else None
MAXCLUB=int(os.environ.get("MAXCLUB","3"))    # global per-club cap (set 2 to force spread)
def cap_for(team):
    if MAX3_CLUBS is not None: return 3 if team in MAX3_CLUBS else 2
    return MAXCLUB

# team xGC/90 (leakiness) from advanced_stats
team_xgc={w["team"]:w["xgc_per90"] for w in adv["team_def_weakness"]}
LG_XGC=statistics.mean(team_xgc.values())

# per team: 6-GW FDR (home-weighted) + avg opponent xGC over those 6 (for #5)
byteam=defaultdict(list)
for f in fx:
    ev=f.get("event")
    if ev is None or ev<start_gw: continue
    if f["team_h"]: byteam[f["team_h"]].append((ev,f["team_h_difficulty"],"H",short[f["team_a"]]))
    if f["team_a"]: byteam[f["team_a"]].append((ev,f["team_a_difficulty"],"A",short[f["team_h"]]))
team_fdr6={}; team_seq6={}; team_oppxgc={}
for tid,rows in byteam.items():
    rows.sort(key=lambda x:x[0]); rows=rows[:6]
    team_fdr6[short[tid]]=round(statistics.mean(d+(0.3 if loc=="A" else 0) for _,d,loc,_ in rows),3)
    team_seq6[short[tid]]=[{"fdr":d,"loc":l} for _,d,l,_ in rows]
    opps=[team_xgc.get(opp,LG_XGC) for _,_,_,opp in rows]
    team_oppxgc[short[tid]]=round(statistics.mean(opps),3)

# advanced stats by (name, team)
adv_by={(p["name"],p["team"]):p for p in adv["players"]}

hcon={}
for p in hist["players"]:
    pl=[g for g in p["gws"] if g["min"]>0]
    if pl: hcon[p["name"]]={"am":statistics.mean(g["min"] for g in pl)}

POS={"GKP":"GK","DEF":"DEF","MID":"MID","FWD":"FWD"}
def _spec(env,default):
    v=os.environ.get(env)
    if v is None: return default
    v=v.strip()
    return [] if not v else [tuple(x.split(":")) for x in v.split(",")]
LOCKED_SPEC=_spec("LOCKS",[("Haaland","MCI"),("B.Fernandes","MUN")]); BANNED_SPEC=_spec("BANS",[("Gabriel","ARS"),("Raya","ARS")])
OUT_NAME=os.environ.get("OUT","gw1_6_adv")
LOCKED_IDS=[next(p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t) for n,t in LOCKED_SPEC]
BANNED_IDS={next((p["id"] for p in feat["players"] if p["web_name"]==n and p["team"]==t),None) for n,t in BANNED_SPEC}
LF,A=3.30,1.35; STARTS_FLOOR=int(os.environ.get("SFLOOR","22"))  # min last-season starts for FREE (non-locked) picks; lower to afford cheap enablers in premium-heavy builds

def mods(p, pos):
    """return (finisher_factor#3, aq_factor#4, opp_leak_factor#5, tags)"""
    a=adv_by.get((p["web_name"],p["team"]))
    fF=aqF=1.0; tags=[]
    if a and pos in ("FWD","MID"):
        # #3 regression on finishing
        d=a.get("xg_delta_per90",0)
        if a.get("finisher_class")=="overperformer": fF=0.88; tags.append(f"OVER Δ{a['xg_delta']:+.1f}")
        elif a.get("finisher_class")=="underperformer": fF=1.06; tags.append(f"under Δ{a['xg_delta']:+.1f}")
        # #4 attack quality
        aq=a.get("attack_quality")
        if aq is not None:
            aqF=1.0+0.06*max(-2.0,min(3.0,aq))
            if aq>=1.5: tags.append(f"AQ{aq:+.1f}")
    # #5 opponent leakiness (attackers benefit vs leaky defences)
    olF=1.0
    if pos in ("FWD","MID","DEF"):   # DEF too (attacking returns), but weaker
        w=0.5 if pos!="DEF" else 0.2
        ratio=team_oppxgc.get(p["team"],LG_XGC)/LG_XGC
        olF=ratio**w
    # attacking-defender boost: advanced FBs/WBs return goals+assists (Hume-type)
    if ATK_DEF and pos=="DEF":
        z=def_atk.get((p["web_name"],p["team"]))
        if z and z>0:
            olF*=1.0+ATK_W*min(4.0,z)
            if z>=1.5: tags.append(f"ATK+{z:.1f}")
    return fF,aqF,olF,tags

def mk(p):
    team=p["team"]; pos=POS[p["pos"]]
    fa=team_fdr6.get(team); ff=(LF/fa)**A
    st=p.get("starts",0) or 0; rel=0.45+0.55*min(1.0,st/30.0)
    h=hcon.get(p["web_name"])
    if h: rel*=(0.90+0.10*min(1.0,h["am"]/85.0))
    fF,aqF,olF,tags=mods(p,pos)
    base=p["pts"]*ff*rel
    score=base*fF*aqF*olF
    return {"id":p["id"],"name":p["web_name"],"team":team,"pos":pos,"price":p["price"],
            "pts":p["pts"],"starts":st,"fdr6":fa,"oppxgc":team_oppxgc.get(team),
            "adj":round(fF*aqF*olF,3),"tags":" ".join(tags),"score":score}

# LIVE cross-check: features.json can be stale (players who changed club, e.g.
# Lacroix CRY->CHE). Require each pool player to exist in the LIVE bootstrap with
# matching team; use LIVE price + LIVE availability. Keeps last-season pts/starts.
live_by={(e["web_name"],short[e["team"]]):e for e in boot["elements"]}
pool,byid=[],{}
for p in feat["players"]:
    if p["pos"] not in POS or p["id"] in BANNED_IDS: continue
    lv=live_by.get((p["web_name"],p["team"]))
    if lv is None: continue                                       # not in live (moved/left)
    if p["id"] not in LOCKED_IDS and lv["status"]!="a": continue  # live availability
    if p["id"] not in LOCKED_IDS and p["status"] in ("i","s","u","d"): continue
    if p["team"] not in team_fdr6: continue
    if p["id"] not in LOCKED_IDS and (p.get("starts",0) or 0)<STARTS_FLOOR: continue
    p=dict(p); p["price"]=lv["now_cost"]/10                       # use LIVE price
    if FORM_W>0 and GW_ELAPSED>0:                                  # blend GW1-2 actual pace
        pace=min(FORM_CAP,(lv.get("total_points",0) or 0)/GW_ELAPSED*38)
        p["pts"]=(1-FORM_W)*p["pts"]+FORM_W*pace
    m=mk(p); pool.append(m); byid[p["id"]]=m

LOCKED=[byid[i] for i in LOCKED_IDS]; NEED={"GK":2,"DEF":5,"MID":5,"FWD":3}
N_LOCKED_GK=sum(1 for p in LOCKED if p["pos"]=="GK")
free_need={k:NEED[k]-sum(1 for p in LOCKED if p["pos"]==k) for k in NEED}; lset=set(LOCKED_IDS)
bypos={k:sorted([p for p in pool if p["pos"]==k and p["id"] not in lset],key=lambda x:-x["score"]) for k in NEED}
cheap_gk=sorted([p for p in bypos["GK"] if p["price"]<=4.5],key=lambda x:(x["price"],-x["score"]))
MAXDEF=int(os.environ.get("MAXDEF","5"))  # cap DEF in XI (set 4 to force a bigger midfield)
FORMS=[(d,m,f) for d in range(3,6) for m in range(2,6) for f in range(1,4) if d+m+f==10 and d<=MAXDEF]

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
        if c[p["team"]]>cap_for(p["team"]): return False
    pc={"GK":0,"DEF":0,"MID":0,"FWD":0}
    for p in sq: pc[p["pos"]]+=1
    if pc!=NEED: return False
    gks=sorted([p for p in sq if p["pos"]=="GK"],key=lambda x:-x["score"])
    if len(gks)==2 and gks[1]["price"]>4.5 and N_LOCKED_GK<2: return False
    return True
def obj(sq):
    xv,_=bxi(sq); base=xv+0.12*(sum(p["score"] for p in sq)-xv)
    if DIV_W>0: base+=DIV_W*len({p["team"] for p in sq})   # spread across more clubs
    return base
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
        over=[k for k,v in cc.items() if v>cap_for(k)]
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
for _ in range(1400):
    s=rv(rng)
    if s is None: continue
    s,v=hc(s,rng,1400)
    if v>bo: bo,best=v,s
best,bo=hc(best,rng,70000)

xv,(xi,form)=bxi(best); xids={p["id"] for p in xi}
bench=[p for p in best if p["id"] not in xids]
order={"GK":0,"DEF":1,"MID":2,"FWD":3}
xi_s=sorted(xi,key=lambda x:(order[x["pos"]],-x["score"]))
bench_s=sorted(bench,key=lambda x:(order[x["pos"]],-x["score"]))
def tag(p): return " 🔒" if p["id"] in lset else ""
print(f"GW1-6 +ADV  {form[1]}-{form[2]}-{form[3]}  £{sum(p['price'] for p in best):.1f}m")
print(f"{'PLAYER':15s}{'TM':5s}{'POS':4s}{'£':>6s}{'pts':>5s}{'FDR6':>6s}{'oppxGC':>7s}{'adj':>6s}  #3/#4 tags")
for lbl,grp in [("XI",xi_s),("BENCH",bench_s)]:
    print(f"-- {lbl} --")
    for p in grp:
        print(f"{p['name']+tag(p):17s}{p['team']:5s}{p['pos']:4s}{p['price']:>6.1f}{p['pts']:>5.0f}{p['fdr6']:>6.2f}{(p['oppxgc'] or 0):>7.2f}{p['adj']:>6.2f}  {p['tags']}")
def _r(p):
    q={k:p[k] for k in ("name","team","pos","price","pts","fdr6","oppxgc","adj","tags")}; q["pts"]=round(q["pts"],1); return q
out={"mode":"gw1-6+adv","formation":f"{form[1]}-{form[2]}-{form[3]}","spend":round(sum(p['price'] for p in best),1),
     "xi":[_r(p) for p in xi_s],
     "bench":[_r(p) for p in bench_s]}
json.dump(out,open(ROOT/f"data/reports/{OUT_NAME}.json","w"),ensure_ascii=False,indent=2)

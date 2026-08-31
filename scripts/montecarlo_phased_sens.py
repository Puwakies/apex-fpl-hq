#!/usr/bin/env python3
"""
APEX FPL HQ — MC GW3-12 sensitivity: GW10 ARS entrant + TC@GW7.
Builds on montecarlo_phased. All BAL variants = balanced GW3 (Haaland+Palmer+strong D),
Bruno@GW6 (with Virgil funding downgrade). Only the GW10 move + captain differ.

Answers 3 questions:
 (1) Tzolis pts SENSITIVITY — sweep Tzolis season-pts; how much does GW3-12 depend on it?
 (2) Tzolis vs Ødegaard vs Eze as the GW10 entrant/captain (all ARS £6.4-6.6). Raw
     last-season data is injury-deflated (Ødegaard 74, Eze 113, Tzolis none) so we test
     ability-adjusted estimates too; plus a "no ARS move" ref (keep Anderson, cap Haaland/Bruno).
 (3) TC@GW7 (Haaland ×3) added to both LOCK4 and BAL — does the ranking move?

Each scenario runs LOCK4 + its BAL variant on SHARED draws (common random numbers) for a
clean paired win-rate. Output: data/reports/montecarlo_phased_sens.json
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

def mkp(name,team,pos,pts,xi,key=None):
    # early 26/27 (only ~2 GWs played) => live ppg is 2-game noise. Use the last-season
    # baseline (pts/38) so the ability ESTIMATE actually drives ppg (needed for sensitivity).
    e=elem.get((name,team)); st=(e.get("starts",0) or 0) if e else 0
    ppg=pts/38.0
    nail=min(0.97,0.72+0.25*min(st,34)/34.0)   # nail floor ~0.72 (early season; symmetric)
    return {"name":name,"team":team,"pos":pos,"xi":xi,"key":key or (name,team),
            "ppg":min(ppg,9.0),"nail":nail,"k":K[pos]}

def load(fnm):
    d=json.load(open(ROOT/f"data/reports/{fnm}.json")); sq=[]
    for grp,xi in ((d["xi"],True),(d["bench"],False)):
        for p in grp: sq.append(mkp(p["name"],p["team"],p["pos"],p.get("pts",40),xi))
    return sq
LOCK4=load("wc_gw3_captain_matrix"); BAL0=load("wc_gw3_balanced")
BRUNO=mkp("B.Fernandes","MUN","MID",235,True)
CHEAPDEF=mkp("_cheapDEF","BOU","DEF",100,True,key=("_cheapDEF","BOU"))  # £4.5 nailed def (neutral team)

def swap(sq,out_name,newp):
    out=[p for p in sq if p["name"]==out_name][0]; np=dict(newp); np["xi"]=out["xi"]
    return [np if p["name"]==out_name else p for p in sq]

def bal_squad(gw, entrant):
    """entrant=dict(name,team,pts,key) or None(keep Anderson)."""
    sq=[dict(p) for p in BAL0]
    if gw>=6:
        sq=swap(sq,"Gibbs-White",BRUNO); sq=swap(sq,"Virgil",CHEAPDEF)
    if gw>=10 and entrant is not None:
        e=mkp(entrant["name"],entrant["team"],"MID",entrant["pts"],True,key=entrant["key"])
        sq=swap(sq,"Anderson",e)
    return sq
def lock4_squad(gw): return [dict(p) for p in LOCK4]

BASE_CAP={3:("Haaland","MCI"),4:("Palmer","CHE"),5:("Haaland","MCI"),6:("B.Fernandes","MUN"),
          7:("Haaland","MCI"),8:("B.Fernandes","MUN"),9:("Haaland","MCI"),
          11:("Haaland","MCI"),12:("B.Fernandes","MUN")}

def score(sq,gw,pts,played,cap,tc_gw):
    xi=[p for p in sq if p["xi"]]; bench=[p for p in sq if not p["xi"]]
    def V(p): return pts.get(p["key"],0.0)
    subs=sorted([b for b in bench if b["pos"]!="GK"],key=lambda b:-b["ppg"]); used=0; s=0.0
    for p in xi:
        if played.get(p["key"]): s+=V(p)
        elif p["pos"]!="GK" and used<len(subs):
            sb=subs[used]; used+=1
            if played.get(sb["key"]): s+=V(sb)
    mult_cap=(3 if gw==tc_gw else 2)-1
    if played.get(cap): s+=pts.get(cap,0.0)*mult_cap
    return s

def scenario(entrant, gw10_cap, tc_gw=None, N=6000, seed=7):
    """returns (bal_raw, lock_raw, bal_gw10cap_mean) paired on shared draws."""
    rng=random.Random(seed)
    # universe
    uni={}
    for gw in range(3,13):
        for p in lock4_squad(gw)+bal_squad(gw,entrant): uni[p["key"]]=p
    teams=list({p["team"] for p in uni.values()})
    bal=[]; lok=[]; g10=[]
    for _ in range(N):
        rb=rl=0.0; c10=0.0
        for gw in range(3,13):
            tshock={t:rng.gammavariate(kT,1.0/kT) for t in teams}
            pts={}; played={}
            for key,p in uni.items():
                pl=rng.random()<=p["nail"]; played[key]=pl
                mu=max(0.05,p["ppg"]*mult(p["team"],gw)*tshock[p["team"]])
                pts[key]=rng.gammavariate(p["k"], mu/p["k"]) if pl else 0.0
            bcap=gw10_cap if gw==10 else BASE_CAP[gw]
            lcap=("Saka","ARS") if gw==10 else BASE_CAP[gw]     # LOCK4 always owns Saka for GW10
            rb+=score(bal_squad(gw,entrant),gw,pts,played,bcap,tc_gw)
            rl+=score(lock4_squad(gw),gw,pts,played,lcap,tc_gw)
            if gw==10 and played.get(bcap): c10+=pts.get(bcap,0.0)*2
        bal.append(rb); lok.append(rl); g10.append(c10)
    return bal,lok,statistics.mean(g10)

def stats(v):
    s=sorted(v); n=len(v)
    return {"mean":statistics.mean(s),"p10":s[int(.1*n)],"p50":s[int(.5*n)],"p90":s[int(.9*n)],"std":statistics.pstdev(s)}
def winrate(a,b): return sum(1 for x,y in zip(a,b) if x>y)/len(a)

N=6000; OUT={}
# LOCK4 baseline (same across scenarios, seed fixed) — compute once via a ref scenario
print(f"=== MC GW3-12 sensitivity  (N={N}, captain matrix, team shocks) ===\n")

# (1) Tzolis pts sensitivity
print("(1) TZOLIS pts SENSITIVITY  (BAL, GW10 cap=Tzolis, no TC)")
print(f"    {'Tzolis season-pts':20s}{'BAL mean':>9s}{'ΔvsLOCK4':>9s}{'P(beat)':>9s}{'GW10cap':>9s}")
tz_rows=[]
for tp in (80,110,140,170,200):
    ent={"name":"Tzolis","team":"ARS","pts":tp,"key":("Tzolis","ARS")}
    bal,lok,g10=scenario(ent,("Tzolis","ARS"),tc_gw=None,N=N)
    sb=stats(bal); sl=stats(lok)
    print(f"    pts={tp:<16d}{sb['mean']:>9.0f}{sb['mean']-sl['mean']:>+9.1f}{winrate(bal,lok)*100:>8.0f}%{g10:>9.1f}")
    tz_rows.append({"tzolis_pts":tp,"bal_mean":round(sb['mean'],1),"delta_vs_lock4":round(sb['mean']-sl['mean'],1),
                    "p_beat_lock4":round(winrate(bal,lok),3),"gw10_cap_mean":round(g10,1)})
    if tp==140: LOCK_MEAN=sl['mean']
OUT["tzolis_sensitivity"]=tz_rows
print(f"    (LOCK4 baseline mean ≈ {LOCK_MEAN:.0f})\n")

# (2) entrant comparison: raw vs ability-adjusted, + no-ARS refs
print("(2) GW10 ENTRANT COMPARE  (BAL mean / Δ vs LOCK4 / GW10 cap contribution)")
print(f"    {'variant':34s}{'BAL mean':>9s}{'ΔvsLOCK4':>9s}{'P(beat)':>9s}{'GW10cap':>9s}")
variants=[
 ("no ARS — keep Anderson, cap Haaland", None, ("Haaland","MCI")),
 ("no ARS — keep Anderson, cap Bruno",   None, ("B.Fernandes","MUN")),
 ("Tzolis  raw~120",  {"name":"Tzolis","team":"ARS","pts":120,"key":("Tzolis","ARS")},  ("Tzolis","ARS")),
 ("Eze     raw 113",  {"name":"Eze","team":"ARS","pts":113,"key":("Eze","ARS")},        ("Eze","ARS")),
 ("Eze     fit ~160", {"name":"Eze","team":"ARS","pts":160,"key":("Eze","ARS")},        ("Eze","ARS")),
 ("Ødegaard raw 74",  {"name":"Ødegaard","team":"ARS","pts":74,"key":("Ødegaard","ARS")},("Ødegaard","ARS")),
 ("Ødegaard fit ~185",{"name":"Ødegaard","team":"ARS","pts":185,"key":("Ødegaard","ARS")},("Ødegaard","ARS")),
]
ent_rows=[]
for lbl,ent,cap in variants:
    bal,lok,g10=scenario(ent,cap,tc_gw=None,N=N); sb=stats(bal); sl=stats(lok)
    print(f"    {lbl:34s}{sb['mean']:>9.0f}{sb['mean']-sl['mean']:>+9.1f}{winrate(bal,lok)*100:>8.0f}%{g10:>9.1f}")
    ent_rows.append({"variant":lbl,"bal_mean":round(sb['mean'],1),"delta_vs_lock4":round(sb['mean']-sl['mean'],1),
                     "p_beat_lock4":round(winrate(bal,lok),3),"gw10_cap_mean":round(g10,1)})
OUT["entrant_compare"]=ent_rows

# (3) TC@GW7 (Haaland x3) on both teams
print("\n(3) TRIPLE CAPTAIN @GW7 (Haaland ×3) — BAL(Tzolis~130) vs LOCK4")
print(f"    {'setup':22s}{'BAL':>7s}{'LOCK4':>7s}{'ΔBAL-LOCK':>10s}{'BAL P90':>9s}{'LOCK P90':>9s}")
ent130={"name":"Tzolis","team":"ARS","pts":130,"key":("Tzolis","ARS")}
tc_rows=[]
for lbl,tcg in (("no TC",None),("TC@GW7",7)):
    bal,lok,_=scenario(ent130,("Tzolis","ARS"),tc_gw=tcg,N=N); sb=stats(bal); sl=stats(lok)
    print(f"    {lbl:22s}{sb['mean']:>7.0f}{sl['mean']:>7.0f}{sb['mean']-sl['mean']:>+10.1f}{sb['p90']:>9.0f}{sl['p90']:>9.0f}")
    tc_rows.append({"setup":lbl,"bal_mean":round(sb['mean'],1),"lock4_mean":round(sl['mean'],1),
                    "delta":round(sb['mean']-sl['mean'],1),"bal_p90":round(sb['p90'],1),"lock4_p90":round(sl['p90'],1),
                    "bal_p_beat":round(winrate(bal,lok),3)})
OUT["tc_gw7"]=tc_rows
json.dump(OUT,open(ROOT/"data/reports/montecarlo_phased_sens.json","w"),ensure_ascii=False,indent=2)
print("\nsaved -> data/reports/montecarlo_phased_sens.json")

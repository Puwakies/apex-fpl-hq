#!/usr/bin/env python3
"""
APEX FPL HQ — WC GW3 team + transfer plan GW3->GW7 (pre international break).
Post-WC we get 1 FT/GW (GW4..7). Locked set-and-forget core is never sold:
  Haaland, B.Fernandes, Joao Pedro (JP), Raya, Kelleher (both GKs long-term).
Logic:
  - per-GW captain = best owned XI by (season pts) x fixture mult
  - value each NON-locked outfielder by its GW4-7 fixture run -> weakest = FT target
  - propose ONE proactive swap for the weakest link, same-price, better GW6-7 fixtures
  - chips already set: BB1@GW2, WC1@GW3, TC1@GW7 (Haaland home vs IPS)
Output: data/reports/wc3_plan.json
"""
import json, urllib.request, statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def get(p):
    r=urllib.request.Request("https://fantasy.premierleague.com/api/"+p,headers={"User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=40))
boot=get("bootstrap-static/"); fx=get("fixtures/")
short={t["id"]:t["short_name"] for t in boot["teams"]}
POSm={1:"GK",2:"DEF",3:"MID",4:"FWD"}
elem={(e["web_name"],short[e["team"]]):e for e in boot["elements"]}
adv={(p["name"],p["team"]):p for p in json.load(open(ROOT/"data/advanced_stats.json"))["players"]}

FX={}
for f in fx:
    ev=f.get("event")
    if ev is None or ev<3 or ev>8: continue
    FX[(short[f["team_h"]],ev)]=(f["team_h_difficulty"],"H",short[f["team_a"]])
    FX[(short[f["team_a"]],ev)]=(f["team_a_difficulty"],"A",short[f["team_h"]])
def mult(team,gw):
    v=FX.get((team,gw))
    if not v: return 0.9
    return max(0.75,min(1.4,(3.3/(v[0]+0.3*(v[1]=="A")))**0.7))
def fxs(team,gw):
    v=FX.get((team,gw)); return f"{v[0]}{v[1]}v{v[2]}" if v else "-"

import os
TEAM=os.environ.get("TEAM","wc_gw3_prem")   # chosen WC GW3 team (default = PREM, no Bruno)
_lk=os.environ.get("LOCKED","Haaland,João Pedro,Semenyo,Raya,Kelleher")
LOCKED=set(_lk.split(","))|{"Joao Pedro","Joao Pedro "}
d=json.load(open(ROOT/f"data/reports/{TEAM}.json"))
xi=d["xi"]; bench=d["bench"]; squad=xi+bench
def pts(p):  # season pts proxy for captain ranking
    e=elem.get((p["name"],p["team"])); return e["total_points"] if e else p.get("pts",0)

# ---- per-GW captain among owned XI (GW3-7) ----
caps={}
for gw in range(3,8):
    c=max([p for p in xi if p["pos"]!="GK"],key=lambda p:pts(p)*mult(p["team"],gw))  # never (C) a keeper
    caps[gw]=c

# ---- value each non-locked OUTFIELD player over GW4-7 -> weakest link ----
def run_val(p): return statistics.mean(mult(p["team"],g) for g in range(4,8))
movable=[p for p in squad if p["name"] not in LOCKED and p["pos"]!="GK"]
ranked=sorted(movable,key=run_val)
weakest=ranked[0]

# ---- find same-price replacement for weakest with better GW6-7 fixtures ----
def cand(pos,price):
    out=[]
    for (nm,tm),e in elem.items():
        if POSm[e["element_type"]]!=pos or e["status"]!="a": continue
        st=e.get("starts",0) or 0
        if st<20: continue
        pr=e["now_cost"]/10
        if abs(pr-price)>0.5: continue
        if nm in {p["name"] for p in squad}: continue
        a=adv.get((nm,tm))
        if a and a.get("finisher_class")=="overperformer": continue  # avoid regression buys (#3)
        g67=mult(tm,6)+mult(tm,7)
        out.append({"name":nm,"team":tm,"pos":pos,"price":pr,"pts":e["total_points"],
                    "g67":round(g67,2),"g47":round(statistics.mean(mult(tm,g) for g in range(4,8)),3)})
    return sorted(out,key=lambda x:-x["g67"])
repl=cand(weakest["pos"],weakest["price"])[:6]

print("=== WC GW3 team — captain per GW (GW3-7) ===")
for gw in range(3,8):
    c=caps[gw]; chip={3:"WC",7:"TC "+c["name"]}.get(gw,"-")
    print(f"  GW{gw}: (C) {c['name']:12s} {c['team']} {fxs(c['team'],gw):9s}  chip={chip}")

print(f"\n=== weakest GW4-7 run among movable (non-locked, non-GK) ===")
for p in ranked[:4]:
    seq=" ".join(fxs(p['team'],g) for g in range(4,8))
    print(f"  {p['name']:14s}{p['team']:4s}{p['pos']:4s} run={run_val(p):.3f}  {seq}")
print(f"\n=== FT target = {weakest['name']} ({weakest['team']} {weakest['pos']} £{weakest['price']}) — replace before GW6-7 ===")
print(f"  {'IN':14s}{'TM':4s}{'£':>5s}{'pts':>5s}{'GW6+7':>7s}   GW6 / GW7")
for r in repl:
    print(f"  {r['name']:14s}{r['team']:4s}{r['price']:>5.1f}{r['pts']:>5d}{r['g67']:>7.2f}   {fxs(r['team'],6)} / {fxs(r['team'],7)}")

plan={
 "chips":{"BB1":"GW2","WC1":"GW3","TC1":"GW7 (Haaland H vs IPS)"},
 "captains":{f"GW{g}":{"name":caps[g]["name"],"team":caps[g]["team"],"fix":fxs(caps[g]["team"],g)} for g in range(3,8)},
 "ft_flow":{
   "GW4":"BANK (fresh WC team) — 1 FT saved",
   "GW5":"BANK — 2 FT saved (unless injury/news)",
   "GW6":f"SPEND 1: {weakest['name']} OUT -> best GW6-7 FWD IN (fix weak run before TC week)",
   "GW7":"BANK/react + TC on Haaland (2H vs IPS)"},
 "ft_target_out":{k:weakest[k] for k in ("name","team","pos","price")},
 "ft_target_in_options":repl}
json.dump(plan,open(ROOT/"data/reports/wc3_plan.json","w"),ensure_ascii=False,indent=2)
print("\nsaved -> data/reports/wc3_plan.json")

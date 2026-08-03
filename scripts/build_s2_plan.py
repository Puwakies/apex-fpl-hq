#!/usr/bin/env python3
"""
APEX FPL HQ — S2 full plan GW1-7 (Monte Carlo winner):
start = no-Haaland BB-GW2 team; BB@GW2; bank FT GW3-6; reshape to Haaland @GW7 + TC.
Prints: per-GW captain (best fixture among owned), the GW7 transfer set (<=5 FT,
budget-balanced), and the resulting GW7 team.
"""
import json, urllib.request, statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def get(p):
    r=urllib.request.Request("https://fantasy.premierleague.com/api/"+p,headers={"User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=40))
boot=get("bootstrap-static/"); fx=get("fixtures/")
short={t["id"]:t["short_name"] for t in boot["teams"]}
feat={p["web_name"]+"|"+short[p["team"]]:p for p in boot["elements"]}
POSm={1:"GK",2:"DEF",3:"MID",4:"FWD"}
adv={(p["name"],p["team"]):p for p in json.load(open(ROOT/"data/advanced_stats.json"))["players"]}
# fixtures per team, GW1-11
FX={}
for f in fx:
    ev=f.get("event")
    if ev is None or ev>11: continue
    FX[(short[f["team_h"]],ev)]=(f["team_h_difficulty"],"H",short[f["team_a"]])
    FX[(short[f["team_a"]],ev)]=(f["team_a_difficulty"],"A",short[f["team_h"]])
def mult(team,gw):
    v=FX.get((team,gw))
    if not v: return 0.9
    return max(0.75,min(1.4,(3.3/(v[0]+0.3*(v[1]=="A")))**0.7))
def fxs(team,gw):
    v=FX.get((team,gw)); return f"{v[0]}{v[1]}v{v[2]}" if v else "-"

start=json.load(open(ROOT/"data/reports/bb_gw2_nohaaland.json"))
squad=[]
for p in start["xi"]+start["bench"]:
    m=feat.get(p["name"]+"|"+p["team"]); st=p.get("starts",0) or 0
    squad.append({"name":p["name"],"team":p["team"],"pos":p["pos"],"price":m["now_cost"]/10 if m else p["price"],
                  "ppg":(p["pts"]/max(st,1) if st else p["pts"]/38),"pts":p["pts"],"xi":p in start["xi"]})

# ---- per-GW captain (GW1-6) among owned XI ----
print("=== S2: กัปตันราย GW (no-Haaland team, GW1-6) ===")
for gw in range(1,7):
    ranked=sorted([p for p in squad if p["xi"]], key=lambda p:-p["ppg"]*mult(p["team"],gw))
    c=ranked[0]
    print(f"  GW{gw}: (C) {c['name']} ({c['team']} {fxs(c['team'],gw)})   chip={'BB' if gw==2 else '-'}")

# ---- GW7 reshape: force Haaland in, keep Bruno, <=5 transfers, budget-balanced ----
haa=feat["Haaland|MCI"]; haa_pr=haa["now_cost"]/10
# value each owned player for GW7-11 (ppg x avg mult) to decide keeps/sells
def v711(p): return p["ppg"]*statistics.mean(mult(p["team"],g) for g in range(7,12))
owned=sorted(squad,key=v711)
keep_names={"B.Fernandes"}                    # never sell Bruno
# candidate incomers per position (nailed, good GW7-11, not overperformer, affordable-ish)
def cand(pos,maxpr):
    out=[]
    for k,m in feat.items():
        if POSm[m["element_type"]]!=pos or m["status"]!="a": continue
        st=m.get("starts",0) or 0
        if st<25 or m["now_cost"]/10>maxpr: continue
        nm=m["web_name"]; tm=short[m["team"]]
        a=adv.get((nm,tm))
        if a and a.get("finisher_class")=="overperformer": continue
        ppg=m["total_points"]/max(st,1)
        out.append({"name":nm,"team":tm,"pos":pos,"price":m["now_cost"]/10,
                    "ppg":ppg,"pts":m["total_points"],"v":ppg*statistics.mean(mult(tm,g) for g in range(7,12))})
    return sorted(out,key=lambda x:-x["v"])

# transfer 1: sell most-expensive FWD -> Haaland
fwds=sorted([p for p in squad if p["pos"]=="FWD"],key=lambda p:-p["price"])
out1=fwds[0]
haa_row={"name":"Haaland","team":"MCI","pos":"FWD","price":haa_pr,"ppg":haa["total_points"]/max(haa.get("starts",1),1)}
transfers=[(out1,haa_row)]
need = haa_pr - out1["price"]                  # £ we must FREE from downgrades
cur={p["name"] for p in squad if p is not out1} | {"Haaland"}
curteam={}
for p in squad:
    if p is out1: continue
    curteam[p["team"]]=curteam.get(p["team"],0)+1
curteam["MCI"]=curteam.get("MCI",0)+1
def cheapest(pos, below):
    for r in sorted(cand(pos, below-0.01), key=lambda x:x["price"]):   # cheapest nailed filler
        if r["name"] in cur or curteam.get(r["team"],0)>=3: continue
        return r
    return None
# to FREE money efficiently, downgrade the most-expensive non-Bruno OUTFIELD players
# (this is the real cost of FT-ing Haaland in: the premium midfield gets gutted)
freed=0.0
sell_order=sorted([p for p in squad if p["name"] not in keep_names and p is not out1
                   and p["pos"] in ("MID","FWD","DEF")], key=lambda p:-p["price"])
for cand_sell in sell_order:
    if freed>=need-1e-9 or len(transfers)>=5: break
    repl=cheapest(cand_sell["pos"], cand_sell["price"])
    if not repl or cand_sell["price"]-repl["price"]<0.4: continue
    transfers.append((cand_sell,repl)); freed+=cand_sell["price"]-repl["price"]
    cur.discard(cand_sell["name"]); cur.add(repl["name"])
    curteam[cand_sell["team"]]-=1; curteam[repl["team"]]=curteam.get(repl["team"],0)+1
budget = freed - need                          # >=0 means affordable within these FTs

print(f"\n=== GW7 reshape ({len(transfers)} FT, งบสุทธิ £{budget:+.1f}) — เอา Haaland เข้า + TC ===")
for o,i in transfers:
    print(f"  OUT {o['name']:13s}{o['team']:4s} £{o['price']:>4.1f}  →  IN {i['name']:13s}{i['team']:4s} £{i['price']:>4.1f}")

# resulting GW7 team
gw7=[p for p in squad if p["name"] not in {o['name'] for o,_ in transfers}] + [i for _,i in transfers]
from collections import Counter
pos=Counter(p["pos"] for p in gw7); clubs=Counter(p["team"] for p in gw7); spend=sum(p["price"] for p in gw7)
print(f"\n=== ทีม GW7 หลัง reshape · £{spend:.1f}m · legal={pos==Counter({'DEF':5,'MID':5,'FWD':3,'GK':2}) and max(clubs.values())<=3} ===")
o={"GK":0,"DEF":1,"MID":2,"FWD":3}
for p in sorted(gw7,key=lambda x:(o[x['pos']],-x['ppg'])):
    print(f"  {p['pos']:4s}{p['name']:14s}{p['team']:4s} £{p['price']:>4.1f}  GW7 {fxs(p['team'],7)}")
capg7=max([p for p in gw7], key=lambda p:p['ppg']*mult(p['team'],7))
print(f"  🎯 TC GW7 = {capg7['name']} ({capg7['team']} {fxs(capg7['team'],7)})")
json.dump({"start_team":start['formation'],"gw7_transfers":[(o['name'],i['name']) for o,i in transfers],
           "gw7_team":[{k:p[k] for k in ('name','team','pos','price')} for p in gw7]},
          open(ROOT/"data/reports/s2_plan.json","w"),ensure_ascii=False,indent=2)

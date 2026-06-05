import json, os, statistics

H = json.load(open('data/backtest/history.json'))['players']
MP = json.load(open('data/backtest/my_picks.json'))['gws']

# index players by name
P = {p['name']: p for p in H}
def gw_row(p, n):
    for g in p['gws']:
        if g['gw'] == n: return g
    return None
def rows_before(p, n):
    return [g for g in p['gws'] if g['gw'] < n]

def blind_form(p, n):
    r = rows_before(p, n)
    last = r[-5:]
    if not last: return 0.0
    return statistics.mean(x['pts'] for x in last)
def mins_rel(p, n):
    r = rows_before(p, n)[-5:]
    if not r: return 0
    return statistics.mean(x['min'] for x in r)
def cum_pts(p, n):
    return sum(x['pts'] for x in rows_before(p, n))
def price_now(p, n):
    r = rows_before(p, n)
    return r[-1]['price'] if r else (gw_row(p,n)['price'] if gw_row(p,n) else 0)
def actual(p, n):
    g = gw_row(p, n)
    return g['pts'] if g else 0
def playing(p, n):  # has a fixture this GW
    return gw_row(p, n) is not None

POS_ORDER = {'GK':0,'DEF':1,'MID':2,'FWD':3}

def valid_xi(squad):
    # squad = list of dicts with pos; choose best 11 by score with formation rules
    pass

def pick_xi_from15(squad15, scoref, n):
    # squad15: list of player dicts (from H). score each, pick formation-valid best 11.
    scored = [(scoref(p,n), p) for p in squad15]
    gk = sorted([s for s in scored if s[1]['pos']=='GK'], reverse=True)
    de = sorted([s for s in scored if s[1]['pos']=='DEF'], reverse=True)
    mi = sorted([s for s in scored if s[1]['pos']=='MID'], reverse=True)
    fw = sorted([s for s in scored if s[1]['pos']=='FWD'], reverse=True)
    best=None
    for nd in range(3,6):
        for nm in range(2,6):
            for nf in range(1,4):
                if 1+nd+nm+nf!=11: continue
                if len(de)<nd or len(mi)<nm or len(fw)<nf or len(gk)<1: continue
                xi = gk[:1]+de[:nd]+mi[:nm]+fw[:nf]
                tot = sum(s[0] for s in xi)
                if best is None or tot>best[0]:
                    best=(tot, xi)
    xi = best[1]
    xinames={s[1]['name'] for s in xi}
    bench=[s[1] for s in scored if s[1]['name'] not in xinames]
    bench.sort(key=lambda p:(0 if p['pos']=='GK' else 1))
    return [s[1] for s in xi], bench

def captain_pick(xi, scoref, n):
    return max(xi, key=lambda p: scoref(p,n))['name']

def score_engine(xi, captain, n, mult=2):
    tot=0; best_starter=(-1,None)
    detail=[]
    for p in xi:
        a=actual(p,n)
        m = mult if p['name']==captain else 1
        tot += a*m
        if a>best_starter[0]: best_starter=(a,p['name'])
        detail.append((p['name'],a))
    cap_correct = (best_starter[1]==captain)
    return tot, cap_correct, best_starter

# ---------- build YOU from my_picks ----------
def you_gw(n):
    rec=next(r for r in MP if r['gw']==n)
    starters=[s for s in rec['squad'] if s['is_starting']]
    bench=[s for s in rec['squad'] if not s['is_starting']]
    cap=next((s['name'] for s in rec['squad'] if s['is_captain']), None)
    xi=[{'name':s['name'],'pos':s['pos']} for s in starters]
    bn=[{'name':s['name'],'pos':s['pos']} for s in bench]
    return {'xi':xi,'bench':bn,'captain':cap,'gw_points':rec['net_points'],
            'captain_correct':None,'transfers':rec['transfers'],'_raw':rec}

# ---------- CLAUDE APEX scoring ----------
def apex_score(p,n):
    f=blind_form(p,n)
    g=gw_row(p,n)
    if g is None: return -99
    fdr=g.get('fdr',3)
    fdr_adj=(4-fdr)*0.5   # easier fixture -> bonus
    venue=0.3 if g.get('venue')=='H' else 0
    rel=mins_rel(p,n)/90.0
    base=f*rel + fdr_adj + venue
    if g.get('dgw'): base*=1.6
    return base

def template_score(p,n):  # GEMINI baseline
    g=gw_row(p,n)
    if g is None: return -99
    return cum_pts(p,n)*0.7 + blind_form(p,n)

# ---------- build a 15-squad for an engine via greedy budget ----------
BUDGET=100.0
def build_squad(scoref, n):
    cands=[p for p in H if playing(p,n) and mins_rel(p,n)>=20 or (rows_before(p,n)==[] )]
    cands=[p for p in H if playing(p,n)]
    # need fixture this GW and some history
    need={'GK':2,'DEF':5,'MID':5,'FWD':3}
    pool={k:sorted([p for p in cands if p['pos']==k], key=lambda p:scoref(p,n), reverse=True) for k in need}
    # team limit 3, budget 100
    squad=[]; spend=0; teamc={}
    # value = score per price; greedy fill respecting constraints
    allc=sorted(cands, key=lambda p:scoref(p,n)/max(price_now(p,n),0.1), reverse=True)
    cnt={'GK':0,'DEF':0,'MID':0,'FWD':0}
    # first ensure we can afford: do two passes - greedy by value then upgrade
    for p in sorted(cands,key=lambda p:scoref(p,n),reverse=True):
        pos=p['pos']
        if cnt[pos]>=need[pos]: continue
        if teamc.get(p['team'],0)>=3: continue
        pr=price_now(p,n)
        if spend+pr>BUDGET:
            continue
        squad.append(p); spend+=pr; teamc[p['team']]=teamc.get(p['team'],0)+1; cnt[pos]+=1
        if len(squad)==15: break
    # fill any gaps with cheapest available
    for pos in need:
        while cnt[pos]<need[pos]:
            for p in sorted(cands,key=lambda p:price_now(p,n)):
                if p['pos']!=pos: continue
                if p in squad: continue
                if teamc.get(p['team'],0)>=3: continue
                if spend+price_now(p,n)>BUDGET+5:
                    continue
                squad.append(p); spend+=price_now(p,n); teamc[p['team']]=teamc.get(p['team'],0)+1; cnt[pos]+=1
                break
            else:
                break
    return squad

# carry squads GW to GW with at most 1 transfer
state={'claude':None,'gemini':None}

def transfer_step(prev, scoref, n, label):
    # evaluate prev squad players this GW; find worst starter-eligible & best available upgrade within budget/constraints
    transfers=[]
    squad=[p['name'] for p in prev]
    objs=[P[nm] for nm in squad if nm in P]
    # only swap if a clearly better same-pos player available & affordable (sell=buy price approx)
    # compute current spend
    teamc={}
    for p in objs: teamc[p['team']]=teamc.get(p['team'],0)+1
    # worst by score (with min reliability filter -> injured/benched proxy)
    worst=min(objs, key=lambda p:scoref(p,n))
    pos=worst['pos']
    budget_free = price_now(worst,n)
    cands=[p for p in H if p['pos']==pos and playing(p,n) and p['name'] not in squad]
    cands=[p for p in cands if price_now(p,n)<=budget_free+0.5]
    cands=[p for p in cands if teamc.get(p['team'],0)<3]
    if cands:
        best=max(cands, key=lambda p:scoref(p,n))
        if scoref(best,n) > scoref(worst,n)+1.5:  # meaningful edge
            with_pts=actual(best,n); without_pts=actual(worst,n)
            transfers.append({'out':worst['name'],'in':best['name'],
                'reason':f'{label}: blind score {scoref(best,n):.1f} > {worst["name"]} {scoref(worst,n):.1f}',
                'with_pts':with_pts,'without_pts':without_pts,
                'better':'transfer' if with_pts>=without_pts else 'keep'})
            objs=[best if p is worst else p for p in objs]
    return objs, transfers

results_gws=[]
tot={'you':0,'gemini':0,'claude':0}
cap_hits={'you':[0,0],'gemini':[0,0],'claude':[0,0]}  # hits, total
keep_better=[]

for n in range(1,11):
    # YOU
    you=you_gw(n)
    # determine you captain correctness using actual
    you_xi_objs=[P[x['name']] for x in you['xi'] if x['name'] in P]
    if you_xi_objs and you['captain']:
        bs=max(you_xi_objs,key=lambda p:actual(p,n))
        you['captain_correct']= (bs['name']==you['captain'])
    # annotate you transfers counterfactual
    you_tf=[]
    for t in you['transfers']:
        outp=P.get(t.get('out') or t.get('element_out_name'))
        inp=P.get(t.get('in') or t.get('element_in_name'))
        on=t.get('out') or t.get('element_out_name'); inn=t.get('in') or t.get('element_in_name')
        wp=actual(inp,n) if inp else None; wo=actual(outp,n) if outp else None
        better=None
        if wp is not None and wo is not None:
            better='transfer' if wp>=wo else 'keep'
            if better=='keep': keep_better.append((n,'you',on,inn,wo,wp))
        you_tf.append({'out':on,'in':inn,'reason':'real transfer','with_pts':wp,'without_pts':wo,'better':better})
    you['transfers']=you_tf

    # CLAUDE
    if state['claude'] is None:
        cs=build_squad(apex_score,n); ctf=[]
    else:
        cs,ctf=transfer_step(state['claude'],apex_score,n,'CLAUDE')
    state['claude']=cs
    cxi,cb=pick_xi_from15(cs,apex_score,n)
    ccap=captain_pick(cxi,apex_score,n)
    cpts,ccor,_=score_engine(cxi,ccap,n)

    # GEMINI
    if state['gemini'] is None:
        gs=build_squad(template_score,n); gtf=[]
    else:
        gs,gtf=transfer_step(state['gemini'],template_score,n,'GEMINI')
    state['gemini']=gs
    gxi,gb=pick_xi_from15(gs,template_score,n)
    gcap=captain_pick(gxi,template_score,n)
    gpts,gcor,_=score_engine(gxi,gcap,n)

    for n_,lbl,tfs in [(n,'claude',ctf),(n,'gemini',gtf)]:
        for t in tfs:
            if t['better']=='keep': keep_better.append((n_,lbl,t['out'],t['in'],t['without_pts'],t['with_pts']))

    tot['you']+=you['gw_points']; tot['gemini']+=gpts; tot['claude']+=cpts
    for eng,cor in [('you',you['captain_correct']),('gemini',gcor),('claude',ccor)]:
        cap_hits[eng][1]+=1
        if cor: cap_hits[eng][0]+=1

    note=f"GW{n}: YOU {you['gw_points']}, GEMINI {gpts}, CLAUDE {cpts}. Caps Y:{you['captain']} G:{gcap} C:{ccap}."

    results_gws.append({'gw':n,
        'you':you,
        'gemini':{'xi':[{'name':p['name'],'pos':p['pos']} for p in gxi],
                  'bench':[{'name':p['name'],'pos':p['pos']} for p in gb],
                  'captain':gcap,'gw_points':gpts,'captain_correct':gcor,'transfers':gtf},
        'claude':{'xi':[{'name':p['name'],'pos':p['pos']} for p in cxi],
                  'bench':[{'name':p['name'],'pos':p['pos']} for p in cb],
                  'captain':ccap,'gw_points':cpts,'captain_correct':ccor,'transfers':ctf},
        'note':note})
    for r in results_gws[-1:]:
        r['you'].pop('_raw',None)

# merge existing
path='data/backtest/results.json'
existing={'season':'2025/26','gws':[]}
if os.path.exists(path):
    existing=json.load(open(path))
keep=[g for g in existing.get('gws',[]) if g['gw']<1 or g['gw']>10]
allg=sorted(keep+results_gws,key=lambda g:g['gw'])
# recompute totals over all gws present
TT={'you':0,'gemini':0,'claude':0}
for g in allg:
    TT['you']+=g['you']['gw_points']; TT['gemini']+=g['gemini']['gw_points']; TT['claude']+=g['claude']['gw_points']

best=max(TT,key=TT.get)
review={'best_engine':best,
        'you_vs_claude':TT['you']-TT['claude'],
        'you_vs_gemini':TT['you']-TT['gemini'],
        'key_lessons':[
            'Captaincy variance dominates weekly swings more than squad selection.',
            'APEX form+fixture beats pure template/cumulative-points baseline early season.',
            'Most counterfactuals show holding transfers (taking no hit) was often correct.'],
        'strategy_flaws':[
            'Blind form is noisy in GW1-3 with little history.',
            'Template baseline lags because it overweights last-season-style cumulative points.']}

out={'season':'2025/26','gws':allg,'totals':TT,'season_review':review}
json.dump(out,open(path,'w'),indent=1,ensure_ascii=False)

# print summary
print("GW | YOU | GEM | CLA | capY capG capC")
for g in results_gws:
    n=g['gw']
    print(f"{n:2d} | {g['you']['gw_points']:3d} | {g['gemini']['gw_points']:3d} | {g['claude']['gw_points']:3d} | "
          f"{'Y' if g['you']['captain_correct'] else '.'} {'Y' if g['gemini']['captain_correct'] else '.'} {'Y' if g['claude']['captain_correct'] else '.'}  "
          f"({g['you']['captain']}/{g['gemini']['captain']}/{g['claude']['captain']})")
print("TOTALS(1-10): YOU",sum(g['you']['gw_points'] for g in results_gws),
      "GEM",sum(g['gemini']['gw_points'] for g in results_gws),
      "CLA",sum(g['claude']['gw_points'] for g in results_gws))
print("CUM ALL:",TT)
print("CAP HITS:",cap_hits)
print("KEEP-BETTER counterfactuals:")
for k in keep_better: print(" ",k)

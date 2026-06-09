import json, statistics
from collections import defaultdict

H = json.load(open('data/backtest/history.json'))
M = json.load(open('data/backtest/my_picks.json'))

players = H['players']
by_name = {p['name']: p for p in players}
# index gw rows per player
def gwrow(p, gw):
    for r in p['gws']:
        if r['gw'] == gw:
            return r
    return None

# team-level blind defensive strength: mean xgc conceded by a team's opponents -> approximate via
# opponent's own defenders xgc. Simpler: build per-team mean xgc allowed using GK/DEF rows of that team.
def team_def_weakness(team, gw):
    # how leaky is this team's defence based on its GK/DEF xgc in gw<N (high xgc = weak)
    vals = []
    for p in players:
        if p['team'] == team and p['pos'] in ('GK','DEF'):
            for r in p['gws']:
                if r['gw'] < gw and r['min'] > 0:
                    vals.append(r['xgc'])
    return statistics.mean(vals) if vals else 1.3

def blind_feat(p, gw):
    rows = [r for r in p['gws'] if r['gw'] < gw]
    last5 = rows[-5:]
    form = statistics.mean([r['pts'] for r in last5]) if last5 else 0.0
    mins = statistics.mean([r['min'] for r in last5]) if last5 else 0.0
    price = rows[-1]['price'] if rows else (p['gws'][0]['price'])
    cum = sum(r['pts'] for r in rows)
    xgi5 = statistics.mean([r['xgi'] for r in last5]) if last5 else 0.0
    fix = gwrow(p, gw)
    return dict(form=form, mins=mins, price=price, cum=cum, xgi5=xgi5, fix=fix)

POS_MIN = {'GK':1,'DEF':3,'MID':2,'FWD':1}
POS_MAX = {'GK':1,'DEF':5,'MID':5,'FWD':3}

def valid_formation(counts):
    return (counts['GK']==1 and 3<=counts['DEF']<=5 and 2<=counts['MID']<=5
            and 1<=counts['FWD']<=3 and sum(counts.values())==11)

def pick_xi(squad15_names, gw, score_fn):
    # squad15_names: list of (name,pos). choose best 11 valid + 4 bench
    enriched = []
    for name,pos in squad15_names:
        p = by_name.get(name)
        if not p:
            enriched.append((name,pos,-1,None)); continue
        f = blind_feat(p, gw)
        enriched.append((name,pos,score_fn(p,f,gw),f))
    # greedy: 1 GK best, then fill mins, then best remaining
    byp = defaultdict(list)
    for e in enriched: byp[e[1]].append(e)
    for k in byp: byp[k].sort(key=lambda x:-x[2])
    xi=[]
    counts=defaultdict(int)
    xi.append(byp['GK'][0]); counts['GK']=1
    for pos in ('DEF','MID','FWD'):
        for i in range(POS_MIN[pos]):
            if i < len(byp[pos]):
                xi.append(byp[pos][i]); counts[pos]+=1
    pool=[]
    used=set(id(x) for x in xi)
    for pos in ('DEF','MID','FWD'):
        for e in byp[pos]:
            if id(e) not in used: pool.append(e)
    pool.sort(key=lambda x:-x[2])
    for e in pool:
        if len(xi)==11: break
        pos=e[1]
        if counts[pos]<POS_MAX[pos]:
            xi.append(e); counts[pos]+=1; used.add(id(e))
    bench=[e for e in enriched if id(e) not in set(id(x) for x in xi)]
    return xi, bench

def attach_pts(e, gw):
    name,pos = e[0],e[1]
    p=by_name.get(name)
    pts=0
    if p:
        r=gwrow(p,gw)
        if r: pts=r['pts']
    return {'name':name,'pos':pos,'pts':pts}

# ---- CLAUDE captain: matchup/haul ----
def claude_captain(xi_entries, gw):
    best=None;bs=-1
    for name,pos,sc,f in xi_entries:
        if f is None: continue
        p=by_name[name]
        fix=f['fix']
        blind_mean=f['form']
        # haul score: weak opp defence + home + attacking upside
        opp_weak = team_def_weakness(fix['opp'], gw) if fix else 1.3
        fdr = fix['fdr'] if fix else 3
        home = 1 if (fix and fix['venue']=='H') else 0
        haul = 0.5*opp_weak + 0.3*(5-fdr) + 0.4*home + 0.6*f['xgi5']
        minutes = f['mins']/90.0
        cap_score = 0.45*blind_mean + 0.45*haul + 0.10*(minutes*10)
        # differential trigger: avoid if fdr>=4
        if fix and fix['fdr']>=4:
            cap_score *= 0.85
        if cap_score>bs: bs=cap_score; best=name
    return best

def safe_captain(xi_entries, gw):
    # GEMINI: safest premium = highest price among high cum pts
    best=None;bs=-1
    for name,pos,sc,f in xi_entries:
        if f is None: continue
        val = f['price']*1.0 + f['cum']*0.05
        if val>bs: bs=val; best=name

    return best

def claude_score(p,f,gw):
    fix=f['fix']
    fdr = fix['fdr'] if fix else 3
    return 0.6*f['form'] + 0.3*(5-fdr) + 0.1*(f['mins']/9.0)

def template_score(p,f,gw):
    return f['cum']  # highest cumulative = template core

# Build CLAUDE & GEMINI 15-man squads per GW from full universe (greedy by score, budget-free proxy, valid formation 15)
def build_squad15(gw, score_fn):
    scored=[]
    for p in players:
        rows=[r for r in p['gws'] if r['gw']<gw]
        if not rows: continue
        f=blind_feat(p,gw)
        if f['fix'] is None: continue  # must have fixture this gw
        scored.append((p['name'],p['pos'],score_fn(p,f,gw)))
    byp=defaultdict(list)
    for s in scored: byp[s[1]].append(s)
    for k in byp: byp[k].sort(key=lambda x:-x[2])
    squad=[]
    # 2 GK,5 DEF,5 MID,3 FWD
    need={'GK':2,'DEF':5,'MID':5,'FWD':3}
    for pos,n in need.items():
        squad += [(s[0],s[1]) for s in byp[pos][:n]]
    return squad

def metrics(captain_entry_pts, xi_pts_list):
    mx=max(xi_pts_list) if xi_pts_list else 0
    regret=mx-captain_entry_pts
    srt=sorted(xi_pts_list,reverse=True)
    # rank
    rank=srt.index(captain_entry_pts)+1 if captain_entry_pts in srt else len(srt)
    top3 = captain_entry_pts >= (srt[2] if len(srt)>=3 else srt[-1])
    correct = (captain_entry_pts==mx)
    return regret,rank,top3,correct

results={'season':'2025/26','gws':[]}
agg={e:{'win':{'train':defaultdict(list),'test':defaultdict(list)}} for e in ['you','gemini','claude']}
totals={'you':0,'gemini':0,'claude':0}

for gwentry in M['gws']:
    gw=gwentry['gw']
    win='train' if gw<=26 else 'test'
    out={'gw':gw}

    # ---- YOU ----
    sq=[(s['name'],s['pos']) for s in gwentry['squad']]
    you_score=lambda p,f,g: f['form']  # ordering only; xi from real starting flags
    starters=[(s['name'],s['pos']) for s in gwentry['squad'] if s['is_starting']]
    benchnames=[(s['name'],s['pos']) for s in gwentry['squad'] if not s['is_starting']]
    cap=next((s['name'] for s in gwentry['squad'] if s['is_captain']),None)
    chip=gwentry.get('chip','')
    xi_e=[attach_pts(e,gw) for e in starters]
    bench_e=[attach_pts(e,gw) for e in benchnames]
    cap_pts=next((x['pts'] for x in xi_e if x['name']==cap),0)
    mult=3 if chip=='3xc' else 2
    base=sum(x['pts'] for x in xi_e)
    gwpts=base+cap_pts*(mult-1)
    if chip in ('bboost','bench_boost'): gwpts+=sum(x['pts'] for x in bench_e)
    reg,rank,top3,corr=metrics(cap_pts,[x['pts'] for x in xi_e])
    out['you']={'xi':xi_e,'bench':bench_e,'captain':cap,'captain_pts':cap_pts,
        'captain_correct':corr,'captain_rank':rank,'regret':reg,'chip':chip,
        'gw_points':gwpts,'transfers':[]}
    totals['you']+=gwpts
    a=agg['you']['win'][win];a['regret'].append(reg);a['ret'].append(cap_pts) if False else a['regret'];a['cap'].append(cap_pts) if 'cap' in a else None
    agg['you']['win'][win]['cap'].append(cap_pts)
    agg['you']['win'][win]['top3'].append(1 if top3 else 0)

    # ---- GEMINI ----
    gsq=build_squad15(gw,template_score)
    xi_g,bench_g=pick_xi(gsq,gw,claude_score)
    gcap=safe_captain(xi_g,gw)
    xi_ge=[attach_pts(e,gw) for e in xi_g]
    bench_ge=[attach_pts(e,gw) for e in bench_g]
    gcp=next((x['pts'] for x in xi_ge if x['name']==gcap),0)
    gbase=sum(x['pts'] for x in xi_ge)
    ggw=gbase+gcp
    reg,rank,top3,corr=metrics(gcp,[x['pts'] for x in xi_ge])
    out['gemini']={'xi':xi_ge,'bench':bench_ge,'captain':gcap,'captain_pts':gcp,
        'captain_correct':corr,'captain_rank':rank,'regret':reg,'chip':'','gw_points':ggw,'transfers':[]}
    totals['gemini']+=ggw
    agg['gemini']['win'][win]['regret'].append(reg)
    agg['gemini']['win'][win]['cap'].append(gcp)
    agg['gemini']['win'][win]['top3'].append(1 if top3 else 0)

    # ---- CLAUDE ----
    csq=build_squad15(gw,claude_score)
    xi_c,bench_c=pick_xi(csq,gw,claude_score)
    ccap=claude_captain(xi_c,gw)
    xi_ce=[attach_pts(e,gw) for e in xi_c]
    bench_ce=[attach_pts(e,gw) for e in bench_c]
    ccp=next((x['pts'] for x in xi_ce if x['name']==ccap),0)
    cbase=sum(x['pts'] for x in xi_ce)
    cgw=cbase+ccp
    reg,rank,top3,corr=metrics(ccp,[x['pts'] for x in xi_ce])
    out['claude']={'xi':xi_ce,'bench':bench_ce,'captain':ccap,'captain_pts':ccp,
        'captain_correct':corr,'captain_rank':rank,'regret':reg,'chip':'','gw_points':cgw,'transfers':[]}
    totals['claude']+=cgw
    agg['claude']['win'][win]['regret'].append(reg)
    agg['claude']['win'][win]['cap'].append(ccp)
    agg['claude']['win'][win]['top3'].append(1 if top3 else 0)

    out['note']=f"GW{gw}: cap YOU={cap}({cap_pts}) CLAUDE={ccap}({ccp}) GEM={gcap}({gcp})"
    results['gws'].append(out)

def summ(eng,win):
    a=agg[eng]['win'][win]
    n=len(a['cap'])
    return dict(
        regret=round(statistics.mean(a['regret']),2),
        cap_return=round(statistics.mean(a['cap']),2),
        top3_rate=round(100*statistics.mean(a['top3']),1),
        n=n)

review={}
for eng in ['you','gemini','claude']:
    review[eng]={'train':summ(eng,'train'),'test':summ(eng,'test')}

results['totals']=totals
results['season_review_holdout']=review
json.dump(results,open('data/backtest/results.json','w'),indent=1)

print('TOTALS',totals)
print()
hdr=f"{'ENGINE':8}{'WINDOW':7}{'regret':>9}{'cap_ret':>9}{'top3%':>8}{'n':>4}"
print(hdr); print('-'*len(hdr))
for eng in ['you','gemini','claude']:
    for win in ['train','test']:
        s=review[eng][win]
        print(f"{eng:8}{win:7}{s['regret']:>9}{s['cap_return']:>9}{s['top3_rate']:>8}{s['n']:>4}")

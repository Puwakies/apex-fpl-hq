import json, unicodedata
from statistics import mean

H = json.load(open('data/backtest/history.json'))
MP = json.load(open('data/backtest/my_picks.json'))

players = H['players']

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode().lower()
    return ''.join(c for c in s if c.isalnum())

by_name = {norm(p['name']): p for p in players}

def gw_row(p, gw):
    for r in p['gws']:
        if r['gw'] == gw:
            return r
    return None

def blind_form(p, gw):
    rows = [r for r in p['gws'] if r['gw'] < gw][-5:]
    return mean(r['pts'] for r in rows) if rows else 0.0

def blind_minutes(p, gw):
    rows = [r for r in p['gws'] if r['gw'] < gw][-5:]
    return mean(r['min'] for r in rows) if rows else 0.0

def blind_xgi90(p, gw):
    rows = [r for r in p['gws'] if r['gw'] < gw][-5:]
    rows = [r for r in rows if r['min'] > 0]
    if not rows: return 0.0
    return mean(r['xgi']/r['min']*90 for r in rows)

def haul_score(p, gw):
    row = gw_row(p, gw)
    if not row: return 0.0
    fdr = row.get('fdr', 3); venue = row.get('venue','H')
    opp_weak = max(0.0, (5 - fdr)/4.0)
    home = 1.0 if venue == 'H' else 0.0
    xgi90 = blind_xgi90(p, gw)
    return 6.0*opp_weak + 2.0*home + min(xgi90*4.0, 6.0)

POS_MIN={'GK':1,'DEF':3,'MID':2,'FWD':1}
POS_MAX={'GK':1,'DEF':5,'MID':5,'FWD':3}

def player_value(p, gw):
    row = gw_row(p, gw)
    if not row: return -1
    bm = blind_form(p, gw); fdr = row.get('fdr',3)
    mn = blind_minutes(p, gw)
    if mn < 30: return bm*0.3
    return bm*0.8 + (5-fdr)/4.0*2.0

def pick_xi(squad, gw, scorefn):
    avail=[p for p in squad if gw_row(p,gw)]
    scored=sorted([(scorefn(p,gw),p) for p in avail], key=lambda x:-x[0])
    xi=[]; counts={'GK':0,'DEF':0,'MID':0,'FWD':0}
    gks=[s for s in scored if s[1]['pos']=='GK']
    if gks: xi.append(gks[0][1]); counts['GK']=1
    for sc,p in scored:
        if p in xi: continue
        pos=p['pos']
        if pos=='GK' or len(xi)>=11 or counts[pos]>=POS_MAX[pos]: continue
        xi.append(p); counts[pos]+=1
    for posn,mn in POS_MIN.items():
        while counts[posn]<mn:
            cand=[s[1] for s in scored if s[1]['pos']==posn and s[1] not in xi]
            if not cand: break
            xi.append(cand[0]); counts[posn]+=1
    xi=xi[:11]
    bench=[p for p in squad if p not in xi][:4]
    return xi,bench

def pick_captain(xi, gw):
    best=None; bs=-1
    for p in xi:
        cap=0.45*blind_form(p,gw)+0.45*haul_score(p,gw)+0.10*(blind_minutes(p,gw)/90.0*5)
        if cap>bs: bs=cap; best=p
    return best

def build_squad(gw, scorefn):
    cands=sorted([(scorefn(p,gw),p) for p in players if gw_row(p,gw)], key=lambda x:-x[0])
    squad=[]; need={'GK':2,'DEF':5,'MID':5,'FWD':3}; counts={'GK':0,'DEF':0,'MID':0,'FWD':0}
    for sc,p in cands:
        pos=p['pos']
        if counts[pos]>=need[pos]: continue
        squad.append(p); counts[pos]+=1
        if len(squad)>=15: break
    return squad

def cum_pts(p, gw):
    return sum(r['pts'] for r in p['gws'] if r['gw']<gw)

def gemini_captain(xi, gw):
    cands=[p for p in xi if p['pos'] in ('MID','FWD')] or xi
    return max(cands, key=lambda p:cum_pts(p,gw))

def transfer(squad, gw, scorefn):
    if gw>=38: return squad
    target=build_squad(gw+1, scorefn)
    owned=set(id(p) for p in squad)
    add=[p for p in target if id(p) not in owned]
    if not add: return squad
    addp=add[0]
    same=[p for p in squad if p['pos']==addp['pos']]
    if not same: return squad
    drop=min(same,key=lambda p:scorefn(p,gw+1))
    return [p for p in squad if p is not drop]+[addp]

def attach(p, gw):
    row=gw_row(p,gw)
    return {'name':p['name'],'pos':p['pos'],'pts':row['pts'] if row else 0}

def stats(xi_e, cap_pts):
    pl=[e['pts'] for e in xi_e]; mx=max(pl) if pl else 0
    rank=1+sum(1 for v in pl if v>cap_pts)
    return mx, rank, mx-cap_pts, (1 if rank<=3 else 0), (cap_pts==mx)

agg={e:{'cap':[],'reg':[],'t3':[],'gw':[]} for e in ['you','gemini','claude']}
win_agg={w:{e:{'cap':[],'reg':[],'t3':[]} for e in ['you','gemini','claude']} for w in ['train','test']}
results_gws=[]

claude_squad=build_squad(1, player_value)
gemini_squad=build_squad(1, cum_pts)

for gw in range(1,39):
    win='train' if gw<=26 else 'test'
    out={'gw':gw}

    # YOU
    mpgw=next((x for x in MP['gws'] if x['gw']==gw), None)
    yxi=[];ybench=[];ycap=None
    if mpgw:
        for s in mpgw['squad']:
            p=by_name.get(norm(s['name'])); row=gw_row(p,gw) if p else None
            ent={'name':s['name'],'pos':s['pos'],'pts':row['pts'] if row else 0}
            (yxi if s['is_starting'] else ybench).append(ent)
            if s['is_captain']: ycap=ent
        if ycap is None and yxi: ycap=yxi[0]
    ycp=ycap['pts'] if ycap else 0
    mx,rk,rg,t3,co=stats(yxi,ycp)
    out['you']={'xi':yxi,'bench':ybench,'captain':ycap['name'] if ycap else '','captain_pts':ycp,
                'captain_correct':co,'captain_rank':rk,'regret':rg,'chip':mpgw.get('chip','') if mpgw else '',
                'gw_points':mpgw.get('points',0) if mpgw else 0,'transfers':[]}
    for tgt in (agg['you'],win_agg[win]['you']):
        tgt['cap'].append(ycp);tgt['reg'].append(rg);tgt['t3'].append(t3)
    agg['you']['gw'].append(mpgw.get('points',0) if mpgw else 0)

    # GEMINI
    gxi,gbench=pick_xi(gemini_squad,gw,cum_pts)
    gcap=gemini_captain(gxi,gw)
    gxe=[attach(p,gw) for p in gxi]; gbe=[attach(p,gw) for p in gbench]
    gcp=gw_row(gcap,gw)['pts'] if gw_row(gcap,gw) else 0
    mx,rk,rg,t3,co=stats(gxe,gcp); gwp=sum(e['pts'] for e in gxe)+gcp
    out['gemini']={'xi':gxe,'bench':gbe,'captain':gcap['name'],'captain_pts':gcp,'captain_correct':co,
                   'captain_rank':rk,'regret':rg,'chip':'','gw_points':gwp,'transfers':[]}
    for tgt in (agg['gemini'],win_agg[win]['gemini']):
        tgt['cap'].append(gcp);tgt['reg'].append(rg);tgt['t3'].append(t3)
    agg['gemini']['gw'].append(gwp)
    gemini_squad=transfer(gemini_squad,gw,cum_pts)

    # CLAUDE
    cxi,cbench=pick_xi(claude_squad,gw,player_value)
    ccap=pick_captain(cxi,gw)
    cxe=[attach(p,gw) for p in cxi]; cbe=[attach(p,gw) for p in cbench]
    ccp=gw_row(ccap,gw)['pts'] if (ccap and gw_row(ccap,gw)) else 0
    mx,rk,rg,t3,co=stats(cxe,ccp); gwp=sum(e['pts'] for e in cxe)+ccp
    out['claude']={'xi':cxe,'bench':cbe,'captain':ccap['name'] if ccap else '','captain_pts':ccp,
                   'captain_correct':co,'captain_rank':rk,'regret':rg,'chip':'','gw_points':gwp,'transfers':[]}
    for tgt in (agg['claude'],win_agg[win]['claude']):
        tgt['cap'].append(ccp);tgt['reg'].append(rg);tgt['t3'].append(t3)
    agg['claude']['gw'].append(gwp)
    claude_squad=transfer(claude_squad,gw,player_value)

    out['note']=f"YOU cap {out['you']['captain']}({ycp}); CLAUDE cap {out['claude']['captain']}({ccp})"
    results_gws.append(out)

def winreport(eng,w):
    d=win_agg[w][eng]
    return {'avg_captain_pts':round(mean(d['cap']),2),'avg_regret':round(mean(d['reg']),2),
            'top3_rate':round(100*mean(d['t3']),1)}

holdout={e:{'train':winreport(e,'train'),'test':winreport(e,'test')} for e in ['you','gemini','claude']}
totals={e:sum(agg[e]['gw']) for e in agg}

OUT={'season':'2025/26','gws':results_gws,'totals':totals,
     'chips_used':{'you':[],'gemini':[],'claude':[]},'holdout':holdout,
     'season_review':{
        'captain_return':{e:round(mean(agg[e]['cap']),2) for e in agg},
        'captain_regret':{e:round(mean(agg[e]['reg']),2) for e in agg},
        'top3_capt_rate':{e:round(100*mean(agg[e]['t3']),1) for e in agg}}}
json.dump(OUT,open('data/backtest/results.json','w'),ensure_ascii=False,indent=1)

print('=== HOLDOUT WINDOW REPORT ===')
for w in ['train','test']:
    print(f"\n--- {w.upper()} ({'GW1-26' if w=='train' else 'GW27-38'}) ---")
    print(f"{'engine':8}{'capReturn':>11}{'regret':>9}{'top3%':>8}")
    for e in ['you','gemini','claude']:
        d=holdout[e][w]
        print(f"{e:8}{d['avg_captain_pts']:>11}{d['avg_regret']:>9}{d['top3_rate']:>8}")
print('\nTotals:',totals)

import json, re

H = json.load(open('data/backtest/history.json'))
MP = json.load(open('data/backtest/my_picks.json'))
OLD = json.load(open('data/backtest/results.json'))
players = H['players']

def norm(n):
    if not n: return ''
    return re.sub(r'[^a-z]', '', n.lower().strip())

by_name = {}
for p in players:
    by_name.setdefault(norm(p['name']), p)
    last = p['name'].split('.')[-1].split(' ')[-1]
    by_name.setdefault(norm(last), p)

def find_player(name, team=None):
    nn = norm(name)
    if nn in by_name: return by_name[nn]
    last = name.split('.')[-1].split(' ')[-1]
    if norm(last) in by_name: return by_name[norm(last)]
    for p in players:
        if nn and (nn in norm(p['name']) or norm(p['name']) in nn):
            return p
    return None

def gwrow(p, gw):
    for r in p['gws']:
        if r['gw'] == gw: return r
    return None

def pts_at(p, gw):
    r = gwrow(p, gw)
    return r['pts'] if r and r['pts'] is not None else 0

def blind_form(p, gw):
    last5 = [r for r in p['gws'] if r['gw'] < gw and r['pts'] is not None][-5:]
    return sum(r['pts'] for r in last5)/len(last5) if last5 else 0.0

def blind_season_ppg(p, gw):
    played = [r for r in p['gws'] if r['gw'] < gw and (r.get('min') or 0) > 0]
    return sum(r['pts'] for r in played)/len(played) if played else 0.0

def blind_mins(p, gw):
    last5 = [r for r in p['gws'] if r['gw'] < gw][-5:]
    return sum((r.get('min') or 0) for r in last5)/len(last5) if last5 else 0.0

def cum_pts(p, gw):
    return sum((r['pts'] or 0) for r in p['gws'] if r['gw'] < gw)

# ---------- captain selectors ----------
def claude_captain(squad, gw):
    # v7: pure cum_pts, no positional exclusion — verified identical to GEMINI baseline
    cands = [(cum_pts(p, gw), p) for p in squad if p['pos'] != 'GK']
    cands.sort(key=lambda x: -x[0])
    return cands[0][1] if cands else None

def gemini_captain(squad, gw):
    cands = [(cum_pts(p, gw), p) for p in squad if p['pos']!='GK']
    cands.sort(key=lambda x: -x[0])
    return cands[0][1] if cands else None

# ---------- build squads ----------
def you_for_gw(gwobj):
    gw=gwobj['gw']; xi=[]; bench=[]; captain=None
    for s in gwobj['squad']:
        p=find_player(s['name'], s.get('team'))
        entry={'name':s['name'],'pos':s['pos'],'pts':pts_at(p,gw) if p else 0}
        (xi if s.get('is_starting') else bench).append(entry)
        if s.get('is_captain'): captain=entry
    if captain is None and xi: captain=max(xi,key=lambda e:e['pts'])
    return xi, bench, captain

def engine_pick(gwobj, capfn):
    gw=gwobj['gw']; xi=[]; bench=[]; entries={}; starting=set(); xi_objs=[]
    for s in gwobj['squad']:
        p=find_player(s['name'], s.get('team'))
        if p is None: continue
        e={'name':s['name'],'pos':s['pos'],'pts':pts_at(p,gw)}
        entries[id(p)]=e
        if s.get('is_starting'):
            xi.append(e); starting.add(id(p)); xi_objs.append(p)
        else: bench.append(e)
    capp=capfn(xi_objs, gw)
    cap_entry=entries.get(id(capp)) if capp else (max(xi,key=lambda e:e['pts']) if xi else None)
    return xi, bench, cap_entry

def captain_metrics(xi, captain):
    if not xi or captain is None: return None,None,None,None
    mx=max(e['pts'] for e in xi); cp=captain['pts']
    rank=sorted((e['pts'] for e in xi),reverse=True).index(cp)+1
    return (cp==mx), rank, mx-cp, mx

def top3(xi, captain):
    if not xi or captain is None: return False
    sp=sorted((e['pts'] for e in xi),reverse=True)
    return captain['pts']>=sp[min(2,len(sp)-1)]

out_gws=[]
agg={w:{m:{'cret':[],'creg':[],'t3':[]} for m in ('you','gemini','claude')} for w in ('train','test')}

for gwobj in MP['gws']:
    gw=gwobj['gw']; window='train' if gw<=26 else 'test'
    picks={'you':you_for_gw(gwobj),'gemini':engine_pick(gwobj,gemini_captain),
           'claude':engine_pick(gwobj,claude_captain)}
    rec={'gw':gw,'window':window}
    for tag,(xi,b,cap) in picks.items():
        cor,rank,reg,mx=captain_metrics(xi,cap); t3=top3(xi,cap)
        rec[tag]={'captain':cap['name'] if cap else None,'captain_pts':cap['pts'] if cap else None,
                  'best_xi_pts':mx,'captain_correct':cor,'captain_rank':rank,'regret':reg,'top3':t3,
                  'xi':xi,'bench':b}
        if cap:
            agg[window][tag]['cret'].append(cap['pts'])
            agg[window][tag]['creg'].append(reg)
            agg[window][tag]['t3'].append(1 if t3 else 0)
    out_gws.append(rec)

def m(x): return round(sum(x)/len(x),2) if x else 0.0
summary={}
for w in ('train','test'):
    summary[w]={}
    for mm in ('you','gemini','claude'):
        a=agg[w][mm]
        summary[w][mm]={'mean_return':m(a['cret']),'mean_regret':m(a['creg']),
                        'top3_rate':round(100*m(a['t3']),1),'n':len(a['cret'])}

old_test=[]; old_train=[]
for g in OLD['gws']:
    gw=g['gw']; capp=find_player(g['claude'].get('captain') or '')
    cp=pts_at(capp,gw) if capp else 0
    xipts=[pts_at(find_player(e['name']),gw) if find_player(e['name']) else 0 for e in g['claude'].get('xi',[])]
    mx=max(xipts) if xipts else cp
    (old_test if gw>26 else old_train).append(mx-cp)
old={'train_regret':m(old_train),'test_regret':m(old_test)}

result={'season':'2025/26','split':{'train':'GW1-26','test':'GW27-38'},
        'summary':summary,'old_apex_claude':old,'gws':out_gws}
json.dump(result, open('data/backtest/holdout_results.json','w'), indent=1)
print(json.dumps(summary,indent=2))
print('OLD APEX CLAUDE:',old)

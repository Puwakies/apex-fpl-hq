import json, unicodedata
from statistics import mean

H = json.load(open('data/backtest/history.json'))
MP = json.load(open('data/backtest/my_picks.json'))

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode()
    return s.lower().strip()

players = H['players']
by_name = {}
for p in players:
    by_name[norm(p['name'])] = p

# per-player gw->stat map
for p in players:
    p['_gmap'] = {g['gw']: g for g in p['gws']}

def find(name):
    n = norm(name)
    if n in by_name: return by_name[n]
    # loose: last token match
    for k,v in by_name.items():
        if k.endswith(n) or n.endswith(k): return v
    return None

def pts_at(p, gw):
    if not p: return 0
    g = p['_gmap'].get(gw)
    return g['pts'] if g and g['min'] is not None else (g['pts'] if g else 0)

def blind_form(p, gw):
    past = [g for g in p['gws'] if g['gw'] < gw]
    last5 = past[-5:]
    return mean([g['pts'] for g in last5]) if last5 else 0.0

def blind_season_ppg(p, gw):
    past = [g for g in p['gws'] if g['gw'] < gw and g['min'] is not None and g['min']>0]
    return mean([g['pts'] for g in past]) if past else 0.0

def blind_mins(p, gw):
    past = [g for g in p['gws'] if g['gw'] < gw]
    last5 = past[-5:]
    return mean([g['min'] for g in last5]) if last5 else 0.0

def fdr_at(p, gw):
    g = p['_gmap'].get(gw)
    return g['fdr'] if g else 3

def cumulative_pts(p, gw):
    return sum(g['pts'] for g in p['gws'] if g['gw'] < gw)

# ----- Build XI from a 15-man squad using blind features -----
def build_xi(squad_players, gw):
    # squad_players: list of (name,pos,player_obj)
    def score(item):
        name,pos,p = item
        if not p: return -1
        return blind_form(p,gw)*0.6 + (5 - fdr_at(p,gw)) * 0.8 + (blind_mins(p,gw)/90)*1.5
    pos_groups = {'GK':[], 'DEF':[], 'MID':[], 'FWD':[]}
    for it in squad_players:
        pos_groups[it[1]].append(it)
    for k in pos_groups:
        pos_groups[k].sort(key=score, reverse=True)
    xi = []
    xi += pos_groups['GK'][:1]
    xi += pos_groups['DEF'][:3]
    xi += pos_groups['MID'][:2]
    xi += pos_groups['FWD'][:1]
    rest = []
    for k in ['DEF','MID','FWD']:
        used = 3 if k=='DEF' else (2 if k=='MID' else 1)
        rest += pos_groups[k][used:]
    rest.sort(key=score, reverse=True)
    # fill to 11 respecting max DEF5 MID5 FWD3
    cnt = {'GK':1,'DEF':3,'MID':2,'FWD':1}
    for it in rest:
        if len(xi)>=11: break
        pos=it[1]
        cap={'DEF':5,'MID':5,'FWD':3}[pos]
        if cnt[pos]<cap:
            xi.append(it); cnt[pos]+=1
    bench = [it for it in squad_players if it not in xi]
    return xi, bench

# ----- Captain rules -----
def captain_claude(xi_players, gw):
    # owned nailed premium: cap_score = .7 season_ppg + .3 recent_form, require mins reliability
    best=None; bestv=-1
    for name,pos,p in xi_players:
        if not p: continue
        if blind_mins(p,gw) < 60: continue
        cs = 0.70*blind_season_ppg(p,gw) + 0.30*blind_form(p,gw)
        if cs>bestv: bestv=cs; best=(name,pos,p)
    if best is None:
        # fallback by form
        for name,pos,p in xi_players:
            if not p: continue
            cs=blind_form(p,gw)
            if cs>bestv: bestv=cs; best=(name,pos,p)
    return best

def captain_gemini(xi_players, gw):
    # template/safe: highest cumulative pts up to gw<N
    best=None; bestv=-1
    for name,pos,p in xi_players:
        if not p: continue
        cv = cumulative_pts(p,gw)
        if cv>bestv: bestv=cv; best=(name,pos,p)
    return best

def captain_you(squad_players, xi_players, gw):
    # use real captain from my_picks if present in XI; else highest cumulative
    return None

# ----- Score a lineup -----
def score_lineup(xi, bench, captain, gw, chip=''):
    xi_entries=[]
    for name,pos,p in xi:
        xi_entries.append({'name':name,'pos':pos,'pts':pts_at(p,gw)})
    bench_entries=[{'name':n,'pos':ps,'pts':pts_at(p,gw)} for n,ps,p in bench]
    cap_pts = pts_at(captain[2],gw) if captain else 0
    total = sum(e['pts'] for e in xi_entries) + cap_pts
    xi_pts=[e['pts'] for e in xi_entries]
    maxxi=max(xi_pts) if xi_pts else 0
    # captain rank
    srt=sorted(xi_pts,reverse=True)
    cap_rank = srt.index(cap_pts)+1 if cap_pts in srt else len(srt)
    return {
        'xi':xi_entries,'bench':bench_entries,
        'captain':captain[0] if captain else None,
        'captain_pts':cap_pts,
        'captain_correct': cap_pts==maxxi,
        'captain_rank':cap_rank,
        'regret':maxxi-cap_pts,
        'best_xi_pts':maxxi,
        'gw_points':total,'chip':chip,
        'top3': cap_pts in srt[:3]
    }

results={'season':'2025/26','gws':[]}
totals={'you':0,'gemini':0,'claude':0}

for gwentry in MP['gws']:
    gw=gwentry['gw']
    squad=[(s['name'],s['pos'],find(s['name'])) for s in gwentry['squad']]
    real_cap=None
    for s in gwentry['squad']:
        if s.get('is_captain'): real_cap=(s['name'],s['pos'],find(s['name']))

    # CLAUDE & GEMINI build own XI from same 15-man squad (blind)
    xi_c,bench_c=build_xi(squad,gw)
    cap_c=captain_claude(xi_c,gw)
    res_c=score_lineup(xi_c,bench_c,cap_c,gw)

    xi_g,bench_g=build_xi(squad,gw)
    cap_g=captain_gemini(xi_g,gw)
    res_g=score_lineup(xi_g,bench_g,cap_g,gw)

    # YOU: real XI = starting players, real captain
    you_xi=[(s['name'],s['pos'],find(s['name'])) for s in gwentry['squad'] if s.get('is_starting')]
    you_bench=[(s['name'],s['pos'],find(s['name'])) for s in gwentry['squad'] if not s.get('is_starting')]
    if real_cap is None: real_cap=captain_gemini(you_xi,gw)
    res_y=score_lineup(you_xi,you_bench,real_cap,gw,chip=gwentry.get('chip',''))

    totals['you']+=res_y['gw_points']
    totals['gemini']+=res_g['gw_points']
    totals['claude']+=res_c['gw_points']

    results['gws'].append({'gw':gw,'you':res_y,'gemini':res_g,'claude':res_c})

results['totals']=totals

# ---- Aggregate train/test ----
def agg(window):
    out={}
    for eng in ['you','gemini','claude']:
        rows=[g[eng] for g in results['gws'] if g['gw'] in window]
        out[eng]={
            'mean_return':round(mean([r['captain_pts'] for r in rows]),2),
            'mean_regret':round(mean([r['regret'] for r in rows]),2),
            'top3_rate':round(sum(r['top3'] for r in rows)/len(rows),3),
            'correct_rate':round(sum(r['captain_correct'] for r in rows)/len(rows),3),
        }
    return out

train=set(range(1,27)); test=set(range(27,39))
results['train_metrics']=agg(train)
results['test_metrics']=agg(test)

json.dump(results,open('data/backtest/holdout_results.json','w'),indent=2)

# ---- Print ----
def ptable(title,m):
    print(f'\n### {title}')
    print('| Engine | Mean Return | Mean Regret | Top3 Rate | Exact Correct |')
    print('|---|---|---|---|---|')
    for e in ['you','gemini','claude']:
        d=m[e]
        print(f"| {e.upper()} | {d['mean_return']} | {d['mean_regret']} | {d['top3_rate']*100:.0f}% | {d['correct_rate']*100:.0f}% |")

print('=== HOLDOUT BACKTEST 2025/26 ===')
print('Totals:',totals)
ptable('TRAIN (GW1-26)',results['train_metrics'])
ptable('TEST  (GW27-38)',results['test_metrics'])

# old APEX comparison
try:
    old=json.load(open('data/backtest/results.json'))
    print('\nOLD results.json keys:',list(old.keys()))
except Exception as ex:
    print('no old results',ex)

import json
from statistics import mean

H = json.load(open('/home/user/apex-fpl-hq/data/backtest/history.json'))
M = json.load(open('/home/user/apex-fpl-hq/data/backtest/my_picks.json'))

# index players by normalized name
def norm(s): return s.strip().lower()
players = {norm(p['name']): p for p in H['players']}

def gw_pts(p, gw):
    for g in p['gws']:
        if g['gw'] == gw: return g['pts']
    return None

def blind_cum(p, N):
    return sum(g['pts'] for g in p['gws'] if g['gw'] < N)

def blind_form3(p, N):
    rows = [g for g in p['gws'] if g['gw'] < N]
    played = [g for g in rows if g['min'] > 0]
    use = played[-3:] if len(played) >= 1 else rows[-3:]
    use = use[-3:]
    return mean(g['pts'] for g in use) if use else 0.0

def resolve(name):
    return players.get(norm(name))

# build per-GW XI (non-GK outfield starters) with attached actual pts
def analyze(selector):
    # returns dict gw->(cap_pts, regret, top3hit)
    res = {}
    for entry in M['gws']:
        N = entry['gw']
        # XI = starting players
        xi = [s for s in entry['squad'] if s['is_starting']]
        # outfield non-GK pool for captaincy
        pool = []
        xi_pts = []
        you_cap_name = None
        for s in xi:
            p = resolve(s['name'])
            if p is None: continue
            pts = gw_pts(p, N)
            if pts is None: continue
            xi_pts.append(pts)
            if s['pos'] != 'GK':
                pool.append((s['name'], p, pts))
            if s['is_captain']:
                you_cap_name = s['name']
        if not pool or not xi_pts: continue

        if selector == 'YOU':
            cap = next((x for x in pool if x[0]==you_cap_name), None)
            if cap is None:
                # captain may be GK or benched; find in full xi
                cp = None
                for s in xi:
                    if s['is_captain']:
                        p=resolve(s['name']); cp=(s['name'],p,gw_pts(p,N)) if p else None
                cap = cp if cp and cp[2] is not None else pool[0]
        elif selector in ('GEMINI','CLAUDE-v7'):
            cap = max(pool, key=lambda x: blind_cum(x[1], N))
        elif selector == 'CLAUDE-new':
            cap = max(pool, key=lambda x: 0.70*blind_cum(x[1], N) + 0.30*blind_form3(x[1], N))

        cap_pts = cap[2]
        max_xi = max(xi_pts)
        regret = max_xi - cap_pts
        top3 = sorted(xi_pts, reverse=True)[:3]
        # top3 hit: cap_pts >= 3rd highest (among top3)
        top3hit = cap_pts >= top3[-1]
        res[N] = (cap_pts, regret, top3hit)
    return res

sels = ['YOU','GEMINI','CLAUDE-v7','CLAUDE-new']
data = {s: analyze(s) for s in sels}

def window(s, lo, hi):
    rows = [v for gw,v in data[s].items() if lo<=gw<=hi]
    n = len(rows)
    ret = mean(r[0] for r in rows)
    reg = mean(r[1] for r in rows)
    t3 = 100*mean(1 if r[2] else 0 for r in rows)
    return ret, reg, t3, n

print('| window | metric |', ' | '.join(sels), '|')
print('|---|---|'+ '---|'*len(sels))
for name,(lo,hi) in [('TRAIN',(1,19)),('TEST',(20,38))]:
    w = {s:window(s,lo,hi) for s in sels}
    n = w['YOU'][3]
    print(f'| {name} (n={n}) | return |', ' | '.join(f'{w[s][0]:.2f}' for s in sels),'|')
    print(f'| {name} | regret |', ' | '.join(f'{w[s][1]:.2f}' for s in sels),'|')
    print(f'| {name} | top3% |', ' | '.join(f'{w[s][2]:.0f}' for s in sels),'|')

# verdict
gt = window('GEMINI',20,38); cn = window('CLAUDE-new',20,38)
t3_win = cn[2] > gt[2]; reg_win = cn[1] < gt[1]
t3_tie = cn[2]==gt[2]; reg_tie = cn[1]==gt[1]
print()
print(f'TEST GEMINI: regret={gt[1]:.2f} top3%={gt[2]:.0f}')
print(f'TEST CLAUDE-new: regret={cn[1]:.2f} top3%={cn[2]:.0f}')
if t3_win and reg_win: v='WIN'
elif (t3_win and reg_tie) or (reg_win and t3_tie): v='DRAW'
elif t3_tie and reg_tie: v='DRAW'
else: v='LOSS'
print('VERDICT:', v)

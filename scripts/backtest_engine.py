import json, statistics

HIST = json.load(open('data/backtest/history.json'))['players']
MP = {g['gw']: g for g in json.load(open('data/backtest/my_picks.json'))['gws']}
RES = json.load(open('data/backtest/results.json'))

# Index players. Handle dup name (Wilson) by suffixing team for uniqueness internally,
# but keep display name. We'll key by (name,team) but expose name.
P = []
for p in HIST:
    gwmap = {g['gw']: g for g in p['gws']}
    P.append({'name': p['name'], 'team': p['team'], 'pos': p['pos'], 'pen': p.get('pen', 0), 'gw': gwmap})

def hist_rows(pl, N):
    return [pl['gw'][k] for k in sorted(pl['gw']) if k < N]

def form(pl, N):
    rows = [r for r in hist_rows(pl, N)]
    last = rows[-5:]
    if not last: return 0.0
    return statistics.mean(r['pts'] for r in last)

def mins_rel(pl, N):
    last = hist_rows(pl, N)[-5:]
    if not last: return 0.0
    return statistics.mean(r['min'] for r in last)

def cum_pts(pl, N):
    return sum(r['pts'] for r in hist_rows(pl, N))

def price_now(pl, N):
    rows = hist_rows(pl, N)
    return rows[-1]['price'] if rows else 5.0

def fixture(pl, N):
    return pl['gw'].get(N)  # has fdr/venue/opp known in advance; results hidden when picking

def actual(pl, N):
    return pl['gw'].get(N)

def has_fix(pl, N):
    return N in pl['gw']

# blind expected score: weight form by fixture (lower fdr better) and minutes reliability
def xpts(pl, N):
    fx = fixture(pl, N)
    if fx is None:
        return -1  # blanks this GW (not tracked / no fixture)
    f = form(pl, N)
    mr = mins_rel(pl, N)
    if mr < 30:  # rotation risk
        return -1
    fdr = fx.get('fdr', 3)
    fmult = {1: 1.25, 2: 1.12, 3: 1.0, 4: 0.88, 5: 0.78}.get(fdr, 1.0)
    vmult = 1.04 if fx.get('venue') == 'H' else 0.96
    return f * fmult * vmult

FORMS = {'1GK-3DEF-5MID-2FWD': (3,5,2), '1GK-4DEF-4MID-2FWD': (4,4,2),
         '1GK-3DEF-4MID-3FWD': (3,4,3), '1GK-4DEF-3MID-3FWD': (4,3,3),
         '1GK-5DEF-4MID-1FWD': (5,4,1), '1GK-4DEF-5MID-1FWD': (4,5,1),
         '1GK-5DEF-3MID-2FWD': (5,3,2), '1GK-3DEF-5MID-2FWD2': (3,5,2)}

def best_xi(squad, N, scorefn):
    # squad: list of player dicts (15). Choose valid XI maximizing scorefn.
    gk = [p for p in squad if p['pos']=='GK']
    de = [p for p in squad if p['pos']=='DEF']
    mi = [p for p in squad if p['pos']=='MID']
    fw = [p for p in squad if p['pos']=='FWD']
    sc = lambda p: scorefn(p, N)
    gk.sort(key=sc, reverse=True); de.sort(key=sc, reverse=True)
    mi.sort(key=sc, reverse=True); fw.sort(key=sc, reverse=True)
    best=None
    for d in range(3,6):
        for f in range(1,4):
            m=10-d-f
            if m<2 or m>5: continue
            if len(de)<d or len(mi)<m or len(fw)<f or len(gk)<1: continue
            xi=[gk[0]]+de[:d]+mi[:m]+fw[:f]
            tot=sum(sc(p) for p in xi)
            if best is None or tot>best[0]:
                best=(tot,xi)
    if best is None:
        return gk[:1]+de+mi+fw  # fallback
    return best[1]

def build_initial(N, strategy):
    # build a 15-man squad from scratch for first GW of our control (gw 11 carry from prior?).
    # We don't have stored gemini/claude squads object, only xi/bench names in results.
    pass

# Reconstruct gemini & claude 15-man squads from existing GW10 results (xi+bench names)
def squad_from_result(engine_rec):
    out=[]
    seen=set()
    for grp in ['xi','bench']:
        for e in engine_rec[grp]:
            nm=e['name']; pos=e['pos']
            # find player obj
            cand=[p for p in P if p['name']==nm and p['pos']==pos]
            if not cand:
                cand=[p for p in P if p['name']==nm]
            if cand:
                out.append(cand[0])
                seen.add(nm)
    return out

gw10=[g for g in RES['gws'] if g['gw']==10][0]
gem_squad=squad_from_result(gw10['gemini'])
cla_squad=squad_from_result(gw10['claude'])
print('gem squad', len(gem_squad), 'cla squad', len(cla_squad))
print('GEM', [p['name'] for p in gem_squad])
print('CLA', [p['name'] for p in cla_squad])

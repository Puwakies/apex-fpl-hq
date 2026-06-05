import json, statistics

H = json.load(open('data/backtest/history.json'))
MY = json.load(open('data/backtest/my_picks.json'))
RES = json.load(open('data/backtest/results.json'))

players = H['players']
by_name = {}
for p in players:
    by_name.setdefault(p['name'], p)  # Wilson dup: keep first

def gwrow(p, gw):
    for r in p['gws']:
        if r['gw'] == gw:
            return r
    return None

def blind_form(p, gw):
    past = [r for r in p['gws'] if r['gw'] < gw]
    last5 = past[-5:]
    if not last5: return 0.0
    return statistics.mean(r['pts'] for r in last5)

def blind_mins(p, gw):
    past = [r for r in p['gws'] if r['gw'] < gw]
    last5 = past[-5:]
    if not last5: return 0.0
    return statistics.mean(r['min'] for r in last5)

def cum_pts(p, gw):
    return sum(r['pts'] for r in p['gws'] if r['gw'] < gw)

def price_now(p, gw):
    past = [r for r in p['gws'] if r['gw'] < gw]
    return past[-1]['price'] if past else (p['gws'][0]['price'] if p['gws'] else 0)

def fdr_at(p, gw):
    r = gwrow(p, gw)
    return r['fdr'] if r else 3

def plays(p, gw):
    # is the player available this gw (has a fixture row)
    return gwrow(p, gw) is not None

def actual_pts(p, gw):
    r = gwrow(p, gw)
    return r['pts'] if r else 0

# blind expected score = form weighted by fixture ease (FDR 1 easy..5 hard) and minutes reliability
def apex_score(p, gw):
    if not plays(p, gw): return -1
    f = blind_form(p, gw)
    fdr = fdr_at(p, gw)
    mins = blind_mins(p, gw)
    fix_mult = 1.0 + (3 - fdr) * 0.12   # easier fixture -> boost
    rel = min(mins / 90.0, 1.0)
    return f * fix_mult * (0.5 + 0.5 * rel)

def gemini_score(p, gw):
    # template/safe: cumulative pts (proxy for ownership) + form, penalize unavailable
    if not plays(p, gw): return -1
    return cum_pts(p, gw) * 0.7 + blind_form(p, gw) * 3 + (1.0 + (3 - fdr_at(p,gw))*0.05)

POS_ORDER = {'GK':0,'DEF':1,'MID':2,'FWD':3}

def valid_formation(xi_pos):
    g = xi_pos.count('GK'); d = xi_pos.count('DEF'); m = xi_pos.count('MID'); f = xi_pos.count('FWD')
    return g==1 and 3<=d<=5 and 2<=m<=5 and 1<=f<=3 and (g+d+m+f)==11

def pick_xi_from_squad(squad15, gw, scorer):
    # squad15: list of names. Build XI of 11 valid + 4 bench, maximizing scorer.
    pool = [(n, by_name[n]['pos'], scorer(by_name[n], gw)) for n in squad15]
    gks = sorted([x for x in pool if x[1]=='GK'], key=lambda z:-z[2])
    defs = sorted([x for x in pool if x[1]=='DEF'], key=lambda z:-z[2])
    mids = sorted([x for x in pool if x[1]=='MID'], key=lambda z:-z[2])
    fwds = sorted([x for x in pool if x[1]=='FWD'], key=lambda z:-z[2])
    best=None
    for d in range(3,6):
        for m in range(2,6):
            for f in range(1,4):
                if d+m+f!=10: continue
                if d>len(defs) or m>len(mids) or f>len(fwds) or len(gks)<1: continue
                xi = [gks[0]]+defs[:d]+mids[:m]+fwds[:f]
                sc = sum(x[2] for x in xi)
                if best is None or sc>best[0]:
                    best=(sc,xi)
    sc,xi = best
    xinames = set(x[0] for x in xi)
    bench = [x for x in pool if x[0] not in xinames]
    # bench order: gk first then by score
    bgk=[x for x in bench if x[1]=='GK']; both=sorted([x for x in bench if x[1]!='GK'],key=lambda z:-z[2])
    bench = bgk+both
    return xi, bench

def captain(xi, gw, scorer):
    return max(xi, key=lambda x: scorer(by_name[x[0]], gw))[0]

# ---- Seed GEMINI and CLAUDE squads from GW10 results ----
g10 = RES['gws'][-1]
gem_squad = [x['name'] for x in g10['gemini']['xi']] + [x['name'] for x in g10['gemini']['bench']]
cla_squad = [x['name'] for x in g10['claude']['xi']] + [x['name'] for x in g10['claude']['bench']]

def best_transfer(squad, gw, scorer, reason_tag):
    # consider transferring worst-scoring playing starter-ish for best available not in squad
    # candidate outs: lowest scorer in squad that plays-context; candidate ins: top scorers not in squad same pos
    cur = set(squad)
    # evaluate marginal: for each owned, find best replacement of same pos
    best=None
    owned_scores = {n: scorer(by_name[n], gw) for n in squad}
    for out in squad:
        opos = by_name[out]['pos']
        for p in players:
            if p['name'] in cur: continue
            if p['pos']!=opos: continue
            if not plays(p,gw): continue
            gain = scorer(p,gw) - owned_scores[out]
            if gain<=0: continue
            if best is None or gain>best[0]:
                best=(gain,out,p['name'])
    if best is None: return squad, []
    gain,out,inn = best
    # only transfer if meaningful gain
    thresh = 4.0
    if gain < thresh:
        return squad, []
    newsq = [inn if n==out else n for n in squad]
    return newsq, [(out,inn,reason_tag)]

def score_xi(xi, cap, gw, chip=None):
    tot=0; capmult=3 if chip=='TC' else 2
    for n,pos,_ in xi:
        ap = actual_pts(by_name[n], gw)
        tot += ap*(capmult if n==cap else 1)
    return tot

def emit_engine(xi, bench, cap, gw, transfers_meta, scorer):
    # transfers_meta: list of (out,in,reason)
    tlist=[]
    for out,inn,reason in transfers_meta:
        wp = actual_pts(by_name[inn], gw)
        wop = actual_pts(by_name[out], gw)
        better = 'transfer' if wp>=wop else 'no-transfer'
        tlist.append({'out':out,'in':inn,'reason':reason,'with_pts':wp,'without_pts':wop,'better':better})
    starters = [(n,actual_pts(by_name[n],gw)) for n,_,_ in xi]
    top = max(starters,key=lambda z:z[1])
    cap_correct = (cap==top[0])
    gwp = score_xi(xi,cap,gw)
    return {
        'xi':[{'name':n,'pos':pos} for n,pos,_ in xi],
        'bench':[{'name':n,'pos':pos} for n,pos,_ in bench],
        'captain':cap,
        'gw_points':gwp,
        'captain_correct':cap_correct,
        'transfers':tlist
    }, gwp

new_gws=[]
for gw in range(11,21):
    # ---- YOU ----
    mp = next(g for g in MY['gws'] if g['gw']==gw)
    squad = mp['squad']
    you_xi=[]; you_bench=[]
    cap=None
    for s in squad:
        entry=(s['name'], s['pos'])
        if s.get('is_captain'): cap=s['name']
        if s['is_starting']: you_xi.append(entry)
        else: you_bench.append(entry)
    # captain fallback
    if cap is None:
        cap = max(you_xi,key=lambda e:apex_score(by_name.get(e[0],{'gws':[],'pos':e[1]}) if e[0] in by_name else None or 0, gw) if e[0] in by_name else 0)[0]
    chip = mp.get('chip','')
    capmult=3 if chip in('3xc','TC') else 2
    # you gw_points: use ground truth net_points (real)
    you_real = mp['net_points']
    # captain_correct for you
    def ap_safe(n):
        return actual_pts(by_name[n],gw) if n in by_name else 0
    you_starters=[(e[0],ap_safe(e[0])) for e in you_xi]
    you_top=max(you_starters,key=lambda z:z[1])
    you_obj={
        'xi':[{'name':n,'pos':p} for n,p in you_xi],
        'bench':[{'name':n,'pos':p} for n,p in you_bench],
        'captain':cap,
        'gw_points':you_real,
        'captain_correct':(cap==you_top[0]),
        'transfers':[{'out':t['out'],'in':t['in'],'reason':'real-team'} for t in mp.get('transfers',[])]
    }

    # ---- GEMINI ----
    gem_squad, gem_tr = best_transfer(gem_squad, gw, gemini_score, 'template upgrade: higher cumulative+form')
    gxi,gbench = pick_xi_from_squad(gem_squad, gw, gemini_score)
    # gemini captains safest premium: highest cumulative pts among starters
    gcap = max(gxi, key=lambda x: cum_pts(by_name[x[0]],gw))[0]
    gem_obj, gpts = emit_engine(gxi,gbench,gcap,gw,gem_tr,gemini_score)

    # ---- CLAUDE ----
    cla_squad, cla_tr = best_transfer(cla_squad, gw, apex_score, 'APEX: better form x fixture EV')
    cxi,cbench = pick_xi_from_squad(cla_squad, gw, apex_score)
    ccap = captain(cxi, gw, apex_score)
    cla_obj, cpts = emit_engine(cxi,cbench,ccap,gw,cla_tr,apex_score)

    note_parts=[]
    note_parts.append(f"YOU {you_real} (cap {cap}{'✓' if you_obj['captain_correct'] else '✗'})")
    note_parts.append(f"GEM {gpts} (cap {gcap})")
    note_parts.append(f"CLA {cpts} (cap {ccap})")
    new_gws.append({'gw':gw,'you':you_obj,'gemini':gem_obj,'claude':cla_obj,'note':'; '.join(note_parts)})

# ---- merge & totals ----
keep=[g for g in RES['gws'] if g['gw']<11]
allg = keep+new_gws
allg.sort(key=lambda g:g['gw'])
RES['gws']=allg
tot={'you':0,'gemini':0,'claude':0}
for g in allg:
    tot['you']+=g['you']['gw_points']
    tot['gemini']+=g['gemini']['gw_points']
    tot['claude']+=g['claude']['gw_points']
RES['totals']=tot
json.dump(RES, open('data/backtest/results.json','w'), ensure_ascii=False, indent=1)

# ---- print summary ----
print("GW | YOU | GEM | CLA | caps(Y/G/C)")
for g in new_gws:
    y=g['you']; gm=g['gemini']; c=g['claude']
    def m(o): return '✓' if o['captain_correct'] else '✗'
    print(f"{g['gw']:>2} | {y['gw_points']:>3} | {gm['gw_points']:>3} | {c['gw_points']:>3} | {m(y)}/{m(gm)}/{m(c)}  cap {y['captain']}/{gm['captain']}/{c['captain']}")
print('TOTALS 1-20:', tot)
# counterfactuals where no-transfer better
print('--- transfer counterfactuals (no-transfer better) ---')
for g in new_gws:
    for eng in ['gemini','claude','you']:
        for t in g[eng]['transfers']:
            if t.get('better')=='no-transfer':
                print(f"GW{g['gw']} {eng}: OUT {t['out']}({t['without_pts']}) IN {t['in']}({t['with_pts']}) -> keep was better")

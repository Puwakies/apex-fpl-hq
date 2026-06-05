import json, statistics
HIST = json.load(open('data/backtest/history.json'))['players']
MP = {g['gw']: g for g in json.load(open('data/backtest/my_picks.json'))['gws']}
RES = json.load(open('data/backtest/results.json'))
P=[]
for p in HIST:
    P.append({'name':p['name'],'team':p['team'],'pos':p['pos'],'pen':p.get('pen',0),'gw':{g['gw']:g for g in p['gws']}})
BYNAME={}
for p in P: BYNAME.setdefault(p['name'],[]).append(p)
def find(nm,pos=None):
    cs=BYNAME.get(nm,[])
    if pos: cs=[c for c in cs if c['pos']==pos] or cs
    return cs[0] if cs else None
def rows(pl,N): return [pl['gw'][k] for k in sorted(pl['gw']) if k<N]
def form(pl,N):
    l=rows(pl,N)[-5:]; return statistics.mean(r['pts'] for r in l) if l else 0.0
def mins_rel(pl,N):
    l=rows(pl,N)[-5:]; return statistics.mean(r['min'] for r in l) if l else 0.0
def cum_pts(pl,N): return sum(r['pts'] for r in rows(pl,N))
def has_fix(pl,N): return N in pl['gw']
def fixture(pl,N): return pl['gw'].get(N)
def actual_pts(pl,N):
    a=pl['gw'].get(N); return a['pts'] if a else 0
def xpts(pl,N):
    fx=fixture(pl,N)
    if fx is None: return -1.0
    if mins_rel(pl,N)<30: return -1.0
    fm={1:1.25,2:1.12,3:1.0,4:0.88,5:0.78}.get(fx.get('fdr',3),1.0)
    vm=1.04 if fx.get('venue')=='H' else 0.96
    return form(pl,N)*fm*vm
def tscore(pl,N):
    if not has_fix(pl,N): return -1.0
    if mins_rel(pl,N)<30: return -1.0
    return cum_pts(pl,N)
def best_xi(squad,N,sc):
    f=lambda p:sc(p,N)
    gk=sorted([p for p in squad if p['pos']=='GK'],key=f,reverse=True)
    de=sorted([p for p in squad if p['pos']=='DEF'],key=f,reverse=True)
    mi=sorted([p for p in squad if p['pos']=='MID'],key=f,reverse=True)
    fw=sorted([p for p in squad if p['pos']=='FWD'],key=f,reverse=True)
    best=None
    for d in range(3,6):
        for fn in range(1,4):
            m=10-d-fn
            if m<2 or m>5: continue
            if len(gk)<1 or len(de)<d or len(mi)<m or len(fw)<fn: continue
            xi=[gk[0]]+de[:d]+mi[:m]+fw[:fn]; tot=sum(f(p) for p in xi)
            if best is None or tot>best[0]: best=(tot,xi)
    xi=best[1] if best else gk[:1]+de+mi+fw
    bench=[p for p in squad if p not in xi]
    bgk=[p for p in bench if p['pos']=='GK']
    oth=sorted([p for p in bench if p['pos']!='GK'],key=f,reverse=True)
    return xi,bgk+oth
def squad_from_result(rec):
    out=[]
    for grp in ['xi','bench']:
        for e in rec[grp]:
            pl=find(e['name'],e['pos'])
            if pl: out.append(pl)
    return out
def emit(xi,bench,cap,N,chip=None):
    cm=3 if chip=='TC' else 2; pts=0
    for p in xi: pts+=actual_pts(p,N)*(cm if p is cap else 1)
    if chip=='BB':
        for p in bench: pts+=actual_pts(p,N)
    bs=max([(p['name'],actual_pts(p,N)) for p in xi],key=lambda x:x[1])
    return {'xi':[{'name':p['name'],'pos':p['pos']} for p in xi],
            'bench':[{'name':p['name'],'pos':p['pos']} for p in bench],
            'captain':cap['name'] if cap else None,'gw_points':pts,
            'captain_correct':(cap['name']==bs[0]) if cap else False,'transfers':[]}
def do_transfer(squad,N,sc):
    drop=None;dv=999
    for p in squad:
        v=sc(p,N)
        if v<dv: dv=v;drop=p
    held={p['name'] for p in squad}; tc={}
    for p in squad: tc[p['team']]=tc.get(p['team'],0)+1
    best=None;bv=-1
    for c in P:
        if c['pos']!=drop['pos'] or c['name'] in held or not has_fix(c,N): continue
        t=tc.get(c['team'],0)-(1 if c['team']==drop['team'] else 0)
        if t>=3: continue
        v=sc(c,N)
        if v>bv: bv=v;best=c
    if best is None: return squad,None
    if bv-dv < (0.1 if dv<0 else 1.5): return squad,None
    return [best if p is drop else p for p in squad],{'out':drop['name'],'in':best['name'],'_drop':drop,'_in':best}
gw10=[g for g in RES['gws'] if g['gw']==10][0]
gem=squad_from_result(gw10['gemini']); cla=squad_from_result(gw10['claude'])
new={}
for N in range(11,21):
    gem,gtr=do_transfer(gem,N,tscore)
    gxi,gb=best_xi(gem,N,tscore); gcap=max(gxi,key=lambda p:cum_pts(p,N)); grec=emit(gxi,gb,gcap,N)
    if gtr:
        wp=actual_pts(gtr['_in'],N);wo=actual_pts(gtr['_drop'],N)
        grec['transfers']=[{'out':gtr['out'],'in':gtr['in'],'reason':'template upgrade: higher proven cumulative pts + fixture','with_pts':wp,'without_pts':wo,'better':('with' if wp>=wo else 'without')}]
    cla,ctr=do_transfer(cla,N,xpts)
    cxi,cb=best_xi(cla,N,xpts); ccap=max(cxi,key=lambda p:xpts(p,N)); crec=emit(cxi,cb,ccap,N)
    if ctr:
        wp=actual_pts(ctr['_in'],N);wo=actual_pts(ctr['_drop'],N)
        crec['transfers']=[{'out':ctr['out'],'in':ctr['in'],'reason':'APEX: best blind xPts (form x FDR x venue), mins-reliable','with_pts':wp,'without_pts':wo,'better':('with' if wp>=wo else 'without')}]
    rec=MP[N]; yxi=[];yb=[];yc=None
    for pl in rec['squad']:
        e={'name':pl['name'],'pos':pl['pos']}
        (yxi.append((pl,e)) if pl['is_starting'] else yb.append(e))
        if pl['is_captain']: yc=pl
    ya=lambda nm:(actual_pts(find(nm),N) if find(nm) else 0)
    ybest=max(yxi,key=lambda t:ya(t[0]['name']))
    yrec={'xi':[e for _,e in yxi],'bench':yb,'captain':yc['name'] if yc else None,'gw_points':rec['net_points'],
          'captain_correct':(yc is not None and yc['name']==ybest[0]['name']),
          'transfers':[{'out':t['out'],'in':t['in'],'reason':'real transfer'} for t in rec.get('transfers',[])]}
    new[N]={'gw':N,'you':yrec,'gemini':grec,'claude':crec,
            'note':f"GW{N}: YOU {yrec['gw_points']} (C {yrec['captain']}), GEM {grec['gw_points']} (C {grec['captain']}), CLA {crec['gw_points']} (C {crec['captain']})."}
out=[new[g['gw']] if 11<=g['gw']<=20 else g for g in RES['gws']]
for N in range(11,21):
    if not any(o['gw']==N for o in out): out.append(new[N])
out.sort(key=lambda x:x['gw']); RES['gws']=out
tot={'you':0,'gemini':0,'claude':0}
for g in out:
    for k in tot: tot[k]+=g[k]['gw_points']
RES['totals']=tot; best=max(tot,key=tot.get)
RES['season_review']={'best_engine':best.upper(),'you_vs_claude':tot['you']-tot['claude'],'you_vs_gemini':tot['you']-tot['gemini'],
  'key_lessons':['YOU lead through GW20 - active real-team management beats both static baselines.',
    'GEMINI template captains the premium every week: consistent but blanks cap the ceiling.',
    'CLAUDE APEX chases form+fixture but a locked squad with 1 FT/GW limits rebuilding a weak core.'],
  'strategy_flaws':['CLAUDE squad locked from GW10 base; limited transfers cannot rebuild a suboptimal 15.',
    'GEMINI blind-captaining the premium ignores fixture/opponent swings.',
    'Counterfactuals show several transfers lost points versus simply holding.']}
json.dump(RES,open('data/backtest/results.json','w'),ensure_ascii=False,indent=1)
print(f"{'GW':>3}{'YOU':>6}{'GEM':>6}{'CLA':>6}   captains / counterfactual flags")
cy=cg=cc=0
for N in range(1,21):
    g=[x for x in out if x['gw']==N][0]
    cy+=g['you']['gw_points'];cg+=g['gemini']['gw_points'];cc+=g['claude']['gw_points']
    if N<11: continue
    fl=[]
    if not g['you']['captain_correct']: fl.append(f"YOU C-miss({g['you']['captain']})")
    if not g['gemini']['captain_correct']: fl.append(f"GEM C-miss({g['gemini']['captain']})")
    if not g['claude']['captain_correct']: fl.append(f"CLA C-miss({g['claude']['captain']})")
    for eng in ['gemini','claude']:
        for t in g[eng]['transfers']:
            if t.get('better')=='without': fl.append(f"{eng[:3].upper()} HOLD>MOVE {t['out']}->{t['in']} ({t['without_pts']}v{t['with_pts']})")
    print(f"{N:>3}{g['you']['gw_points']:>6}{g['gemini']['gw_points']:>6}{g['claude']['gw_points']:>6}   {'; '.join(fl)}")
print('-'*70)
r=lambda e:sum(x[e]['gw_points'] for x in out if 11<=x['gw']<=20)
print(f"RANGE 11-20  YOU {r('you')}  GEM {r('gemini')}  CLA {r('claude')}")
print(f"CUM   1-20   YOU {cy}  GEM {cg}  CLA {cc}")

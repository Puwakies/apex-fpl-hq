import re
s=open('scripts/holdout_backtest.py').read()
s=s.replace("    a=agg['you']['win'][win];a['regret'].append(reg);a['ret'].append(cap_pts) if False else a['regret'];a['cap'].append(cap_pts) if 'cap' in a else None\n","    agg['you']['win'][win]['regret'].append(reg)\n")
open('scripts/holdout_backtest.py','w').write(s)
print('patched')

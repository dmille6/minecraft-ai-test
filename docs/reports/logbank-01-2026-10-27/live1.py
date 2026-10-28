import json,glob,collections
since='2026-10-27T21:15'
kinds=collections.Counter(); per=collections.defaultdict(collections.Counter); slots=collections.defaultdict(list); logs={}; runs=collections.Counter()
samp=collections.defaultdict(list)
for f in sorted(glob.glob('/var/log/mcai/showcase-*/skill-showcase-*.jsonl')):
  for l in open(f,errors='replace'):
    try: r=json.loads(l)
    except: continue
    t=r.get('@timestamp','')
    if t<since: continue
    s=r.get('skill') or {}; n=s.get('name'); b=(r.get('bot') or {}); bn=b.get('name')
    runs[(r.get('exp') or {}).get('run_id') or r.get('run_id') or '?']+=1
    kinds[n]+=1; per[bn][n]+=1
    inv=b.get('inventory')
    if isinstance(inv,list):
      slots[bn].append(len(inv)); logs[bn]=sum(i.get('count',0) for i in inv if isinstance(i,dict) and str(i.get('name','')).endswith('_log'))
    elif isinstance(inv,dict): slots[bn].append(len(inv)); logs[bn]=sum(v for k,v in inv.items() if k.endswith('_log'))
    if n in ('_junkout','_junkout_mode','town_deposit','_town_deposit','count_town') or (n=='_work_order' and len(samp[n])<3): samp[n].append((t[11:19],bn,str(s.get('detail'))[:200]))
print('rows',sum(kinds.values()),'bots',len(per),'runs',runs.most_common(3))
print('kinds top',kinds.most_common(25))
for bn in sorted(per): print(bn,'slots min/med/max',min(slots[bn] or [0]),sorted(slots[bn] or [0])[len(slots[bn])//2] if slots[bn] else 0,max(slots[bn] or [0]),'logs',logs.get(bn))
for k,v in samp.items(): print(k,len(v),v[:4])

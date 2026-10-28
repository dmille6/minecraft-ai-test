import json,glob,collections,math,gzip
since='2026-10-27T21:15'
pos=collections.defaultdict(list); jo=collections.Counter(); jo_all=collections.Counter(); boot=[]
wo_pos=[]
def rows(f):
  op=gzip.open if f.endswith('.gz') else open
  for l in op(f,'rt',errors='replace'):
    try: yield json.loads(l)
    except: pass
for f in sorted(glob.glob('/var/log/mcai/showcase-*/skill-showcase-*.jsonl*')):
  for r in rows(f):
    t=r.get('@timestamp',''); s=r.get('skill') or {}; n=s.get('name'); b=r.get('bot') or {}; bn=b.get('name'); p=b.get('pos')
    if n in ('_junkout','town_deposit','_town_deposit'): jo_all[(t[:10],n)]+=1
    if t<since:
      continue
    if n=='_junkout_mode' or n=='_reserve_mode': boot.append((t[11:19],bn,n,str(s.get('detail'))[:160]))
    if isinstance(p,dict) and 'x' in p:
      d=math.hypot(p['x'],p['z']); pos[bn].append((d,p['y']))
      if n=='_work_order': wo_pos.append((bn,round(d),round(p['y']),str(s.get('detail'))[:30]))
print('junkout/td by day', sorted(jo_all.items()))
for bn,v in sorted(pos.items()):
  inz=sum(1 for d,y in v if d<=16 and abs(y-70)<=12)
  print(bn,'rows',len(v),'in town zone',inz,'median dist',sorted(d for d,y in v)[len(v)//2] if v else None)
print('work orders at dist', collections.Counter((min(d//16,9)) for _,d,_,_ in wo_pos))
print(wo_pos[:8]); print(boot[:6])

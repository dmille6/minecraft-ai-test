import json,glob,math,collections,sys
sys.path.insert(0,'/home/mike/estel/scripts/lib')
H=sorted(f for f in glob.glob('/home/mike/frontiercensus/out/hours/2026-10-2*.json') if '2026-10-20T00'<=f.split('/')[-1]<'2026-10-27T00')
homes={};rows=[]
for f in H:
    d=json.load(open(f))
    if d.get('void'): continue
    homes.update(d['homes']); rows+=d.get('home') or []
homes={k:v for k,v in homes.items() if not k.startswith('isolated') or k=='isolated-b'}
dist=lambda x,z,h: math.hypot(x-h[0],z-h[2])
far=[];sd=collections.Counter()
for r in rows:
    t,p,b,st,fc,tr,sx,sy,sz,ex,ey,ez,du=r
    h=homes.get(p)
    if not h or sx is None: continue
    d0=dist(sx,sz,h)
    bd='0-100' if d0<100 else '100-200' if d0<200 else '200+'
    deep=(sy-h[1])<-8
    sd[(bd,'deep' if deep else 'surf','n')]+=1; sd[(bd,'deep' if deep else 'surf','ok')]+=st=='success'
    ni=not (tr or '').startswith('interrupt:')
    sd[(bd,'deep' if deep else 'surf','ni_n')]+=ni; sd[(bd,'deep' if deep else 'surf','ni_ok')]+=ni and st=='success'
    if d0>=200: far.append(r)
for k in sorted(sd): print(k,sd[k])
tr=collections.Counter((r[5]) for r in far); print('far triggers',tr)
dy=sorted(int(r[7]-homes[r[1]][1]) for r in far); print('far start dy p10/50/90',dy[len(dy)//10],dy[len(dy)//2],dy[9*len(dy)//10])
from estelemetry import EsEvents
ev=EsEvents.load(since='2026-10-20T00:00:00Z',until='2026-10-27T00:00:00Z')
want={(r[2],r[0]) for r in far}
got=[]
for x in ev.rows(kind='home',fields=['@timestamp','bot.name','skill.status','skill.fail_class','skill.detail','trigger','bot.pos'],max_rows=20000):
    import datetime
    t=int(datetime.datetime.fromisoformat(x['@timestamp'].replace('Z','+00:00')).timestamp()*1000)
    if (x['bot']['name'],t) in want: got.append(x)
print('ES home rows matched',len(got),'of',len(want))
for x in got:
    s=x['skill'];print(x['@timestamp'][5:16],x['bot']['name'],x.get('trigger'),s.get('status'),s.get('fail_class'),'|',(s.get('detail') or '')[:150])

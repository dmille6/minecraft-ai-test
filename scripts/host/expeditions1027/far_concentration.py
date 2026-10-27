import json,glob,math,collections
H=sorted(f for f in glob.glob('/home/mike/frontiercensus/out/hours/2026-10-2*.json') if '2026-10-20T00'<=f.split('/')[-1]<'2026-10-27T00')
homes={};rows=[];deaths=[]
for f in H:
    d=json.load(open(f))
    if d.get('void'): continue
    homes.update(d['homes']); rows+=d.get('home') or []; deaths+=d.get('deaths') or []
homes={k:v for k,v in homes.items() if not k.startswith('isolated') or k=='isolated-b'}
dist=lambda x,z,h: math.hypot(x-h[0],z-h[2])
far=[r for r in rows if r[1] in homes and r[6] is not None and dist(r[6],r[8],homes[r[1]])>=200]
print('far rows',len(far),'bots',len(set(r[2] for r in far)))
print(collections.Counter(r[2] for r in far).most_common(8))
c=collections.Counter(((r[7]-homes[r[1]][1])<-8, r[3], r[4]) for r in far)
for k,v in sorted(c.items(),key=lambda x:-x[1]): print(' deep=%s'%k[0],k[1],k[2],v)
nb=[r for r in far if r[2] not in('placebo-c-Bravo','board-d-Alpha')]
print('excl 2 chronic: n',len(nb),'ok',sum(r[3]=='success' for r in nb))
# deaths by band
dc=collections.Counter()
for t,p,b,x,y,z,fc in deaths:
    if p in homes and x is not None: dc[('200+' if dist(x,z,homes[p])>=200 else '<200', fc)]+=1
print('deaths',sorted(dc.items()))

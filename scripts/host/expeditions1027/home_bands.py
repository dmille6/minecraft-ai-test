import json,glob,math,collections,sys
H=sorted(glob.glob('/home/mike/frontiercensus/out/hours/2026-10-2[0-6]T*.json'))
H=[h for h in H if h>='/home/mike/frontiercensus/out/hours/2026-10-20T00']
def band(d):
    return '0-48' if d<48 else '48-100' if d<100 else '100-200' if d<200 else '200-300' if d<300 else '300+'
homes={};rows=[];samples=collections.defaultdict(list);deaths=collections.defaultdict(list);nh=0
for f in H:
    d=json.load(open(f));nh+=1
    if d.get('void'): continue
    homes.update(d['homes'])
    rows+=d.get('home') or []
    s=d.get('sample') or {}
    for r in s.get('rows') or []:
        samples[r[0]].append((s['at'],r[1],r[2],r[3],r[4]))
    for x in d.get('deaths') or []: deaths[x[2]].append(x)
homes={k:v for k,v in homes.items() if not k.startswith('isolated') or k=='isolated-b'}
print('hours',nh,'pools',len(homes),sorted(homes))
print('home rows',len(rows))
dist=lambda x,z,h: math.hypot(x-h[0],z-h[2])
# A: by start band, status/fail_class, closure
tab=collections.defaultdict(collections.Counter);clo=collections.defaultdict(list)
for t,p,b,st,fc,tr,sx,sy,sz,ex,ey,ez,du in rows:
    h=homes.get(p)
    if not h: continue
    if sx is None: k='unknown'
    else: k=band(dist(sx,sz,h))
    tc= tr if tr in('watchdog_home','llm:idle') else ('interrupt' if (tr or '').startswith('interrupt:') else 'other')
    tab[k][(st,fc)]+=1; tab[k]['n']+=1; tab[k]['trig:'+tc]+=1
    if sx is not None and ex is not None:
        d0=dist(sx,sz,h);d1=dist(ex,ez,h);clo[k].append((d0,d1,st,tc,(du or 0)/1000,(ey or 0)-h[1],(sy or 0)-h[1]))
for k in ['0-48','48-100','100-200','200-300','300+','unknown']:
    c=tab[k];print('\n==',k,'n',c['n'],'success',c[('success',None)]+sum(v for kk,v in c.items() if isinstance(kk,tuple) and kk[0]=='success' and kk[1] is not None))
    print('  ',sorted(((v,str(kk)) for kk,v in c.items() if kk!="n"),reverse=True)[:12])
    L=clo.get(k,[])
    if L:
        import statistics as S
        frac=[(a-b)/a for a,b,*_ in L if a>0]
        end=[b for a,b,*_ in L]
        print('   closure frac median %.2f; end<16: %d/%d; end<48: %d; moved closer>=50%%: %d; dur p50 %.0f; start deep(dy<-8) %d'%(S.median(frac),sum(e<16 for e in end),len(L),sum(e<48 for e in end),sum(f>=.5 for f in frac),S.median([x[4] for x in L]),sum(x[6]<-8 for x in L)))
        ni=[x for x in L if x[3]!='interrupt']
        if ni: print('   non-interrupted %d, success %d, end<16 %d'%(len(ni),sum(x[2]=='success' for x in ni),sum(x[1]<16 for x in ni)))
# B: excursions from hourly samples
print('\nsamples bots',len(samples),'total',sum(map(len,samples.values())))
ep=collections.Counter();ttr=collections.defaultdict(list);peak=collections.Counter()
for bot,S_ in samples.items():
    S_.sort();out=None;mx=0
    for at,p,x,y,z in S_:
        h=homes.get(p)
        if not h: continue
        d=dist(x,z,h)
        if out is None and d>=200: out=at;mx=d;continue
        if out:
            mx=max(mx,d)
            if d<48:
                b='200-300' if mx<300 else '300+'
                dd=[x_ for x_ in deaths[bot] if out<=__import__('datetime').datetime.fromtimestamp(x_[0]/1000,__import__('datetime').timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')<=at]
                kind='death' if dd else 'walked'
                ep[(b,kind)]+=1
                h1=(int(at[8:10])*24+int(at[11:13]))-(int(out[8:10])*24+int(out[11:13]))
                ttr[(b,kind)].append(h1);out=None
    if out: ep[('200-300' if mx<300 else '300+','censored')]+=1
print('excursions >=200 (hourly samples):',dict(ep))
for k,v in ttr.items():
    v.sort();print(' ',k,'hours to <48: n',len(v),'p50',v[len(v)//2],'p90',v[int(len(v)*.9)])
# same for 100-200 as control

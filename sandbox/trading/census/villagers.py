#!/usr/bin/env python3
"""Read-only census of villagers (entities/*.mca) and bot XP (playerdata/*.dat). Minimal NBT reader, stdlib only.
usage: villagers.py WORLD_DIR [--players]"""
import sys, os, struct, zlib, gzip, io, glob, json, collections
def rd(f, t):
    if t==1: return struct.unpack('>b', f.read(1))[0]
    if t==2: return struct.unpack('>h', f.read(2))[0]
    if t==3: return struct.unpack('>i', f.read(4))[0]
    if t==4: return struct.unpack('>q', f.read(8))[0]
    if t==5: return struct.unpack('>f', f.read(4))[0]
    if t==6: return struct.unpack('>d', f.read(8))[0]
    if t==7: n=struct.unpack('>i', f.read(4))[0]; return f.read(n)
    if t==8: n=struct.unpack('>H', f.read(2))[0]; return f.read(n).decode('utf-8','replace')
    if t==9:
        et=f.read(1)[0]; n=struct.unpack('>i', f.read(4))[0]; return [rd(f,et) for _ in range(n)]
    if t==10:
        d={}
        while True:
            tt=f.read(1)[0]
            if tt==0: return d
            n=struct.unpack('>H', f.read(2))[0]; k=f.read(n).decode('utf-8','replace'); d[k]=rd(f,tt)
    if t==11: n=struct.unpack('>i', f.read(4))[0]; return list(struct.unpack('>%di'%n, f.read(4*n)))
    if t==12: n=struct.unpack('>i', f.read(4))[0]; return list(struct.unpack('>%dq'%n, f.read(8*n)))
    raise ValueError(t)
def root(b):
    f=io.BytesIO(b); t=f.read(1)[0]; n=struct.unpack('>H', f.read(2))[0]; f.read(n); return rd(f,t)
def chunks(path):
    data=open(path,'rb').read()
    for i in range(1024):
        off=int.from_bytes(data[i*4:i*4+3],'big'); 
        if not off: continue
        p=off*4096; ln=struct.unpack('>i', data[p:p+4])[0]; ct=data[p+4]
        raw=data[p+5:p+4+ln]
        try: yield root(zlib.decompress(raw) if ct==2 else gzip.decompress(raw) if ct==1 else raw)
        except Exception as e: pass
w=sys.argv[1]
if '--players' in sys.argv:
    for p in sorted(glob.glob(w+'/playerdata/*.dat')):
        d=root(gzip.open(p).read())
        print(os.path.basename(p)[:8], 'XpLevel',d.get('XpLevel'),'XpTotal',d.get('XpTotal'),'XpP',round(d.get('XpP',0),2),'pos',[round(x) for x in d.get('Pos',[])])
    sys.exit()
out=[]; ents=collections.Counter(); nchunks=0
for r in glob.glob(w+'/entities/*.mca'):
    for c in chunks(r):
        nchunks+=1
        for e in c.get('Entities',[]):
            ents[e.get('id')]+=1
            if e.get('id') in ('minecraft:villager','minecraft:wandering_trader','minecraft:iron_golem'):
                vd=e.get('VillagerData',{}) or {}
                offers=[]
                for o in (e.get('Offers',{}) or {}).get('Recipes',[]):
                    def it(x): return (x.get('id'), x.get('count', x.get('Count',1))) if x else None
                    ench=None
                    s=o.get('sell',{}) or {}
                    comp=s.get('components',{}) or {}
                    st=comp.get('minecraft:stored_enchantments')
                    if st: ench=st.get('levels', st) if isinstance(st,dict) else st
                    offers.append({'buy':it(o.get('buy')),'buyB':it(o.get('buyB')),'sell':it(s),'ench':ench,'uses':o.get('uses'),'max':o.get('maxUses')})
                out.append({'id':e['id'],'pos':[round(x) for x in e.get('Pos',[])],'prof':vd.get('profession'),'level':vd.get('level'),'type':vd.get('type'),'xp':e.get('Xp'),'offers':offers})
print(json.dumps({'chunks':nchunks,'entity_kinds':ents.most_common(25),'villagers':out}))

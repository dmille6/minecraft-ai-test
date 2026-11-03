# READ-ONLY census helper (trading design 2026-11-03). Run on a COPY of a world folder. usage: poi.py WORLD_COPY [x0,y0,z0,x1,y1,z1]
import sys, collections, json
sys.argv=[sys.argv[0]]+sys.argv[1:]
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'villagers.py')).read().split("w=sys.argv[1]")[0])
import glob
box=[int(x) for x in sys.argv[2].split(',')] if len(sys.argv)>2 else None
cnt=collections.Counter(); rows=[]
for r in glob.glob(sys.argv[1]+'/poi/*.mca'):
    for c in chunks(r):
        for y,s in (c.get('Sections') or {}).items():
            for rec in s.get('Records',[]):
                x,yy,z=rec['pos']
                if box and not (box[0]<=x<=box[3] and box[2]<=z<=box[5]): continue
                cnt[rec['type']]+=1
                if rec['type'] not in ('minecraft:home','minecraft:nether_portal'): rows.append((rec['type'],rec['pos'],rec.get('free_tickets')))
print(cnt.most_common())
for r in sorted(rows): print(r)

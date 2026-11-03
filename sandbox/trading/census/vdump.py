# READ-ONLY (trading design 2026-11-03): villagers in a box with brain memories. usage: vdump.py WORLD_COPY x0,y0,z0,x1,y1,z1
import sys, glob
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'villagers.py')).read().split("w=sys.argv[1]")[0])
box=[int(x) for x in sys.argv[2].split(',')]
for r in glob.glob(sys.argv[1]+'/entities/*.mca'):
    for c in chunks(r):
        for e in c.get('Entities',[]):
            if e.get('id')!='minecraft:villager': continue
            x,y,z=e['Pos']
            if not (box[0]<=x<=box[3] and box[2]<=z<=box[5]): continue
            br=(e.get('Brain') or {}).get('memories',{})
            print([round(v,1) for v in e['Pos']], e.get('VillagerData'), 'Age',e.get('Age'),'NoAI',e.get('NoAI'),'Health',e.get('Health'),'Xp',e.get('Xp'),'LastRestock',e.get('LastRestock'),'mem',{k[10:]:(v.get('value') if isinstance(v,dict) else v) for k,v in br.items()}, 'Inv',e.get('Inventory'))

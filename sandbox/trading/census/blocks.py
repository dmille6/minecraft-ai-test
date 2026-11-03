# READ-ONLY (trading design 2026-11-03): a block map of a small box from region files. usage: blocks.py REGION_COPY_DIR x0,y0,z0,x1,y1,z1
import sys, glob, os, math
exec(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'villagers.py')).read().split("def chunks")[0])
import struct, zlib, gzip
def chunk_at(regdir, cx, cz):
    p='%s/r.%d.%d.mca'%(regdir, cx>>5, cz>>5)
    data=open(p,'rb').read(); i=(cx&31)+(cz&31)*32
    off=int.from_bytes(data[i*4:i*4+3],'big')
    if not off: return None
    q=off*4096; ln=struct.unpack('>i',data[q:q+4])[0]; ct=data[q+4]; raw=data[q+5:q+4+ln]
    return root(zlib.decompress(raw) if ct==2 else raw)
cache={}
def block(regdir,x,y,z):
    cx,cz=x>>4,z>>4
    if (cx,cz) not in cache: cache[(cx,cz)]=chunk_at(regdir,cx,cz)
    c=cache[(cx,cz)]
    if c is None: return '?'
    for s in c['sections']:
        if s['Y']==y>>4:
            bs=s.get('block_states',{}); pal=bs['palette']
            if 'data' not in bs: return pal[0]['Name'][10:]
            bits=max(4,math.ceil(math.log2(len(pal)))); per=64//bits
            idx=((y&15)*16+(z&15))*16+(x&15); L=bs['data'][idx//per]&((1<<64)-1)
            v=(L>>((idx%per)*bits))&((1<<bits)-1); return pal[v]['Name'][10:]
    return 'void'
reg=sys.argv[1]; x0,y0,z0,x1,y1,z1=[int(v) for v in sys.argv[2].split(',')]
ab={'air':'.','cave_air':'.','spruce_planks':'P','spruce_log':'L','cobblestone':'C','dirt_path':'_','grass_block':'g','dirt':'d','spruce_door':'D','glass_pane':'|','spruce_stairs':'^','spruce_slab':'-','torch':'t','wall_torch':'t','cauldron':'K','water_cauldron':'K','stone':'s','spruce_fence':'f','spruce_trapdoor':'T','white_bed':'B','snow':'*','short_grass':',','fern':','}
other={}
for y in range(y0,y1+1):
    print('y',y,'(x %d..%d across, z %d..%d down)'%(x0,x1,z0,z1))
    for z in range(z0,z1+1):
        row=''
        for x in range(x0,x1+1):
            b=block(reg,x,y,z); ch=ab.get(b)
            if ch is None:
                ch=other.setdefault(b, chr(ord('a')+len(other)) if len(other)<26 else '#')
            row+=ch
        print('  z%4d %s'%(z,row))
print({v:k for k,v in ab.items()}|{v:k for k,v in other.items()})

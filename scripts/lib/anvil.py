#!/usr/bin/env python3
"""Minimal Anvil/NBT reader + PNG writer, no dependencies.
Renders a vertical cross-section of the world around a stuck bot."""
import zlib, struct, sys

def read_nbt(b, i=0):
    def u1(): 
        nonlocal i; v=b[i]; i+=1; return v
    def u2():
        nonlocal i; v=struct.unpack_from('>H', b, i)[0]; i+=2; return v
    def i2():
        nonlocal i; v=struct.unpack_from('>h', b, i)[0]; i+=2; return v
    def i4():
        nonlocal i; v=struct.unpack_from('>i', b, i)[0]; i+=4; return v
    def i8():
        nonlocal i; v=struct.unpack_from('>q', b, i)[0]; i+=8; return v
    def f4():
        nonlocal i; v=struct.unpack_from('>f', b, i)[0]; i+=4; return v
    def f8():
        nonlocal i; v=struct.unpack_from('>d', b, i)[0]; i+=8; return v
    def s():
        nonlocal i; n=u2(); v=b[i:i+n].decode('utf-8','replace'); i+=n; return v
    def payload(t):
        nonlocal i
        if t==1:
            nonlocal_i = struct.unpack_from('>b', b, i)[0]; i += 1; return nonlocal_i
        if t==2: return i2()
        if t==3: return i4()
        if t==4: return i8()
        if t==5: return f4()
        if t==6: return f8()
        if t==7:
            n=i4(); v=b[i:i+n]; i+=n; return v
        if t==8: return s()
        if t==9:
            et=u1(); n=i4(); return [payload(et) for _ in range(n)]
        if t==10:
            d={}
            while True:
                tt=u1()
                if tt==0: return d
                nm=s(); d[nm]=payload(tt)
        if t==11:
            n=i4(); v=list(struct.unpack_from('>%di'%n,b,i)); i+=4*n; return v
        if t==12:
            n=i4(); v=list(struct.unpack_from('>%dq'%n,b,i)); i+=8*n; return v
        raise ValueError(f'tag {t}')
    # byte payload fix
    t=b[i]; i+=1
    if t==0: return None,i
    _=None
    n=struct.unpack_from('>H',b,i)[0]; i+=2; i+=n
    return payload(t), i

def get_chunk(path, cx, cz):
    with open(path,'rb') as f: data=f.read()
    idx = 4*((cx & 31) + (cz & 31)*32)
    off = int.from_bytes(data[idx:idx+3],'big')*4096
    cnt = data[idx+3]*4096
    if off == 0: return None
    ln = int.from_bytes(data[off:off+4],'big')
    comp = data[off+4]
    raw = data[off+5:off+4+ln]
    if comp == 2: raw = zlib.decompress(raw)
    elif comp == 1: raw = zlib.decompress(raw, 16+zlib.MAX_WBITS)
    nbt,_ = read_nbt(raw)
    return nbt

def blocks(chunk):
    """-> dict[(x,y,z)] = blockname, chunk-local x,z 0..15, absolute y"""
    out = {}
    for sec in chunk.get('sections', []):
        bs = sec.get('block_states')
        if not bs: continue
        pal = bs.get('palette') or []
        names = [p.get('Name','?') for p in pal]
        y0 = sec['Y']*16
        dat = bs.get('data')
        if not names: continue
        if dat is None or len(names)==1:
            for yy in range(16):
                for zz in range(16):
                    for xx in range(16):
                        out[(xx,y0+yy,zz)] = names[0]
            continue
        bits = max(4, (len(names)-1).bit_length())
        per = 64//bits
        mask = (1<<bits)-1
        vals=[]
        for lo in dat:
            lo &= (1<<64)-1
            for k in range(per):
                if len(vals) >= 4096: break
                vals.append((lo>>(k*bits)) & mask)
        for n,v in enumerate(vals[:4096]):
            yy = n//256; zz=(n%256)//16; xx=n%16
            out[(xx,y0+yy,zz)] = names[v] if v < len(names) else '?'
    return out

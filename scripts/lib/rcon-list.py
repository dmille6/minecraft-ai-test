#!/usr/bin/env python3
# rcon-list.py -- run ON the worlds host (10.0.0.30, sudo): ask every Block 2 Paper server who is online and its TPS.
# One line per world: "<pool> online <n>  tps <t>  <names>", then "TOTAL online <n>". "RCON FAIL" when a server does not answer.
# This is the one signal about the fleet that the Minecraft server itself vouches for; fleet-status.sh reads it over SSH.
import socket,struct,re,glob
def rcon(port,pw,cmd):
    s=socket.create_connection(("127.0.0.1",port),timeout=5)
    def send(t,body):
        p=struct.pack("<ii",1,t)+body.encode()+b"\x00\x00"; s.sendall(struct.pack("<i",len(p))+p)
        ln=struct.unpack("<i",s.recv(4))[0]; d=b""
        while len(d)<ln: d+=s.recv(ln-len(d))
        return d[8:-2].decode(errors="replace")
    send(3,pw); r=send(2,cmd); s.close(); return re.sub("§.","",r)
tot=0
for w in sorted(glob.glob("/srv/block2/*/server.properties")):
    name=w.split("/")[3]
    if name.startswith(("sandbox","template")): continue
    c=dict(l.split("=",1) for l in open(w).read().splitlines() if "=" in l and not l.startswith("#"))
    try:
        port=int(c.get("rcon.port",25575)); pw=c["rcon.password"].strip()
        out=rcon(port,pw,"list"); m=re.search(r"There are (\d+)",out); n=int(m.group(1)) if m else -1; tot+=max(n,0)
        t=re.findall(r"[0-9]+\.[0-9]+",rcon(port,pw,"tps"))[:1]
        who=out.split(":",1)[1].strip()[:70] if ":" in out else out[:70]
        print(f"{name:12s} online {n}  tps {t[0] if t else '?'}  {who}")
    except Exception as e: print(f"{name:12s} RCON FAIL {e}")
print("TOTAL online",tot)

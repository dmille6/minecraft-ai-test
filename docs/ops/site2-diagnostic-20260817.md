# Site-2 diagnostic snapshot — Mon Aug 17 13:58:44 CDT 2026

Collected from the Research Net (192.168.192.198, egress 76.165.200.8)
for tonight's work on: site2 -> home unreachable, and VPN failure.

## Home reachability from site 2 (the core symptom)
- 99.18.26.20:19200 -> HTTP 000
- 99.18.26.20:51820 -> HTTP 000
- 99.18.26.20:51821 -> HTTP 000
- 99.18.26.20:443 -> HTTP 000
```
traceroute to home:
traceroute to 99.18.26.20 (99.18.26.20), 8 hops max, 40 byte packets
 1  192.168.192.1  0.796 ms
 2  76.165.200.1  1.322 ms
 3  10.250.27.241  5.097 ms
 4  10.250.27.69  5.079 ms
 5  *
 6  154.54.168.213  5.312 ms
 7  154.54.40.249  12.925 ms
 8  154.54.28.74  12.740 ms
```

## Site-2 networks
```
WAN-LONI-76.165.200.8      purpose=wan              subnet=- vpn=- enabled=True
Internet 2                 purpose=wan              subnet=- vpn=- enabled=None
Default                    purpose=corporate        subnet=192.168.1.1/24 vpn=- enabled=True
OpenVPN-TICRDEV            purpose=remote-user-vpn  subnet=192.168.5.1/24 vpn=openvpn-server enabled=True
    local_port = 1194
Research Net               purpose=corporate        subnet=192.168.192.1/24 vpn=- enabled=None
CCU                        purpose=vlan-only        subnet=192.168.104.1/24 vpn=- enabled=None
Storage                    purpose=vlan-only        subnet=- vpn=- enabled=None
TICRDEV-WireGuard          purpose=remote-user-vpn  subnet=192.168.3.1/24 vpn=wireguard-server enabled=True
    local_port = 51820
    wireguard_interface = wan
MC-AI Lab                  purpose=corporate        subnet=192.168.193.1/24 vpn=- enabled=None
```

## Site-2 WAN / health
```
wan = ok  wan_ip= 76.165.200.8  gw= TICR_DEV
www = ok  wan_ip=   gw= 
lan = ok  wan_ip=   gw= 
vpn = ok  wan_ip=   gw= 
```

## Site-2 port forwards
```
TPOT : WAN to TPOT Hive        wan: 64290-64310 -> 192.168.192.10:64290-64310 src=None on=True
TPOTMISP to INTEL              wan:        8443 -> 192.168.192.152:443      src=None on=True
TPOTMISP SSH                   wan:        8022 -> 192.168.192.152:22       src=None on=True
TPOT to AI Server - CACHED     wan:       11434 -> 192.168.192.15:11435    src=None on=True
AI Server - NO CACHE           wan:       11436 -> 192.168.192.15:11434    src=None on=True
AI SSH access                  wan:          22 -> 192.168.192.15:22       src=None on=True
MCAI Inference (Blackwell)     wan:       11438 -> 192.168.192.244:11434    src=None on=True
MCAI ssh bots2                 wan:        2222 -> 192.168.193.40:22       src=99.18.26.20 on=True
MCAI ssh ctl01                 wan:        2223 -> 192.168.193.10:22       src=99.18.26.20 on=True
```

## Firewall zones and Research-zone policy
```
zone: Internal ['6a202e6e13a4c211f68477f6']
zone: External ['6a202e6e13a4c211f68477f4', '6a202e6e13a4c211f68477f5']
zone: Gateway []
zone: Vpn ['6a22d8c254dace44959943c6', '6a597ef6d61ecacb493935a3']
zone: Hotspot []
zone: Dmz []
zone: Research ['6a4d042ed61ecacb493899aa', '6a75e91f53e640dffc038528']

ON  Internal ->Vpn       ALLOW Allow All Traffic
ON  Internal ->Research  BLOCK Block All Traffic
ON  External ->Vpn       BLOCK Block All Traffic
ON  External ->Vpn       ALLOW Allow Return Traffic
ON  External ->Vpn       BLOCK Block Invalid Traffic
ON  External ->Research  BLOCK Block All Traffic
ON  External ->Research  ALLOW Allow DNAT {1to1 datashare1 inbound}
ON  External ->Research  ALLOW Allow Port Forward TPOT : WAN to TPOT Hive
ON  External ->Research  ALLOW Allow Port Forward TPOTMISP to INTEL
ON  External ->Research  ALLOW Allow Port Forward TPOTMISP SSH
ON  External ->Research  ALLOW Allow Port Forward TPOT to AI Server - CACHE
ON  External ->Research  ALLOW Allow Port Forward AI Server - NO CACHE
ON  External ->Research  ALLOW Allow Port Forward AI SSH access
ON  External ->Research  ALLOW Allow Port Forward MCAI Inference (Blackwell
ON  External ->Research  ALLOW Allow Port Forward MCAI ssh bots2
ON  External ->Research  ALLOW Allow Port Forward MCAI ssh ctl01
ON  External ->Research  ALLOW Allow Return Traffic
ON  External ->Research  BLOCK Block Invalid Traffic
ON  Gateway  ->Vpn       ALLOW Allow All Traffic
ON  Gateway  ->Research  ALLOW Allow All Traffic
ON  Vpn      ->Internal  ALLOW Allow All Traffic
ON  Vpn      ->External  ALLOW Allow All Traffic
ON  Vpn      ->External  BLOCK Block Invalid Traffic
ON  Vpn      ->Gateway   ALLOW Allow All Traffic
ON  Vpn      ->Vpn       ALLOW Allow All Traffic
ON  Vpn      ->Hotspot   ALLOW Allow All Traffic
ON  Vpn      ->Dmz       ALLOW Allow All Traffic
ON  Vpn      ->Research  BLOCK Block All Traffic
ON  Vpn      ->Research  ALLOW MC-AI Lab shipper to Instance1 ELK (Return)
ON  Hotspot  ->Vpn       BLOCK Block All Traffic
ON  Hotspot  ->Vpn       ALLOW Allow Return Traffic
ON  Hotspot  ->Research  BLOCK Block All Traffic
ON  Dmz      ->Vpn       BLOCK Block All Traffic
ON  Dmz      ->Vpn       ALLOW Allow Return Traffic
ON  Dmz      ->Research  BLOCK Block All Traffic
ON  Research ->Internal  BLOCK Block All Traffic
ON  Research ->Internal  ALLOW Allow Internal to Research (Return)
ON  Research ->External  ALLOW Allow All Traffic
ON  Research ->External  ALLOW Allow 1to1 datashare1 inbound (Return)
ON  Research ->External  BLOCK Block Invalid Traffic
ON  Research ->Gateway   ALLOW Allow All Traffic
ON  Research ->Gateway   ALLOW Allow mDNS
ON  Research ->Vpn       BLOCK Block All Traffic
ON  Research ->Vpn       ALLOW Allow VPN to Research (Return)
ON  Research ->Hotspot   BLOCK Block All Traffic
ON  Research ->Dmz       BLOCK Block All Traffic
ON  Research ->Research  BLOCK Block All Traffic
ON  Research ->Research  ALLOW MC-AI Lab to AI inference hosts (Return)
ON  Vpn      ->Research  ALLOW Allow VPN to Research
ON  Internal ->Research  ALLOW Allow Internal to Research
ON  External ->Research  ALLOW Allow 1to1 datashare1 inbound
ON  Research ->Research  ALLOW MC-AI Lab to AI inference hosts
ON  Research ->Vpn       ALLOW MC-AI Lab shipper to Instance1 ELK
```

## Blackwell / CCU1 status (192.168.192.244)
```
ARP: ? (192.168.192.244) at b4:e9:b8:f6:b8:38 on en9 ifscope [ethernet]
ICMP: no reply; TCP 22/135/139/445/3389/5985/11434 all filtered
UniFi sees: name= None  uptime_s= 328030  last_seen= 2026-08-17 13:59:30
switch port= 8  sw_mac= d8:b3:70:3a:35:89  wired= True  rx= None  tx= None
VERDICT: powered on, linked, network stack answers ARP; all L3/L4 blocked.
         -> Windows Firewall (likely profile flipped to Public) or resource-wedged.
         -> NEEDS PHYSICAL/CONSOLE ACCESS. No remote path in.
```

## Hypothesis to test tonight (from home)
Site 2 -> home is dead on EVERY port (19200/51820/51821/443), not just VPN.
It worked earlier today. Home's Site Magic tunnel ("Express 7",
sdwan-mesh-tunnel, remote_vpn_subnets 192.168.4.0/24 + 192.168.3.0/24) was
DOWN for hours (home reported vpn=error) during the window when site2->home
worked, and site 2 reported vpn=ok when it stopped working.

THEORY: with the tunnel up, home routes replies toward site 2's WAN prefix
(76.165.200.0/24) into the tunnel instead of out the WAN, so every inbound
connection from site 2 gets an undeliverable reply.

CHECK FROM HOME TONIGHT:
  1. ip route get 76.165.200.8   (does it resolve via wgsts1000 / the tunnel?)
  2. Home firewall: any rule matching 76.165.200.0/24 beyond my ELK ones
  3. Whether Express 7 is currently up, and whether disabling it restores
     site2 -> home (user does NOT want the networks joined permanently, so
     disabling is acceptable to them)
  4. Confirm instance #2 filebeat is or is not reaching 99.18.26.20:19200

CHANGES MADE TODAY (revert candidates):
  - site 2 OpenVPN-TICRDEV subnet 192.168.2.0/24 -> 192.168.5.0/24  [KEEP:
    it genuinely collided with home's Wisteria VPN subnet]
  - home Wisteria WireGuard local_port 51820 -> 51821  [REVERT: did not help,
    and home's "Allow WireGuard VPNs" policy permits only udp/51820,20000 —
    if it did not auto-update, this alone breaks the VPN everywhere]

# VM provisioning — as built

**Host:** Proxmox `rprox3a` · **VMID:** 101 · **Name:** `mc-ai-test-dm`
**Guest:** `mcai` @ mcai.lan · Ubuntu 26.04 LTS · kernel 7.0.0-29-generic
**Admin user:** `mike` (passwordless sudo, SSH key `id_ed25519_aiservers`)
**Last verified:** 2026-08-05

---

## Proxmox config (VMID 101)

| Setting | Value | Why |
|---|---|---|
| `cores` | 6 | Paper's tick loop is single-threaded; ~2 cores Paper, ~0.4/bot pathfinding, ~0.5 OS |
| `memory` | 16438 MB | 6G Paper heap + ~1G JVM non-heap + ~1G/bot + ~1.5G OS |
| `cpu` | **`x86-64-v3`** | v2-AES (the previous value) exposes **no AVX2/FMA/BMI2**. v3 does, and unlike `host` it stays live-migratable across Haswell+ nodes. Every other VM on this host is v2-AES — v3 keeps that migration property. |
| `scsihw` | `virtio-scsi-single` | |
| `scsi0` | `data-zfs:vm-101-disk-0,iothread=1,ssd=1,discard=on,size=256G` | `ssd=1` reports non-rotational to the guest; `discard=on` frees ZFS zvol blocks on fstrim |
| `balloon` | **0** | A fixed JVM heap beside a balloon driver causes GC stalls. 0 removes the device. |
| `agent` | **not yet enabled** | See "Outstanding" below |

Applied with:

```bash
qm set 101 --cpu x86-64-v3
qm set 101 --scsi0 data-zfs:vm-101-disk-0,iothread=1,ssd=1,discard=on,size=256G
qm set 101 --balloon 0
qm stop 101 && sleep 5 && qm start 101
```

CPU/disk/balloon changes need a **full stop/start** — a reboot inside the guest does
not re-read the Proxmox config.

### Verifying the CPU change actually took

Guest-side flags:

```bash
grep -m1 ^flags /proc/cpuinfo | tr ' ' '\n' | grep -xE "avx|avx2|fma|bmi2"
```

JVM-side (the check that actually matters):

```bash
java -XX:+PrintFlagsFinal -version | awk '/UseAVX|UseFMA|MaxVectorSize/{print $2, $4}'
```

| | before (v2-AES) | after (v3) |
|---|---|---|
| `UseAVX` | 0 | **2** |
| `UseFMA` | false | **true** |
| `MaxVectorSize` | 16 | **32** |

`lscpu` still prints `QEMU Virtual CPU version 2.5+` for named CPU models — that
string is not a reliable indicator. Trust the flags.

---

## Storage layout

Ubuntu's installer allocated only 100 G of the 254 G volume group to root, leaving
154 G free. A dedicated data LV was carved from it so world growth can never fill
root and break the OS.

```
sda (256G, ZFS zvol) → sda3 → ubuntu-vg (254G)
                                ├─ ubuntu-lv  100G  /
                                ├─ data       120G  /srv/minecraft
                                └─ (free)      34G  headroom
```

```bash
lvcreate -y -L 120G -n data ubuntu-vg
mkfs.ext4 -q -L mcdata /dev/ubuntu-vg/data
# fstab: UUID=<uuid> /srv/minecraft ext4 defaults,noatime 0 2
```

### Directories and ownership

| Path | Owner | Mode |
|---|---|---|
| `/srv/minecraft/server` | `minecraft:minecraft` | 750 |
| `/srv/minecraft/bots` | `mcbot:mcbot` | 750 |
| `/srv/minecraft/backups` | `minecraft:minecraft` | 750 |
| `/srv/minecraft/shared` | `mike:mike` | 755 |

`minecraft` and `mcbot` are separate `nologin` system accounts. Splitting them
implements handoff doc §18 — the Paper server and the agent runtime are distinct
trust domains, so a compromised bot process cannot write to the server directory.
`mike` is a member of both groups.

**Backups use ZFS snapshots, not tarballs.** The underlying storage is ZFS
(`data-zfs`), so `zfs snapshot` gives near-instant, block-level, compressed world
backups. This replaces the 30–50 GB of rotating tarballs originally budgeted.

---

## Installed runtime

| Component | Version | Source |
|---|---|---|
| Java | OpenJDK **21.0.11** (`openjdk-21-jdk-headless`) | Ubuntu repo |
| Node.js | **22.22.1** | Ubuntu repo |
| npm | **11.19.0** | `npm install -g npm@11` → `/usr/local/bin` |
| mineflayer | **4.37.1** (smoke-tested) | npm, in `/srv/minecraft/bots` |

Java 21, not 25 — Paper 1.21.11 requires exactly 21. Do not install 25; that is
for Paper 26.x, which mineflayer cannot connect to (see ADR-0001).

The **JDK** rather than the JRE, so `jcmd`, `jstat`, and JFR are available for
diagnosing tick-time problems ("observability before scale").

**npm gotcha:** Ubuntu pairs node 22.22.1 with npm 9.2.0 (from 2022). `npm@latest`
(12.x) requires node `^22.22.2` — one patch newer than Ubuntu ships — so it fails
with `EBADENGINE`. Pin to `npm@11`.

---

## Kernel tuning

`/etc/sysctl.d/99-minecraft.conf`:

```ini
vm.swappiness=1
vm.vfs_cache_pressure=50
```

Swappiness 1 (default 60) because a swapped JVM heap produces multi-second GC
pauses. `fstrim.timer` is enabled so `discard=on` actually reclaims zvol blocks.

---

## Outstanding

1. **QEMU guest agent.** Installed in-guest but cannot start: `/dev/virtio-ports/`
   is empty because the host has not exposed the virtio-serial device. Needs
   `qm set 101 --agent enabled=1` plus a stop/start. Only affects clean shutdown
   and snapshot quiescing — safe to defer to the next power cycle.
2. **Static addressing.** Still DHCP (`proto dhcp`). Set a reservation for
   mcai.lan so the address cannot move.
3. **Paper + ViaVersion** not yet installed.
4. Two packages held back by Ubuntu's phased rollout
   (`software-properties-common`, `python3-software-properties`). Normal; they
   land on their own.

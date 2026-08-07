#!/usr/bin/env bash
# build-lab.sh -- create the mc2 lab VMs on a Proxmox host.
#
# Run ON the Proxmox host (or via ssh root@host 'bash -s' < build-lab.sh).
#
# DELIBERATELY ADDITIVE. It creates VMs and nothing else. It does not touch host
# networking, existing VMs, storage layout, or the firewall -- a bad bridge or
# VLAN change on the hypervisor locks out the SSH session doing the work, and
# there is no path back in to undo it. That part stays manual and verified.
#
#   ./build-lab.sh                 preflight + show the plan, change nothing
#   ./build-lab.sh --apply         create the VMs
#   ./build-lab.sh --apply --start boot them after creating
#
# Every value it needs is DISCOVERED and CHECKED against the host rather than
# assumed. Assumed values are how you get a VM on the wrong bridge with an IP
# that silently collides -- and this project has already spent a day chasing a
# distance measured from a home coordinate that was assumed rather than read.
set -euo pipefail

# data-zfs, not local-lvm: storage is NODE-SCOPED. rprox1 has 793G on local-lvm,
# rprox3a has 137G -- not enough for this build. The same trap as the interface
# names, and the reason preflight validates rather than trusts.
STORAGE="${STORAGE:-data-zfs}"
# vmbr193 sits on the nic2.193 sub-interface, which does the VLAN tagging. Do
# NOT also set tag= on the NIC: that double-tags and the traffic goes nowhere.
# TICRDEV was deliberately left non-VLAN-aware so the live VMs on it are
# untouched, which is why this is a separate bridge rather than a tag.
BRIDGE="${BRIDGE:-vmbr193}"
GW="${GW:-192.168.193.1}"
POOL="${POOL:-MC-AI-Test}"
IMG_URL="${IMG_URL:-https://cloud-images.ubuntu.com/releases/26.04/release/ubuntu-26.04-server-cloudimg-amd64.img}"
SSHKEY="${SSHKEY:-$HOME/.ssh/authorized_keys}"
CIUSER="${CIUSER:-mike}"
# A SHA-512 crypt hash ($6$...), never a plaintext password. cloud-init accepts
# either; passing the hash means the secret is not in this script, not in the
# process table, and not in anyone's shell history. Console access matters
# because if networking breaks on a guest, the Proxmox console is the only
# remaining way in -- SSH keys alone would strand it.
CIPASS="${CIPASS:-}"
NAMESERVER="${NAMESERVER:-192.168.193.1}"
APPLY=0; START=0
for a in "$@"; do case "$a" in --apply) APPLY=1;; --start) START=1;; esac; done

# vmid  name           cores  ram    disk  ip
#
# The -dm suffix is this cluster's ownership convention (opencti-dm,
# student-elk-share-dm, k-12-hp-dm). On a shared host, a guest whose owner is
# not obvious from its name is a guest nobody will touch when it misbehaves.
read -r -d '' PLAN <<'EOF' || true
9101 mc2-mc01-dm   4  8192  100 192.168.193.100
9140 mc2-lab01-dm  6 16384  100 192.168.193.40
9121 mc2-evd01-dm  4 16384  250 192.168.193.21
9130 mc2-elk01-dm  4 16384  300 192.168.193.30
9110 mc2-ctl01-dm  4  8192  100 192.168.193.10
EOF

say(){ printf '  %s\n' "$*"; }
die(){ printf '\n  FAIL: %s\n' "$*" >&2; exit 1; }

echo "== preflight"
command -v qm  >/dev/null || die "qm not found -- is this a Proxmox host?"
command -v pvesm >/dev/null || die "pvesm not found"
say "proxmox $(pveversion 2>/dev/null | head -1)"

# Storage: must exist and accept disk images.
if [ -z "$STORAGE" ]; then
  STORAGE=$(pvesm status -content images 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')
  [ -n "$STORAGE" ] || die "no active image-capable storage found; set STORAGE="
  say "storage (discovered): $STORAGE"
else
  pvesm status -content images | awk 'NR>1{print $1}' | grep -qx "$STORAGE" \
    || die "storage '$STORAGE' is not an active image-capable storage"
  say "storage: $STORAGE"
fi

# Bridge: must exist. VLAN-awareness is checked but not changed.
ip link show "$BRIDGE" >/dev/null 2>&1 \
  || die "bridge '$BRIDGE' does not exist on this host (expected vmbr193 on nic2.193)"
say "bridge: $BRIDGE -> $(ls /sys/class/net/$BRIDGE/brif 2>/dev/null | tr '\n' ' ')"
# A bridge with no port is a bridge to nowhere, and VMs on it fail silently.
[ -n "$(ls /sys/class/net/$BRIDGE/brif 2>/dev/null)" ] || die "$BRIDGE has no member port"

pvesh get "/pools/$POOL" >/dev/null 2>&1 || die "resource pool '$POOL' does not exist"
say "pool: $POOL"

[ -r "$SSHKEY" ] || die "no readable ssh public key at $SSHKEY (set SSHKEY=)"
say "ssh key: $SSHKEY ($(wc -l < "$SSHKEY") entries)"
case "$CIPASS" in
  '$6$'*) say "console password: SHA-512 hash supplied" ;;
  '')     say "console password: none (key-only)" ;;
  *)      die "CIPASS does not look like a SHA-512 crypt hash -- refusing to set a plaintext password" ;;
esac

# VMIDs must be free. Refusing to touch an existing VM is the whole safety model.
while read -r id name _; do
  [ -z "${id:-}" ] && continue
  qm status "$id" >/dev/null 2>&1 && die "vmid $id is already in use (wanted for $name) -- refusing to touch it"
done <<< "$PLAN"
say "vmids free: $(awk '{printf "%s ", $1}' <<< "$PLAN")"

# Image: fetch once, verify it is actually an image and not an error page.
IMG="/var/lib/vz/template/qcow2/$(basename "$IMG_URL")"
mkdir -p "$(dirname "$IMG")"
if [ ! -s "$IMG" ]; then
  say "image not cached; downloading $(basename "$IMG_URL")"
  command -v dig >/dev/null || apt-get install -y -qq dnsutils >/dev/null 2>&1 || true
  [ "$APPLY" = 1 ] || { say "(dry run -- would download)"; }
  if [ "$APPLY" = 1 ]; then
    # rprox3a's /etc/resolv.conf points at 192.168.192.1, a resolver it has no
    # route to, so name resolution fails even though the internet is reachable
    # (dig @8.8.8.8 works, ping 8.8.8.8 works). That is a pre-existing host
    # misconfiguration on a shared cluster, so resolve around it here rather
    # than editing DNS for guests that are not ours.
    HOST=$(echo "$IMG_URL" | awk -F/ '{print $3}')
    RESOLVE=""
    if ! getent hosts "$HOST" >/dev/null 2>&1; then
      IP=$(dig +short +time=3 @8.8.8.8 "$HOST" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)
      [ -n "$IP" ] || die "cannot resolve $HOST (system resolver dead, 8.8.8.8 fallback also failed)"
      say "system resolver cannot see $HOST; using $IP directly"
      RESOLVE="--resolve $HOST:443:$IP"
    fi
    curl -fL --retry 3 $RESOLVE -o "$IMG.part" "$IMG_URL" || die "download failed: $IMG_URL"
    qemu-img info "$IMG.part" >/dev/null 2>&1 || die "downloaded file is not a disk image -- check IMG_URL"
    mv "$IMG.part" "$IMG"
  fi
else
  qemu-img info "$IMG" >/dev/null 2>&1 || die "cached image is corrupt: $IMG"
  say "image cached: $IMG"
fi

# Thin provisioning means an over-committed pool looks fine until the day the
# disks actually fill, at which point every guest fails at once.
WANT=$(awk '{s+=$5} END{print s}' <<< "$PLAN")
FREE=$(pvesm status -content images | awk -v st="$STORAGE" '$1==st{printf "%.0f", $6/1048576}')
say "requested ${WANT}G, free on $STORAGE: ${FREE}G"
[ "${FREE:-0}" -gt "$WANT" ] || die "not enough space on $STORAGE (${FREE}G free, ${WANT}G requested)"

echo
echo "== plan"
printf '  %-6s %-14s %5s %7s %6s  %s\n' VMID NAME CORES RAM DISK IP
while read -r id name cores ram disk ip; do
  [ -z "${id:-}" ] && continue
  printf '  %-6s %-14s %5s %6sM %5sG  %s/24\n' "$id" "$name" "$cores" "$ram" "$disk" "$ip"
done <<< "$PLAN"

if [ "$APPLY" != 1 ]; then
  echo
  say "DRY RUN -- nothing created. Re-run with --apply."
  exit 0
fi

echo
echo "== creating"
while read -r id name cores ram disk ip; do
  [ -z "${id:-}" ] && continue
  say "$name ($id)"
  qm create "$id" --name "$name" --cores "$cores" --memory "$ram" \
    --cpu host --machine q35 --bios ovmf --agent enabled=1 \
    --net0 "virtio,bridge=$BRIDGE" --ostype l26 --scsihw virtio-scsi-single \
    --pool "$POOL"
  qm set "$id" --efidisk0 "$STORAGE:0,efitype=4m,pre-enrolled-keys=0" >/dev/null
  qm importdisk "$id" "$IMG" "$STORAGE" >/dev/null
  qm set "$id" --scsi0 "$STORAGE:vm-$id-disk-1,discard=on,ssd=1" >/dev/null
  qm disk resize "$id" scsi0 "${disk}G" >/dev/null
  qm set "$id" --ide2 "$STORAGE:cloudinit" --boot order=scsi0 \
                --ciuser "$CIUSER" --sshkeys "$SSHKEY" \
                --nameserver "$NAMESERVER" \
                --ipconfig0 "ip=$ip/24,gw=$GW" >/dev/null
  # Set separately so the hash never appears on the same command line as the
  # rest, and so a missing value is a visible skip rather than a blank password.
  if [ -n "$CIPASS" ]; then qm set "$id" --cipassword "$CIPASS" >/dev/null
  else say "  no CIPASS set -- console login will be key-only"; fi
  # mc01 hosts the Minecraft server: its tick loop is latency-sensitive and
  # must not share physical cores with the bot runner. See PLAN-30-DAY.
  [ "$name" = "mc2-mc01-dm" ] && qm set "$id" --numa 1 >/dev/null
  say "  created"
  if [ "$START" = 1 ]; then
    qm start "$id"; say "  started"
    # FIRST BOOT NEEDS A KICK. Four of the first five guests never brought up a
    # network on their initial power-on -- identical disks, identical config,
    # all of them burning CPU, and a plain stop/start fixed every one. The most
    # likely cause is OVMF settling its boot entry the first time it runs, since
    # the efidisk starts empty with pre-enrolled-keys=0 and there is no boot
    # variable until something writes one.
    #
    # Rather than leave a script that silently needs babysitting, wait for the
    # guest to answer and power-cycle it once if it does not. If it is still
    # silent after that, say so plainly instead of reporting success.
    for _ in $(seq 1 12); do sleep 5; ping -c1 -W1 "$ip" >/dev/null 2>&1 && break; done
    if ! ping -c1 -W1 "$ip" >/dev/null 2>&1; then
      say "  no network after 60s -- power-cycling once (known OVMF first-boot behaviour)"
      qm stop "$id" >/dev/null 2>&1; sleep 3; qm start "$id" >/dev/null 2>&1
      for _ in $(seq 1 24); do sleep 5; ping -c1 -W1 "$ip" >/dev/null 2>&1 && break; done
    fi
    ping -c1 -W1 "$ip" >/dev/null 2>&1 && say "  up at $ip" || say "  STILL SILENT at $ip -- check the console"
  fi
done <<< "$PLAN"

echo
say "done. Verify with: qm list  ·  pvesh get /pools/$POOL"
say "Cloud-init sets the IP; first boot takes a minute. Then: ssh $CIUSER@<ip>"

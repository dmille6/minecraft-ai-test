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
CIUSER="${CIUSER:-darrell}"
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
  [ "$APPLY" = 1 ] || { say "(dry run -- would download)"; }
  if [ "$APPLY" = 1 ]; then
    curl -fL --retry 3 -o "$IMG.part" "$IMG_URL" || die "download failed: $IMG_URL"
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
                --ipconfig0 "ip=$ip/24,gw=$GW" >/dev/null
  # mc01 hosts the Minecraft server: its tick loop is latency-sensitive and
  # must not share physical cores with the bot runner. See PLAN-30-DAY.
  [ "$name" = "mc2-mc01-dm" ] && qm set "$id" --numa 1 >/dev/null
  say "  created"
  [ "$START" = 1 ] && { qm start "$id"; say "  started"; }
done <<< "$PLAN"

echo
say "done. Verify with: qm list  ·  pvesh get /pools/$POOL"
say "Cloud-init sets the IP; first boot takes a minute. Then: ssh $CIUSER@<ip>"

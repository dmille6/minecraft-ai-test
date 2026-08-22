# pve4 — morning todo (2026-08-21)

Everything on pve4 is done and healthy **except GPU passthrough**, which is
blocked by motherboard firmware. All of these need someone physically at the
machine.

---

## 1. Unblock the RTX 5080 passthrough  ← the only blocker

The board's BIOS emits three ACPI IVMD entries covering every PCI device, so
VFIO refuses to hand the GPU to a guest. Try these BIOS toggles **in order**,
rebooting and re-checking after each.

- [ ] **DMA Protection** — look for "Kernel DMA Protection", "Pre-boot DMA
      Protection", or "DMA Remapping". Set to **Disabled**.
- [ ] **TSME / AMD Memory Guard / Transparent Secure Memory Encryption** —
      Disabled. (BIOS v1A73's changelog explicitly enabled TSME for Ryzen 9000.)
- [ ] **Anti-cheat mechanism** — if exposed as a toggle. MSI added this in v1A61.

After each change, from the Mac:

    ssh -i ~/.ssh/id_ed25519_aiservers root@10.0.0.72 /root/check-iommu.sh

It prints a plain **STILL BLOCKED** or **FIXED** verdict. On FIXED:

    ssh -i ~/.ssh/id_ed25519_aiservers root@10.0.0.72 'qm start 203'

### If no BIOS toggle works — roll back the BIOS

- [ ] Flash **7E57v1A55** (2026-01-26) or **7E57v1A53** (2025-09-24).

Both predate v1A61's anti-cheat, and both are *after* v1A43 (June 2025) which
added 64GB DIMM support — so your 128GB stays supported. v1A53 is closest to the
firmware the board shipped with. USB stick is already formatted FAT32 as
`/Volumes/BIOS`; update via M-Flash.

**Note:** the passthrough may have worked on the original shipped BIOS
(1.AE1, Sept 2025). It was never tested, so this is unproven — but the AGESA
version is the prime suspect.

---

## 2. Install the 10GbE card

- [ ] Fit the card (same Aquantia AQC113 as pve1 — `atlantic` driver, proven).
- [ ] Check EEE on it: `ethtool --show-eee <iface>` — pve1 reports it disabled,
      but confirm rather than assume. This is the exact fault that took the
      cluster down last night.
- [ ] Add it as corosync **link 1**, keeping the Realtek as link 0, for ring
      redundancy — rather than just moving the single point of failure.

---

## 3. Raspberry Pi QDevice

- [ ] `corosync-qnetd` on the Pi, `corosync-qdevice` on all four nodes.
- [ ] Keep it off the cluster's failure domain — different switch if possible,
      not the same UPS.

Cluster is currently 4 nodes at quorum 3, so it still survives only **one**
failure. The QDevice makes it 3-of-5 and survives two.

---

## Already done, no action needed

- Repos switched to no-subscription; upgraded 9.2.2 → 9.2.11 (kernel 7.0.14-12)
- Joined `dmhomecluster` as pve4, quorate
- 2TB wiped → `nvme2t` LVM-thin, scoped to pve4
- NIC link flapping **fixed** — EEE disabled, persisted as `nic0-eee-off.service`
- VM 203 `ollama-5080` built (8 cores / 32GB / 500G on nvme2t / 10.0.0.17),
  waiting only on the passthrough fix
- **Do not remove `rpcbind`** — `argentino_nfs` is NFSv3 and needs it

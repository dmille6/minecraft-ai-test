# 2026-08-31 — the climb-escape re-evaluation did not happen: no path to the fleet

**Verdict: UNKNOWN. Not "it worked", not "it failed".** The overnight fix was
never measured, because this Mac cannot reach the fleet host.

## What was supposed to happen

Re-measure, restricted to after the `block2-climb-escape` deploy: frozen vs
moving bots, `surface` success below y=60 (the key metric — 0/1902 before the
fix), shaft stop reasons, pickaxe holdings, deaths and restarts.

## What actually happened

`ssh mike@10.0.0.31` times out. So does everything else on 10.0.0.0/24,
including the gateway. `traceroute` to 10.0.0.31 drops at hop 1 — no route,
not a slow route.

The Mac is at Site 2: `en0 = 10.4.0.127/24`, gateway 10.4.0.1, egress
**76.165.200.4**. The fleet is at home on 10.0.0.0/24.

Paths tried and eliminated:

| path | result |
|---|---|
| direct `10.0.0.31` | ping 100% loss, TCP 22 timeout, traceroute dies hop 1 |
| `ai1` as jump | reachable, but it is on 192.168.192.15 (work net, forbidden) and cannot reach 10.0.0.31 either |
| `feed` (cti1, 76.165.200.190) | reachable; cannot reach 10.0.0.31 |
| rprox1 / rprox2a / rprox3a | reachable; none can reach 10.0.0.31 |
| `10.0.0.2` as jump (only route Home-Split installs) | itself unreachable |
| WireGuard **Home-Split** | reports *Connected*; installs one host route (10.0.0.2); carries nothing |
| WireGuard **Home-Full** | reports *Connected*; takes the default route and black-holes **all** traffic — `curl api.ipify.org` returned empty |

The three local Proxmox nodes host threat-intel VMs plus the stopped `mc2-*`
guests. The fleet does not live at this site.

## This is the already-documented fault

`docs/ops/site2-diagnostic-20260817.md`: "Site 2 -> home is dead on EVERY port
(19200/51820/51821/443), not just VPN", theorised as home's Site Magic tunnel
"Express 7" routing replies for **76.165.200.0/24** into the tunnel instead of
out the WAN. Today's egress, 76.165.200.4, is inside that prefix. The fault is
at the *home* end; nothing done from Site 2 fixes it. The repair (Express 7 /
home firewall) also sits behind the UniFi API on 10.0.0.1, which is off limits.

Network state was restored: all three VPN profiles Disconnected, default route
back to 10.4.0.1, internet verified working.

## What was verified instead (locally, no fleet needed)

All five fixes are present in the tree with dedicated tests:
`extendScaffolding` and `overheadBreakRisk` (bots/src/scaffold.mjs),
`planDig`/`MIN_DIG_MS` (bots/src/digbudget.mjs), the `recipesFor` veto
(bots/src/admission.mjs:400-412), and `FALLING` kept out of bridging while
allowed for the vertical pillar (bots/src/scaffold.mjs:32).

Full suite: **85/85 pass, 0 fail, 0 timeout** (`bots/test`, 300s per-file
budget). `hard-stop` took 210s and `mine-staircase` 55s, exactly as the
budget note predicts. The 9 other `*.test.mjs` files in the repo are under
`eval/cairn/`, a separate subproject, and were not run.

**This says the code is self-consistent. It says nothing about whether the bots
got out.** The suite passed before the deploy too.

## Unresolved and important

Two of the five fixes were committed *this morning* — `4a0a90e` (07:11, sand
pillar) and `83f3fa6` (07:31, dig failure reasons) — after the `ac3a3f2` deploy
(01:29). Whether they ever reached the fleet is **unknown**, and cannot be
checked without log access, since the deploy moment is found by the first
appearance of a `code.version` in the logs. If the network was already down at
07:11, they did not deploy.

## Next

1. Restore Site 2 -> home routing from the home end, or run the analysis from a
   machine on 10.0.0.0/24.
2. Then re-run the measurement. The key metric is unchanged and still fair:
   `surface` below y=60, against a pre-fix baseline of 0/1902.
3. Still open, needs a design decision, unchanged: `place` searches only the
   eight horizontal neighbours, so in a 1x2 shaft a crafting table can never go
   down (`place crafting_table` 7.9% vs 83.8% for scaffold-class). Letting
   `place` break a neighbour crosses the "digging is an explicit skill-layer
   decision" line, so it is raised, not taken.

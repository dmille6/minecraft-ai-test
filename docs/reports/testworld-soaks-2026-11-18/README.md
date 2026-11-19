# Test world soaks, 2026-11-18 / 19

Every run: a fresh restore of the showcase's 11-18 04:15Z nightly copy, 14 bots, on block2-bots. A soak is 3 hours
untouched, then the load step (15 min at 40% of the CPU the slice had been using, then six rounds of 50-second pauses
that make the server drop each bot for a missed keepalive, then 15 min to recover). How to run and read one:
[`docs/runbooks/testworld.md`](../../runbooks/testworld.md).

| run | release | window (Z) | verdict | pages |
|---|---|---|---|---|
| `efee8b5f-proof-1118` | reconnect-leak fix | 14:51-16:11 | INCONCLUSIVE: stopped at 1.33 h by its own guard, because the showcase had been stopped by its tripwire and could not be seen | on the host only |
| `efee8b5f-proof2-1118` | reconnect-leak fix `efee8b5f` | 16:22-20:25 | **PASS** | [soak](efee8b5f-proof2-soak-read.md), [stack](efee8b5f-proof2-stack-read.md) |
| `f7cc2a19-stack-1118` | `efee8b5f` + zoneplant `8cf8c6e3` + buildfirst `5cd05a1f` + drawshort `f7cc2a19` | 20:33-00:35 | **PASS** | [soak](f7cc2a19-stack-soak-read.md), [stack](f7cc2a19-stack-stack-read.md), [first read](f7cc2a19-stack-soak-read.FIRST-READ-rule-bug.md) |
| `b6b83327-control-1119` | the release before the reconnect fix, load step only | 00:4x- | see below | [check](b6b83327-control-load-check.md) |

**A verdict was changed after the fact, once.** The stack soak's first read said FAIL: "the last bot was back 14 min
after the last pause". The Paper log shows all 14 back at 00:21:01Z, 12 s after the last pause; at 00:34:59Z one bot
dropped with the client's own "Disconnected" and rejoined in 10 s, and my rule took that join for the recovery. The
rule now reports the first moment all bots are in the world at once (commit `940a5ef84`, with tests). The first read is
kept beside the corrected one.

## The stack against the release under it, piece by piece

Same ground, same 14 bots, same hours of the day apart; one run each, so small differences are not findings.

### The base: memory and reconnects (the reconnect-leak fix, in both)

| | `efee8b5f` | stack `f7cc2a19` |
|---|---|---|
| memory per bot in the 3 h (cgroup, every 5 min) | 176-460 MB, 30% of the ceiling at most | 182-543 MB, 35% at most |
| restarts / deaths / kernel memory kills | 0 / 0 / 0 in 56.6 bot-hours | 0 / 0 / 0 in 56.6 bot-hours |
| reconnects in the untouched 3 h | 10 (0.24 per bot-hour), all "Disconnected" | 7 (0.17), all "Disconnected" |
| forced drops in the load step ("Timed out") | 258, 17-20 a bot | 229, 12-20 a bot |
| chunk buffers kept per forced reconnect, median | 0.0 MB over 14 bots (limit 8) | 0.0 MB over 14 bots |
| all bots back after the last pause | 0.3 min | 0.2 min |
| showcase model p95 beside it (30-min values) | 2.20 s at most, 24 checks | 2.35 s at most, 24 checks |

Not explained: the "Disconnected" reconnects in quiet hours (the client leaving by itself), in both runs.

### zoneplant: the protected zones

| | `efee8b5f` | stack |
|---|---|---|
| plant spots chosen | 112; **37 inside a zone**, 21 more within 8 blocks | 97; **0 inside, 0 within 8 blocks** |
| orders to plant inside a zone | 37 | 0 |
| planted inside a zone | **3** (19:37Z, 19:38Z, 20:04Z, all in the load step) | **0** |
| trees grown inside a zone | **2 trunks, 209 blocks** (at 65,-2 and 75,31) | **0** |
| refusals `_protect_zone_refused` | 27, all `op=place purpose=other` | 0: nothing reached the refusal |
| other blocks placed inside a zone box (block history) | 11 dirt | 14: Delta 4 cobblestone at the west edge (21:45Z), Frost a pillar of 9 at 87,67..75,23 (22:34Z, 7 cobblestone + 2 gravel), Lumen 1 cobblestone at 60,27,-46 |
| zone walks | 2, both `no_exit`, with a rescue call (Juno, Lumen) | 2, both `no_exit`, with a rescue call (Haven, 23:35Z and 23:37Z) |
| deaths inside a zone | 0 | 0 |

- The three plantings on `efee8b5f` are the showcase's 11-18 incident again, on the copy: that release is what the
  showcase runs.
- **To weigh for zoneplant:** the 14 blocks placed inside the village on the stack were reflex placements, which the
  fix allows (Frost's rows: `_marooned ... climbing out`, `out.reflex.pillar.placed`; Delta's: `margin.reflex.bridge.placed`).
  Frost's pillar stands 9 high inside the village. I did not check whether it was taken down or how the tripwire reads it.
- **To weigh for the zone walk (not new in the stack):** Haven's two `no_exit` rows came two minutes into the CPU
  squeeze and every bearing reads `unloaded`: the walk called for rescue because the chunks had not arrived yet, not
  because there was no way out.
- **Comet** began sealed at 146,54,-50 and **stayed**, in both runs. On the stack: 6,253 rows, one position, no
  `_zone_walk` row at all, 0 blocks broken or placed (block history); 855 `_path_no_legal_move`, 88 `_entombed`, and
  `goto` / `home` answering "no route out of here even with digging allowed". The new rule changed nothing for it:
  the walk-out never started.

### buildfirst: idle bots and bag room

| | `efee8b5f` | stack |
|---|---|---|
| blocks placed by build visits | 245 in 210 visits, **all tidy** | 1,355 in 450 visits: **251 unfinished buildings (19%)**, 519 repairs and upkeep (yard 424), 585 tidy |
| unfinished buildings completed | none visited | **civicH and civicM**, both in the first 30 minutes; warehouse site 117 cells (9 open); cropfarm 22 |
| idle orders to a building | 0 of 199 (all to the grounds) | 70 of 270 (26%) |
| bag slots used at idle orders, median | not logged | 35/36 in the first hour, 32, 29, 28, 28 after |

- Junk well: 32 trips, 19 threw something (2,285 cobblestone, 1,089 cobbled deepslate); trips ended build 15, short 9,
  player_near 7, unreachable 1. Yard: 6 trips, 141 cobblestone. Clay: 9 compactions, 111 blocks.
- Plot holds: 61 (every remedy together under 8 slots 43, well not usable 16, cap unknown 2).
- No bot stood at the well over 5 minutes; no well -> hold -> well loop (32 trips and 61 holds read).
- **To weigh for buildfirst:** most of the gain came in the first two hours (117, 118, then 8, 4, 4 blocks an hour into
  unfinished buildings). The steer passed a plot over for want of bag room 59 times (warehouse 21, house1 11). The
  warehouse ended `blocked` on 5 of its 10 visits.

### drawshort: materials for building

- civicH completed with its roof 35 of 35 (the rig's result, repeated here). `_structure_complete`: civicH, civicM,
  and paths, dress, wood.
- `_build_bag`: 321 visits, 223 asked the town for something, **207 left short**: tidy 191 (dirt 191, cobblestone 63),
  civicP 8 (dark oak stairs, planks, log, slab, lantern), wallext 3, decor 2, dress 2, storehouse 1.
- `_draw_short`: 4 re-asks, all civicP; 0 gave up at the cap.
- Visits that ended `no_material`: decor 2 of 2, tidy 2 of 268, dress 1 of 3.
- **To weigh for drawshort:** tidy is short of dirt on 191 of its 268 visits. The release under it does not log
  need / short, so I cannot say whether that is new.

## The positive control (`b6b83327`, load step only)

The rig must be able to fail: the release before the reconnect fix has to FAIL the leak rule. Result in
[`b6b83327-control-load-check.md`](b6b83327-control-load-check.md).

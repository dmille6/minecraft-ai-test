# buildfirst read `f7cc2a19-stack-1118`

Release `f7cc2a19cd92ff0fc50d8be86da2e1396b824a91+4b9e7f`. 20:33-00:35Z (4.05 h), 94,699 rows from 14 bots.

## Blocks placed by build visits, per hour

| hour | unfinished buildings | repairs and upkeep | tidy |
|---|---|---|---|
| 20:00Z | 117 (civicM 62, civicH 45, cropfarm 10) | 90 (yard 76, paths 14) | 56 (tidy 56) |
| 21:00Z | 118 (warehouse 117, storehub 1) | 176 (yard 146, paths 28, house1 2) | 91 (tidy 91) |
| 22:00Z | 8 (cropfarm 8) | 91 (yard 69, civicP 12, paths 8, cottage1 1, dress 1) | 196 (tidy 196) |
| 23:00Z | 4 (cropfarm 4) | 121 (yard 99, wood 14, paths 3, shaft 2, forest 2, dress 1) | 154 (tidy 154) |
| 00:00Z | 4 (storehub 4) | 41 (yard 34, forest 5, paths 2) | 88 (tidy 88) |
| all | 251 | 519 | 585 |

Of 1355 blocks placed in 450 build visits, 251 (19%) went into unfinished buildings.

## Unfinished buildings, one by one
- civicH: 1 visits, 45 placed; ended complete 1; **completed** (1 `_structure_complete`); parts: lights 3 cells placed (now open=0 done=3), posts 7 cells placed (now open=0 done=12), roof 35 cells placed (now open=0 done=35)
- civicM: 1 visits, 62 placed; ended complete 1; **completed** (1 `_structure_complete`); parts: cross 13 cells placed (now open=0 done=13), lights 9 cells placed (now open=0 done=9), pave 25 cells placed (now open=0 done=25), rim0 3 cells placed (now open=0 done=24), stalls 12 cells placed (now open=0 done=12)
- cropfarm: 5 visits, 22 placed; ended complete 5; not completed; parts: R-1 14 cells placed (now open=0 done=10), R-2 10 cells placed (now open=0 done=10)
- stepwell: 1 visits, 0 placed; ended passed 1; not completed
- warehouse: 10 visits, 117 placed; ended blocked 5, deadline 2, unknown 2, aborted 1; not completed; parts: prep 117 cells placed (now open=9 done=117)
- storehub: 19 visits, 5 placed; ended upkeep 17, complete 2; not completed; parts: ring 2 cells placed (now open=0 done=53), wall-B 3 cells placed (now open=0 done=34)
- also completed: {'paths': 1, 'dress': 1, 'wood': 1}

## Materials for building (the draw)
- build visits that logged their bag (`_build_bag`): 321; asked the town for something: 223; **left short of something: 207** by item: dirt 191, cobblestone 63, dark_oak_stairs 9, dark_oak_planks 9, lantern 5, dark_oak_log 4, stone_bricks 3, deepslate_bricks 3, bone_meal 2, dark_oak_slab 2, torch 1, spruce_planks 1, spruce_log 1; by project: tidy 191, civicP 8, wallext 3, decor 2, dress 2, storehouse 1
- false shortages re-asked (`_draw_short op=short`): 4; gave up after two (`op=cap`): 0; by plot: {'civicP': {'short': 4, 'cap': 0}}

## Making bag room
- junk well trips (`_room_well`): 32, of which 19 threw something; thrown: 1,089 cobbled_deepslate, 2,285 cobblestone; slots before -> after, median 32 -> 29 (each trip: 36->28, 36->30, 34->28, 34->34, 35->28, 36->30, 36->30, 31->28, 35->35, 36->36, 36->29, 36->34, 30->29, 34->28, 30->28, 29->29, 36->36, 36->28, 32->30, 30->28); ended: {'build': 15, 'short': 9, 'unreachable': 1, 'player_near': 7}
- yard trips (`_room_yard`): 6; stocked: 141 cobblestone
- clay compactions (`_compact op=bag from=clay_ball`): 9 done of 9 tried, 111 clay blocks made
- plot holds (`_room_hold`): 61 by reason: short_of_8 43, well_dead 16, cap_unknown 2; as logged: {'0:cap_unknown well_ok=1': 2, '0:none well_ok=1': 29, '2:ok well_ok=1': 6, '0:cap_none well_ok=1': 3, '1:ok well_ok=0': 13, '3:ok well_ok=0': 1, '3:ok well_ok=1': 1, '6:ok well_ok=1': 1, '5:ok well_ok=0': 1, '0:cap_none well_ok=0': 1, '1:ok well_ok=1': 2, '5:ok well_ok=1': 1}

## Bags
- slots used at idle orders (`_build_first free=`, exact), first seen 36/36; median per hour: 20:00Z 35/36 (n=135); 21:00Z 32/36 (n=150); 22:00Z 29/36 (n=187); 23:00Z 28/36 (n=189); 00:00Z 28/36 (n=255)

## Idle orders
- idle orders: 270; to a building 70 (26%; `_build_first why=building`), to the grounds 200 (`_work_order build_shop {"grounds":true,"why":"idle"}`)
- the steer's decisions (`_build_first why=`): {'no_building': 833, 'building': 70, 'grounds_turn': 13}; what it looked at: {'away': 546, 'exempt': 113, 'order': 100, 'skip:room': 59, 'idle:complete': 50, 'skip:stuck_on_cell': 38, 'skip:slots_full': 5, 'idle:no_material': 5}; passed over for want of bag room, by plot: {'warehouse': 21, 'house1': 11, 'storehub': 6, 'reroof': 4, 'paths': 3, 'civicP': 3, 'civicH': 2, 'stepwell': 2, 'civicB': 2, 'storehouse': 2, 'civicM': 1, 'monument': 1, 'cottage2': 1}

## Visits that ended for want of material
- decor: 2 of its 2 visits ended no_material
- tidy: 2 of its 268 visits ended no_material
- dress: 1 of its 3 visits ended no_material

## At the junk well (standing cell 12,74,6)
- no bot stayed within 3 blocks of it for more than 5 minutes (14 bots' positions read)
- no well -> hold -> well loop on one plot (32 well trips and 61 holds read)

# Evidence pack for the land-cleanup evaluation (2026-11-14)

Three kinds of evidence, in order of how far to trust them: measurements of the world, the bots' own log rows, and notes
written at the time by the sessions that built each feature (these can be stale or wrong).

## 1. The measured state of the showcase town (time capsule, saved 2026-11-14T15:50:17Z)

The town has run since 2026-10-20 with 14 to 15 bots. Within 48 blocks of the town's home (0,70,0), read from the server's
save files and the town's own records by `infra/capsule/scorecard/pitmap.py`:

```
CONTROL saved 2026-11-14T15:50:17Z newest 2026-11-14T15:50:17Z cells 166869 chunks 64 missing 0
columns 11025 top kinds [('grass_block', 6170), ('cobblestone', 2762), ('stone', 460), ('dirt', 451), ('dirt_path', 367), ('stone_bricks', 188), ('spruce_planks', 160), ('spruce_stairs', 130), ('spruce_slab', 76), ('crafting_table', 23), ('diorite', 19), ('spruce_fence', 18)]
tidy record g180: skipped {"stray_natural": 53, "beside_natural": 50, "stray_hollow": 18, "hole_deep": 3, "stray_tall": 2, "reserved": 47} | waived 40 | inwall keys ['box', 'boxes', 'pillars', 'litter', 'holes', 'cut', 'fill', 'skipped', 'access', 'ledger', 'rough']
inwall {"box": 4, "boxes": 2, "pillars": 996, "litter": 15, "holes": 748, "cut": 1100, "fill": 1622, "skipped": 6, "access": 3, "ledger": 40, "rough": 2}
record cells 16793 by plot [('monument', 4889), ('stepwell', 2168), ('shaft', 1625), ('tower', 901), ('wallext', 886), ('wall', 827), ('hall', 807), ('paths', 620), ('storehub', 604), ('townhall', 569), ('country', 557), ('enchantshop', 503), ('yard', 349), ('shop', 254)]
tidy fill cells 5790 still open 2181

OPEN PITS (top >= 2 under the median within 3): 791 columns in 368 pits; blocks to fill 2416
  by size: 1 col 234 | 2-9 127 | 10-30 7 | >30 0
   29 cols x -48..-25 z -16..-12  floor y 64..68  deepest 6  blocks 103 | tidy plans a fill in 1 cols | other records {} | wet cols 0
   25 cols x 40..46 z 16..22  floor y 61..66  deepest 6  blocks 74 | tidy plans a fill in 0 cols | other records {'country': 30} | wet cols 0
   16 cols x -20..-14 z 16..19  floor y 63..64  deepest 4  blocks 55 | tidy plans a fill in 4 cols | other records {} | wet cols 0
   16 cols x 44..48 z -34..-30  floor y 63..66  deepest 5  blocks 60 | tidy plans a fill in 0 cols | other records {'country': 22} | wet cols 0
   14 cols x -17..-10 z 33..36  floor y 65..67  deepest 3  blocks 31 | tidy plans a fill in 0 cols | other records {'hall': 12} | wet cols 0
   14 cols x 20..26 z 33..35  floor y 66..73  deepest 9  blocks 53 | tidy plans a fill in 0 cols | other records {} | wet cols 0
   11 cols x 45..48 z 26..30  floor y 64..66  deepest 4  blocks 33 | tidy plans a fill in 0 cols | other records {'country': 20} | wet cols 0
    9 cols x -48..-43 z -46..-44  floor y 61..64  deepest 6  blocks 35 | tidy plans a fill in 0 cols | other records {'country': 5} | wet cols 0
    9 cols x 14..18 z -45..-41  floor y 65..66  deepest 3  blocks 20 | tidy plans a fill in 5 cols | other records {} | wet cols 0
    8 cols x 38..41 z 23..26  floor y 63..67  deepest 5  blocks 26 | tidy plans a fill in 0 cols | other records {'country': 14} | wet cols 0
    8 cols x -41..-38 z -47..-45  floor y 61..64  deepest 5  blocks 25 | tidy plans a fill in 0 cols | other records {'country': 2} | wet cols 0
    8 cols x -7..-2 z -31..-30  floor y 62..65  deepest 7  blocks 33 | tidy plans a fill in 1 cols | other records {} | wet cols 0
    8 cols x 28..30 z 23..26  floor y 64..68  deepest 6  blocks 26 | tidy plans a fill in 3 cols | other records {} | wet cols 0
    8 cols x -19..-16 z 1..3  floor y 63..67  deepest 4  blocks 22 | tidy plans a fill in 4 cols | other records {} | wet cols 0

ROOFED HOLLOWS (air within 8 under the ground top): 7742 columns in 32 hollows; air blocks 26116
  by size: 1 col 18 | 2-9 13 | 10-30 0 | >30 1
  7683 cols x -48..48 z -48..48  air y 52..81  air blocks 26007 | tidy plans a fill in 143 cols | other records {'monument': 515, 'paths': 344, 'wall': 295} | roof {'grass_block': 4406, 'cobblestone': 1968, 'dirt': 363}
    8 cols x -19..-14 z -6..-4  air y 61..66  air blocks 22 | tidy plans a fill in 0 cols | other records {} | roof {'grass_block': 4, 'stone': 2, 'cobblestone': 2}
    6 cols x -48..-47 z -34..-31  air y 66..67  air blocks 9 | tidy plans a fill in 0 cols | other records {'monument': 6} | roof {'cobblestone': 6}
    6 cols x 0..2 z -1..1  air y 61..74  air blocks 18 | tidy plans a fill in 1 cols | other records {} | roof {'grass_block': 3, 'cobblestone': 1, 'crafting_table': 1}
    3 cols x -48..-46 z -26..-26  air y 66..68  air blocks 3 | tidy plans a fill in 0 cols | other records {'monument': 3} | roof {'cobblestone': 3}
    2 cols x -11..-11 z 12..13  air y 60..60  air blocks 2 | tidy plans a fill in 0 cols | other records {'paths': 1} | roof {'grass_block': 1, 'dirt_path': 1}
    2 cols x 9..9 z -44..-43  air y 57..60  air blocks 7 | tidy plans a fill in 0 cols | other records {} | roof {'cobblestone': 1, 'stone': 1}
    2 cols x 9..9 z 1..2  air y 67..67  air blocks 2 | tidy plans a fill in 0 cols | other records {} | roof {'grass_block': 2}
    2 cols x -12..-11 z -9..-9  air y 71..72  air blocks 3 | tidy plans a fill in 0 cols | other records {} | roof {'grass_block': 2}
    2 cols x 4..5 z 6..6  air y 63..69  air blocks 4 | tidy plans a fill in 0 cols | other records {} | roof {'grass_block': 1, 'cobblestone': 1}
    2 cols x -10..-9 z 11..11  air y 61..61  air blocks 2 | tidy plans a fill in 0 cols | other records {'paths': 2} | roof {'dirt_path': 2}
    2 cols x 10..11 z -13..-13  air y 69..72  air blocks 5 | tidy plans a fill in 0 cols | other records {} | roof {'dirt': 2}
```

Town projects (newest record per plot): 34 plots; 23 complete, 7 open (civicH, civicM, country, stepwell, tidy, tower,
waterwalk), forest standing, land in plan, treefarm retired, siteprep with no state.

Admin one-off cleans were needed on this town on 11-09 and 11-10 (see the notes in section 3), which the owner allowed as
exceptions; the standing rule is that the bots must do this themselves.

## 2. The bots' own log rows for land work, 30 hours

Read with the project's telemetry library on the showcase host. Event names are the bots' own; "status" is the row's
outcome field. Digits in the detail text are replaced by N so that like rows group together; the count is on the left.

```
WINDOW: 30 h ending 2026-11-14 ~18:45Z (the model was unreachable 08:31-14:43Z on 11-14; work orders still ran); rows 441288 bots 14 event names 330
CONTROL: rows by canonical name -- gather 4594 build 4832 build_visit 897 goto 4432

== keeper: 172 rows, status {'success': 172}
       86  project=tidy op=keeper_take gen=N
       56  project=tidy op=keeper_release gen=N why=no_work_visit
       23  project=tidy op=keeper_release gen=N why=underground
        7  project=tidy op=keeper_release gen=N why=away

== town_ground: 934 rows, status {'success': 934}
      926  gather_skipped=N
        4  mine_bearing_refused=N mine_walkout=N
        3  gather_skipped=N mine_bearing_refused=N mine_walkout=N
        1  mine_bearing_refused=N

== grounds_lane: 486 rows, status {'success': 486}
      423  lane=inside why=side:inside role=helper country=open
       36  lane=country why=keeper_turn:open role=keeper country=open
       27  lane=inside why=keeper_inside role=keeper country=open

== grounds_quota: 794 rows, status {'no_effect': 579, 'success': 215}
       87  on=N turn=N open=N share=N took=tidy why=turn placed=N cleared=N empty=N out=deadline late=N
       54  on=N turn=N open=N share=N took=tidy why=turn placed=N cleared=N empty=N out=aborted late=N
       49  on=N turn=N open=N share=N took=other why=off_turn placed=- cleared=- empty=N out=aborted
       40  on=N turn=N open=N share=N took=tidy why=keeper placed=N cleared=N empty=N out=waterwalk
       39  on=N turn=N open=N share=N took=tidy why=no_order:stuck_on_cell placed=N cleared=N empty=N out=deadline late=N
       35  on=N turn=N open=N share=N took=other why=off_turn placed=- cleared=- empty=N out=complete

== cleanzone: 872 rows, status {'success': 872}
      362  op=release why=timeouts pos=N,N,N goal=GoalNear@N,N,N ms=N r=N
      358  op=release why=no_path pos=N,N,N goal=GoalNear@N,N,N ms=N r=N
       68  op=release why=no_path pos=N,N,N goal=GoalNearXZ@- ms=N r=N
       33  op=pass goal=N,N,N ms=N
       17  op=release why=no_path pos=N,N,N goal=GoalY@- ms=N r=N
       15  op=release why=no_path pos=N,N,N goal=GoalWithinDigReach@N,N,N ms=N r=N

== cleanzone_hits: 2429 rows, status {'success': 2429}
     1650  vetoed=N searches=N touched=N failed=N releases=N freed=N total_vetoed=N total_releases=N passes=N passed=N
      779  vetoed=N searches=N touched=N failed=N releases=N freed=N total_vetoed=N total_releases=N

== litter: 76 rows, status {'success': 65, 'no_effect': 11}
       64  op=handed n=N why=expired:N open=N written=N failed=N
        4  op=folded n=N why=refresh read=N seen=N known=N greened=N old=N held=- cells=- gen=N
        2  op=folded n=N why=refresh read=N seen=N known=N greened=N old=N held=planned:N cells=- gen=N
        1  op=dropped n=N why=in_ground:N,built_on:N,record_col:N
        1  op=dropped n=N why=in_ground:N,record_col:N
        1  op=dropped n=N why=in_ground:N

== junk_pickup: 143 rows, status {'success': 143}
        5  short_grass xN passive build_shop at N,N,N overworld | feet=air below=grass_block leaves=N bamboo=N grass=N | recent: _decor:no_effect Ns, _path_failure_shapes:failed Ns,
        4  spruce_sapling xN sought(pickup) gather:spruce_log at N,N,N overworld | feet=air below=grass_block leaves=N bamboo=N grass=N | recent: _path_reset Ns, _pickup_skipped Ns,
        3  spruce_sapling xN passive explore at N,N,N overworld | feet=air below=grass_block leaves=N bamboo=N grass=N | recent: _affordance_scan Ns, _explore_toward_known Ns, _affo
        2  flint xN passive mine:yN at N,N,N overworld | feet=air below=gravel leaves=N bamboo=N grass=N | recent: _path_reset Ns, _shaft_use:no_effect Ns, _affordance_scan Ns
        2  spruce_sapling xN passive home at N,N,N overworld | feet=air below=grass_block leaves=N bamboo=N grass=N | recent: _affordance_scan Ns, _pipeline Ns, _affordance_scan Ns
        2  flint xN passive mine:yN at N,N,N overworld | feet=air below=stone leaves=N bamboo=N grass=N | recent: _affordance_scan Ns, _pipeline Ns, _affordance_scan Ns

== junkout: 525 rows, status {'failed': 193, 'success': 323, 'no_effect': 9}
       24  phase=wear listed=N worn=N of=N slots=N->N
        1  phase=well vid=showcase-Alpha.mwfnNvbr armed=out:mwfmlyyl-mwfmnelm dh=N dy=N dw=N offlist=N swords=N cobble=N stock=N slots=N->N listed=- n=N status=failed stop=unreachab
        1  phase=bank v=showcase-Alpha.mwfnpfrh mode=tail armed=first dh=N dy=N peaceful=N stacks=N banked=N slots=N->N keep_picks=N rows=torch:N part=N/N allow=torch=N:N
        1  phase=well vid=showcase-Alpha.mwfnrcjN armed=out:mwfnNiwN-mwfnN dh=N dy=N dw=N offlist=N swords=N cobble=N stock=N slots=N->N listed=- n=N status=failed stop=unreachable
        1  phase=well vid=showcase-Alpha.mwfqNyu armed=first dh=N dy=N dw=N offlist=N swords=N cobble=N stock=N slots=N->N listed=- n=N status=failed stop=unreachable
        1  phase=well vid=showcase-Alpha.mwfrxghN armed=first dh=N dy=N dw=N offlist=N swords=N cobble=N stock=N slots=N->N listed=N n=N status=success stop=done

== takeback: 9352 rows, status {'no_effect': 5997, 'success': 3355}
     1524  outcome=dug why=ripe pos=N,N,N block=dirt shape=pillar zone=out age_ms=N ms=N
     1441  outcome=left why=expired pos=N,N,N block=dirt shape=pillar zone=out age_ms=N
     1421  outcome=left why=expired pos=N,N,N block=dirt shape=step zone=out age_ms=N
     1015  outcome=dug why=ripe pos=N,N,N block=dirt shape=step zone=out age_ms=N ms=N
      506  outcome=adopted why=gone pos=N,N,N block=dirt shape=pillar zone=out age_ms=N
      446  outcome=adopted why=gone pos=N,N,N block=dirt shape=step zone=out age_ms=N

== takeback_sum: 1516 rows, status {'success': 1516}
      257  w=Ns noted=N halts=N ms=N open=N | left N
      238  w=Ns noted=N halts=N ms=N open=N | left N; dug N
      152  w=Ns noted=N halts=N ms=N open=N | dug N
      124  w=Ns noted=N halts=N ms=N open=N
       90  w=Ns noted=N halts=N ms=N open=N | dug N; left N
       51  w=Ns noted=N halts=N ms=N open=N | left N; dug N; adopted N

== scaffold_pick: 13952 rows, status {'success': 13952}
     2882  pillar_out: dirt instead of cobblestone
      930  pillar_out: dirt instead of spruce_log
      799  dig_straight_up: dirt instead of cobblestone
      709  pillar_out: andesite instead of cobblestone
      696  pillar_out: dirt instead of sand
      573  pillar_out: dirt instead of cobbled_deepslate

== scaftown_hits: 2429 rows, status {'success': 2429}
     2429  hits=N chosen=N searches=N priced=N cuts=N restarts=N latches=N latched=N capped=N stuck_latches=N stuck_skipped=N total_hits=N off=N

== well_dispose: 152 rows, status {'success': 152}
      113  slots=N->N offlist=N gclicked=N stone=N swords=N sword_lost=N sword_kept=N cobble=N offlist_items=- unnamed=N freed=N tossed=N n=N misses=N aim_off=N aim_read=N retaken=N
       22  slots=N->N offlist=N gclicked=N stone=N swords=N sword_lost=N sword_kept=N cobble=N cobble_left=N cap=at_cap stock=N offlist_items=- unnamed=N freed=N tossed=N n=N misses
        6  slots=N->N offlist=N gclicked=N stone=N swords=N sword_lost=N sword_kept=N cobble=N cobble_left=N cap=at_cap offlist_items=- unnamed=N freed=N tossed=N n=N misses=N aim_o
        3  slots=N->N offlist=N gclicked=N stone=N swords=N sword_lost=N sword_kept=N cobble=N cap=below stock=N offlist_items=- unnamed=N freed=N tossed=N n=N misses=N aim_off=N ai
        3  slots=N->N offlist=N gclicked=N stone=N swords=N sword_lost=N sword_kept=N cobble=N cap=below offlist_items=- unnamed=N freed=N tossed=N n=N misses=N aim_off=N aim_read=N
        3  slots=N->N offlist=N gclicked=N stone=N swords=N sword_lost=N sword_kept=N cobble=N cap=unknown stock=N offlist_items=- unnamed=N freed=N tossed=N n=N misses=N aim_off=N 

== dispose_well: 408 rows, status {'failed': 232, 'success': 152, 'no_effect': 22, 'aborted': 2}
      232  could not reach the junk well's standing cell at N,N,N (the bot is at N,N,N); the next town visit tries again
      150  threw N junk item(s) down the town well (N -> N slots)
        4  wait for showcase-Delta to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes
        3  wait for showcase-Iris to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes
        3  wait for showcase-Echo to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes
        2  wait for showcase-Bravo to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes

== well_refused: 254 rows, status {'refused': 254}
      232  order=dispose reason=unreachable could not reach the junk well's standing cell at N,N,N (the bot is at N,N,N); the next town visit tries again
        4  order=dispose reason=player_near wait for showcase-Delta to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes
        3  order=dispose reason=player_near wait for showcase-Iris to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes
        3  order=dispose reason=player_near wait for showcase-Echo to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes
        2  order=dispose reason=player_near wait for showcase-Bravo to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes
        2  order=dispose reason=player_near wait for showcase-Alpha to move off the town junk well (N blocks): it opens only with nobody within N, and the next town visit disposes

== dig_town: 237 rows, status {'success': 237}
       31  pos=N,N,N block=dirt class=ground purpose=survival by=reflex:escape outcome=confirmed dt=N
       24  pos=N,N,N block=stone class=ground purpose=survival by=reflex:escape outcome=confirmed dt=N
       24  pos=N,N,N block=stone class=ground purpose=transit by=home outcome=confirmed dt=N
       20  pos=N,N,N block=dirt class=ground purpose=transit by=goto outcome=confirmed dt=N
       16  pos=N,N,N block=grass_block class=ground purpose=other by=build_shop outcome=confirmed dt=N
       12  pos=N,N,N block=stone class=ground purpose=transit by=surface outcome=confirmed dt=N

== dig_town_sum: 7815 rows, status {'success': 7815}
     7630  w=Ns all=N conf=N unconf=N foreign=N rej=N abort=N death=N err=N hung=N pend=N ovf=N ierr=N
       45  w=Ns all=N conf=N unconf=N foreign=N rej=N abort=N death=N err=N hung=N pend=N ovf=N ierr=N | margin.free.target.confirmed N
       25  w=Ns all=N conf=N unconf=N foreign=N rej=N abort=N death=N err=N hung=N pend=N ovf=N ierr=N | zone.ground.survival.confirmed N
       16  w=Ns all=N conf=N unconf=N foreign=N rej=N abort=N death=N err=N hung=N pend=N ovf=N ierr=N | zone.ground.other.confirmed N
       15  w=Ns all=N conf=N unconf=N foreign=N rej=N abort=N death=N err=N hung=N pend=N ovf=N ierr=N | zone.ground.transit.confirmed N
       12  w=Ns all=N conf=N unconf=N foreign=N rej=N abort=N death=N err=N hung=N pend=N ovf=N ierr=N | zone.free.other.confirmed N

== relocate_landed: 697 rows, status {'success': 687, 'failed': 10}
        1  attempt mwfokrNN: success dry feet=air head=air in_region=N region_now=dry
        1  attempt mwfpbhvNN: aborted dry feet=air head=air in_region=N region_now=dry
        1  attempt mwfpkneNN: aborted dry feet=air head=air in_region=N region_now=dry
        1  attempt mwfqrifrN: aborted dry feet=air head=cave_air in_region=N region_now=dry
        1  attempt mwfqyNeNN: aborted dry feet=air head=air in_region=N region_now=dry
        1  attempt mwfruqreN: success dry feet=air head=air in_region=N region_now=dry

== build rows for land projects (name, project, status):
     2842  ('build', 'tidy', 'success')
     1772  ('build_seg', 'tidy', 'success')
      213  ('build_visit', 'tidy', 'success')
      117  ('build_visit', 'tidy', 'aborted')
      115  ('build_visit', 'tidy', 'no_effect')
       83  ('build', 'yard', 'success')
       48  ('build_visit', 'paths', 'no_effect')
       47  ('build', 'tidy', 'no_effect')
        8  ('build', 'paths', 'success')
        6  ('build', 'country', 'success')
        4  ('build', 'waterwalk', 'success')
        3  ('build_seg', 'paths', 'success')
        2  ('build_visit', 'paths', 'success')
        1  ('build', 'monument', 'success')
        1  ('build_visit', 'country', 'success')
        1  ('build_visit', 'yard', 'success')
  -- top details ('build', 'tidy')
      780  project=tidy op=deferred seg=TNN cell=N,N,N n=N
      718  project=tidy op=place seg=TNN cell=N,N,N block=cobblestone
      540  project=tidy op=tempstand seg=TNN cell=N,N,N result=refused why=no_step
      261  project=tidy op=place seg=TNN cell=N,N,N block=dirt
      138  project=tidy op=deferred seg=TNN cell=N,N,N n=N why=blocked
       63  project=tidy op=stuck_on_cell cell=N,N,N visits=N n=N segs=TNN+TNN+TNN waiting=N early=true
       49  project=tidy op=clear cell=N,N,N block=grass_block kind=tidy
  -- top details ('build_seg', 'tidy')
     1772  project=tidy seg=TNN open=N done=N
  -- top details ('build_visit', 'tidy')
      174  project=tidy outcome=deadline stop=deadline placed=N refused=N silent=N cleared=N planted=N unknown=N slot=N gen=N took=- back=- crew=worker lane=inside ms=N why=deadline
      113  project=tidy outcome=aborted crew=worker lane=inside ms=N why=interrupted
       94  project=tidy outcome=aborted stop=aborted placed=N refused=N silent=N cleared=N planted=N unknown=N slot=N gen=N took=- back=- crew=worker lane=inside ms=N why=aborted;_c
       16  project=tidy outcome=deadline stop=deadline placed=N refused=N silent=N cleared=N planted=N unknown=N slot=N gen=N took=cobblestone:N back=- crew=worker lane=inside ms=N 
       12  project=tidy outcome=deadline stop=deadline placed=N refused=N silent=N cleared=N planted=N unknown=N slot=N gen=N took=- back=- crew=keeper lane=inside ms=N why=deadline
        7  project=tidy outcome=waterwalk stop=waterwalk placed=N cleared=N crew=keeper lane=inside ms=N why=water:_N_dug,_N_planks_laid_(complete)
        6  project=tidy outcome=deadline stop=deadline placed=N refused=N silent=N cleared=N planted=N unknown=N slot=N gen=N took=- back=- crew=worker fromYard=N lane=inside ms=N w
  -- top details ('build', 'yard')
       83  project=yard op=clear cell=N,N,N block=cobblestone kind=tidy
  -- top details ('build_visit', 'paths')
       48  project=paths outcome=complete stop=complete placed=N refused=N silent=N cleared=N planted=N unknown=N slot=N gen=N took=- back=- ms=N why=complete;_used_N,_laid_N/N
        1  project=paths outcome=stuck_on_cell stop=stuck_on_cell placed=N refused=N silent=N cleared=N planted=N unknown=N slot=N gen=N took=- back=- ms=N why=N_cell(s)_no_stand_ha
        1  project=paths outcome=no_tool stop=no_tool ms=N why=no_shovel:_craft_a_stone_shovel_(N_cobblestone_+_N_sticks),_or_the_toolkit_makes_an_iron_one_from_town_iron
  -- top details ('build', 'paths')
        2  project=paths op=overburden_refused seg=P-storehubN cell=N,N,N block=spruce_leaves why=tree_spruce_leaves_N,N,N
        2  project=paths op=place seg=P-storehubN cell=N,N,N block=dirt_path kind=use
        1  project=paths op=clear seg=P-storehouseN cell=N,N,N block=grass_block kind=overburden
        1  project=paths op=place seg=P-storehouseN cell=N,N,N block=dirt_path kind=use
        1  project=paths op=deferred seg=P-storehubN cell=N,N,N n=N
        1  project=paths op=stuck_on_cell cell=N,N,N visits=N n=N segs=P-storehubN waiting=N stalled=true
```

## 3. Notes written at the time (may be stale or wrong)

Each block below is the head of one note from the project's memory, named by its file. Dates are 2026.

```
### owner-pretty-land-1107.md
name: owner-pretty-land-1107
description: "Owner 11-07 sent circled timelapse shots of rough ground (pillars, holes, floating dirt beams, tables on pillars) + a target landscape; wants all of it smoothed and pretty"
  type: project
  originSessionId: 2a199c24-8dc2-4c02-9509-8499787c3dd1
  modified: 2026-11-07T07:12:02.796Z
---

2026-11-07 the owner circled rough areas in three showcase timelapse/beauty shots: lone dirt pillars, 1-2 deep holes,
ragged dirt steps, crafting tables on 2-3 block pillars, cobble rubble, FLOATING dirt blocks and long dirt beams left in
the trees (bot scaffolding), dirt lumps on the forest floor, ragged ground along the wall. Target picture: smooth grassy
meadows, gentle wide terraces with neat edges, clean river, forest in clean stands, natural hills kept.
"i'd like all areas like this to be smoothed out and made to look pretty" -- inside the walls AND the countryside.

**Why:** the timelapses show the town; tidy's plan said 0/77 cuts 0/1331 fills while all this was visible, so the
groundskeeper's plan never contained these defects. Extends [[owner-gk-town-clean-1104]].

**How to apply:** roughground agent (11-07) maps each circle, says which current code fixes it, builds piece 1 (defects
tidy misses + scaffold prevention) then piece 2 (grass/terraces). Bots do the work; no admin edits. Judge success
by the pictures, not only by tidy counters.

11-07 more targets (images 11-13): concentric grass-terrace mound with one big tree; cherry grove with flowers, lanterns, clean river banks; flower-edged winding cobble/plank path, stone bridge, farm terraces. Rules: no bare dirt, slopes as 1-block grass steps, flowers on lawns + path edges, clean banks, trees in clusters, landmark mound. Worldgen cliffs/mountains are not ours.

**11-07 ~13:10Z owner:** "yes, go ahead and start" -- piece 4 wide-area regrading (roughground agent) + flower supply (bone meal/wild picks -> flower path borders + lawns; flowers agent).

**11-08 ~09:20Z owner:** groundskeeper helpers per town up to 4 while the tidy stage has >500 open cells (back to 1-2 when small). Extends the 1-2 rule.

### roughground-1107.md
name: roughground-1107
description: "roughground-01 11-07: owner's circled rough ground mapped (Chunky project/town views); GK misses clumps/floating/wide holes/tables; fix built show 80cf5d5c + fleet 9aa9b1c1, ready to stage"
---
OWNER 11-07: three circled showcase renders ("will the greens keeper fill these areas in and smooth them out?") + four target
pictures (meadows, terraced mound with one tree, cherry grove by a river, flower-edged path/bridge). Design note:
docs/reports/roughground-design-2026-11-07.md; marked before-shots in videos/roughground-1107/ (untracked dir).
- Shots are the nightly CHUNKY renders (video/stills/chunky/<day>/project.png = follow cam on cropfarm 14.5,69,-8.5 d45;
  town.png = hero -8,70,10 d105), not BlueMap. Mapping = ray-cast through chunky_beauty.py's camera into the mirror copy.
- Measured: 739 clump cols, 94 pillars, 124 floating, 147 hole cols, 26 stray tables in ~4,300 circled cols; live inwall record
  from 11-05 read 0/77 0/1331; 823/1,418 ledgered scaffold climbs still stand; town ground is a grass crust over 2-high bot tunnels.
- Built: bots/src/roughground.mjs surveyRough (floating, clumps, holes, smoothing, loose tables, ledgered scaffold; never opens a
  hollow -- Codex r1 blocker) in inwall + bands; inwallFirst re-surveys inside before a band (60 min clock, record.inwallAt);
  climbOf ledgers bridges + margin. ROUGH=off rollback. Show roughground-01show 80cf5d5c (on d8dbd32a); fleet
  roughground-01-on-63d28320 9aa9b1c1 (survey only). Offline 4 passes: clumps 739->517, floating 117->75, tables 26->11.
**Why:** the stray/hole rules need ONE column above/below ALL 8 neighbours and read air-under as natural.
**How to apply:** stage after the gkwork read; then pieces 1b (hollow fill-before-cut), 1c (stands for float_high), 2 (cobble
lawn tops->dirt, terrace in cycle, banks), 3 (flower paths, landmark mound, lanterns). Related [[gkwork-1107]],
[[owner-gk-town-clean-1104]], [[stations-1106]].

**PIECES 1b/1c/2/3 BUILT 11-07 (each on 80cf5d5c, ships alone; Paper sandbox6 proofs PASS):** 1b hollow fill-before-cut
`roughground-1b-show` 31c6d5eb (cut carries `hollow`, held while any body incl. own is in it; fills `opener` never waived);
1c stands for float_high `roughground-1c-show` f655a52b (plotprep-shaped stone stand, platformTeardown on `targets`, never on a
wallext plot); 2 `roughground-2-show` 28016120 (cobble lawn tops -> `topsoil` dirt, noSoil gate + dirt bill, dry bank holes,
cycle wraps to TERRACE; grass spreads beside grass in median 1.1 min); 3 `roughground-3-show` 6e71edd0 (landmark.mjs round
terraced mound + one sapling, land record first, landmarkRepair). Fleet piece 2 `roughground-2-on-63d28320` 6819822c (topsoil +
banks) registered ~/mcai-analysis/roughground-02.*. 1b/1c/3 do not apply to the fleet (no tidyOk gate / stands / park).
Stacked sim (circled areas, 4 passes): clumps 739 -> 517 (01) -> 470 (+1b) -> 396 (+1c); cobble lawn tops 194 -> 81 (+2).

**RELEASED showcase 11-07 10:38:40Z as 272288e1** (80cf5d5c + fold e09ee921 roughCutWaits: a cut waits while the digging bot stands on it over air, and a crafting table waits while another player is within 8). Caveat: keepers made 0 tidy visits on d8dbd32a (build orders skip why=room, bags full).

**PIECE 4 (owner GO 11-07 ~13:10Z) BUILT:** wide-area regrade bots/src/regrade.mjs (rough cols -> 7x7 median, anchors elsewhere,
1-block clamp, cliffs >= 4 + feet and changes > 3 kept, refused cuts anchored so neighbours fill up, dirt tops, 8x8 tiles <= 600
cells). `roughground-4-show` d2dcb64f (on roughground-2-show), fleet `roughground-4-on-63d28320` c643406e (survey only, registered
roughground-04). Paper PASS (122 -> 14 steep pairs, 0 holes/tunnels opened, tops green 9.9 min). All pieces stacked: steep ground

### showcase-oneoff-clean-1109.md
name: showcase-oneoff-clean-1109
description: Owner-directed one-off showcase town clean-up 11-09 -- 400 cuts + 905 fills laid by RCON from the tidy record g103; bots left stopped (Studio brain unreachable)
  type: project
  originSessionId: 2a199c24-8dc2-4c02-9509-8499787c3dd1
  modified: 2026-11-09T20:17:56.111Z
---

OWNER 11-09 ~20:00Z: "yes, lets do a freeze and one-off clean" (tidy backlog: scaffold-bug mess, code fix = scaftown).

- Froze bots 20:07:53Z (stop-bots.sh), applied 20:11-20:12Z: RCON `setblock ... replace`, cuts top-down then fills bottom-up,
  forceload of chunks -3,-6..2,2 for the run only (removed). 1305 ok / 0 failed.
- Cells = the bots' own plan, tidy head `project-0_70_0.tidy.g103.json`: cut -> air while the listed block stands; fill -> palette[0]
  (earth/topsoil dirt, core/access cobblestone) while open. 400 cuts (17 stray crafting tables at the well), 905 fills.
- Skipped 395: other project zones/boxes (paths 176, dress 22, canefarm 16, road 6, wall 2, house1 1, wallext 1), 164 fills over
  open cells not filled, 7 saplings/torch. Dry run matched the bots' log (cuts left 436; fills ~1,076 vs 1,075).
- Project files NOT edited: tidy.mjs tidyProgress reads the world, so the next visit re-counts. Verified on the live world:
  cuts done 662->1062/1098, fills done 199->1104/2601.
- Tripwire 20:16Z: WATCH (pre-existing stuck cells), zones INTACT.
- START BLOCKED: the start-bots gate failed because showcase-studio-tunnel cannot reach ai.ticrcorp.com:22 (down since 18:29:51Z, also
  from the Mac). The bots were left stopped and the gate was not bypassed. Journal rows `owner-repair-blocked-start`: down window open from 20:07:53Z.
  When Studio is back: `sudo -n /srv/showcase/bin/start-bots.sh`, then `sudo systemctl stop mcshow@showcase-Nova`, then journal down_end.
- Script + cell lists: branch oneoff-clean-1109 docs/reports/oneoff-clean-2026-11-09/ (not merged); host copy ~/oneoff-1109,
  /srv/showcase/ops/oneoff-clean-20261109-{cells,applied}.json.

## Pass 2 (11-10 01:20-01:36Z) -- the leftovers the tidy plan misses, proven by CoreProtect

Owner saw pillars/floating dirt/1x1 holes round the town core after pass 1 ("is this expected?" -- no).
- Rule (pass2.py): CoreProtect LAST row on the cell = a showcase bot's, world still shows it. Placed spoil sticking up over its own
  clean ground and the 8-neighbour median -> restored to CoreProtect's before (air); bot-dug surface hole at/below the median ->
  the block the bot dug. Skipped: any project cell/box/zone/claim, any tidy-gen fill/cut cell, protected zones, liquid, bot <=2.5,
  planks, placed clusters >12. Area: inwall boxes + Chebyshev 64.
- Applied 01:25-01:26Z: 569 cuts + 458 fills, 1027 ok 0 failed; forceload removed. Re-plan on the live world: 0 cuts left
  (135 more fills qualify only because neighbours were filled -- not chased). Tripwire 01:30Z (root) WATCH (same S6 stuck cells),
  zones INTACT; live zones-compare INTACT. Bots down 01:20:41-01:35:26Z; start-bots PASS on 3b3af7ef; Nova re-stopped.

### stuckclose-1108.md
name: stuckclose-01 11-08
description: tidy "stuck (complete)" = buildretry-held cuts never given up; stuckclose-01 3d96f847 on 1e593b9b built, draft entry, NOT queued
Status report 11-08 18:03Z: tidy "stuck ... (complete)" in hive-b/isolated-c/hive-d/board-a.

**Cause (measured, telemetry.py 12 h, 2,574 _build_visit rows / 16 pools control):** hive-b 219, isolated-c 179,
board-a 172 tidy visits `outcome=complete` ("cuts left 2/38 | 4/8 | 2/28, fills 0"), placed 0. The cuts left are
EXACTLY the cuts in the tidy's buildretry ledger (`project-<home>.tidy.retry.<bot>.json`, summed 3-11 visits,
why=unreached). Held -> clears() never evaluates them -> per-bot TIDY_CUT_TRIES (bot.tidyGiven, per connection) never
reached -> cutLeft forever -> no completion, and gkwork visitEmpty false -> 0 strikes in every strike file.
The `complete` outcome is runVisit's stop (its own list empty), NOT the record closing.

**Fix:** stuckclose-01 3d96f847 (branch stuckclose-01-on-1e593b9b, pushed): stuckclose.mjs townGivenCuts (ledger
visits >= RETRY_VISITS = town gives the cut up) + givenWaivers on completion (gkfDeadCarry 24 h). buildrun clears():
p.tidyTownCount counts stand-less tidy cuts in the ledger. STUCKCLOSE=off rollback. Tier 2. Codex NO BLOCKERS.
Suite ci2 43f84f01 421/422, 3d96f847 420/422 (well.test fails on base; plinth-skill passes alone). Registration ~/mcai-analysis/stuckclose-01.3d96f847.json (validate:
valid); draft ~/mcai-analysis/stuckclose-01.queue-entry.json. Merges clean with stuckfleet-01 d65154c0 / -02 d6d5e535.

**Not this fix:** hive-c tidy moved on its own (277 places / 12 h, new gen 19:39Z). placebo-c paths = no_site unrouted
(all dests unreachable; retry_now x5). hive-a/hive-d monuments = aborted/interrupted (hive-a start 33-38 s = hivedrop
stall; hive-d walk ~22 s interrupts x57 in 6 h, unexplained) + no_material tier3/tier5.

### tidyrefresh-1109.md
name: tidyrefresh-01show-11-09-10
description: "open inwall tidy record re-surveyed hourly + new cells merged, town cut give-up, rough cap pages; built, Codex NO BLOCKERS, ready to stage, NOT released; fleet no port"
  type: project
  originSessionId: 2a199c24-8dc2-4c02-9509-8499787c3dd1
  modified: 2026-11-10T02:08:12.798Z
---

**Break (measured, 11-10 01:52Z copy):** the showcase inwall tidy record (gen 107, sited 11-08 04:47Z) was still open after 45 h, with
294 fills and 8 cuts open (of 2,601 cells and 1,098 cuts) and 18 waived. buildTidy re-sites only after a completion, so mess made after
the siting was never planned. The rough cap (161 cut off) never paged, and the outer rings never opened. The stuck maps name 18 cells,
not 41. The visits are also slow: 24 h = 261 tidy visits, mostly deadline/helper_idle, 0-52 placed/h.

**Fix:** `bots/src/tidyrefresh.mjs`, wired by skills.mjs tidyRefresh + stageSurveyInputs. (a) The keeper surveys the open inwall record
again every hour (refreshAt). It merges whole new columns only: never busy, guarded, known/waived, stand or plot cells. New fills go in
new T-groups; at most 1,200 entries a refresh, nearest first. roughground inwallAtOf counts refreshAt. (b) cutGiveUps: a cut the bot
gave up (TIDY_CUT_TRIES) goes on rec.waived (plus opener fills under a kept crust). The cut list and the completion honour it. Remedy:
the next inwall survey plans it again. (c) siteStage `planned` = the open columns -> rough busy, so the cap pages. Rollback:
TIDYREFRESH=off. Tier: not protected.

**Branches:** tidyrefresh-01show d49b5877 (on live 3b3af7ef) and tidyrefresh-01show-on-bw3 38f048f8 (on
showcase-boardwalk3-on-bridges 6b2ca969; one conflict beside waterWalkVisit, both kept). Stage the -on-bw3 one after
bridges+boardwalk-03. Replay copies: ci2 ~/tidyrefresh-1109 and .40 ~/tidyrefresh-1109.

**Replay (bots/scripts/tidyrefresh-offline.mjs):** adds 256 cuts + 944 fills over 710 columns (346 more wait for the next hour).
Survey cap skips 0. All 4 protected checks are 0. It covers 199 of the 395 in-wall columns of pass-3's shape dry run; the other 196
are outside the tidy survey's own rules. The open work grows from about 300 to about 1,500 cells, so the inside stays the keeper's
work for days and the outer rings wait. The lever for that is visit throughput, not this fix.

**Read after staging:** `_build op=refreshed` hourly; `op=waived why=cut_given_up`; the record's `refreshed`; tripwire H/Z 0.
**Fleet:** no port (no groundskeeper/stages on main). The fleet's stuck single cells are covered by stuckclose-01 3d96f847: queue it.
Doc on main: docs/reports/tidyrefresh-2026-11-10.md; ledger row id tidyrefresh-1110.
**Checks:** Codex r1 NO BLOCKERS, fold NO BLOCKERS. Suite ci2 38f048f8 489/491: orphaned is the base bagdiet failure; showdrop is a
timing flake that passes alone 2/2. The earlier 7a4930d1 run caught bridgepost's exactly-one anchor; fixed with tidyGuardSet.
Main 3a29abe7: doc + replay jsonl + orphan entries + ledger row.

### land-program-1112.md
name: land-program-1112
description: Owner 11-12 "design it, test it, deploy it": land care + movement program on main; takeback-01show LIVE; grounds-01show (cleanup as funded work) in review; pieces 2-5 not built
---

**Owner 11-12 (verbatim):** "is there a better approach for bots movement and pathfinding along with a better approach to cleaning up the land (in town and out of town) ... grounds keeping and terraforming the land"; then "Yes, design it, test it, deploy it. lets get this working we've been fighting it for days".

**Design:** `docs/reports/land-and-movement-program-2026-11-12.md` on main (c11fb9249). Codex + Claude independent designs agree on the pieces. Order: 0 take-back; 1 cleanup as ordinary funded work; 2 one way down and up (mine/surface, protected); 3 escapes + dug ground put back; 4 freeze the surface plan; 5 only then ban placing while walking.

**Measured (showcase, 24 h to 11-12 13:39Z; query `scratchpad/access.py`):** tidy got 218 of 20,160 bot-minutes (1.1%), 269 cells, 2.5 cells/min when it works; 49 of 131 visits `helper_idle`; the ~2 min visit cutoff is SKILL_TIMEOUT 180 s minus a 60 s tail, so the lever is more visits not longer ones; 3,730 movement blocks placed in town+margin; surface skill 11.8% of skill time; entombed 2,576 (1,976 underground); noPath 7,064; placements spread over 465 5x5 spots (25 hold 25%, 77 hold 50%).

**Piece 0 `takeback-01show` LIVE 14:00:55Z 11-12:** release `c4616380-6dd0ded8-fdd64ead` (rollback target f4d86d0a; `TAKEBACK=off`). Codex r1 3 blockers, r2 2, r3 none; Claude r1 2, r2 none, final none. First 26 min: 51 dug, 35 left:expired, 34 adopted:gone, 14 kept:reuse, 0 deaths, 5 s per bot-hour; in town+margin 11 of 47 pathfinder placements taken back (23%, target was half). noPath doubled in that window but it includes the restart: like-for-like hour read `scratchpad/tbread2.py`. See [[takeback-1112]].

**Piece 1 `grounds-01show`** (branch origin/grounds-01show, worktree .wt-grounds, on takeback c4616380; commits f5d48a6a + d9c05f5c; built by a subagent, I read the diff): `bots/src/grounds2.mjs` + glue in skills.mjs (buildShop groundsBegin/groundsEnd, buildShopVisit, shopActive, buildersFor, keeperOrder, buildTidyVisit). Switch `GROUNDS2`. Any builder at the surface in town is a worker (no helper lease); share: open > 500 every 2nd build visit, > 100 every 4th; empty visit spends the turns 10 min; max 4 bots, last slot the keeper's; stairs first when the bag holds stone. Rows `_grounds_mode`, `_grounds_quota`. Not protected. Agent's estimate 4-6% of bot time (non-crew build orders come at most every 10 min); all cuts share one `seg-clear` lease (one cutter at a time). Read: net tidy backlog change per day (was +380).

**Owed:** cottage1 next visit (stuck back-off 6 h from 10:26Z) should place -8,69,-37; gathermem-01 registration guardrail `death` -> `_death` needs `queue replace-variant`.

**UPDATE 15:25Z 11-12.** takeback +60 rollout-check PASS (0 deaths, 14/14). Like-for-like hour (14:12-15:07 vs 13:03-13:58): walks ok 58% vs 44%, noPath 395 vs 626, entombed 112 vs 117, 0 deaths, ~10 s take-back per bot-hour; in town+margin 42 of 118 pathfinder placements dug back (36%; target half); 161 of 358 receipts `left:expired` (119 of them zone=out) -- the expiry row does not say why (unfenced walk / halt cap / left another way): add that reason (takeback-02). A 12-h read against 1,321 placed / 75 dug is still owed.
**grounds-01show LIVE 15:21:37Z 11-12:** release `df63792a-6dd0ded8-fdd64ead` on c4616380 (rollback target c4616380; `GROUNDS2=off`). Codex r1 1, r2 2, r3 none; Claude r1 1, r2 none, final none; both delta-checked df63792a (the gate needs an APPROVE at the exact piece sha). Suite ci2 509/510 (orphan, base). First row: open=3012 share=2. Read script `scratchpad/gread.py` (+30 and +60 min reads); rollout-check due ~16:30Z. Lesson: a change to a line in skills.mjs breaks structural tests elsewhere (stepwell05, country, cobble-rule, reroof4, fellfirst): grep the test dir for the old line before the full suite.

**UPDATE 17:55Z 11-12 (owner: "yes, lets do both ... see why the projects are stalled ... when all projects are complete, bots should be cleaning up and teraforming").**
- grounds-01 +60 PASS. First 66 min: tidy 3.7% of bot time (was 0.6%), 0 helper_idle; then output stalled: the record is worked in survey order and its first 7 open segments each began with a cell no stand reaches (366/347/300/188/101 visits); the give-up rule only counts visits that ran out of work (none do).
- **grounds-02show LIVE 17:16:37Z** (release `99b4d8b0-6dd0ded8-fdd64ead`, rollback df63792a): stuckSegs/stuckLast -- a segment with a cell 6+ visits could not reach goes last, with its dependants. +35 min: `late=7` on rows, 1.75 cells per tidy minute (was 0.84), but NEW unreachable cells are met (8,69,-46; 9,68,-46; 6,66,-47; 1,64,-52 ...): each costs 10-16 s standing still, and after ~3 the visit ends `aborted (interrupted)`. Suspect: runVisit rebuilds the walk map (`nodesFor` -> walkFrom BFS, buildrun.mjs ~1390) every loop pass. Agent on it: branch standcache-01show, worktree .wt-standcache.
- **Time (showcase 6 h, skill rows are START times):** in a skill 43%; waiting between actions 32% (LLM_DECISION_COOLDOWN_MS=30000: gap median 33.6 s after everything); still walking 12%; rescue/escape 8%; model wait 3%. Fleet with pipeline-01: gap after success 2.6 s.
- **pipeline-01show restacked** (branch origin/pipeline-01show-on-grounds, worktree .wt-pipe, tip 13d54cf6 on 99b4d8b0; same patch-id as b91c44c9 + a dryCheck fix: it now restores bot.bankClosed -- Codex reproduced a discarded prefetch reopening the bank; THE FLEET HAS THE SAME GAP, follow-up owed). Codex r2 + Claude NO BLOCKERS at 13d54cf6; suite ci2 509/511 at 6316161a, ci3 506/511 at the tip (craftsync, plinth-skill, showdrop flakes pass locally). Release held until grounds-02's rollout-check (~18:20Z). With it: owner setting SHOP_COOLDOWN_MS=180000 via drop-in /etc/systemd/system/mcshow@.service.d/20-shop-cooldown.conf + `owner-direct-setting` row (units are mcshow@showcase-<Bot>.service).
- **Projects (24 h):** 24 of 32 done; open and blocked: stepwell 2,168 cells 0 placed (92 h), pens 37x no_site, civicF 25x no_site, tower 46 placed, wood 64/66 aborted, country 0 placed, cottage1 back-off, townhall no_material for crafted wood parts (materials job only makes stone; 633 of 840 of its runs are chest recounts). Model free-picks: explore 4,331/day, gather dirt 2,172, iron ore 1,304. Build order offered every 10 min (SHOP_COOLDOWN_MS).
- Agents running: grounds-03show cleanup-as-fallback (.wt-fallback, switch GROUNDSFALL); read-only diagnosis of each stalled project (report + files in scratchpad/diag/); standcache.

**UPDATE 18:50Z 11-12.**
- grounds-02 +60 rollout-check PASS 18:20Z (0 deaths, 14/14).
- **pipeline-01show (13d54cf6):** the showcase gate REFUSED it at dry-run (protected admission.mjs/cognitive.mjs match no fleet-kept build). Re-recorded with `--owner-when 2026-11-12T17:25:23Z --owner-quote "Yes, do it"` (the owner's answer to the port proposal) and staging; the stage replay takes ~20 min. Drop-in for SHOP_COOLDOWN_MS=180000 goes in at its activation.
- **projfix-01show (a14afe5a on 13d54cf6):** four fixes (country heartbeat `beatKeys`; stepwell sand stands `fallingFloorOk`; wood kit `woodKitStillMs`; civic chain `chainSkipOk` + `civic-site` lease 12 min). Claude NO BLOCKERS r1-r3; Codex r3's last finding (lease check and publish not atomic across a 13-min process suspension) DECLINED by me as not a practical window: record as accepted risk, not a Codex approval of that point. Suites: ci2 508/512 at 6cadfd0e; ci3 507/512 at 703ac0c9; ci4 506/512 at a14afe5a (craftsync, lavastep, plinth-skill, protected-paths, well all pass alone at a14afe5a; orphan is the base's). Release after pipeline's +60.
- **grounds-03show (66c1c609 on a14afe5a; worktree .wt-fallback; switch GROUNDSFALL):** fall-through (a no_effect build visit on a FALL_STOPS stop with 90 s left goes on to the tidy), no-order ask (complete/no_site/stuck_on_cell/slots_full -> grounds-only visit), `bot.g3Hold` keeps the back-off. r1: Claude none, Codex 1 (sweep past the skill limit) -> `lateUntil`. r2: Codex none, Claude 1 (a late leg took a FREE keeper lease) -> `groundsMayKeep`; tip now 66c1c609; r3 reviews + suite running. Plan: release projfix + grounds-03 TOGETHER as one release (tip 66c1c609, two piece records) after pipeline's +60. KNOWN GAP: with the inside tidy COMPLETE and a country band open, quota/fall-through/ask answer `record_complete` (g2Record reads only the inside record) -- the "all done -> countryside" half of the owner's ask is NOT built yet. Also: when the tidy is the order's own pick, an empty visit quiets it 1 h (`idle`), not 10 min.
- `npm run check` fails lint:movement on the live showcase line already (buildbot.mjs, pathhalt.test, pickuplog-review.test outside the baseline): not from these pieces; eslint passes.
- Next stalled-project fixes (buildrun.mjs, after standcache): tower zone-refused clears; no_material cell pick; pens siting; decor palette; forest foreign block.

### takeback-1112.md
name: takeback-1112
description: Owner 11-12 "no walking mess, in town and outside": design on main; piece 1 takeback-01show built (walk digs back its own scaffold), in review; pieces 2-5 not built
---

**Owner 11-12 (verbatim):** "1. absolutely do this, i thought we already did this. even outside the town i want the same rules to apply" (to: walking must not place dirt or dig ground; escapes undo what they placed). Later the same day: "Yes, mess first" (ahead of storage steps 2-4).

**Design:** `docs/reports/walking-mess-design-2026-11-12.md` on main (7f872a673). Codex + Claude independent designs; both proposed "no-place first search" as piece 1. I moved it to piece 2 because scaftown-01 (the +20 price, live on the showcase since 11-07) already priced 74,826 of 90,689 walk searches in 12 h and a placing route was still chosen 585 times. My interpretation, stated to the owner: a flat ban would strand bots, so the rule is "place only when no other route, and take it back".

**Baseline (showcase, 12 h to 11-12 13:20Z, 14 bots):** 1,772 movement blocks placed in town+margin (pathfinder 1,321; pillarOut ~300), ~2,700 outside, 75 cells ever dug again, 176 ground digs in town, cleanup crew ~140 fixes. `scratchpad/mess.py` is the query (LIB=/tmp/look-1112c on .40).

**Piece 1 `takeback-01show`** (branch origin/takeback-01show, worktree .wt-takeback, commit 88296ec2 on cottagepost f4d86d0a): `bots/src/takeback.mjs` wraps `bot.pathfinder.goto`; receipts from placeaudit `onPlaced`; rows `_takeback_mode`, `_takeback`, `_takeback_sum`; `_dig_town purpose=takeback`; switch `TAKEBACK=off`. protected.py says not protected, but it is reviewed as tier 3 (two engines). Read plan: `_takeback outcome=dug` against `_place_town outcome=placed reason=pathfinder`; target at least half; hurting if deaths near a `_takeback` row, walk failures +10%, >90 s per bot-hour.

**Pieces not built:** 2 hard no-place first search (incl. gather approach); 3 escapes' pillars (reflex.mjs, protected); 4 dug ground put back + no gathering dirt from town ground; 5 repeated spots become stairs. Fleet port needs placeaudit (the fleet line has no `_place_town`).

Related: [[showcase-roofs-keeper-1112]], [[owner-pretty-land-1107]], [[scaffold-1107]].

### scaffold-1107.md
name: scaffold-1107
description: "scaftown-01 11-07: owner 'dirt as a cheap way to get around'; the pathfinder (not escapes) leaves the visible dirt; +20 town price after legality built show c523bc53 + fleet (placeaudit-fleet-01 first)"
---
OWNER 11-07 evening: "we're still using dirt as a cheap way to get around and get over obstacles ... is that just a cheap
poor man's path finding solution?" Yes: walk tower step = 1 + placeCost 5 = 6 vs walk 1.
Measured showcase 24 h (CoreProtect copy matched 2,609/2,615 `_place_town` rows): pathfinder 1,945 movement blocks in
town+margin (pillar 1,048, step 877), 409 cells standing, 137 on top of their column; pillarOut 576, only 9 on top (in
holes). Fleet has NO placement instrument (no `_place_town`, no CoreProtect): `_scaffold_pick` 94,966/24 h only.
Design note docs/reports/scaffold-design-2026-11-07.md (Codex independent design matched; took its gather exemption, dy 4, cost 20).
Built: bots/src/scaftown.mjs -- +20 per walk/composter_walk placement in wall rings+2 or Chebyshev 80 of home at
y >= home.y-4, added in a getNeighbors wrapper AFTER legality (never deletes a move); escapes+gather exempt (scafTown=false
on clones); getPathFromTo/compute scope: capped searches unpriced, 1 s budget then RESTART IN PLACE at base costs (Codex r1
blocker: zeroing price mid-search kept inflated closed nodes, column goal timed out), timeout/stuck goals latch 120 s.
SCAFTOWN=off rollback. Paper sandbox6: ledge 6->0 dirt, wall+gate 9->0, pit-in-town still out, far unchanged.
Branches: show scaftown-01show c523bc53 (on 01c6debf, ready to stage); fleet placeaudit-fleet-on-de9fe23d 3b85ebd9 (tier 2,
instrument, MUST go first: effect metric) -> scaftown-01-on-placeaudit-fleet 2366d466 (tier 3). Regs ~/mcai-analysis on .31.
**Why:** the visible litter is pathfinder scaffold chosen because towers are cheap, not escape pillars.
**How to apply:** read `_scaftown_hits` (hits/chosen>0, restarts/latches small) and `_place_town reason=pathfinder
outcome=placed` per bot-h; pieces 2 (placer take-back + gather) and 3 (stairs at the top-20 climb spots) are designed only.
Related [[roughground-1107]], [[owner-gk-town-clean-1104]], [[owner-pretty-land-1107]].

**LIVE showcase 11-08 03:33:50Z as 81d1894f.** First hour: pathfinder placements in the PRICED area (y>=66) 45.7 -> 19.4/h;
all `_place_town` flat because ~80% are below home.y-4 (pits/mines, unpriced by design); path_timeout 287 -> 98/h; 0 deaths.
Defect: stall latch fired on goals the price never touched ('stuck' resets are routine; Comet 28/10 min with hits=0) ->
fixed scaftown-02show afd36d69 (touch recorded per slice, stall counts only touched goals; Codex+Claude NO BLOCKERS; ci2
470/471); fleet variant now b52603ec. _reflex_stuck 24 -> 49/h: deep half = `surface` escapes in one pocket ~25,4..14,-32
(exempt profile, not scaftown); surface `home` stalls 5.2 -> 14.8/h at pre-existing wedge spots (14,69,-32), (-2,68,-24),
(-32,67,12), (22,67,32): plausibly scaftown routing walks through them -- watch.

**Fleet canary 01dc970 (hive-a+hive-b) REVERTED 11-08 16:01Z on "canary unit not running: hive-a-Bravo"** = pre-existing hive-a
disconnect/1 GB RSS flapping (11-07 same hours, no scaftown: Bravo 68 drops at 1,061 MB; hive-a server timeouts since 11-06,
flat 33-45/h); hive-b did MORE priced work with 0 drops; control board-a-Bravo 23 drops. Write-up main 6a76dec5. Requeue on
b52603ec under a new run id pinned to hive-b + hive-c/hive-d; keep hive-a/board-a out.

### boardwalk3-1108.md
name: boardwalk3-1108
description: "boardwalk-03 11-08: bot dirt/cobble in water -> planks in place on walk lines, dug elsewhere; genesis proof; fleet 4cbdcd41 (on ef774d02) entry drafted, show f12b03c2 ready to stage"
---
OWNER 11-08: replace the bots' dirt/cobble lines standing in water with plank walkways where bots cross; remove the rest; only bot-placed blocks.

- PROOF = GENESIS: regenerate each world from its seed (level.dat via read-only sudo) with the same Paper 1.21.8 b60 jar (8de7c52c)
  in a throwaway dir on ci2 (~/bw3-genesis, gen.py; 6 fleet seeds -- 10 worlds share 12393.. -- + showcase). Listed = genesis
  water/air + column open water at genesis + live bot material at/above wy + live water on >= 2 sides. Controls: non-stone
  agreement 93.7-96.4%, WRONG seed 4.4%. Tool scripts/host/waterstrays.py (scan on .30/.40, finish on .31/.40: records, place rows,
  7-d bot.pos traffic). Fleet 12,480 cells / 16 pools, 357 walk lines (1,777 cells); showcase 139, 0 walk lines, CoreProtect 6/139.
  Woodworks' 2,718 heuristic is NOT ownership: genesis calls 4,385 of 8,250 heuristic columns natural.
- CODE: bots/src/boardwalk.mjs + skills waterWalkVisit (keeper tidy visit every 15 min BEFORE the stage) + buildrun p.wet/DUG
  (show: own p.intoWater) + buildbot dig confirms on water. Evidence files ship in the sha bots/src/waterstrays/<pool>.json,
  EXPIRE 30 d (2026-12-08). BOARDWALK3=off / WALKWAYS=off.
- Codex r1 3 blockers (deck only while listed/planks/water; removal rooted at bank nearest home; no deck w/o planks), r2 1 (plank
  budget per visit, bw3DeckFor), r3 none. Paper sandbox5 boardwalk3-proof PASS (12/12 in place, 16/16 dry, 6/6 far-first).
- Tier 2 (not protected). Fleet branch boardwalk-03-on-ef774d02 4cbdcd41 (1e593b9b variant 4ae4cba0); suite ci2 422/423 (well base); reg ~/mcai-analysis/boardwalk-03.4cbdcd41.json (valid),
  entry ~/mcai-analysis/boardwalk-03.queue-entry.json (pin placebo-b/hive-c; NOT added -- control session). Show boardwalk-03show
  f12b03c2 on dd79b56a, NOT released (suite w30 470/479, all base/flake/load); tripwire WW1/WW2 on main shopread (241/241 mutants), NOT installed on .40.

**Why:** owner wants clean water + walkways; ownership must be proved, not inferred from shape.
**How to apply:** read `_waterwalk` + `_build project=waterwalk op=clear|place`, WW1/WW2 = 0, deaths; re-scan canary town at +180.
Related [[woodworks-1108]], [[owner-no-water-bridging-1027]], [[scaffold-1107]].

### fillslow-1109.md
name: fillslow-1109
description: "showcase tidy fills ~2/h 11-09: cuts-first visits starve fills (keeper 0 fills/47 visits) + no helpers 02:08-09:10Z; fillshare-01show 750cfdb1 (+01b yard-draw bill fix) on b9fa002e, ready to stage"
  type: project
  originSessionId: 2a199c24-8dc2-4c02-9509-8499787c3dd1
  modified: 2026-11-09T12:42:25.502Z
---

Status report 11-09 06:03 CT: inside-wall tidy 160 cuts / 26 fills since 00:00Z (roughfill-01show read 15.5/h fills on 11-08).

**Measured** (telemetry.py on .40, 14 bots, tidy `_build_visit` by `crew=`; scripts /tmp/fs_crew.py, /tmp/fs_tops.py, /tmp/fs_held.py on .40):
- runVisit digs the tidy cuts FIRST (GK.clearMax 16 tries); a crew visit ends `deadline` at ~120-160 s inside them. Keeper
  02:39-12:40Z: 47 visits, cleared 105, placed 0. Helpers 20:00-24:00Z: 23 visits, cleared 30, placed 4. Fills came only from
  helpers locked out of seg-clear while the keeper was in a visit (16:17-20:00Z: keeper 28 visits -> helpers placed 22).
- 0 helper_take 02:08-09:10Z: helpers take the tidy only with nothing else buildable (keeperOrderPure d=helper: tidy last);
  paths/cottage1/shaft were open. Helpers back 09:10Z -> fills 7.9/h.
- NOT the cause: material (no_material 0 every window; bags dirt 200+), buildsite CLAIM (fills recovered after it), stuck cells.
- Bots stopped 02:39-03:37Z (S4 trip, rollback to dd79b56a) -- part of the gap is downtime.

**Fix:** branch `fillshare-01show` 59879aa8 (f27f4ec1 + reroof4 anchor) on showcase tip b9fa002e (glass-01show), worktree /Users/darrellmiller/Documents/.wt-fillslow.
groundskeeper.mjs tidyShare: fills behind cuts (fraction left) + workable fill + earth in bag -> helper `clearsLast` (buildrun:
segments first, clears once at the end), keeper clearMax 6. Row field share=last|6. GKFILLSHARE=0 rollback. Tier 2; Codex r1 NO BLOCKERS. Suite ci2 f27f4ec1 482/485 (craftsync + orphaned fail on base; reroof4 anchor fixed -> 1/1).

**01b (coordinator follow-up, 143 helper visits since 13:49Z 11-08):** 59 helper_idle = placed 0 + cleared 0 + gathered 0 (a label,
not a lock-out; 57 at the deadline): 28 no segment taken (walking), 16 fill cells deferred, 9 yard draw >= 40% of visit, 5 segment walk
hit deadline. Worked helper visits: first op at median 83 s of ~130 s. Yard draws (12) by bags holding 17-227 dirt: the bill
subtracted ALL open topsoil from spare dirt. Fix 750cfdb1: tidy.mjs earthDirt = spare - min(openSoil, visit cap). Codex NO BLOCKERS. Suite ci2 750cfdb1 484/485 (orphaned fails on base).
Not fixed: travel to work (~83 s) inside a ~130 s skill budget -- the real ceiling on helper output (runner budget = protected scope).

**Why:** two correct orders (cuts first; helpers last in the project order) composed into fills ~0.
**How to apply:** after release read fills/h vs cuts/h by crew (fs_crew.py), share= rows, helper_idle rate; if fills still low, the
next lever is helper availability (tidy last in a helper's order) and the keeper's forest/explore time -- owner decisions.
Related [[roughground-1107]], [[gkwork-1107]], [[bagfull-1107]].

### gkwork-1107.md
name: gkwork-1107
description: "gkwork-01 11-07: groundskeeper always has work or releases -- town-wide strikes close an empty stage, no 1-h quiet while closing, release no_work_now, stalled stage waives stuck cells past the tenth"
  type: project
  originSessionId: 2a199c24-8dc2-4c02-9509-8499787c3dd1
  modified: 2026-11-07T05:09:15.325Z
---

OWNER GOAL (via control session 11-07): groundskeepers always have work; town beautiful/clean/level inside the walls, then countryside.
Measured 11-07 (telemetry.py): showcase 24 h 29 keeper terms / 25.9 keeper-h, grounds visits 1.4% of term time (17 visits, 1 success),
no_work_visit 15/29; the inwall tidy stage read "cuts 0/77, fills 0/1331" on ~30 keeper visits for 23 h and never completed (per-bot
gkClears/gkParkWait counters x 20-min lease rotation; clears_given_up 11 times to 11-03, 0 since). Fleet gkstay 63d28320 2 h: 42 terms,
grounds 7.3%, 11 `stuck` releases (board-b stalled: 12/69 waived = room spent). Aborts are the stuck/entombed reflexes (protected; not changed).
- Code bots/src/gkwork.mjs + test/gkwork.test.mjs. Rules: per-holder strike files `<key>.gkwork.<holder>.json`, 3 empty visits town-wide
  -> soft holds give way, stage completes; showcase tidyQuiet `closing`; keeper releases `no_work_now` when strikes are in but a hard hold
  stays; STALLED stage waives stuck-map cells (>=3 visits) up to 1/4 of the stage, 6/visit. Rollback GKWORK=0. Tier 2.
- Design: docs/reports/gkwork-design-2026-11-07.md (Codex design + reconciliation). Ledger row gkwork-1107.
- Branches gkwork-01show (on af3b9a8b, ready to stage) and gkwork-01-on-63d28320 (registration + draft entry ~/mcai-analysis/gkwork-01.*.json on .31).
**Why:** two correct guards composing into a dead end (per-bot counters x rotating lease; waiver cap x stuck release).
**How to apply:** read `_build op=stage_held|stage_close kind=` rows to see what held a stage; follow-ups: keeper assignment supervisor
(Codex), kept trees out of tidyClearsLeft, forest off_stand failures, bag-room skip for the keeper.

**RELEASED showcase 11-07 06:41:07Z as d8dbd32a (batch20, with forest-04show a71eee4f).** Fold fixes: f794ac07 the felling clears leaves only inside the worked record's tripwire area (fellClearArea = shopread forest_leaves_ok / farm_retire_ok); d8dbd32a gkwork no_work_now never releases a keeper whose forest is due (keeperAfterVisit forestDue).

**gklease-02 (11-07, coordinator's effect-audit question):** the fleet tidy -64% after gklease-01 was NOT keeper starvation: stalled tidy
stages wrote the town's 6-h stuck stamp, and a waived TIDY cell was not "done" for it (paths/walls were), so the town had 0 tidy visits by
any bot for 6 h (hive-d, isolated-a, board-c, placebo-c, hive-b). Branch gklease-02-on-45defefa bce7d783: waived tidy cell done; open sky =
surface (141/392 underground releases were lake shores); stray-sweep give-up town-wide (1,868 failed tries / 342 strays). GKLEASE2=0.
Showcase gkwork-01show is live but NOT ACTING: since 06:40Z 0 keeper tidy visits; `_shop_skip why=room` 158 rows (bags full) -- next fix.
**gkroom-01show (11-07):** bagfull-01's piece 2 on dd0a4489: keeper with 2-7 free slots whose forest is refused for room is ordered the tidy
(GKROOM=0). Branch gkroom-01show d2bdf62c. gklease-02 not needed on the showcase (no stamps, no stations sweep). Station hoarding fix ~40-80 lines.
**gkclear-01show (11-07 night):** showcase inwall stage held `clears:11` (logs no stand reaches; clears() skips them uncounted); 1 keeper tidy
visit in 2 h because the forest goes first and gkwPending is per-bot; no stage close -> no rough re-survey. Fix 01c6debf on 191445b8: town
strikes (60-min window) make the keeper's order tidy-first while 1-2 strikes are in.
**gkclear-02show (11-08):** gkclear-01's 60-min closing window deadlocked on a 3-h-old strike; d7306d0d on dc293197 counts the 6-h window and

### gkforever-1106.md
name: gkforever-1106
description: "11-06 gkforever-01: groundskeeping never runs out (clock, dead carry, level, crew, grounds lap) on decbundle-01 with groundskeeper-01 ported; supersedes groundskeeper-01; draft queue entry, not queued"
---
OWNER 11-06 ~04:00Z/04:30Z: always projects; greenskeepers clean the town (beautiful, no holes/pits/unlevel ground), then the
countryside outward. Measured 24 h (fleet 4f3b0f5c, 80 bots): tidy 1,099 visits / 3.0 of 1,920 bot-h in 4 of 16 towns; tidy
COMPLETE in 9 towns (48 h re-survey), absent in 5 (unsited first project); hourwatch lap 81%, 10/16 towns unworkable.
- **Branch gkforever-01** (pushed) on decbundle-01 3690e867: groundskeeper-01 ported (stationkeep sweep left out) + gkforever.mjs.
  Parts/flags: GKF_CLOCK (next band at once, interior audit 30 min, cycle 30 min, bands to 128), GKF_DEAD (waived cells carried
  24 h), GKF_LEVEL (1-high step cut, 1-deep hole fill, stage 0), GKF_CREW (tidy builders 2), GKF_IDLE (grounds lap alternating
  in idle_work). GKFOREVER=0 = groundskeeper-01. Tier 2. Codex r1 2 BLOCKERS fixed (tidySameGen fence, dead lights), r2 none.
- Registration + draft entry: docs/reports/gkforever-2026-11-06/ (branch + main). Design on main: docs/reports/gkforever-design-2026-11-06.md.
- Showcase already has its own gkstage/inwall/gksweep/outbands line (cycle-back + inwall): reconcile at the showcase-onto-main merge.
**Why:** the tidy completes and waits 48 h, one keeper is its only builder, so idle bots lap.
**How to apply:** queue P right after decbundle-01, cancel groundskeeper-01; next pieces decorate (decorator flowers), smooth, countryside traps.

### showcase-roofs-keeper-1112.md
name: showcase-roofs-keeper-1112
description: "11-12 showcase read: roofs stalled since 11-09 (town hall/hall/cottage1 stuck on unreachable cells); groundskeeper backlog growing (fills faster surveyed than placed)"
---

Measured 2026-11-12 ~07:00Z on the showcase (telemetry.py 24 h: 338,038 rows / 14 bots; and a 7-day count over 168 log files, 43,250 `_build`/`_build_visit` rows).

**Roofs.** Roof-shaped blocks (stairs/slabs) placed by buildings per day: 11-06 112 (shop 63, house1 49), 11-09 49 (cottage1), every other day since 11-05 zero (only 5 road slabs on 11-10 and 11-11). Roof pieces are released (townstyle-02/03 11-05, reroof-02 11-06, stepcanopy 11-08, reroof3 + reroof4 11-09, cottage2 11-09). In the last 24 h: townhall 5 visits all stuck_on_cell (1 cell no stand reaches, 352 open cells wait on it), hall 4 stuck_on_cell (2 cells wait), cottage1 3 stuck + 2 aborted; zero `project=cottage2` rows ever.

**Groundskeeper.** 24 h: 147 tidy visits, 152 fills placed (dirt 160, cobble 13 by `_build`), 68 cuts (grass_block 49, dirt 12, cobblestone 6); 67 visits `helper_idle`; ops deferred 478, stuck_on_cell 101 vs place 173. Backlog GREW: fills left 1,941/4,300 -> 2,313/4,652, cuts left 421/1,785 -> 531/2,051 (the hourly re-survey adds faster than the keeper fills). Countryside: 58 visits, 30 helper_idle, 24 waterwalk. Tripwire S6 STALLED (every open segment waits on a stuck cell).
Fleet (4 h): tidy 496 visits, 524 placed, 155 cleared in 13 towns.

**Where the mess comes from (same read, 24 h):** `_place_town` 8,045 rows in zones town (5,523) + margin (2,522), 84% dirt: placed by the pathfinder as steps/pillars (town 1,175 + 941, margin about 805) and by the pillarOut escape reflex (town 307, margin 269) = about 3,500 blocks placed a day, all 14 bots alike; no retract rows exist. `_dig_town` 283 confirmed digs a day in town ground: reflex escape/marooned 114, goto/surface/home 130, gather dirt or sand 28, build_shop 25. Against the keeper's 152 fills + 68 cuts. Cleanup itself: 68 of 147 tidy visits helper_idle ('nothing of the grounds is this helper's now') with 2,313 fills open; keeper lease lost 31x for being underground. Stuck buildings: townhall 1 pad cell -10,64,-58 (352 cells wait incl. gable/roof), hall 1 earth cell -10,64,30, cottage1 1 wall-B cell -8,68,-37, monument 2 cells, wallext 17 cells at 36,75,-37.

**OWNER 11-12 ~07:25Z, answering my four numbered options:** (1) stop walking from placing dirt or digging ground: "absolutely do this, i thought we already did this. even outside the town i want the same rules to apply"; (2) helpers take any open cleanup work: "yes"; (3) a stuck cell must not freeze a building (temporary stand, or carry on): "yes, this makes sense"; (4) one-off repair of the three roof-blocking cells: "yes".
**One-off repair DONE 07:27Z** (RCON `setblock ... keep`, all three were air, no bot near): townhall -10,64,-58 stone_bricks; hall -10,64,30 dirt; cottage1 -8,68,-37 spruce_log[axis=y]. Logged /srv/showcase/ops/oneoff-repair-20261112-applied.json. Unread: whether the three buildings resume (next visits). Items 1-3 are NOT built; item 1 is movement code (tier 3) and needs a design, because a flat ban outside town could strand bots (my caution, not the owner's words).

**Why:** owner asked 11-12 how the slanted roofs and the groundskeeper are doing. **How to apply:** both are throughput/stuck-cell problems, not missing features; the lever named in [[tidyrefresh-01show-11-09-10]] (visit throughput) is still the open one. Nothing built for either as of this note.

**12:00Z 11-12 after the one-off repair (07:24Z):** town hall building again (190 blocks since, 56 roof slabs; roof-edge 58 of 96). Hall complete 07:29Z. cottage1 NOT fixed: its own builder (Delta, 10:26:42Z) cleared the repaired post at -8,68,-37 as `kind=tree`, then deferred and stuck again. The bug is site clearing treating a planned log cell as a tree; do not re-place the block, fix the code. Tidy backlog still growing (fills left 2,224 -> 2,426 in 9 h).

**cottagepost-01show LIVE 12:57Z 11-12** (release `f4d86d0a-6dd0ded8-fdd64ead` on 6663328c, branch origin/cottagepost-01show, worktree .wt-cottagepost; rollback target 6663328c). Cause: a spruce stood on cottage1's corner-post column at siting, so `record.clear` lists `tree spruce_log` on the cells the plan fills with `post: ['spruce_log']`; the clears pass exempted trees from its built guard and felled the posts every visit. Fix: `ownLog` in buildrun.mjs (clears list, guard at the dig, treeDownFor). Codex NO BLOCKERS; suite ci2 506/508 (orphan bagdiet + well, both base). 13:01Z second one-off placement of -8,68,-37 (owner "Yes, fix it"), journalled as `owner-direct-world-edit` with the 07:24Z pass (which had only its applied.json). -8,69,-37 left for the bots (blind cell, reachable from inside). STILL OPEN: -8,68,-37 has no walkable stand (its only click is the post's top face from a ledge 2 above ground) -> the temporary-stand work; `lint:movement` fails on the showcase line's base (buildbot.mjs, pathhalt, pickuplog-review); main has the same guard line but no cottage code (port when cottages reach the fleet).

### owner-storage-yard-direction-1112.md
name: owner-storage-yard-direction-1112
description: "OWNER 11-12: storage direction — growable stepped piles per kind in the yard; no stone or logs in chests ever; use bag, then yard, before gathering; a real log limit"
---

OWNER 2026-11-12 ~07:10Z (after weeks of full bags/chests: "very little long term maintainable progress ... is there a better, simpler long term approach"). Their words:
- "could we use our storage yard approach but make stackable piles, build like the ziggurat or like a stepped structure for each kind, or even a wall of each kind so it can be expanded over time and be accessible ... an area that was inclined or stepped to allow bots access ... that stepped side would just grow as the piles grew"
- "could we put a limit, when we had a huge excess of logs bots stop cutting down trees?"
- "i wouldnt want any kind of stone or logs in chests ever, thats what the storage yard is for"
- "have a rule where bots took from their own bag, then storage yard before going to mine more of a material"

**Measured the same hour (telemetry.py 6 h, 539,979 rows / 80 bots):** logcap-02 is live and says capped in 15 of 16 towns (towns hold 468-5,321 logs vs high 1,024; about 57,800 counted in town chests), yet 432 log gathers still succeeded in capped towns (332 model-chosen at llm:idle): the cap is advice, not a refusal. Bags carry 11,644 logs. The showcase yard (bots/src/yard.mjs, main only, YARD_POOLS default 'showcase') holds 304 blocks (4 bays x 76, ramps 4 high), cobble/deepslate/bamboo only, no log bay.

**Why:** the owner wants one simple, lasting storage model instead of per-item chest patches. **How to apply:** design storage work around these four rules; do not add more chest-capacity patches (no fullplace part two unless asked). My own additions, labelled as mine: scale is about 3,600 logs a town to move out of chests (one-off); storage blocks 9:1 (coal, copper, iron, bone meal = about 27% of chest slots on 11-09) are a cheap extra. Not built as of this note; owner go-ahead on the build order pending. Related: [[bagfull-deadend-1112]], [[owner-logs-1108]], [[logs-1108]].

- TOWN GROUND IS A DECK OVER A GAP (measured 11-14 09:38Z from the server save with `regiondump.py`; reader checked: finished builds' recorded cells hold a block at 100 % and at 41-67 % when shifted one block). Within 48 of home, of 6,543 ground-topped columns no build owns, 4,986 (76 %) have air within 3 under their top block (4,179 directly under it); about 13,000 air blocks within 3 deep, 18,000 within 8. Sample columns: grass at 68, air 67-66, natural grass at 65. NOT growing: +8 / -6 columns between the 04:25Z copy and 09:45Z. My reading (not proven): old pathfinder walking bridges and scaffold at the plaza level (y 67-70) that grass spread over, above natural ground at y 63-66; the crawl space under it is where bots get boxed in (roofclimb plans `top=66 n=1` at y=63) and the "pits" are holes in the deck. Open pits by my rule: 372 pits, 802 columns, 2,445 blocks; the keeper's hole rule (<= 9 columns, <= 4 deep, roughground ROUGH.holeMax/fillMax) fits 304 of them and plans a fill in 109; 68 pits (305 columns, 1,197 blocks) are too big or deep for it. Scripts on .40: `/tmp/look-1112c/pitmap.py` (+ `pitmap_more.py`, `pitmap_ctl.py`), `crustdiff.py`, `digsrc.py`. Fix direction I chose: fill the gap under the lawn with bag cobblestone and dirt (a keeper stage), not built yet.
```

# Independent Claude review of the reconciled design (second engine, 2026-11-03 ~21:10Z)

This was a separate Claude subagent. It was given the design and the code, not the author's reasoning. It reviewed one round,
blockers only, and was read-only. The draft it reviewed was the first version of `storehub-design-2026-11-03.md`. What was done
about each blocker is in §10 of the main doc.

**VERDICT: BLOCK.** It found four blockers. All four can be fixed in the doc.

## Blockers

### 1. The builder does not choose the placeholder's side face

**The problem.** `buildsite.mjs:449` lists the block *below* first in `SUPPORTS`. `stepFor` (`buildsite.mjs:461-483`) then keeps
the nearest usable support, and the first one wins a tie. The intake row sits on a floor, so the hopper is clicked onto the floor
and faces **down**.

**Why it matters.**
- A hopper that faces the floor fills its 5 slots and then stops.
- Items tossed onto it then lie there and despawn, which is item loss.
- Proof S0 uses its own driver, so it could pass while the real builder still places the hopper wrong.

**What checks out.**
- A hopper keeps its facing after the target block is replaced.
- `buildbot.mjs:38` `INTERACTABLE` includes `chest$` and `^hopper$`.
- Line 279 never clicks an interactable block.

**Fix.**
- Add a forced-support field to blueprint cells, so hopper cells use only the dirt cell's face.
- Unit-test `stepFor` with a floor present.
- Run proof item 1 through `buildrun`/`stepFor`, then read the hopper's `facing`.

### 2. The hub well would throw cargo the doc says is "never thrown"

**(a) `isWellJunk` accepts items the doc lists as never thrown.** `isWellJunk` (`well.mjs:133`) accepts these, and
`NEVER_DISPOSE` (`well.mjs:131`) does not stop them:
- building stone and bricks: `brick` and `bricks`, the `mossy_`, `cracked_` and `chiseled_stone_bricks` forms, `polished_andesite`,
  `polished_diorite` and `polished_granite`, `smooth_basalt`, `tuff_bricks`;
- glass: all stained glass (`well.mjs:91`);
- wood: wooden fences, buttons and pressure plates (`well.mjs:92-99`).

SH1 checks only `NEVER_DISPOSE`, tools, ores, ingots, logs and planks. It would not catch these.

**(b) "The existing dispose path" throws more than `isWellJunk`.** `disposePlan` (`well.mjs:252-266`) also throws:
- swords, when `swords` is true;
- cobble at the cap;
- stock surplus over target (`stockWellStacks`).

Every caller passes `wellSwordsNow`, `cobbleWellCap` and `stockWellOpts` (`skills.mjs:1703`, `9668`, `9799`). That breaks two of
the doc's own rules: "swords stay" and "nothing thrown because a destination is full".

**Fix.**
- Give the clerk its own plan that judges only the cargo stacks.
- Call `disposePlan` with `swords:false`, `cobbleAtCap:false` and `stock:null`.
- Either add a hub exclusion list that matches §3.5, or cut §3.5 down to what `isWellJunk` actually keeps.
- Make SH1 and the classification test check that same list.

### 3. Moving stock to the hub empties the town's stock view

**The problem.** Several things only see containers inside the town box (16 blocks across, 12 up or down):
- the cobble cap and stock-target view scan only containers within `inTown` (`skills.mjs:3959-3968`, `3703`, `STORAGE_NEAR=16` in
  `composter.mjs:224`);
- the town index records opens only inside that box (`townindex.mjs:12`, `skills.mjs:4036`, `4228`).

**What follows.** Piece B moves today's stock (cobble working stock, logs, planks, iron) to a hall 22 to 44 blocks out. The fleet's
cap and target view would then read a drained town:
- stock-target rungs reopen;
- the cobble cap stops refusing;
- the town-iron check that pays for hoppers (`IRON_RESERVE+5`) never fires.

§3.1 registers hub chests only for `townContainers`, withdraw/toolkit and the index.

**Fix.** Do one of these:
- make the hub registry also feed the `townStock` and cobble-cap scan keys and the index observation (the `inTown` callers in
  `skills.mjs`), with tests;
- or keep the stock-target groups and the funding iron inside the town box.

### 4. Piece C reaches the fleet before the showcase

**The problem.**
- C is tier 2, and tier 2 goes "showcase first, 2 h watch" (PROCESS line 95).
- §7 plans fleet C around 11-04 to 11-05, "after bundle-1103a".
- Showcase C is tied to "the first hub release". That release waits on A, which waits on the copper hall at about 25 copper a day.

**Fix.** Release C to the showcase on its own now (it needs no building). Watch it for 2 h, then do the fleet owner-direct rollout.

## Not blocking

- **Protected scope.** Nothing planned touches it, provided there is no new SKILLS row and no edit to `cognitive.mjs` or
  `admission.mjs`. One rule for the build: route hub deposits through `town_deposit`'s execution in `skills.mjs`. Do not add a new
  order in `cognitive.mjs` (`#townDepositOrder` is gated by `inTownZone`, `cognitive.mjs:1019`).
- **Queue.** The placement of F fits the P/S alternation and the one canary slot. D going showcase-first under tier 3 is allowed.

## Notes

1. "Glass lets the chest open" is marked unverified, but it is already proven: `lidrule.mjs:48-51` cites a Paper 10-19 test
   (lidglass).
2. A second hub well "unchanged" cannot exist. Well state is one record per home (`junkwell-site-<home>`, `skills.mjs:17480`), and
   `wellSiteRefusal` returns 'already a well' (`well.mjs:536`). Either say "always reuse the town well", or design a second record.
3. A hopper pulls items only from the space directly above it. Misses land on the floor or a fence and despawn in 5 min. SH2 should
   count floor misses, not only `left=`.
4. Composting surplus saplings and bamboo destroys kinds on `NEVER_DISPOSE`. O2 should tell the owner this explicitly.
5. `jobrules.py:113` gates the `clerk` role on the yard and on cobble. Hub clerks need their own `need()` row; otherwise the cap-1
   claim is about a different job.

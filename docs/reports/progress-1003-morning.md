# Morning report — Saturday 2026-10-03 (overnight, ~11:30 pm to 7 am your time)

## Scoreboard (all 80 bots, last 10 hours) — nothing new reached the fleet overnight (the ore test holds the slot)
| | Yesterday's baseline | This morning |
|---|---|---|
| Bots with a pickaxe good enough for an iron trip | 12 | 9 |
| Bots with no pickaxe at all | 47 | 56 |
| Wood gathers that succeed | ~32% | 39% |
| Bots with a nearly full bag (34+ of 36 slots) | median 35/36 | 60 of 80 (median 35) |
| Iron | (old method, not comparable) | 85 raw iron gained in 10 h — **today's baseline**, same method from now on |

Pickaxes got slightly worse, as expected with no new fix live: the overnight work explains why (below).

## The big findings overnight (all confirmed on a real Minecraft server in the sandbox)
1. **Bots silently lose most of the pickaxes they "craft".** At a crafting table, the current fleet code lost **13 of 29**
   crafts while reporting success, and over-crafted 7 times ("craft 4 sticks" made 16, "8 planks" used all 5 logs).
   Cause: the bot library fires inventory clicks without waiting for the server. **Fix built (craftsync): 38 of 38
   crafts made, 0 lost, exact counts**, about 1–2 seconds slower per craft. This is probably the single biggest
   pickaxe fix available.
2. **Bots chop logs and then fail to pick them up.** 1,866 logs left on the ground in 3 hours vs 2,584 collected, and
   each miss taught the bot "avoid wood". **Fix built (logpickup): collected every log in every sandbox scene, 3–4x
   faster per log**, and a full bag no longer teaches "avoid wood".
3. **The composter works on a real server**: bags went 36 -> 33 -> 34 slots, saplings 248 -> 16 (stops at the planting
   reserve), 12 bone meal kept, nothing dropped. Building one from logs waits on the crafting fix.

## What else got done
- Pickaxe-safety crafting fix (craftroom): approved by both AI reviewers after 8 rounds.
- Town map stage 1 (remember where wood gathering failed, go where it worked): approved.
- Pickup logging (where junk comes from): approved, rides with the next test.
- Shadow mayor: running on the server since 10:17 pm, healthy (2 s per 5-minute pass). It keeps seeing the same needs
  we do — full bags and missing pickaxes — that no bot can currently staff.
- Every change was reviewed by both ChatGPT and Claude; bugs were found and fixed in every one before any sandbox run.

## What didn't work / honest problems
- **The ore tunnel test** (running since 3:22 pm yesterday, decides ~5:20 pm today): it reaches the iron every time it
  runs, but only 3 iron in 12 hours, about the same rate as unchanged bots. Few test bots have a good pickaxe and bag
  room to use it — exactly what the crafting/bag fixes target.
- Each fix needed 3–8 review rounds; slow, but it caught real bugs every time (two would have stranded bots).
- A sandbox helper changed sandbox-only server settings and cleared a sandbox chest. No fleet world was touched.

## Decisions for you
1. **Crafting fixes: one test or two?** craftsync (the root cause) and craftroom (the safety layer) both change crafting.
   My recommendation: test **craftsync first, on its own**, then craftroom — clean attribution, and craftsync alone
   fixes the biggest loss.
2. **Queue order after the ore test.** Recommended: explore-toward (+pickup log) -> **craftsync** -> **logpickup** ->
   craftroom -> orepack -> composter -> town map. Craftsync and logpickup are the two biggest measured wins.

## Next (automatic unless you change the order)
- ~5:20 pm: ore tunnel decision; explore-toward starts on its own.
- craftsync finishes its last planner fixes and a sandbox recheck this morning; then everything above is ready to queue.

# Fleet queue plan — 2026-11-07

_Analysis agent, control session, 11-07 ~14:40Z. **Read-only: `~/canary-queue.json` was not changed.** This answers the
owner's 11-07 question about what to study next. Companion report: `effect-audit-2026-11-07.md`._

## The numbers

- **Live fleet:** `45defefa` (buildfix-01, promoted 11-07 14:00Z).
- **The slot now:** `gkwork-01` is autorebasing onto it. An INSTALL-HOLD (`allowflight-1107`) blocks launches until
  15:15Z.
- **Ready entries:** 20. At the measured rate they drain in **~68 h (2.8 days)** as queued.
- **Measured rate:**
  - 13 canaries ran from 11-05 17:57Z to 11-07 14:00Z (44 h), which is **3.4 h per canary**, idle gaps included.
  - A standard read takes 3 h 10 min from deploy to promotion.
  - A fast read (`fun_reads 45 90`) takes 1 h 45 min.
- **Idle slot:** about **10 of those 44 h (23%)** had nothing deployed. Examples:
  - 11-07 08:31-10:50Z (2.3 h);
  - 11-07 14:00Z to at least 15:15Z;
  - 11-06 05:40-07:18Z (1.6 h).

  The gkwork-01 entry records that the autorebase relay "was looping (start/drop), so built by hand". **Closing the idle
  gaps is worth about as much as the cancellations below.**

## Bundling does not help this queue

I ran `canary-sched.py bundle plan` (it writes nothing) on six candidate sets. Every one came back NOT BUNDLEABLE. The
v41 rules (source: the BUNDLE_MAX / tier-none checks) require all of the following:

- **Tier none for every member.** No tier-3 entry can be bundled.
- **change_rows in every member's registration.** No ready entry declares any.
- **No stacked members.** roughground-02, marks-01, towngate-01 and the trade chain are all stacked.
- **A patch with a `diff_sha256`.** stoneworks-01, bucketfix-01, coalsale-01/02 and jobsite-01 carry the old patch block
  (base, tip and a note only), so they need `queue set-patch` before any autorebase or bundle.
- **At most 3 members.**

Every entry that could pass these rules is tier 1 or 2, and **fun mode already sends tier 1/2 owner-direct**. That lane
is a 60-min check inside a 90-min install-hold, against 3.4 h for a canary.

So the levers that work now are:
- cancel;
- hold until the showcase shows the change working;
- fold a stacked chain into one entry;
- send tier 1/2 owner-direct.

To make bundling usable later, registrations must declare `change_rows`.

## Every ready entry

How the columns were filled:
- **Tier:** main's `protected.py` on each entry's base..tip.
- **Onto live:** `git merge-tree` of the patch onto `45defefa`; for a chain, measured from the chain root. Conflicts in
  the orphan list resolve by the repo's union merge, so they are trivial.
- **src +/-:** lines added/removed under bots/src.

| # | run | lane | tier | src +/- | base (commits behind live) | onto live | evidence | recommendation |
|---|---|---|---|---|---|---|---|---|
| 1 | gkwork-01 | P | 2 | 186/1 | e6a1ea2b (5) | clean | Showcase gkwork-01show is **not acting**: tidy place 0; 18 of 19 keeper releases `no_work_visit`. Fleet: 90% of grounds batches gain nothing (11-07 07-13Z) | **Keep** (in flight). The fleet has the population. Before believing its read, see the effect audit's lease-or-exhaustion question |
| 2 | roughground-01 | P | 2 | 378/2 | 63d28320 (12) | clean | Showcase roughground-01show: **0 rough or census rows** in 3.3 h | **Fold with 02** into one variant 63d28320..6819822c (407/6, clean on live). Canary it after stairuse |
| 3 | roughground-02 | P | 2 | 34/9 | stacked on 01 | chain clean | as 01 | **Cancel as folded** into 01 |
| 4 | stairuse-01 | S | 3 | 294/3 | 47b8342d (25) | clean | projectaudit 11-07: **every fleet shaft is UNDERUSED**; 17-50% of stair visits succeed (e.g. 69/363, 166/404) | **Keep, next S.** The highest-value S entry |
| 5 | pathsfix-01 | P | 2 | 240/39 | 47b8342d (25) | **conflict** in paths.mjs and skills.mjs (next to buildfix-01's changes) | It was built to follow buildfix-01 | **Hand rebase, one Codex blockers round, then owner-direct** |
| 6 | forest-01 | P | 2 | 1295/17 | 9e9284d7 (20) | **conflict** in skills.mjs | Showcase forest-04: **0 forest rows after 07:21Z**. The showcase treefarm is BROKEN in projectaudit | **Hold** until a showcase forest harvests, then rebase |
| 7 | stoneworks-01 | P | 2 | 227/38 | aea83708 (49) | clean | stoneworks-03show is live on the showcase; stone items appear in 52,881 showcase rows today | **Owner-direct.** Run `set-patch` first if it stays queued |
| 8 | pause30-01 | P | 1 | 19/2 | 0542fccb (78) | clean | Owner asked 11-04 to shorten the runner pause; it is a setting | **Owner-direct** |
| 9 | bamboowalk-01 | S | 3 | 111/0 | beb79ed2 (60) | trivial conflict (orphan list) | Designed on 11-03/04 data. monustuck-01 and stuckproj-01's canopy fix shipped since | **Keep S, but first re-count the bamboo-wedge rows**; cancel if the population is gone |
| 10 | marks-01 | P | 1-2 | 79/3 | 16b552f7 = the cancelled stationkeep-01 | clean | No behaviour change by design; its only consumer is towngate-01 | **Cancel together with towngate-01** |
| 11 | towngate-01 | P | 3 | 204/6 | stacked on marks | **conflict** in admission.mjs and skills.mjs; **it modifies stationkeep.mjs, which live deleted** | stations-01 replaced stationkeep-01 | **Cancel (stale).** Rebuild on live only if cobble at the cap still needs it |
| 12 | bucketfix-01 | S | 3 | 24/10 | 3a7badea (51) | trivial conflict (orphan list) | Prerequisite of obsidian-01, which waits on the owner's O-L decision | **Keep S**, after bamboowalk. Run `set-patch` first |
| 13 | kittrim-01 | P | 3 | 327/13 | 0542fccb (78) | clean | Bags are under pressure (stations in bags went 220 -> 539) | **Keep P** |
| 14 | villageunlock-01 | P | 3 | 448/2 | aea83708 (49) | **conflict** in protectzone.mjs | Showcase trading has made no sale (see 16) | **Hold with the trade chain**, rebase on release |
| 15 | cobblebank-01 | P, bag-fix | 3 | 260/20 | 0542fccb (78) | **conflict** in skills.mjs | Its population is towns below the 1000 cobble cap. Town-chest cobble now: **15 of 16 towns at 909-1097**, only hive-a at 755. The builder expected INCONCLUSIVE | **Cancel (no population)** |
| 16 | coalsale-01 | P | 3 | 473/1 | 704acf91 (58) | clean | Showcase market-01/02: **0 trades in ~10.5 h**. Every `_market_run` skipped; the one trip that ran reported "nobody (0 visited, +0 emerald)" | **Hold.** On release, fold 16-20 into one entry: 704acf91..ccbd80b1, clean on live, 2,108/1, tier 3 |
| 17 | coalsale-02 | P | 2 | 140/46 | stacked | chain clean | as 16 | Hold, then fold |
| 18 | jobsite-01 | P | 2 | 197/3 | stacked | chain clean | as 16 | Hold, then fold |
| 19 | market-01 | P | 2 | 918/2 | stacked | chain clean | as 16 | Hold, then fold |
| 20 | market-02 | P | 2 | 471/40 | stacked | chain clean | as 16 | Hold, then fold |

Only three ready entries are S: stairuse-01, bamboowalk-01 and bucketfix-01. With the tier 1/2 P entries moved
owner-direct, the canary lane can still alternate P,S,P,S.

## The plan

**Canary lane.** Tier 3 entries, plus the tier-2 entries whose showcase pieces did not show the goal moving.

| order | run | lane | est. window (Z) |
|---|---|---|---|
| 1 | gkwork-01 | P | 11-07 ~15:20 to 18:30 |
| 2 | stairuse-01 | S | 18:30 to 21:45 |
| 3 | roughground-01 (with 02 folded in) | P | 21:45 to 11-08 01:00 |
| 4 | bamboowalk-01 (if its population is re-counted) | S | 01:00 to 04:15 |
| 5 | kittrim-01 | P | 04:15 to 07:30 |
| 6 | bucketfix-01 | S | 07:30 to 10:45 |

**Owner-direct lane:** pause30-01 (tier 1), stoneworks-01 (tier 2) and pathsfix-01 (tier 2, after its rebase).
- `rollout.py deploy` refuses unless the slot is empty, and the scheduler relaunches 2-3 min after a promotion.
- So the operator `queue hold`s the next entry just before a promotion, runs the deploy (90-min install-hold), then
  releases the hold.
- Three such rollouts add about 4.5 h.
- **Owner option:** stack the three on `45defefa` as one owner-direct sha. That is one 90-min window instead of three,
  and rollback is all-or-nothing.

**Cancel:**
- towngate-01: stale;
- cobblebank-01: no population;
- marks-01: its consumer is gone;
- roughground-02: folded into roughground-01.

**Hold on evidence:**
- forest-01 waits for a showcase forest harvest.
- The trade chain (coalsale-01/02, jobsite-01, market-01/02, villageunlock-01) waits for a showcase sale.
- Released, they add 2-3 canaries: the fold, villageunlock, and forest.

**Expected drain:**
- 6 canaries x ~3.3 h plus 3 owner-direct rollouts x 1.5 h comes to about **24-25 h**. Everything not held is done by
  about **11-08 15:00Z (~1 day)**, against 2.8 days as queued.
- The held work adds about 7-10 h once its evidence exists.
- Closing the idle gaps (23% of slot time) cuts both figures by about a fifth.

## Checks before each launch

- **roughground fold:** run `queue replace-variant roughground-01` with the 63d28320..6819822c patch (clean onto
  45defefa by merge-tree), and cancel roughground-02 in the same step.
- **pathsfix-01:** rebase onto 45defefa (conflicts in paths.mjs and skills.mjs), then one Codex blockers-only round on the
  rebased hunks.
- **stoneworks-01 and bucketfix-01:** run `queue set-patch`; their patch blocks have no diff hash.
- **bamboowalk-01:** count the wedged-in-bamboo rows on 11-07. Cancel if they are gone.
- **Trade chain release criterion:** one showcase `market_trip` with visited > 0 and earned > 0. Then fold it, and rebase
  villageunlock-01 (protectzone.mjs conflict).
- **forest-01 release criterion:** showcase `_build project=forest op=harvest` rows on forest-04 or later.
- **gkwork-01 read:** the gklease-01 drop (tidy places -64% at its promotion hour) confounds the read. Compare by town, and
  check that the towns gkwork targets have a keeper on the surface.

## Sources

- **Tiers:** `protected.py --base <base> --head <tip>` with main's list, run per entry.
- **Conflicts:** `git merge-tree --write-tree --merge-base=<base> 45defefa <tip>`, chains measured from their root.
- **Bundle rules:** `canary-sched.py bundle plan` on .31 (read-only), and `BUNDLE_MAX = 3` / tier-none in its source.
- **Showcase evidence:** the .40 skill streams 11-06 00Z to 11-07 14:20Z (13-15 bots, main's `lib/telemetry.stream_rows`).
- **Populations:** flowledger `history.jsonl` (town-chest cobble) and projectaudit `fleet-2026-11-07.md` (shafts).
- **Slot timing:** `~/canary-journal.jsonl` deployed/promoted rows, 11-04 to 11-07.

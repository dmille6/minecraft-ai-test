# Status 2026-10-16 (daily operator session, 11:07-11:55Z)

**Fleet `75cfb447`.** Two canaries were kept and promoted overnight by the host loop: wellsite-04 (the junk-well site fix, 8cd0bc62) at 19:33Z on 10-15, then townzone-01 (the town-ground keep-out, 75cfb447) at 05:02Z today. Both are merged on origin/main. The docs copy of STATE was a day behind and has been re-based on origin/main's entries.

| run | outcome | when |
|---|---|---|
| wellsite-04 | KEEP +360, promoted 8cd0bc62 | 10-15 19:23Z, promoted 19:33Z |
| townzone-01 | KEEP +360 (deaths 1 vs 3), promoted 75cfb447 | 10-16 04:52Z, promoted 05:02Z |
| cobblecap-1000 | deployed on placebo-a, hive-a | 10-16 05:32Z |
| cobblecap-1000 | +180 NOT_YET, +360 NOT_YET; extending | 08:38Z, 11:37Z |

**Canary cobblecap-1000 @ `623e92b9`** raises the town cobble cap from 256 to 1000 (the owner's 10-14 ask). The cap is visibly live on the canary arm: refusals at a counted cobble cap fell from 110 to 0 on the canary while control rose from 716 to 784, and placebo-a-Alpha banked 12 cobbled deepslate to a town total of 268 at 10:48Z. Canary deaths 0 over 60 bot-h against control 8 over 300. No defect gate tripped. The registered exposure line needs three such bank rows and has one, so the loop extends to +540 at 14:32Z.

**Why exposure is slow.** Hive-a cannot produce a bank row at all. Its town count has failed with a blocked chest lid on every one of 56 tries today, starting 00:13Z, five hours before the canary and on the base build (none on 10-15). While the count is incomplete every cobble deposit there is refused as unknown (114 refusals in six hours). That is a fleet defect, not a canary effect: one blocked lid closes a town's whole cobble bank. The candidate containers are named in STATE for the coordinator. Nothing in the world was changed.

**Decision rule recorded in STATE** for the +540 read: close INCONCLUSIVE early under the owner's 10-15 rule if exposure is still zero with fewer than two bank rows, then re-register the same code at the head of the queue with a draw requirement that a pool's town count completes; with two rows, let +720 at 17:32Z decide. If the loop keeps it, merge and wake the owner, and the four builds queued behind it need variants on the new tip. A wake-up in this session fires at 14:40Z to apply the rule.

**Queue after it:** toolkit-01, bamboo-02, treefarm-02, smeltjob-01 (all with 75cfb447 variants), plinth-01 (eligible now but has no 75cfb447 variant), townfloor-01 (its hold is satisfied; needs a merge onto the tip), minewell-02, monument-01 (held), stonewithdraw-01, shaft-01 (held). cobbleoverflow-01 is built and parked for zero exposure.

**Fleet in numbers** (Elasticsearch, 11:09Z):

| window | deaths | per active bot-h | drownings |
|---|---|---|---|
| 3 h (240 bot-h) | 5 | 0.021 | 3 |
| 24 h (1,920 bot-h) | 32 | 0.017 | 10 |
| 7 d (13,440 bot-h) | see fleetstatus | | |

Iron funnel, 24 h over 1,438 bot-h: raw iron 202 (0.14 per bot-hour, down from 326 five days ago), iron pickaxes crafted 28, gone 75, iron-pickaxe share of bot-hours 59.3%.

**Housekeeping.** The local checkout was 377 commits behind origin/main and is fast-forwarded to 743cb4f5. RULE.md on the host matches the repo. The local analyst is still stale (newest verdict 10-06).

**Waiting on the owner:** ziggurat decisions Z1-Z8; the llm.brain Elasticsearch mapping and the post-veto loop fix before brain-01; recovery after an unattended Studio reboot; whether a town below the cap with every chest full should send surplus cobble to the well (cobbleoverflow-01 is built for it).

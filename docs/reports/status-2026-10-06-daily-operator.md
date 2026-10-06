# Status 2026-10-06 — daily operator session (11:08Z–11:45Z)

## 11:45Z

**Canary.** withdraw-01 (b54e22c on board-b, placebo-a; fleet 47110e8 on the other 70) is still running and has no
decision yet. Its +360 read at 11:26Z said NOT_YET because exposure was too low. Exposure needs 5 canary withdraw orders
and there have been 2, which is expected when 9 of the 10 canary bots already carry a usable pickaxe. Both orders took
the pickaxe and none of the correctness checks G1–G4 fired. Deaths are 1 in 60 canary bot-hours vs 11 in 300 control
bot-hours. Bot-time without a usable pickaxe moved by DiD −0.125, which is reported only and sits inside the ±0.15 null
scale. The host loop takes the next reads at **14:22Z, 17:22Z, 23:22Z and 07:22Z 10-07**, with the deadline at 09:22Z 10-07.
climbflood-02 is chained behind it.

**Shadow mayor, decided: STOP building the deterministic assigner.** This decision was due 10-06 03:18Z and nothing had
been recorded, so this session ran the registered read: revision 2e82cfe81496, 11,008 snapshots, 80/80 bots covered,
with positive controls for every duty. Compared with the leased-random baseline the rule scores FREE_BAG 1.10 vs 1.05,
RESTORE_PICK 1.11 vs 1.11, GET_WOOD 0.72 vs 0.71 and GET_IRON 0.69 vs 0.70, so it picks bots no better than random. No
duty meets the act gate: the best downstream lift is 1.11x against the 1.5x needed, and the best executability is 78%
against the 80% needed. The need itself is real, about 180 bot-h/day of unforced FREE_BAG gap. The freeze on the mayor
files is lifted. Snapshot recording continues as the feed for the overseer/strategist work.

**Iron.** The 24 h funnel shows 252 raw iron (0.18/bot-h), up from 38 and then 93 on the two previous lines.

**This session did not** launch, deploy or tear down anything, and changed no code. The autonomous session owns the
queue on main.

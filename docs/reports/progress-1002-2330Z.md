# Progress report — 2026-10-02 23:30Z

## In one line
The ore tunnel works: every tunnel that ran reached the iron (3 of 3). What stops it is full backpacks and missing pickaxes.

## What worked
- **Pickaxe fix (fixes-03) is live on all 80 bots** since ~11:30Z: 1 good pickaxe lost vs 208 on unchanged bots.
- **Ore tunnel (oretunnel-03), first read at +3 h** (10 test bots vs 50 unchanged):
  - 12 tunnel attempts; **3 ran, 3 reached the ore, 3 iron collected** (unchanged bots: 0).
  - Tunnels were 3-27 blocks, down to y=46, 3-28 seconds each. No deaths linked to tunnels; no pickaxe loops.
  - Trapping fell on the test bots (8.9 -> 6.7 per bot-hour; unchanged bots 6.7 -> 6.0). Deaths 1 vs 6 (per hour lower).
  - Keep/revert verdict is possible at +6 h (~02:22Z).
- **Explore-toward is queued** (your request) and starts by itself when the ore test ends.

## What didn't work
- **9 of 12 tunnel attempts were refused for a full backpack** (2 bots, repeatedly). Bags are full of junk (leaf litter,
  saplings, bamboo), and the bank chests are full too, so "deposit first" often can't be done.
  Both AI reviewers rejected "drop the junk at the tunnel" (the bot walks back over its own pile).
- **The ghost-block fix (digsync2-01) was reverted** at 15:17Z by its own check: on these servers, a quiet server almost
  always means "slow to break", not "refused". Shelved; the tunnel does fine without it.
- **Few bots can try for iron at all:** 53 of 80 have no pickaxe, 52 of those have no wood, and 68% of attempts to chop
  trees fail because the remaining trees are hard to reach.

## Next steps
1. ~02:22Z: ore tunnel keep/revert (automatic). Then explore-toward starts (automatic) - it aims bots at the trees.
2. Build: let the tunnel count free space in stacks the bot already has (not just empty slots), so a bag with room
   in its cobblestone stack is not refused. Small, testable.
3. Bigger: a real way to get rid of junk (burial or a composter, both designed) and stop escapes burning wood.

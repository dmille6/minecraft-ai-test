Found **3 blockers**. Read-only review; focused in-memory checks reproduced all three scheduling failures.

1. **BLOCKER — No-site cane bed blocks later projects.** [skills.mjs:23421](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/skills.mjs:23421) checks the 30-minute backoff only inside the visit. The picker never marks canefarm waiting, so it remains the first eligible open project. The generic `no_site` gate then suppresses orders without selecting later projects. Put the waiting condition into project selection.

2. **BLOCKER — No cane anywhere leaves an unfinished bed permanently active.** [skills.mjs:23481](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/skills.mjs:23481) treats open cells as done when the bag is empty, but line 23484 refuses to mark that record complete. Visits therefore return `complete` with zero progress while the project stays open. `buildIdle` also rejects this combination. Later projects remain starved; the bed needs a material-wait state that yields the order.

3. **BLOCKER — Workshop retry can remain 24 hours, not 30 minutes.** [skills.mjs:19821](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/skills.mjs:19821) starts the new timer but still returns `no_site`. If no intervening build visit changes that bot’s last stop, [shop.mjs:759](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/shop.mjs:759) applies the existing 24-hour retry gate after the workshop reopens. Reproduced at minute 31: `{ order: null, skip: 'no_site' }`.

Other requested checks:

- **Harvest:** second-block coordinates plus immediate name checks prevent digging the bottom or a replacement block ([skills.mjs:23388](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/skills.mjs:23388)).
- **Movement:** stands require dry solid footing; walks cannot dig or bridge. Routes can still swim across ponds; I found no concrete new death/trap blocker. No live movement test performed.
- **Bank:** the own-stock floor is preserved; `matsBank` uses deposits with recovery disabled. No demonstrated discard or park-stock theft.
- **Dry cells:** skipped and allowed to complete, so they alone do not hold the order.
- **Placement:** cardinal water at soil level is valid vanilla geometry. **NOT-BLOCKER:** `CANE_SOIL` additionally accepts `suspicious_gravel`, which is not valid cane substrate ([canefarm.mjs:40](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/canefarm.mjs:40); [placement reference](https://minecraft.wiki/w/Sugar_Cane)).

VERDICT: BLOCK (3 blockers)
done
Reviewed `8a41a91` (`git show HEAD`). All three blockers are resolved:

1. No-site cane beds now wait town-wide; project selection skips them after its cache refresh.
2. Open cells with no cane in bag or town can complete the bed; upkeep replants when cane arrives.
3. Workshop siting failures return `site_wait`, bypassing the order’s 24-hour `no_site` gate.

No new blocker found in the fix.

Read-only review; syntax checks passed. Test suites weren’t run because they write files.

VERDICT: PASS — all three blockers resolved; no new blockers found.
done

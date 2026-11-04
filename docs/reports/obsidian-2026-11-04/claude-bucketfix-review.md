# bucketfix-01 review (Claude, independent subagent, 11-04)

**r1: BLOCK (1).** The claimed bug is real (mineflayer 4.37.1 physics.js: `bot.lookAt` starts with `point.minus(...)`; the aims were
plain objects; vec3's offset returns a Vec3). The only caller of scoopLiquid / pourLiquid is `bucketSkill` (the model's `bucket` verb);
no reflex calls them (scoopWouldHelp only logs). Fill, newly live: low risk (scoopRefusal refuses lava, flowing water, a refilling
source; zone and reach checks). **Pour, newly live: the blocker** -- the candidates were tried head cell first, and the feet-cell guard
compared a fractional target position with the floored feet, so it never fired: every pour aimed into the bot (a head-height source in a
1x1 shaft or a pocket is a drowning; verification would read dry and invite a loop). Note: the fill detail read fields scoopLiquid does
not return.

**Fix round (88c981a1): APPROVE.** Targets from the floored feet cell; emptyRefusal compares cells and refuses the feet and head cells;
the fill detail reads `r.reason`; the zone checks move by less than a block and the reach check uses offsets. Remaining pours (beside the
head/feet, the hole under the feet) are the designed behaviour for the canary read.

# P1 North Pit: the pond finish (plan only, not built)

The pit is dug by `pit-01show` (bots/src/pit.mjs). This page plans the piece that finishes it as a pond. That piece is not built
yet. It goes after the dig reads done (`_pit op=done`) and after the owner sees the bowl.

Pictures: `pit-top.png` and `pit-iso.png` (the designed bowl), plus the rig's before/after.

## What the dig leaves

- **The bowl.** A curved cove about 15 x 21 at (-51, -99). The floor's top is at y60. The banks rise 1 block per column to the
  ground round it, at y62-65, so there are no 2-high steps.
- **The rim.** About 26 outline columns are never dug, because water is within 3 of them: the frozen sea to the east (x >= -42) and the lake to
  the west (x <= -61). The rim stays at its ground height (y62-64). The sea's surface is y62. This means the bowl's floor at y60 lies 2 below
  the sea, with 3+ columns of solid ground between them.
- **Set-aside cells.** The sea guard sets aside any cell that would have opened toward water. Cells no stand reached are set aside
  too (three high leaves on the 11-18 copy). They are listed in the record's `setAside` / `aside`.
- **Held columns.** A few columns hold a leftover lid over a cave that runs below the bowl (`cave_under`: five on the 11-18 copy, near
  (-55..-54, -94) and (-46..-45, -98..-97)). They stand as small humps in the floor.
- **Floating canopies.** Spruce tops hang over the site with no trunk under them: five trunks and about 400 leaves, already floating
  before the dig. They are not the pit's to take.

## The finish, in order

1. **Make the floor whole.** Fill each `cave_under` hole and each set-aside cell to the bowl's height. Use dirt below and dirt on top,
   never cobblestone on top. Take the floating canopies down: the logs go to the town and the leaves are dug.
2. **Water it, on purpose and in one controlled step.** Two ways (the owner picks):
   - **A. Pond (closed, the default).** Keep the rim. Place water sources from buckets on the floor's centre ring: 4-6 sources at
     y61 make the infinite-water spread. Let it level at y61 (one block deep at the edge, two in the middle). The sea is never
     opened. This is the safe choice and fits the "pond" in the owner's words.
   - **B. Cove (open to the bay).** Cut ONE 2-wide channel through the east rim at the narrowest point, near (-44..-43, -100). Dig it from
     the pond side out, its floor at y61, and lay a stone sill first. The last block toward the ice comes out only when the pond
     already holds water to y61. That way the sea meets standing water, not a dry hole, and nothing floods past the bowl. This is
     the only cell ever dug toward the sea, and the guard is lifted for that one cell only, by the finish's own record.
3. **The dock.** A spruce boardwalk dock on the south bank, off the path's end: 3 wide, 5 out over the water at y62, on posts,
   with a lantern on the end post. The woodworks code already builds boardwalks: reuse its blueprint.
4. **The path.** A 2-wide dirt-path track from the north port (-35, -89) to the dock. It takes the existing grass line along the
   point and has no steps over 1: the bowl's banks are already 1:1.
5. **The edge planting.** Sugar cane on the waterline's sand or dirt cells: every second edge cell on the north and west shores, where water is next
   to the block (cane needs it). Flowers on the banks above: cornflower, oxeye daisy and poppy, the owner's "cherry/flowers"
   reference. Leave the south bank's grass open for the dock and the path.
6. **Read it.** Take a top-down and an iso picture, check that no water outside the pond moved (a positive control: the sea's edge
   cells are the same before and after), and show the owner.

## Guards the finish keeps

- Water goes in only from buckets, or through the one channel in option B, never through a guard-refused cell.
- No placement by command. Bots place the water, the dock and the plants.
- The rim's columns stay solid in option A. In option B, every rim column but the channel's stays solid.

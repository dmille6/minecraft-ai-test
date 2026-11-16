// FILLCOLUMN-01 r2 (Codex review, blocker 3). PURE, no imports: every counter of a record's waiver ROOM reads it from here.
//
// A record's `waived` map is read by every done test (a waived cell counts done). It is also the stuck waiver's BUDGET: wall.mjs
// wallWaiveDue (the visit's waiver; the groundskeeper's room is a tenth of the stage, tidy.mjs gkWaiveOpts), gkwork.mjs stallWaive and
// leftWaiveDue and planahead.mjs puWaiveDue (a quarter of the stage) all take their room from the map's size. The column repair
// (fillcolumn.mjs) names the cells it leaves out, and the cells resting on a waived cell, on the same map so that every done test reads
// them -- but they are no stuck cell: their reason starts `fillcolumn:` and NO stuck-waiver counter counts them (stuckWaivedN). They
// have a cap of their own (fillcolumn.mjs repairOutMax, counted by repairWaivedN): at it a column is simply not repaired.
/** A waiver the column repair wrote (its reason's prefix). */
export const REPAIR_WHY = /^fillcolumn:/
export const isRepairWaiver = v => REPAIR_WHY.test(String(v?.why ?? ''))
/** THE STUCK WAIVER'S OWN COUNT -> n: every waived entry that is not the column repair's. Pure. */
export function stuckWaivedN (waived) {
  let n = 0
  for (const v of Object.values(waived && typeof waived === 'object' ? waived : {})) if (!isRepairWaiver(v)) n++
  return n
}
/** THE COLUMN REPAIR'S OWN COUNT -> n: the cells it left out and the cells waived with a waived cell. Pure. */
export function repairWaivedN (waived) {
  let n = 0
  for (const v of Object.values(waived && typeof waived === 'object' ? waived : {})) if (isRepairWaiver(v)) n++
  return n
}

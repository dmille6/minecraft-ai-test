// THE BLOCK A PLACEMENT CLICKS (spentpick-01show). Pure, so the decision is tested as behaviour (test/craft-room.test.mjs).
import { Vec3 } from 'vec3'
import { INTERACTABLE } from './buildbot.mjs'

/** Does a click on this block open, toggle or act on it instead of placing against it? */
export const opensOnClick = b => INTERACTABLE.test(b?.name ?? '')

/**
 * THE BLOCK A PLACEMENT CLICKS, for the cell `target` -> { ref, face } | null. Pure over blockAt.
 * The block under the cell, its top face -- UNLESS A CLICK OPENS IT (buildbot.mjs INTERACTABLE: a crafting table, a furnace,
 * a chest, a door...). The server answers a click on one of those by opening it and places nothing, so the placement
 * waits out its 3 s for a block that never comes. Showcase Frost, 11-15/16: sealed in a one-block cell, the only free
 * cell in reach stood on the crafting table it had put down at 21:21:59Z (the saved region shows the table at -74,49,90);
 * 29 of 29 `place crafting_table` ended "placing exceeded 3000ms", and the slot that table holds is the one the stick
 * craft needed. Then: a solid side neighbour of the cell that does not open, clicked on the face toward the cell;
 * none -> null, and the cell is no candidate. `okRef(pos)` lets the caller refuse a reference (a protected zone's block).
 */
export function placeRefFor (bot, target, okRef = () => true) {
  const at = d => { try { return bot.blockAt?.(new Vec3(Math.floor(target.x) + d[0], Math.floor(target.y) + d[1], Math.floor(target.z) + d[2])) ?? null } catch { return null } }
  const clicks = b => b != null && b.boundingBox === 'block' && !opensOnClick(b)
  const under = at([0, -1, 0])
  if (clicks(under)) return { ref: under, face: new Vec3(0, 1, 0) }
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const b = at(d)
    if (clicks(b) && b.position && okRef(b.position)) return { ref: b, face: new Vec3(-d[0], 0, -d[2]) }
  }
  return null
}

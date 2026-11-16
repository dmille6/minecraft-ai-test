// THE BLOCK A PLACEMENT CLICKS (spentpick-01show). Pure, so the decision is tested as behaviour (test/craft-room.test.mjs).
import { Vec3 } from 'vec3'
import { INTERACTABLE } from './buildbot.mjs'

/**
 * A click on this block ALWAYS goes to the block, whatever is in the hand: it opens a window, toggles, or is used. A
 * placement against it never lands. (Not the conditional ones -- a lodestone wants a compass, a composter something
 * to compost, a jukebox a disc, an iron door a signal: a block in the hand places against those, as it always did.)
 */
const ALWAYS_TAKES_THE_CLICK = new RegExp('^(crafting_table|crafter|furnace|blast_furnace|smoker|chest|trapped_chest|ender_chest|barrel|hopper|' +
  'dropper|dispenser|brewing_stand|anvil|chipped_anvil|damaged_anvil|grindstone|stonecutter|loom|cartography_table|smithing_table|' +
  'enchanting_table|beacon|note_block|repeater|comparator|daylight_detector|lever)$|shulker_box$|_bed$|_button$|_fence_gate$|_sign$|' +
  '(?<!iron)_trapdoor$|(?<!iron)_door$')
export const opensOnClick = b => ALWAYS_TAKES_THE_CLICK.test(b?.name ?? '')
/** A click on this block MAY act on it (buildbot.mjs INTERACTABLE, the builders' wider list): a better reference is preferred. */
export const mayActOnClick = b => opensOnClick(b) || INTERACTABLE.test(b?.name ?? '')

/**
 * THE BLOCK A PLACEMENT CLICKS, for the cell `target` -> { ref, face } | null. Pure over blockAt.
 * The block under the cell, its top face -- UNLESS A CLICK OPENS IT (buildbot.mjs INTERACTABLE: a crafting table, a furnace,
 * a chest, a door...). The server answers a click on one of those by opening it and places nothing, so the placement
 * waits out its 3 s for a block that never comes. Showcase Frost, 11-15/16: sealed in a one-block cell, the only free
 * cell in reach stood on the crafting table it had put down at 21:21:59Z (the saved region shows the table at -74,49,90);
 * 29 of 29 `place crafting_table` ended "placing exceeded 3000ms", and the slot that table holds is the one the stick
 * craft needed. Then: a solid side neighbour of the cell that takes no click at all, clicked on the face toward the cell.
 * With none: the block under the cell after all when it only MAY act (a lodestone, a composter: the old answer, never
 * dropped -- review r1), and null when it always takes the click: that cell is no candidate.
 * `okRef(pos)` lets the caller refuse a side reference (a protected zone's block).
 */
export function placeRefFor (bot, target, okRef = () => true) {
  const at = d => { try { return bot.blockAt?.(new Vec3(Math.floor(target.x) + d[0], Math.floor(target.y) + d[1], Math.floor(target.z) + d[2])) ?? null } catch { return null } }
  const solid = b => b != null && b.boundingBox === 'block'
  const under = at([0, -1, 0])
  const top = () => ({ ref: under, face: new Vec3(0, 1, 0) })
  if (solid(under) && !mayActOnClick(under)) return top()
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const b = at(d)
    if (solid(b) && !mayActOnClick(b) && b.position && okRef(b.position)) return { ref: b, face: new Vec3(-d[0], 0, -d[2]) }
  }
  return solid(under) && !opensOnClick(under) ? top() : null
}

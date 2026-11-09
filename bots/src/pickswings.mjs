// IRONCHAIN-02 (C; docs/reports/ironchain-2026-11-09.md): AN IRON PICKAXE ASKED FOR SWINGS, WITH NO IRON IN THE BAG, IS A STONE ONE.
//
// MEASURED (fleet .31, 12 h to 11-09 ~14:30Z, decision stream): 110 model `craft iron_pickaxe` decisions ended "cannot craft
// iron_pickaxe -- short 3x iron_ingot for the whole tree" (104 of them under the iron rung's TASK). 95 of the 110 came from
// bots that already held 2+ usable pickaxes and an iron one with more than 10 uses -- tool hygiene would have refused them as
// redundant (toolhygiene.mjs redundantCraft) but for ONE of its own exemptions: the bag's pickaxe swings were below what a
// descent from the bot's depth keeps in reserve (exit-contract.mjs descentPickNeed; 64 of the 95 at y <= 16). That exemption is
// right -- `mine` refuses below that line and its remedy is another pickaxe -- but it admits the iron one, which the bag cannot
// make. Every one of them failed, and the next decision asked again.
//
// THE RULE (pure): a craft of iron_pickaxe that tool hygiene admits ONLY for a swing reserve (the same call, asked without the
// depth and the recorded `mine` shortfall, would refuse it), from a bag with fewer than 3 iron ingots, is REWRITTEN to
// stone_pickaxe when the bag can make one (the caller's whole-tree plan). The stone copy adds ~130 swings (the reserve's
// need at y=-50 is ~131), it is made from what a deep bot carries (cobblestone/deepslate + a stick), and it is a craft the
// SAME exemption admits. The bot's tier is untouched: it already holds an iron copy with uses (that is the condition), and
// toolFor digs iron-tier blocks with it. Nothing the task wants is ever rewritten (`wanted`), and nothing else is.
// Deterministic, not advice: the rewritten args are what cognitive.mjs runs (admission.mjs rewrites block names the same way).
//
// Rollback: PICKSWINGS=0 -> the iron craft is admitted as before.
import { redundantCraft } from './toolhygiene.mjs'

export const pickSwingsOn = (env = process.env) => String(env?.PICKSWINGS ?? '1').trim() !== '0'
export const PICKSWINGS = pickSwingsOn(typeof process !== 'undefined' ? process.env : {})
export const IRON_PICK_INGOTS = 3

/**
 * swingRewrite({ item, items, wanted, y, exitShort, stoneMakeable, on }) -> null (leave it) | { from, to, detail }
 *   items          the bag (mineflayer Item[])
 *   wanted         the active task's wanted set (never rewritten when it names the iron pickaxe)
 *   y, exitShort   what tool hygiene was given (the swing-reserve exemptions)
 *   stoneMakeable  () => boolean: the caller's whole-tree plan for ONE stone_pickaxe from this bag succeeds
 */
export function swingRewrite ({ item, items = [], wanted = null, y = null, exitShort = null, stoneMakeable = () => false, on = PICKSWINGS, now = Date.now() } = {}) {
  if (!on || item !== 'iron_pickaxe') return null
  const bag = Array.isArray(items) ? items : []
  const ingots = bag.filter(it => it?.name === 'iron_ingot').reduce((n, it) => n + (it.count ?? 1), 0)
  if (ingots >= IRON_PICK_INGOTS) return null                                   // the iron craft can run: leave it
  // admitted WITH the reserve exemptions, refused WITHOUT them: the reserve is the only reason it was admitted
  if (redundantCraft(item, bag, { wanted, y, exitShort, now }) != null) return null   // hygiene refuses it anyway
  const bare = redundantCraft(item, bag, { wanted, y: null, exitShort: null, now })
  if (bare == null) return null                                                  // admitted for something else (no usable iron copy, the task, ...)
  let ok = false
  try { ok = !!stoneMakeable() } catch { ok = false }
  if (!ok) return null                                                           // no stone copy from here: the craft's own refusal stands
  return { from: item, to: 'stone_pickaxe', held: bare?.held ?? null, uses: bare?.uses ?? null,
    detail: `iron_pickaxe -> stone_pickaxe: you hold a ${bare?.held} with ${bare?.uses ?? '?'} uses but too few swings for the climb out from here, ` +
            `and ${ingots}x iron_ingot (an iron pickaxe needs ${IRON_PICK_INGOTS}); a stone pickaxe adds the swings from what you carry` }
}

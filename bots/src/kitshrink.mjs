// THE SMALLER CARRIED KIT (kitshrink-01; OWNER 10-16 ~16:30Z "yes shrink": the one-of-each kit bots carry, so bags have room
// for work). Design and evidence: docs/reports/kitshrink-01-2026-10-16.md.
//
// MEASURED 10-16 (80 bots, latest bag each): bags 2,675 of 2,880 slots; 68 bots carry torches (median 4) and 68 carry
// ladders (median 3, max 17). Neither has an exit: bankable.mjs judged both `not_wanted` (never banked) and the junk well
// never takes a torch (well.mjs NEVER_DISPOSE) or a ladder (on no list). Neither has a deterministic consumer that a bag of
// these sizes can feed:
//   torch   no survival, escape, milestone or town-order code reads one (worlds are peaceful); 0 torch crafts succeeded and
//           1 was placed fleet-wide in 24 h;
//   ladder  the ONE consumer is the stranded-escape rung climb_ladder, and it needs LADDER_ESCAPE_MIN ladders
//           (ladder.mjs ladderPlan for the LADDER_CLIMB_NEED-block climb): with fewer the rung is never chosen. 0 of 80
//           bots hold that many, and climb_ladder was chosen 0 times in 10,972 stranded escape tries over 8 days.
// So both become BANKABLE -- ladders only below the escape minimum; a bag at or above it keeps every ladder.
//
// WHAT STAYS, ON PURPOSE:
//   crafting_table, furnace, bucket   the tech ladder (milestones.mjs TECH_LADDER) is satisfied by HOLDING them, and the
//                                     pickaxe / bucket / smelt rungs' means read the CARRIED table and furnace: banking
//                                     one re-opens its rung next lap (the bucket costs 3 iron). bankable.mjs KEEP_ONE.
//   chest                             the full-town deposit recovery PLACES the carried chest (chestfull.mjs
//                                     fullChestNext 'place_carried'); without one it must craft one from a full bag, and a
//                                     chest banked into a town's last empty slot leaves exactly that bag behind (Codex
//                                     design review P1).
//   glass, ink sacs, dripstone, leads, rails, eggs, flint   already the junk well's (well.mjs); they stay only where no well
//                                     stands, which plinth-01 fixes. Never banked: the owner's 10-04 "never deposit junk".
import { LADDER_CLIMB_NEED, ladderEscapeMin } from './ladder.mjs'

/** The fewest ladders the stranded-escape rung can use -- asked of ladderPlan, never restated. */
export const LADDER_ESCAPE_MIN = ladderEscapeMin(LADDER_CLIMB_NEED)

/** The kit items this change makes bankable. */
export const KIT_BANK = Object.freeze(['torch', 'ladder'])
const KIT_SET = new Set(KIT_BANK)

/**
 * THE KIT NEVER MAKES A TRIP (Claude design r1 P2-3): the craft room order's FAR branch (skills.mjs roomRemedy / slotRemedy
 * `home`) passes these as `keep`, so a bot far from the bank is never sent home to bank a torch or a ladder. Kit leaves the
 * bag only where the bot already is: the town deposit, the deposit verb near storage, withdraw's room-making at the chest.
 */
export const KIT_NO_TRIP = Object.freeze(KIT_BANK.map(name => Object.freeze({ name, count: 1 })))

/** KIT_SHRINK=on|off, default on; anything else reads as on and the process says so in its `_kitshrink` mode row. Pure. */
export function kitShrinkMode (env = {}) {
  const raw = env?.KIT_SHRINK
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: null }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `KIT_SHRINK=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const KIT_SHRINK = Object.freeze(kitShrinkMode(typeof process !== 'undefined' ? process.env : {}))

/**
 * MAY THIS KIT ITEM BE BANKED FROM A BAG HOLDING `held` OF IT? -> 'bank' | 'escape_ladders' | null. Pure.
 *   null            not a kit item this rule covers (or the switch is off): the base rules decide
 *   'bank'          torch, or ladders below LADDER_ESCAPE_MIN: banked whole, like a wanted item
 *   'escape_ladders' a bag holding LADDER_ESCAPE_MIN+ ladders: every one stays (the escape can use them)
 */
export function kitBankDecision (name, held, { on = KIT_SHRINK.on } = {}) {
  if (!on || !KIT_SET.has(name)) return null
  if (name === 'ladder' && !(Number(held) < LADDER_ESCAPE_MIN)) return 'escape_ladders'
  return 'bank'
}

/** The stations and the bucket a bank must never take the last of (bankable.mjs KEEP_ONE): the bank row reports them. */
export const KIT_KEPT = Object.freeze(['crafting_table', 'furnace', 'bucket'])

/**
 * THE BANK ROW (`_kitshrink phase=bank`), written by the town deposit when the bag held a kit item at its start or the
 * visit banked one. BOUNDED and FIRST (both design reviews r2: the town_deposit row sorts `banked` by count and cuts at
 * 300, so torches and ladders were the names that fell off): every field is `name=before:banked`, the counts at the START
 * of the run (the skill's own heldBefore, never after + banked -- a pickup during the run would fake it) and what the
 * SERVER showed in the chest on the re-open. Pure.
 */
export function kitBankDetail ({ via = 'town_deposit', heldBefore = {}, banked = {}, slotsBefore = null, slotsAfter = null } = {}) {
  const f = n => `${n}=${Math.max(0, Number(heldBefore?.[n]) || 0)}:${Math.max(0, Number(banked?.[n]) || 0)}`
  return `phase=bank via=${via} ${[...KIT_BANK, ...KIT_KEPT].map(f).join(' ')} slots=${slotsBefore ?? '?'}->${slotsAfter ?? '?'}`
}
/** Does this run need a bank row: a kit item held at the start, or banked? Pure. */
export const kitBankRowDue = (heldBefore = {}, banked = {}) => KIT_BANK.some(n => (Number(heldBefore?.[n]) || 0) > 0 || (Number(banked?.[n]) || 0) > 0)

/** The licence row's detail (once per process). */
export function kitShrinkModeDetail (mode = KIT_SHRINK) {
  return `phase=mode on=${mode.on ? 1 : 0} mode=${mode.mode} kit=${KIT_BANK.join(',')} ladder_min=${LADDER_ESCAPE_MIN}${mode.note ? ` note=${String(mode.note).replace(/\s+/g, '_')}` : ''}`
}

// THE PERSONAL WOOD KEEP (logbank-01, OWNER 2026-10-27: "bank their logs at the town and keep only a small personal amount").
//
// Measured on the showcase (10.0.0.40) 10-27: 10 bots held 64-73 logs each (~660) while the 8 town chests held 0, so the
// workshop's stone_bricks (mats.mjs kind bricks: 12 cobble + 2 logs) could not be made. The town deposit kept wood to 64
// because the stockpile_wood rung asked the bot to HOLD 64; a deposit below it re-opened a gather rung. Both now read this
// ONE number, so depositing down to it never re-opens the rung.
//
// WHY 16 IS ENOUGH for what a bot does alone (wood units = logs + planks/4):
//   crafting table 4 planks = 1; sticks for a wooden + stone pickaxe, axe and shovel (8 sticks = 4 planks) = 1;
//   a wooden pickaxe 3 planks = 0.75; the scaffold reserve (bankable.mjs scaffoldKeep) 8 blocks -- logs only when the bag
//   has no cheaper scaffold (cobble/dirt), worst case 8; the bot's own smelting fuel for IRON_KEEP 3 ingots: 1 log = 1.5
//   smelts, 2 logs. Worst case 1 + 1 + 0.75 + 8 + 2 = 12.75 <= 16. A founding chest (8 planks = 2) is found.mjs's own floor.
//
// KILL SWITCH: LOGBANK=off restores 64 (the stockpile ceiling and the deposit keep) and turns off the log half-split.
export const LOGBANK = Object.freeze({ on: String(process.env.LOGBANK ?? '').trim().toLowerCase() !== 'off' })
export const WOOD_KEEP_ON = 16
export const WOOD_KEEP_OFF = 64
/** The personal wood keep in wood units: the stockpile_wood rung's ceiling AND the town deposit's wood keep. */
export const WOOD_KEEP = LOGBANK.on ? WOOD_KEEP_ON : WOOD_KEEP_OFF

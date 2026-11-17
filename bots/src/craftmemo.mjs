// THE CRAFT REFUSAL MEMO (craftmemo-01show, docs/reports/craft-failures-2026-11-17.md).
//
// Measured 11-17 06-12Z on the showcase (265 crafts, 200 failed): a craft refused for a missing input, a refused table
// placement or a full bag was proposed again with the SAME bag from the SAME spot -- short-iron 23, bag-room 39 repeats in
// 30 min, and one bot (Comet) 104 of 104 crafts into a protected zone over 4 h. Nothing remembered the refusal.
//
// So each bot keeps a memo: (item, the bag's signature, the 8-block cell it stood in). While all three are unchanged the
// craft is refused at admission and left out of CAN CRAFT NOW. ANY change to the bag or a move to another cell lifts it --
// the remedy each refusal named (gather, deposit, walk elsewhere) is exactly such a change, so the refusal never strands
// the bot. A success clears the item; an entry also expires after MEMO_TTL_MS so a world change it cannot see (a chest
// refilled, a zone lifted) is retried.

export const MEMO_CELL = 8
export const MEMO_TTL_MS = 30 * 60_000

/** Which refusal is this craft result -> 'short' | 'station' | 'room' | null. Pure. */
export function craftRefusalKind (r) {
  if (!r || r.status === 'success') return null
  const d = String(r.detail ?? '')
  if (r.failClass === 'needs_station' || /could not put down a crafting_table|putting it down failed/.test(d)) return 'station'
  if (r.failClass === 'inventory_full' || r.gap === 'inventory_space') return 'room'
  if (r.failClass === 'missing_ingredients' || /cannot craft \S+ -- (short|gather)/.test(d)) return 'short'
  return null
}

/** The bag as a stable string: name:count, sorted. Pure. */
export function bagSignature (items = []) {
  const n = new Map()
  for (const it of Array.isArray(items) ? items : []) if (it?.name) n.set(it.name, (n.get(it.name) ?? 0) + (it.count ?? 1))
  return [...n].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}:${v}`).join(',')
}

/** The 8-block cell a position is in, as "cx,cy,cz" | null. Pure. */
export function memoCell (pos) {
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return null
  return [pos.x, pos.y, pos.z].map(v => Math.floor(v / MEMO_CELL)).join(',')
}

/** Record (or clear, on success) the outcome of a craft of `item` in `memo` (a Map). Pure apart from the Map. */
const reqCount = c => Math.max(1, Math.floor(Number(c ?? 1) || 1))

export function noteCraftResult (memo, { item, result, items, pos, count = 1, now = Date.now() }) {
  if (!(memo instanceof Map) || typeof item !== 'string') return null
  if (result?.status === 'success') { memo.delete(item); return null }
  const kind = craftRefusalKind(result)
  if (!kind) return null
  const e = { item, kind, count: reqCount(count), sig: bagSignature(items), cell: memoCell(pos), at: now, detail: String(result?.detail ?? '').slice(0, 160) }
  memo.set(item, e)
  return e
}

/** The memo entry that holds `item` back NOW -> entry | null: same bag, same cell, not expired. Pure. */
export function craftMemoHolds (memo, { item, items, pos, count = 1, now = Date.now() }) {
  const e = memo instanceof Map ? memo.get(item) : null
  if (!e) return null
  if (!(now - e.at < MEMO_TTL_MS)) return null
  if (e.sig !== bagSignature(items)) return null
  if (e.cell !== memoCell(pos)) return null
  // A SMALLER REQUEST IS A DIFFERENT CRAFT (codex review r1): 'short for 2' says nothing about 1 from the same bag.
  if (e.kind === 'short' && reqCount(count) < (e.count ?? 1)) return null
  return e
}

const REMEDY = {
  short: 'gather the missing input first (any change to the bag lifts this)',
  station: `walk ${MEMO_CELL}+ blocks away (out of the protected area) and craft there, or carry the input to a placed crafting_table`,
  room: 'deposit at the town chests or drop junk first (any change to the bag lifts this)',
}
/** The admission refusal's words: what was refused and the move that lifts it from here. Pure. */
export function craftMemoDetail (e) {
  const mins = Math.round(MEMO_TTL_MS / 60_000)
  return `craft ${e.item} was just refused with this same bag at this same spot (${e.kind}: ${e.detail.slice(0, 100)}) -- ` +
         `${REMEDY[e.kind] ?? 'change the bag or move'}; it is retried after ${mins} min regardless`
}

/** The walk a protected-zone placement refusal names -> {x, y, z} | null ("reason=protected_zone goto X Y Z ..."). Pure. */
export function zoneWalkTarget (detail) {
  const m = /reason=protected_zone goto (-?\d+) (-?\d+) (-?\d+)/.exec(String(detail ?? ''))
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null
}

// ---- THE GATHER REFUSAL MEMO (gathermemo-01show) ----
//
// Measured 11-17 10:32-13:32Z on the showcase (14 bots, 747 gathers, 389 failed): a failed gather was re-proposed for
// the same block kind by the same bot within 30 min after 328 of 391 refusal-type failures; 182 of those from the same
// 16-block cell, and only 4 of those 182 repeats then succeeded. The biggest shapes: "found but unreachable" 250 (dirt
// 130), "beside water" 48, "buried" 36, "no ... open to the sky" 18. So: a gather that failed for a reason of THIS PLACE
// is refused for that block kind while the bot stays in the same 16-block cell. A move out of the cell, another kind,
// a success or GATHER_TTL_MS lifts it. Transient failures (stuck, stagnation, entombed, aborted, ran out of time) are
// not remembered: they say nothing about the place.
export const GATHER_CELL = 16
export const GATHER_TTL_MS = 30 * 60_000
const GATHER_TRANSIENT = /^(stuck|stagnation|entombed|aborted|interrupted)\b|ran out of time|did not return|threw (GoalChanged|Error)/
// NOT THE PLACE (codex review r1): a full bag reported through the buried-ore path ("[mine said: no room ... deposit
// first]") is lifted by a deposit in the same cell, so it is not a refusal of the place; and "all N candidate(s) in range
// refused" is also what a run says after its one candidate merely timed out, so it is not evidence about the place.
const GATHER_NOT_PLACE = /no room|deposit first|inventory_full|bag is|candidate\(s\) in range refused/

/** Is this gather result a refusal of the place -> 'place' | null. Pure. */
export function gatherRefusalKind (r) {
  if (!r || r.status === 'success' || r.status === 'aborted') return null
  if (r.failClass === 'collect_budget') return null
  const d = String(r.detail ?? '')
  if (!d || GATHER_TRANSIENT.test(d)) return null
  if (r.failClass === 'inventory_full' || GATHER_NOT_PLACE.test(d)) return null
  return /found but unreachable|beside water|under falling|every candidate is buried|open to the sky|candidate\(s\) are floors|no \S+ (found|within|nearby)/.test(d) ? 'place' : null
}

export function gatherCell (pos) {
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return null
  return [pos.x, pos.y, pos.z].map(v => Math.floor(v / GATHER_CELL)).join(',')
}

/** Record (or clear, on success) a gather of `block` in `memo`. Pure apart from the Map. */
export function noteGatherResult (memo, { block, result, pos, now = Date.now() }) {
  if (!(memo instanceof Map) || typeof block !== 'string') return null
  const key = `gather:${block}`
  if (result?.status === 'success') { memo.delete(key); return null }
  if (!gatherRefusalKind(result)) return null
  const cell = gatherCell(pos)
  if (!cell) return null
  const e = { block, cell, at: now, detail: String(result?.detail ?? '').slice(0, 160) }
  memo.set(key, e)
  return e
}

/** The entry holding a gather of `block` back NOW -> entry | null: same 16-block cell, not expired. Pure. */
export function gatherMemoHolds (memo, { block, pos, now = Date.now() }) {
  const e = memo instanceof Map ? memo.get(`gather:${block}`) : null
  if (!e) return null
  if (!(now - e.at < GATHER_TTL_MS)) return null
  if (e.cell !== gatherCell(pos)) return null
  return e
}

export function gatherMemoDetail (e) {
  return `gather ${e.block} just failed here (${e.detail.slice(0, 100)}) -- walk ${GATHER_CELL}+ blocks away and try there, ` +
         `or gather another kind; retried here after ${Math.round(GATHER_TTL_MS / 60_000)} min regardless`
}

// ---- the bot's own memo (the runtime seam) ----
const memoOf = bot => (bot ? (bot.craftMemo instanceof Map ? bot.craftMemo : (bot.craftMemo = new Map())) : null)
export function noteCraftOutcome (bot, item, result, count = 1) {
  try { return noteCraftResult(memoOf(bot), { item, result, count, items: bot.inventory?.items?.() ?? [], pos: bot.entity?.position }) } catch { return null }
}
export function craftMemoFor (bot, item, count = 1) {
  try { return craftMemoHolds(bot?.craftMemo, { item, count, items: bot.inventory?.items?.() ?? [], pos: bot.entity?.position }) } catch { return null }
}
export function noteGatherOutcome (bot, block, result) {
  try { return noteGatherResult(memoOf(bot), { block, result, pos: bot.entity?.position }) } catch { return null }
}
export function gatherMemoFor (bot, block) {
  try { return gatherMemoHolds(bot?.craftMemo, { block, pos: bot.entity?.position }) } catch { return null }
}

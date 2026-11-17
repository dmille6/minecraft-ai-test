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

// ---- the bot's own memo (the runtime seam) ----
const memoOf = bot => (bot ? (bot.craftMemo instanceof Map ? bot.craftMemo : (bot.craftMemo = new Map())) : null)
export function noteCraftOutcome (bot, item, result, count = 1) {
  try { return noteCraftResult(memoOf(bot), { item, result, count, items: bot.inventory?.items?.() ?? [], pos: bot.entity?.position }) } catch { return null }
}
export function craftMemoFor (bot, item, count = 1) {
  try { return craftMemoHolds(bot?.craftMemo, { item, count, items: bot.inventory?.items?.() ?? [], pos: bot.entity?.position }) } catch { return null }
}

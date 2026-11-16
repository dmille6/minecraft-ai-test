// USELEDGER-01 (bagfix-02show (d); OWNER 11-16: "why dont we store everything now, and evaluate what we use over the next week or
// two, then determine what goes in the well"). PURE, and a LEAF (no imports): the ledger's lines, their fold, the week's table.
//
// ONE SMALL POOL FILE the bots append to (`use-ledger-<home>.jsonl`, beside the town index), one line an event:
//   in     what a bot put INTO storage, by name: a town or row chest (every verified transfer -- skills.mjs townIndexTransfers, the one
//          place every deposit's records pass) or a yard pile (the stock visit's placements)
//   out    what a bot drew OUT, by name, and FOR WHAT (`w`): a build's bill (`build`), a craft's ingredient (`craft`), a tool
//          (`tool`), a toolkit (`toolkit`), a smelt job's input and fuel (`smelt`), a trade (`trade`), a consumer's draw from the piles
//          (`yard_draw`) -- every verified take passes skills.mjs withdrawVisit
//   move   a clerk's take or put (the hall's clerk, the sort tidy, compaction, the merge): storage to storage, never a use
//   waste  what went down the well of a kind FULL at its cap (`over_cap`)
//   stock  the standing stock a bot read (the town index's known containers + the yards' piles), at most every STOCK_EVERY_MS a bot
// Derived from nothing else: the rows that exist (`_town_deposit`, `_withdraw*`, `_yard`, `_mats*`) name amounts in six formats over
// rotating logs; this file is the one place a week's table is read from. scripts/host/useledger.py prints it.
// USELEDGER=off|0|false|no: nothing is written.

const isOff = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
export const useLedgerOn = (env = {}) => !isOff(env?.USELEDGER)
export const USELEDGER = Object.freeze({ on: useLedgerOn(typeof process !== 'undefined' ? process.env : {}) })
/** A bot writes the standing stock at most this often. */
export const STOCK_EVERY_MS = 30 * 60_000
/** The kinds of line, and the `w` words that are a USE (a draw by a named consumer). */
export const LEDGER_KINDS = Object.freeze(['in', 'out', 'move', 'waste', 'stock'])
export const ledgerFileName = home => `use-ledger-${home.x}_${home.y}_${home.z}.jsonl`

/** One ledger line -> a JSON string | null (nothing to say). Pure. `names` { name: n } (only positive whole counts are kept). */
export function ledgerLine ({ d = 'in', names = {}, why = '-', bot = null, now = Date.now(), world = null } = {}) {
  if (!LEDGER_KINDS.includes(d)) return null
  const n = {}
  for (const [k, v] of Object.entries(names ?? {})) { const c = Math.floor(Number(v) || 0); if (typeof k === 'string' && k && c > 0) n[k] = c }
  if (!Object.keys(n).length) return null
  return JSON.stringify({ t: Math.floor(now), d, w: String(why ?? '-').slice(0, 24), b: bot ?? null, ...(world != null ? { g: world } : {}), n })
}
const dayOf = t => new Date(t).toISOString().slice(0, 10)
/**
 * THE FOLD -> { kinds: { name: { in, out, move, waste, by: { why: n }, days: { 'YYYY-MM-DD': { in, out } }, lastOut, draws, stock,
 * stockAt } }, lines, bad, from, to }. Pure over the file's lines (strings or parsed objects); a line outside [since, until), of
 * another world (`world` given) or unreadable is skipped (`bad` counts the unreadable). `draws` is the number of OUT lines of the
 * kind (occasions), `lastOut` the newest; `stock` the newest stock line's count for the kind (whatever the window: a standing figure).
 */
export function foldLedger (lines = [], { since = -Infinity, until = Infinity, world = null } = {}) {
  const kinds = {}
  const K = name => (kinds[name] ??= { in: 0, out: 0, move: 0, waste: 0, by: {}, days: {}, lastOut: null, draws: 0, stock: null, stockAt: null })
  let n = 0, bad = 0, from = null, to = null, newestStock = -Infinity, stockNames = null
  for (const raw of lines) {
    let r = raw
    if (typeof raw === 'string') { if (!raw.trim()) continue; try { r = JSON.parse(raw) } catch { bad++; continue } }
    if (!r || !Number.isFinite(r.t) || !LEDGER_KINDS.includes(r.d) || !r.n || typeof r.n !== 'object') { bad++; continue }
    if (world != null && r.g != null && r.g !== world) continue
    if (r.d === 'stock') { if (r.t >= newestStock && r.t < until) { newestStock = r.t; stockNames = r.n } continue }
    if (!(r.t >= since && r.t < until)) continue
    n++; from = from == null ? r.t : Math.min(from, r.t); to = to == null ? r.t : Math.max(to, r.t)
    for (const [name, c0] of Object.entries(r.n)) {
      const c = Number(c0) || 0
      if (!(c > 0)) continue
      const k = K(name)
      k[r.d] += c
      if (r.d === 'in' || r.d === 'out') { const day = (k.days[dayOf(r.t)] ??= { in: 0, out: 0 }); day[r.d] += c }
      if (r.d === 'out') { k.by[r.w ?? '-'] = (k.by[r.w ?? '-'] ?? 0) + c; k.draws++; k.lastOut = Math.max(k.lastOut ?? -Infinity, r.t) }
    }
  }
  if (stockNames) for (const [name, c] of Object.entries(stockNames)) { const k = K(name); k.stock = Number(c) || 0; k.stockAt = newestStock }
  return { kinds, lines: n, bad, from, to }
}
/**
 * THE WEEK'S TABLE -> [{ kind, stock, in, out, by, draws, lastOut, waste, candidate }] sorted: the kinds nobody drew first (the well's
 * candidates: stored or banked, and ZERO draws in the window), then by what was drawn, most first. Pure.
 */
export function useTable (fold) {
  const rows = Object.entries(fold?.kinds ?? {}).map(([kind, k]) => ({ kind, stock: k.stock, in: k.in, out: k.out, by: k.by, draws: k.draws, lastOut: k.lastOut, waste: k.waste,
    candidate: k.draws === 0 && ((k.stock ?? 0) > 0 || k.in > 0) }))
  return rows.sort((a, b) => (Number(b.candidate) - Number(a.candidate)) || (b.out - a.out) || ((b.stock ?? 0) - (a.stock ?? 0)) || (a.kind < b.kind ? -1 : 1))
}
/** IS A KIND USED REGULARLY? (the refill rule's evidence, (e)) -> { used, draws, items, perDay }. Pure over a fold of the last
 *  `days` days: drawn on at least `minDraws` occasions or `minItems` items by a named consumer. */
export function usedRegularly (fold, kind, { days = 2, minDraws = 3, minItems = 64 } = {}) {
  const k = fold?.kinds?.[kind]
  const draws = k?.draws ?? 0, items = k?.out ?? 0
  return { used: draws >= minDraws || items >= minItems, draws, items, perDay: items / Math.max(1, days) }
}

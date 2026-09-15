// Which tool copies left the inventory between two readings, and whether each was spent when it went.
// Pure. Copies are reconciled by name and wear (wear only ever rises), so a hotbar swap is not a loss and losing a
// fresh copy while a one-use copy survives is reported as the fresh copy going, not as a break (Codex pass 1).
import { TOOL_RE, remaining, HARD_STOP } from './toolfor.mjs'
const copies = items => {
  const m = new Map()
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it?.name || !TOOL_RE.test(it.name)) continue
    const list = m.get(it.name) || []
    for (let i = 0; i < (it.count ?? 1); i++) list.push({ left: remaining(it), max: it.maxDurability ?? null })
    m.set(it.name, list)
  }
  return m
}
/** diffTools(before, after) -> [{ name, lost, least, max, broke }] per name: `lost` copies unmatched by any survivor,
 *  `least` the fewest uses among the lost copies, `broke` when that copy had HARD_STOP + 1 or fewer uses left. */
export function diffTools (before = [], after = []) {
  const a = copies(before), b = copies(after), out = []
  for (const [name, was] of a) {
    const now = (b.get(name) || []).map(c => c.left).sort((x, y) => x - y)
    const pool = was.map(c => c.left).sort((x, y) => x - y)   // ascending: the most-worn copies first
    for (const left of now) {   // each survivor consumed the least-worn earlier copy that could have become it (wear only rises)
      let k = -1
      for (let i = 0; i < pool.length; i++) if (pool[i] >= left) { k = i; break }
      if (k >= 0) pool.splice(k, 1)   // no earlier copy could have become this one: it is new (crafted, picked up)
    }
    if (!pool.length) continue
    const least = Math.min(...pool)
    out.push({ name, lost: pool.length, least, max: was[0]?.max ?? null, broke: least <= HARD_STOP + 1 })
  }
  return out
}

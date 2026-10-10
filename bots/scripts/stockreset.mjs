#!/usr/bin/env node
// stockreset.mjs -- the stock targets' operator fence for the ONE-TIME CLEAR (stocktarget-01, design 3.1).
//
// THE CLEAR PROCEDURE (both engines, design r5): stop the affected pools' bots (the operator's own stop/start tooling --
// acknowledged suspension: nothing can mutate a chest during census, planning or execution); run the clear; then THIS
// appends a `reset` record to every town journal of the given pool state dirs -- every count captured at or before it is
// dropped, so the next bots recount before banking, pruning or disposing on the town's stock; then start the bots.
// Their claims from before are voided at their next login (stonecap's void). The record is appended to the CURRENT
// generation and the generation re-read (confirm before mutate); `--check` only reports what a reset would cover.
//
// Usage: node bots/scripts/stockreset.mjs [--check] <pool state dir>...   (e.g. /var/lib/mcai/_pool-board-a)
// Nothing is read from or written to a world. Run it as the user that owns the pool dirs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CC = await import(path.join(here, '..', 'src', 'cobblecap.mjs'))

const args = process.argv.slice(2)
const check = args.includes('--check')
const dirs = args.filter(a => !a.startsWith('--'))
if (!dirs.length) { console.error('usage: stockreset.mjs [--check] <pool state dir>...'); process.exit(2) }

let bad = 0
for (const dir of dirs) {
  let files
  try { files = fs.readdirSync(dir) } catch (e) { console.log(`${dir}: unreadable (${e.code})`); bad++; continue }
  const keys = [...new Set(files.map(f => /^(.*)\.cobble\.(g\d+\.)?(jsonl|seal|base\.json)$/.exec(f)?.[1]).filter(Boolean))]
  if (!keys.length) { console.log(`${dir}: no town journal (nothing to fence)`); continue }
  for (const key of keys) {
    const before = CC.currentGen(dir, key)
    // every world the current generation (and its base) names: a reset is per world, as every record is
    const worlds = new Set()
    const jf = path.join(dir, before ? `${key}.cobble.g${before}.jsonl` : `${key}.cobble.jsonl`)
    try { for (const ln of fs.readFileSync(jf, 'utf8').split('\n')) { try { if (ln) worlds.add(JSON.parse(ln)?.w ?? null) } catch { /* a fragment */ } } } catch { /* none yet */ }
    try { for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(dir, `${key}.cobble.g${before}.base.json`), 'utf8')).worlds ?? {})) worlds.add(JSON.parse(k)) } catch { /* gen 0 */ }
    // every world the current generation names (a reset is per world, as every record is)
    const ws = worlds.size ? [...worlds] : [null]
    for (const w of ws) {
      const at = Date.now()
      if (check) { console.log(`${dir} ${key} world=${w} generation=${before}: a reset at ${new Date(at).toISOString()} would drop every count before it`); continue }
      const ok = CC.appendJournal(dir, key, w, { t: 'reset', at, bot: null })
      const after = CC.currentGen(dir, key)
      const st = CC.readTown(dir, key, w)
      const kept = st ? Object.values(st.obs ?? {}).filter(o => !(o.at > at)).length : -1
      if (!ok || kept !== 0) bad++
      console.log(`${dir} ${key} world=${w} reset at=${new Date(at).toISOString()} written=${ok} generation=${before}->${after} counts_left_from_before=${kept}`)
    }
  }
}
process.exit(bad ? 1 : 0)

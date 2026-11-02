#!/usr/bin/env node
// flowstock.mjs <cobblecap.mjs path> <now ms> <pool dir>...  -- the chest half of flowledger.py (flowledger-01,
// resource-model-1102 §9). READ-ONLY: for each pool state dir it picks the town journal written most recently, folds it with
// the SAME cobblecap.mjs the bots run (its current generation from the checkpoint or the base, never writing either), and
// prints one JSON object { towns: { <dir basename>: { key, world, gen, records, containers, groups: { fam: { observed,
// counted, uncounted, lb, oldest_min } } } }, unreadable: [ { dir, why } ] }.
//   observed   the newest count of every container in the town's scan, ANY age (what the chests held when last opened)
//   counted    containers with a count of that family; uncounted: containers without one (their stock is UNKNOWN, never 0)
//   lb         cobblecap's townStock lower bound (fresh counts only, OBS_TTL_MS): what the bots' own rules act on
// A town whose journal cannot be replayed (no base for its generation, unparseable, too large) is listed under
// `unreadable` -- the report then says so; it is never a zero.
import fs from 'node:fs'
import path from 'node:path'

const [ccPath, nowS, ...dirs] = process.argv.slice(2)
const CC = await import(path.resolve(ccPath))
const ST = await import(path.join(path.dirname(path.resolve(ccPath)), 'stocktarget.mjs'))
const now = Number(nowS) || Date.now()

// report families: the cobble group as the bots count it, and the wood families summed over their per-type groups
const FAMILIES = {
  cobble: ['cobble'],
  logs: ST.STOCK_GROUP_NAMES.filter(g => g.endsWith('_log')),
  planks: ST.STOCK_GROUP_NAMES.filter(g => g.endsWith('_planks')),
  stick: ['stick'],
  sand: ['sand'],
  stone: ['stone'],
}

const out = { towns: {}, unreadable: [] }
for (const dir of dirs) {
  const name = path.basename(dir)
  let files = []
  try { files = fs.readdirSync(dir) } catch (e) { out.unreadable.push({ dir: name, why: `no dir (${e.code})` }); continue }
  const keys = [...new Set(files.map(f => /^(.*)\.cobble\.(g\d+\.)?jsonl$/.exec(f)?.[1]).filter(Boolean))]
  if (!keys.length) { out.unreadable.push({ dir: name, why: 'no town journal' }); continue }
  // the town this pool lives in now: the key whose current-generation journal was appended to last
  const genFile = (key, g) => path.join(dir, g ? `${key}.cobble.g${g}.jsonl` : `${key}.cobble.jsonl`)
  const mt = key => { try { return fs.statSync(genFile(key, CC.currentGen(dir, key))).mtimeMs } catch { return 0 } }
  const key = keys.sort((a, b) => mt(b) - mt(a))[0]
  const gen = CC.currentGen(dir, key)
  // never let a read publish a base: a missing base is UNREADABLE here (loadJournal would publish it)
  if (gen >= 1 && !fs.existsSync(path.join(dir, `${key}.cobble.g${gen}.base.json`))) { out.unreadable.push({ dir: name, why: `generation ${gen} has no base` }); continue }
  // the world: the newest complete record of the current generation that names one
  let world = null
  try {
    const buf = fs.readFileSync(genFile(key, gen), 'utf8')
    const lines = buf.slice(0, buf.lastIndexOf('\n')).split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) { try { const r = JSON.parse(lines[i]); if (r && 'w' in r) { world = r.w; break } } catch { /* fragment */ } }
  } catch { /* an empty current generation: the base's world (null) */ }
  const j = CC.loadJournal(dir, key, world, { checkpoint: true })
  if (!j) { out.unreadable.push({ dir: name, why: 'journal cannot be replayed' }); continue }
  const { state } = CC.foldJournal(j.records, { state: j.base, seq: j.seq })
  const obs = state?.obs ?? {}
  const scanKeys = state?.scan?.keys ?? Object.keys(obs)
  const town = { key, world, gen, records: j.records.length, containers: scanKeys.length, groups: {} }
  for (const [fam, gs] of Object.entries(FAMILIES)) {
    let observed = 0, counted = 0, uncounted = 0, lb = 0, oldest = null
    for (const k of scanKeys) {
      const o = obs[k]
      const vals = gs.map(g => CC.countOf(o, g))
      if (!o || vals.some(v => v == null)) { uncounted++; continue }
      counted++
      observed += vals.reduce((a, b) => a + b, 0)
      const age = (now - Number(o.at)) / 60000
      if (Number.isFinite(age) && (oldest == null || age > oldest)) oldest = age
    }
    for (const g of gs) lb += CC.townStock(state, scanKeys, now, { group: g }).lb
    town.groups[fam] = { observed, counted, uncounted, lb, oldest_min: oldest == null ? null : Math.round(oldest) }
  }
  out.towns[name] = town
}
process.stdout.write(JSON.stringify(out))

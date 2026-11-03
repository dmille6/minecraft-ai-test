#!/usr/bin/env node
// jobfacts.mjs <bots/src dir> <now ms> <pool dir>...  -- the FILE half of jobshadow.py (jobshadow-01, the rule-based town job
// assigner's SHADOW, docs/reports/job-assigner-2026-11-03.md). READ-ONLY: it opens files and never writes, renames, releases or
// creates anything in a pool directory. It reads each pool's town with the SAME modules the bots run (the fleet tree's
// bots/src): buildproj.mjs recordHead + leaseState, shop.mjs PROJECTS + activeProject, the per-project *On(env, pool) defaults,
// townindex.mjs indexRecords + foldIndex + indexHolding. It prints ONE JSON object:
//   { now, towns: { <pool>: { home, hk, projects: [{ plot, after, builders, on, readable, exists, complete, damaged, state, gen,
//       at, landings_built }], active, active_build, leases: { <name>: { holder, live, until, at, term0, released, released_at,
//       gen } }, index: { ok, world, containers, known, unknown, items: { <name>: n } } } }, unreadable: [{ dir, why }] }
// `active` is shop.mjs activeProject over the pool's list (null when everything stands: the job would be quiet);
// `active_build` is the same over the list without the tidy and the yard (those are the groundskeeper's and the clerk's).
// A pool whose directory cannot be read is listed under `unreadable` -- never as an empty town.
import fs from 'node:fs'
import path from 'node:path'

const [srcDir, nowS, ...dirs] = process.argv.slice(2)
const src = path.resolve(srcDir)
const BP = await import(path.join(src, 'buildproj.mjs'))
const SH = await import(path.join(src, 'shop.mjs'))
const TI = await import(path.join(src, 'townindex.mjs'))
const ons = {}
for (const [mod, fn, plot] of [['ziggurat.mjs', 'monumentOn', 'monument'], ['paths.mjs', 'pathsOn', 'paths'], ['wall.mjs', 'wallOn', 'wall'],
  ['treefarm.mjs', 'treefarmOn', 'treefarm'], ['tidy.mjs', 'tidyOn', 'tidy'], ['storehouse.mjs', 'storehouseOn', 'storehouse'],
  ['copperhall.mjs', 'copperhallOn', 'hall'], ['yard.mjs', 'yardOn', 'yard'], ['shopchest.mjs', 'shopchestOn', 'shopchest']]) {
  try { const m = await import(path.join(src, mod)); if (typeof m[fn] === 'function') ons[plot] = m[fn] } catch { /* an older tree: off unless a record exists */ }
}
const now = Number(nowS) || Date.now()
// what the host counts in the town index (the needs the rules read); everything else is not read
const ITEMS = ['iron_ingot', 'raw_iron', 'iron_block', 'coal', 'charcoal', 'raw_copper', 'copper_ingot', 'diamond', 'sand', 'cobblestone',
  'cobbled_deepslate', 'stick', 'torch']
const isLog = n => n.endsWith('_log') || n.endsWith('_stem')
const isPlanks = n => n.endsWith('_planks')

function plotOn (plot, pool) {
  if (plot === 'shop' || plot === 'house1') return true
  if (plot === 'shaft') { try { return !!SH.shaftOn({}, pool) } catch { return false } }
  const f = ons[plot]
  try { return typeof f === 'function' ? !!f({}, pool) : false } catch { return false }
}

function townOf (dir) {
  // the town this pool lives in now: the home whose project files were written last (a reseeded pool keeps old homes)
  const best = new Map()
  for (const f of fs.readdirSync(dir)) {
    const m = /^project-(-?\d+_-?\d+_-?\d+)\./.exec(f)
    if (!m) continue
    let mt = 0
    try { mt = fs.statSync(path.join(dir, f)).mtimeMs } catch { continue }
    if (mt > (best.get(m[1]) ?? -1)) best.set(m[1], mt)
  }
  if (!best.size) return null
  return [...best.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function lease (dir, key, name) {
  const s = BP.leaseState(dir, key, name)
  if (!s) return null
  return { holder: s.rec?.holder ?? null, live: now < (s.holdsUntil ?? 0), until: s.rec?.until ?? null, at: s.rec?.at ?? null,
    term0: s.rec?.meta?.term0 ?? null, released: !!s.released, released_at: s.releasedAt ?? null, gen: s.gen }
}

const out = { now, towns: {}, unreadable: [] }
for (const dir of dirs) {
  const pool = path.basename(dir).replace(/^_pool-/, '')
  let hk
  try { hk = townOf(dir) } catch (e) { out.unreadable.push({ dir: pool, why: `no dir (${e.code ?? e.message})` }); continue }
  if (!hk) { out.unreadable.push({ dir: pool, why: 'no project files' }); continue }
  const [x, y, z] = hk.split('_').map(Number)
  const home = { x, y, z }
  const projects = []
  for (const p of SH.PROJECTS) {
    let h = null
    try { h = BP.recordHead(dir, BP.projKey(home, p.plot)) } catch { h = null }
    const rec = h?.ok ? h.head?.rec ?? null : null
    const complete = !!rec && (rec.state === 'complete' || rec.structure_complete === true)
    projects.push({ plot: p.plot, after: p.after ?? null, builders: SH.buildersOf(p), on: plotOn(p.plot, pool) || !!rec,
      readable: !!h?.ok, exists: !!rec, complete, damaged: !!rec?.damaged, state: rec?.state ?? null, gen: h?.head?.gen ?? null,
      at: rec?.at ?? null, landings_built: Array.isArray(rec?.landings_built) ? rec.landings_built : null })
  }
  const list = SH.PROJECTS.filter(p => projects.find(q => q.plot === p.plot)?.on)
  const states = projects.map(p => ({ plot: p.plot, exists: p.exists, complete: p.complete, damaged: p.damaged }))
  const quiet = p => { const s = p && projects.find(q => q.plot === p.plot); return !p || (s.exists && s.complete && !s.damaged) }
  const a = list.length ? SH.activeProject(states, list) : null
  const buildList = list.filter(p => p.plot !== 'tidy' && p.plot !== 'yard')
  const ab = buildList.length ? SH.activeProject(states, buildList) : null
  const leases = {}
  for (const p of projects) {
    for (let k = 1; k <= Math.max(1, p.builders); k++) {
      const l = lease(dir, BP.projKey(home, p.plot), `slot${k}`)
      if (l) leases[`${p.plot}.slot${k}`] = l
    }
  }
  for (const [nm, plot, name] of [['deepmine.slot1', 'deepmine', 'slot1'], ['tidy.keeper', 'tidy', 'keeper']]) {
    const l = lease(dir, BP.projKey(home, plot), name)
    if (l) leases[nm] = l
  }
  // the town index: every record, every world; the world read is the one with the newest observation (a reseed starts another)
  let index = { ok: false, world: null, containers: 0, known: 0, unknown: 0, items: {} }
  try {
    const fold = TI.foldIndex(TI.indexRecords(dir, hk))
    let bestW = null, bestAt = -1
    for (const [w, entries] of Object.entries(fold.worlds ?? {})) {
      for (const e of Object.values(entries)) { const at = e?.obs?.at ?? -1; if (at > bestAt) { bestAt = at; bestW = w } }
    }
    const entries = bestW != null ? fold.worlds[bestW] : {}
    const items = Object.fromEntries(ITEMS.map(n => [n, 0]))
    items.logs = 0; items.planks = 0
    let known = 0, unknown = 0
    for (const e of Object.values(entries)) {
      if (TI.indexStateOf(e, now) !== 'known') { unknown++; continue }
      known++
      for (const n of ITEMS) items[n] += TI.indexHolding(e, n, now)?.n ?? 0
      items.logs += TI.indexHolding(e, isLog, now)?.n ?? 0
      items.planks += TI.indexHolding(e, isPlanks, now)?.n ?? 0
    }
    index = { ok: true, world: bestW, containers: Object.keys(entries).length, known, unknown, items }
  } catch (e) { index = { ...index, why: String(e?.message ?? e).slice(0, 120) } }
  out.towns[pool] = { home, hk, projects, active: quiet(a) ? null : a.plot, active_build: quiet(ab) ? null : ab.plot, leases, index }
}
process.stdout.write(JSON.stringify(out))

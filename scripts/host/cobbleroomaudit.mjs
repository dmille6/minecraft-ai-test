#!/usr/bin/env node
// cobbleroomaudit.mjs <cobblecap.mjs path> <events.json> <pool dir>...  -- the journal half of cobbleoverflowread.py
// (cobbleoverflow-01). Read-only. For every overflow throw the read found (events.json: [{ id, pool, at }], `at` in ms),
// folds that pool's town journals -- generation by generation, base + records, as the bots fold them -- with the SAME
// cobblecap.mjs the canary runs, up to the last record APPENDED at or before `at`, and reports the town's room for cobble
// as the fold then knew it (cobblecap.mjs townRoom over the journal's last covered scan, at `at`):
//   { id, pool, at, known, max, unknown, containers, town } per event, or { id, pool, at, unreadable } / { ..., no_town }
// A journal that cannot be replayed is listed under `unreadable` (the gate is then blind there). Prints one JSON object.
import fs from 'node:fs'
import path from 'node:path'

const [ccPath, eventsPath, ...dirs] = process.argv.slice(2)
const CC = await import(path.resolve(ccPath))
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'))
const out = { events: [], unreadable: [], towns: 0 }

const lines = (f, upto = Infinity) => {
  try {
    let buf = fs.readFileSync(f)
    if (Number.isFinite(upto)) buf = buf.subarray(0, upto)
    const last = buf.lastIndexOf(10)
    return buf.subarray(0, last + 1).toString('utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// pool name from a pool state dir (_pool-<pool>)
const poolOf = dir => path.basename(dir).replace(/^_pool-/, '')
for (const dir of dirs) {
  const pool = poolOf(dir)
  const mine = events.filter(e => e.pool === pool).sort((a, b) => a.at - b.at)
  if (!mine.length) continue
  let files = []
  try { files = fs.readdirSync(dir) } catch { out.unreadable.push(dir); continue }
  const keys = [...new Set(files.map(f => /^(.*)\.cobble\.(g\d+\.)?(jsonl|seal|base\.json)$/.exec(f)?.[1]).filter(Boolean))]
  // per town, per world: the fold's state just before each event
  const views = []   // { town, world, lastAt, view(e) }
  for (const key of keys) {
    out.towns++
    const gens = [...new Set(files.map(f => f.startsWith(`${key}.cobble.`) ? (/^g(\d+)\./.exec(f.slice(key.length + 8))?.[1] ?? (/^(jsonl)$/.test(f.slice(key.length + 8)) ? '0' : null)) : null).filter(x => x != null).map(Number))].sort((a, b) => a - b)
    const first = gens[0] ?? 0
    const worldsState = {}
    if (first >= 1) {
      try { const b = JSON.parse(fs.readFileSync(path.join(dir, `${key}.cobble.g${first}.base.json`), 'utf8')); for (const [w, v] of Object.entries(b.worlds ?? {})) worldsState[w] = { state: v.state, seq: v.seq } } catch { out.unreadable.push(`${dir}/${key}`); continue }
    }
    const cutOf = g => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${key}.cobble.g${g + 1}.base.json`), 'utf8')).prevEnd } catch { return Infinity } }
    const recs = []
    for (const g of gens) recs.push(...lines(path.join(dir, g ? `${key}.cobble.g${g}.jsonl` : `${key}.cobble.jsonl`), cutOf(g)))
    const byWorld = new Map()
    for (const r of recs) { const w = JSON.stringify(r.w ?? null); if (!byWorld.has(w)) byWorld.set(w, []); byWorld.get(w).push(r) }
    for (const [w, rs] of byWorld) {
      let state = worldsState[w]?.state ?? null, seq = worldsState[w]?.seq ?? 0, i = 0, lastAt = -Infinity
      const at = {}
      for (const e of mine) {
        // fold every record appended at or before the event (append order; a record without `at` is folded as it comes)
        while (i < rs.length && !(Number(rs[i].at) > e.at)) {
          const f = CC.foldJournal([rs[i]], { state, seq }); state = f.state; seq = f.seq
          if (Number.isFinite(Number(rs[i].at))) lastAt = Math.max(lastAt, Number(rs[i].at))
          i++
        }
        const keysNow = state?.scan?.keys ?? Object.keys(state?.obs ?? {})
        at[e.id] = { lastAt, view: state ? CC.townRoom(state, keysNow, e.at, { coverage: !!state.scan }) : null }
      }
      views.push({ town: `${path.basename(dir)}/${key}`, world: w, at })
    }
  }
  for (const e of mine) {
    // the town/world whose journal was written to most recently before the event is the one the bot lived in
    const cands = views.map(v => ({ v, a: v.at[e.id] })).filter(x => x.a && Number.isFinite(x.a.lastAt)).sort((x, y) => y.a.lastAt - x.a.lastAt)
    const best = cands[0]
    if (!best || !best.a.view) { out.events.push({ ...e, no_town: true }); continue }
    const v = best.a.view
    out.events.push({ ...e, town: best.v.town, known: v.known, max: v.max, unknown: v.unknown.length, containers: v.containers })
  }
}
console.log(JSON.stringify(out))

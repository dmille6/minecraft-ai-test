#!/usr/bin/env node
// stockjournal.mjs <cobblecap.mjs path> <since ms> <until ms> <pool dir>...  -- the journal half of stocktargetread.py
// (stocktarget-01). Read-only: folds every town journal of the given pool state dirs, generation by generation (base +
// records, as the bots fold them), record by record, with the SAME cobblecap.mjs the canary runs, and reports per town:
//   G3  an admitted BANK claim (not valve) in the window whose release-time group total -- the fold's lower bound over
//       the town's containers right after its releasing count -- exceeds the group's target
//   G4  an admitted TAKE claim in the window whose container lost MORE of the group between its admission and its
//       releasing count than the claim (a take that removed more than it was admitted for; another bot's draw on the same
//       container in between is listed with it, so the row is a TRIPWIRE when one overlaps)
//   valve claims, live claims older than an hour by bot, reset records, generations seen, records, max group totals
// Prints one JSON object. A journal that cannot be replayed is listed under `unreadable` (the gate is then blind there).
import fs from 'node:fs'
import path from 'node:path'

const [ccPath, sinceS, untilS, ...dirs] = process.argv.slice(2)
const CC = await import(path.resolve(ccPath))
const ST = await import(path.join(path.dirname(path.resolve(ccPath)), 'stocktarget.mjs'))
const since = Number(sinceS), until = Number(untilS)
const out = { towns: [], g3: [], g4: [], g4_overlap: [], valve: [], resets: [], unreadable: [], live_over_1h: {}, generations: {}, admitted: { bank: 0, take: 0, draw: 0, valve: 0, nowell: 0 }, draws: {}, bank_ids: [] }

// a generation's records, cut at `upto` bytes (the successor base's prevEnd: what was appended after it is NOT folded by
// any bot -- design r3 section 4 -- so the audit must not fold it either; Codex code r1 P2)
const lines = (f, upto = Infinity) => {
  try {
    let buf = fs.readFileSync(f)
    if (Number.isFinite(upto)) buf = buf.subarray(0, upto)
    const last = buf.lastIndexOf(10)
    return buf.subarray(0, last + 1).toString('utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

for (const dir of dirs) {
  let files = []
  try { files = fs.readdirSync(dir) } catch { continue }
  const keys = [...new Set(files.map(f => /^(.*)\.cobble\.(g\d+\.)?(jsonl|seal|base\.json)$/.exec(f)?.[1]).filter(Boolean))]
  for (const key of keys) {
    const gens = [...new Set(files.map(f => f.startsWith(`${key}.cobble.`) ? (/^g(\d+)\./.exec(f.slice(key.length + 8))?.[1] ?? (/^(jsonl)$/.test(f.slice(key.length + 8)) ? '0' : null)) : null).filter(x => x != null).map(Number))].sort((a, b) => a - b)
    out.generations[`${path.basename(dir)}/${key}`] = gens
    // start from the OLDEST generation still on disk: its base (or nothing for generation 0), then every generation's
    // records in order (a later generation's base folds exactly the earlier ones, so walking the records is the same fold)
    const first = gens[0] ?? 0
    let worldsState = {}
    if (first >= 1) {
      try { const b = JSON.parse(fs.readFileSync(path.join(dir, `${key}.cobble.g${first}.base.json`), 'utf8')); for (const [w, v] of Object.entries(b.worlds ?? {})) worldsState[w] = { state: v.state, seq: v.seq } } catch { out.unreadable.push(`${dir}/${key}`); continue }
    }
    const recs = []
    const cutOf = g => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${key}.cobble.g${g + 1}.base.json`), 'utf8')).prevEnd } catch { return Infinity } }
    for (const g of gens) recs.push(...lines(path.join(dir, g ? `${key}.cobble.g${g}.jsonl` : `${key}.cobble.jsonl`), cutOf(g)))
    const byWorld = new Map()
    for (const r of recs) { const w = JSON.stringify(r.w ?? null); if (!byWorld.has(w)) byWorld.set(w, []); byWorld.get(w).push(r) }
    for (const [w, rs] of byWorld) {
      let state = worldsState[w]?.state ?? null, seq = worldsState[w]?.seq ?? 0
      const takeAt = {}
      const maxTot = {}
      const admittedOn = {}    // container -> [seq of every admitted claim]: an overlap is any OTHER admission in between
      for (const r of rs) {
        const before = state
        const f = CC.foldJournal([r], { state, seq })
        state = f.state; seq = f.seq
        const keysNow = state.scan?.keys ?? Object.keys(state.obs ?? {})
        if (r.t === 'reset' && r.at >= since && r.at <= until) out.resets.push({ town: `${path.basename(dir)}/${key}`, at: r.at, hold: r.hold ?? null })
        if (r.t === 'claim') {
          const c = state.claims?.[r.id]
          if (c && r.at >= since && r.at <= until && c.decision in out.admitted) out.admitted[c.decision]++
          // the read's G2 checks a recovery's reservations against these (Codex code r2 P2)
          if (c && (c.decision === 'bank' || c.decision === 'nowell') && r.at >= since - 600_000 && r.at <= until) out.bank_ids.push(r.id)
          if (c) (admittedOn[r.k] ??= []).push({ id: r.id, seq, g: c.g ?? 'cobble' })
          if (c && c.decision === 'draw' && r.at >= since && r.at <= until) { const t = (out.draws[path.basename(dir)] ??= {}); t[c.g ?? 'cobble'] = (t[c.g ?? 'cobble'] ?? 0) + (Number(c.n) || 0) }
          if (c && c.decision === 'take') takeAt[r.id] = { k: r.k, g: c.g ?? 'cobble', n: c.n, c0: CC.countOf(before?.obs?.[r.k], c.g ?? 'cobble'), at: r.at, bot: r.bot, seq }
          if (c && c.decision === 'valve' && r.at >= since && r.at <= until) out.valve.push({ town: `${path.basename(dir)}/${key}`, id: r.id, bot: r.bot, g: c.g, at: r.at, proof: r.proof ?? null })
        }
        if (r.t === 'cnt' && Array.isArray(r.ids)) {
          for (const id of r.ids) {
            const c = before?.claims?.[id]
            if (!c || c.state !== 'live') continue
            const g = c.g ?? 'cobble'
            const v = CC.townStock(state, keysNow, Number(r.at) || r.cap || Date.now(), { group: g })
            maxTot[g] = Math.max(maxTot[g] ?? 0, v.lb)
            if (c.decision === 'bank' && c.at >= since && c.at <= until && v.lb > ST.targetOf(g))
              out.g3.push({ town: `${path.basename(dir)}/${key}`, id, bot: c.bot, g, n: c.n, total: v.lb, target: ST.targetOf(g), at: c.at })
          }
          // G4 per releasing count, PER GROUP (Codex code r2 P2: one batch summed every group's takes against the first group's
          // loss): the takes it releases on its container of ONE group, against what the container lost of THAT group since
          // that batch's first admission; any other admission of the same group on that container in between = overlap
          if (r.k != null) {
            const byG = {}
            for (const id of r.ids) {
              const c = before?.claims?.[id]
              if (!c || c.state !== 'live' || c.decision !== 'take' || c.k !== r.k || !takeAt[id]) continue
              ;(byG[takeAt[id].g] ??= []).push(id)
            }
            for (const [g, ids] of Object.entries(byG)) {
              const first = Math.min(...ids.map(id => takeAt[id].seq))
              const c0 = takeAt[ids.find(id => takeAt[id].seq === first)].c0
              const c1 = CC.countOf(state.obs?.[r.k], g)
              const n = ids.reduce((t, id) => t + (Number(takeAt[id].n) || 0), 0)
              if (c0 != null && c1 != null && c0 - c1 > n && ids.some(id => takeAt[id].at >= since && takeAt[id].at <= until)) {
                const overlap = (admittedOn[r.k] ?? []).some(a => a.seq > first && a.g === g && !ids.includes(a.id))
                ;(overlap ? out.g4_overlap : out.g4).push({ town: `${path.basename(dir)}/${key}`, ids, bot: takeAt[ids[0]].bot, g, n, removed: c0 - c1, at: takeAt[ids[0]].at })
              }
            }
          }
        }
      }
      for (const c of Object.values(state?.claims ?? {})) if (c.state === 'live' && until - c.at > 3600_000) out.live_over_1h[c.bot ?? '?'] = (out.live_over_1h[c.bot ?? '?'] ?? 0) + 1
      out.towns.push({ town: `${path.basename(dir)}/${key}`, world: JSON.parse(w), records: rs.length, gens, max_total: maxTot })
    }
  }
}
console.log(JSON.stringify(out))

// ROUGHGROUND-4 (owner 11-07 GO: "rough ground blends into gentle slopes like target 10 / 11"): the wide-area regrade. Behaviour on
// buildfake's flat world (stone below G, grass at G, readable to +-60), through the rough survey and the inside-the-wall stage.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const RG = await import('../src/roughground.mjs')
const RD = await import('../src/regrade.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const RD_PATH = new URL('../src/regrade.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const col = srv => (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
const rough = (srv, o = {}) => RG.surveyRough(srv.read, { home: HOME, box: [-25, -25, 25, 25], col: col(srv), spoil: T.SPOIL, yLo: HOME.y - 14, ...o })
const laid = (srv, r) => T.tidyOverlay(srv.read, { cut: r.cut, clear: [], cells: r.fill.map(f => ({ at: f.at, role: f.role ?? 'earth' })) })
const steep = (rd, box) => { let n = 0; const y = (x, z) => T.tidyColumn(rd, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 }).y; for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) for (const [dx, dz] of [[1, 0], [0, 1]]) if (Math.abs(y(x, z) - y(x + dx, z + dz)) >= 2) n++; return n }
// the bots' rough ground: a 16x16 patch, columns 0..3 over the grass, every 3x3 spread 3 -- wider than any clump
const roughPatch = (srv, x0 = 4, z0 = 4, n = 16) => { for (let x = x0; x < x0 + n; x++) for (let z = z0; z < z0 + n; z++) { const h = (((x * 7 + z * 3) % 4) + 4) % 4; for (let y = G + 1; y <= G + h; y++) srv.set([x, y, z], 'dirt') } }

await t('a wide rough patch converges to gentle ground: steep (2+) pairs fall to near nothing over a few surveys; every fill top is dirt', async () => {
  let srv = server()
  roughPatch(srv)
  const box = [3, 3, 20, 20]
  const before = steep(srv.read, box)
  let rd = srv.read
  for (let i = 0; i < 4; i++) {
    const s2 = { read: rd }
    const r = RG.surveyRough(rd, { home: HOME, box: [-25, -25, 25, 25], col: (x, z) => T.tidyColumn(rd, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 }), spoil: T.SPOIL, yLo: HOME.y - 14 })
    if (i === 0) {
      assert.ok(r.census.regraded > 0, 'the regrade takes part')
      const top = new Map(); for (const f of r.fill) { const k = `${f.at[0]},${f.at[2]}`; top.set(k, Math.max(top.get(k) ?? -1e9, f.at[1])) }
      assert.ok(r.fill.filter(f => f.pit?.startsWith('rg')).every(f => (f.at[1] === top.get(`${f.at[0]},${f.at[2]}`)) === (f.role === 'topsoil')), 'regrade tops topsoil, under them core')
    }
    rd = T.tidyOverlay(s2.read, { cut: r.cut, clear: [], cells: r.fill.map(f => ({ at: f.at, role: f.role ?? 'earth' })) })
  }
  const after = steep(rd, box)
  assert.ok(before > 100 && after <= before / 10, `steep pairs ${before} -> ${after}`)
  srv = null
})
await t('a natural hill (a 10x10 rise 6 high) and a gentle slope (1-block steps) are never touched', async () => {
  const srv = server()
  for (let x = -20; x <= -11; x++) for (let z = -20; z <= -11; z++) for (let y = G + 1; y <= G + 6; y++) srv.set([x, y, z], 'stone')
  const r = rough(srv)
  assert.ok(![...r.cut, ...r.fill].some(c => c.at[0] >= -21 && c.at[0] <= -10 && c.at[2] >= -21 && c.at[2] <= -10), 'the hill and its foot stand')
  assert.strictEqual(r.census.regraded, 0)
  // a whole slope of 1-block steps (one every 3 columns, the full width): nothing to do
  const sl = server()
  for (let x = -25; x <= 25; x++) for (let z = -25; z <= 25; z++) for (let y = G + 1; y <= G + Math.floor((x + 25) / 3); y++) sl.set([x, y, z], 'dirt')
  const rs = rough(sl, { box: [-20, -20, 20, 20] })
  assert.strictEqual(rs.census.regraded, 0); assert.strictEqual(rs.cut.length + rs.fill.length, 0)
})
await t('the honeycomb: a cut the ground refuses (a tunnel beside it) is never made -- the column is an anchor and the ground round it is filled to meet it', async () => {
  const srv = server()
  // a 5x5 knoll 3 high over flat ground, a 2-high tunnel under its east side at G+1..G+2 (the knoll's own ground there is a crust)
  for (let x = 8; x <= 12; x++) for (let z = 8; z <= 12; z++) for (let y = G + 1; y <= G + 3; y++) srv.set([x, y, z], 'dirt')
  for (let z = 6; z <= 14; z++) { srv.set([13, G, z], 'air'); srv.set([13, G - 1, z], 'air'); srv.set([13, G + 1, z], 'dirt') }
  for (let z = 6; z <= 14; z++) srv.set([13, G + 2, z], 'dirt')
  const r = rough(srv)
  const tunnel = [...Array(9).keys()].map(i => [13, G, 6 + i])
  const after = laid(srv, r)
  assert.ok(tunnel.every(c => after(...c).name === 'air' || r.fill.some(f => f.at.join(',') === c.join(','))), 'no tunnel cell exposed by a cut beside it')
  // every cut cell: no open cell beside it under that neighbour's ground
  for (const c of r.cut) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = srv.read(c.at[0] + dx, c.at[1], c.at[2] + dz)
    const nt = col(srv)(c.at[0] + dx, c.at[2] + dz).y
    assert.ok(!(n?.name === 'air' && nt > c.at[1]), `cut ${c.at} opens a hollow beside it`)
  }
  // the mutant: the side-hollow check gone -> a cut opens a hollow beside it (A raised 3 over flat ground; B beside it, a column the
  // regrade may not touch -- not in H -- with air at A's cut heights under its overhang)
  const w = server()
  for (let y = G + 1; y <= G + 3; y++) w.set([10, y, 10], 'dirt')
  w.set([11, G + 3, 10], 'stone_bricks'); w.set([11, G + 1, 10], 'air'); w.set([11, G + 2, 10], 'air'); w.set([11, G, 10], 'air')
  const cw = col(w)
  const Hw = new Map(); for (let x = 0; x <= 20; x++) for (let z = 0; z <= 20; z++) { if (x === 11 && z === 10) continue; const y = cw(x, z).y; if (Number.isFinite(y)) Hw.set(`${x},${z}`, y) }
  const openW = (x, y, z) => w.read(x, y, z)?.name === 'air', solidW = (x, y, z) => !openW(x, y, z)
  const sideCut = wk => wk.cut.some(q => q.at[0] === 10 && q.at[2] === 10 && q.at[1] <= G + 2)
  const okW = RD.regradeWork(w.read, Hw, { home: HOME, open: openW, solid: solidW })
  assert.ok(!sideCut(okW), 'control: A is an anchor, never cut down beside the hollow')
  assert.ok((okW.skipped.regrade_side_hollow_anchored ?? 0) >= 1, JSON.stringify(okW.skipped))
  await withMutant(RD_PATH, "      for (const [dx, dz] of N4) { const nt = H.get(k2(x + dx, z + dz)); if (open(x + dx, yy, z + dz) && (!Number.isFinite(nt) || nt > yy)) return 'regrade_side_hollow' }\n", '', async M => {
    assert.ok(sideCut(M.regradeWork(w.read, Hw, { home: HOME, open: openW, solid: solidW })), 'mutant opens the hollow sideways')
  })
})
await t('the target is 1-block steps between every solved pair; the mutant without the clamp leaves a 3-block step', async () => {
  // a 3-block step between two flat halves (x < 10 at 70, x >= 10 at 73): its two rough columns become 71 and 72
  const H = new Map()
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) H.set(`${x},${z}`, x < 10 ? 70 : 73)
  const worstOf = Tt => { let w = 0; for (let x = 0; x < 19; x++) for (let z = 0; z < 20; z++) w = Math.max(w, Math.abs(Tt.get(`${x},${z}`) - Tt.get(`${x + 1},${z}`))); return w }
  const fit = RD.regradeTarget(H)
  assert.strictEqual(worstOf(fit.T), 1); assert.strictEqual(fit.T.get('9,5'), 71); assert.strictEqual(fit.T.get('10,5'), 72)
  await withMutant(RD_PATH, '    for (let it = 0; it < R.iters; it++) {', '    for (let it = 0; it < 0; it++) {', async M => {
    assert.ok(worstOf(M.regradeTarget(H).T) >= 2, 'mutant: the step stays')
  })
})
await t('bounded: the tiles nearest home first, under the cap (the rest: the next survey); a cut never leaves bare stone on top', async () => {
  const srv = server()
  roughPatch(srv, -20, -20, 10); roughPatch(srv, 10, 10, 10)
  const H = new Map(); const c = col(srv)
  for (let x = -25; x <= 25; x++) for (let z = -25; z <= 25; z++) { const y = c(x, z).y; if (Number.isFinite(y)) H.set(`${x},${z}`, y) }
  const open = (x, y, z) => srv.read(x, y, z)?.name === 'air', solid = (x, y, z) => !open(x, y, z)
  const all = RD.regradeWork(srv.read, H, { home: HOME, open, solid })
  const one = RD.regradeWork(srv.read, H, { home: HOME, open, solid, R: { ...RD.REGRADE, cap: 1 } })
  assert.ok(all.tiles.length > one.tiles.length && one.tiles.length === 1, `${all.tiles.length} tiles, capped ${one.tiles.length}`)
  assert.ok(one.skipped.regrade_cap >= 1)
  // stone under the cut: the new top laid again in dirt (topsoil), the visit's foreign dig taking the stone first
  const st = server()
  for (let x = 4; x <= 19; x++) for (let z = 4; z <= 19; z++) { const h = (((x * 7 + z * 3) % 4) + 4) % 4; for (let y = G + 1; y <= G + h; y++) st.set([x, y, z], y <= G + 1 ? 'stone' : 'dirt') }
  const Hs = new Map(); const cs = col(st)
  for (let x = 0; x <= 24; x++) for (let z = 0; z <= 24; z++) { const y = cs(x, z).y; if (Number.isFinite(y)) Hs.set(`${x},${z}`, y) }
  const ws = RD.regradeWork(st.read, Hs, { home: HOME, open: (x, y, z) => st.read(x, y, z)?.name === 'air', solid: (x, y, z) => st.read(x, y, z)?.name !== 'air' })
  const resoil = ws.fill.filter(f => f.role === 'topsoil' && st.read(...f.at)?.name === 'stone')
  assert.ok(resoil.length > 0, 'bare stone tops re-soiled')
  // Codex r1 BLOCKER: a re-soil over a hollow (stone roof, air under it) is never planned -- the column is an anchor
  const ho = server()
  for (let x = 4; x <= 19; x++) for (let z = 4; z <= 19; z++) { const h = (((x * 7 + z * 3) % 4) + 4) % 4; for (let y = G + 1; y <= G + h; y++) ho.set([x, y, z], y <= G + 1 ? 'stone' : 'dirt') }
  for (let x = 4; x <= 19; x++) for (let z = 4; z <= 19; z++) if ((((x * 7 + z * 3) % 4) + 4) % 4 >= 1) ho.set([x, G, z], 'air')   // a hollow under every stone roof
  const Hh = new Map(); const ch = col(ho)
  for (let x = 0; x <= 24; x++) for (let z = 0; z <= 24; z++) { const y = ch(x, z).y; if (Number.isFinite(y)) Hh.set(`${x},${z}`, y) }
  const wh = RD.regradeWork(ho.read, Hh, { home: HOME, open: (x, y, z) => ho.read(x, y, z)?.name === 'air', solid: (x, y, z) => ho.read(x, y, z)?.name !== 'air' })
  const fk = new Set(wh.fill.map(f => f.at.join(',')))
  assert.ok(!wh.fill.some(f => f.role === 'topsoil' && ho.read(...f.at)?.name === 'stone' && ho.read(f.at[0], f.at[1] - 1, f.at[2])?.name === 'air' && !fk.has([f.at[0], f.at[1] - 1, f.at[2]].join(','))), 'no re-soil over a hollow')
  assert.ok((wh.skipped.regrade_resoil_unsafe_anchored ?? 0) > 0, JSON.stringify(wh.skipped))
  await withMutant(RD_PATH, "      if (!solid(x, t - 1, z) || wet(x, t, z)) return 'regrade_resoil_unsafe'\n", '', async M => {
    const m = M.regradeWork(ho.read, Hh, { home: HOME, open: (x, y, z) => ho.read(x, y, z)?.name === 'air', solid: (x, y, z) => ho.read(x, y, z)?.name !== 'air' })
    const mk = new Set(m.fill.map(f => f.at.join(',')))
    assert.ok(m.fill.some(f => f.role === 'topsoil' && ho.read(...f.at)?.name === 'stone' && ho.read(f.at[0], f.at[1] - 1, f.at[2])?.name === 'air' && !mk.has([f.at[0], f.at[1] - 1, f.at[2]].join(','))), 'mutant re-soils over the hollow')
  })
})
await t('never a record cell, a build\'s ring, a zone: the regrade keeps to the rough survey\'s refusals; REGRADE off (T.regrade) does nothing', async () => {
  const srv = server(); const cells = new Set()
  roughPatch(srv)
  for (let z = 4; z <= 19; z++) { srv.set([12, G + 4, z], 'stone_bricks'); cells.add(`12,${G + 4},${z}`) }
  const records = [{ plot: 'wall', cells: [...cells].map(k => ({ at: k.split(',').map(Number) })) }]
  const avoid = (x, z) => (x >= 4 && x <= 8 && z >= 4 && z <= 8 ? 'zone' : null)
  const r = rough(srv, { cells, nearCells: RG.nearCellsOf(records), avoid })
  assert.ok(![...r.cut, ...r.fill].some(c => c.at[0] >= 11 && c.at[0] <= 13), 'the wall\'s column and its ring')
  assert.ok(![...r.cut, ...r.fill].some(c => c.at[0] >= 4 && c.at[0] <= 8 && c.at[2] >= 4 && c.at[2] <= 8), 'the zone')
  const off = rough(srv, { T: { ...RG.ROUGH, regrade: false } })
  assert.strictEqual(off.census.regraded, 0)
  assert.strictEqual(RD.regradeOn({ REGRADE: 'off' }), false)
})
await t('fleet: through tidy-01\'s siting (surveyTidy -> siteTidy): the regrade is on the record, a re-survey of the laid ground has less to do', async () => {
  const srv = server()
  roughPatch(srv)
  const s = T.siteTidy(srv.read, { home: HOME, r: 30, rough: true })
  assert.ok(s.record && s.record.rough.regraded > 0, JSON.stringify(s.record?.rough))
  const after = T.tidyOverlay(srv.read, s.record)
  const s2 = T.siteTidy(after, { home: HOME, r: 30, rough: true })
  const n1 = s.record.cut.length + s.record.cells.length, n2 = (s2.record?.cut.length ?? 0) + (s2.record?.cells.length ?? 0)
  assert.ok(n2 < n1 / 3, `${n1} -> ${n2}`)
})
await t('fleet: a wide SUNK patch is filled up: its regrade tops reach the record as `topsoil` (dirt only)', async () => {
  const srv = server()
  for (let x = 4; x < 20; x++) for (let z = 4; z < 20; z++) { const h = (((x * 7 + z * 3) % 4) + 4) % 4; for (let y = G; y > G - h; y--) srv.set([x, y, z], 'air') }
  const s = T.siteTidy(srv.read, { home: HOME, r: 30, rough: true })
  assert.ok(s.record.rough.regraded > 0)
  const roles = s.record.cells.reduce((m, c) => ((m[c.role] = (m[c.role] ?? 0) + 1), m), {})
  assert.ok(roles.topsoil > 0, JSON.stringify(roles))
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

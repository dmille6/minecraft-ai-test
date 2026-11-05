// LEVELFALL-01 + STATIONZONE-01 (showcase batch 13 prep, 11-05).
// LEVELFALL-01 (bots/src/buildsite.mjs levelFor `alts` / screenSite `level` / siteBlueprint `ctx.levelAlts`; enchantshop.mjs
// ENCHANT_SITE.levelAlts). LIVE showcase 11-05: the enchanting workshop's ONE anchor on plot X1 (27,-64 W: its 17 x 11 shell in the
// 19 x 13 plot) failed its proof `no_step earth fill@21,65,-65` once X1's spruce was down -- a cave pocket y 65..68 under the plot's
// grass at 69; at the least-earthwork floor (68) the fill starts at 65, out of every stand's reach. The search now proves the SAME
// anchor at its next feasible floor levels: at 67 it is proven. Behaviour on the live region (the 17:48Z copy, X1's trees 0 and 2
// felled as the in-wall stage plans), with the old search as the positive control and an anchored mutant.
// STATIONZONE-01 (bots/src/enchant.mjs pickStation; skills.mjs stationNear): the workshop's own anvil / table first; a scanned one
// never inside a protected zone (a village's anvil chips with use); none while the zones are unknown.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
const B = await import('../src/buildsite.mjs')
const EN = await import('../src/enchantshop.mjs')
const E = await import('../src/enchant.mjs')
const mc = createRequire(import.meta.url)('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
async function withMutant (rel, old, neu, fn) {
  const p = new URL(rel, import.meta.url)
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---- the live X1 region (absent inside the box = air); a flat plain at 69 outside it (the walk from home) --------------------
const FX = JSON.parse(readFileSync(new URL('./fixtures/levelfall-x1-1105.json', import.meta.url), 'utf8'))
const [bx0, bz0, bx1, bz1] = FX.box, [by0, by1] = FX.y
const mk = n => (n == null || n === '?' ? null : { name: n, boundingBox: mc.blocksByName[n]?.boundingBox ?? 'block' })
const read = (x, y, z) => {
  if (x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1 && y >= by0 && y <= by1) return mk(FX.world[`${x},${y},${z}`] ?? 'air')
  return mk(y < 69 ? 'stone' : y === 69 ? 'grass_block' : 'air')
}
const home = { x: 0, y: 70, z: 0 }
const plan = { home, gen: 1, plots: [] }
const X1 = { id: 'X1', kind: 'hall', box: [10, -75, 28, -63], y: [67, 69] }
const bp = B.loadBlueprint(EN.ENCHANT_BLUEPRINT)
function site (levelAlts) {
  const sp = EN.enchantSitingPlan(home, X1, [])
  return B.siteBlueprint(read, plan, bp, { zones: [], wells: [], farm: [], z0: null, stood: [], sectors: sp.sectors, plot: EN.ENCHANT_PLOT,
    earth: sp.earth, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line, levelAlts })
}

console.log('LEVELFALL-01 (the live X1 region)')
const s0 = site(0)
await t('POSITIVE CONTROL (the old search): the one anchor\'s proof fails at the least-earthwork floor -- no_step earth at the pocket', () => {
  assert.strictEqual(s0.ok, false, JSON.stringify(s0.why))
  const ex = s0.sectors.flatMap(r => r.proofEx ?? [])
  assert.ok(ex.some(e => /^27,-64\/W no_step earth/.test(e)), JSON.stringify(ex))
})
await t('with levelAlts the SAME anchor is proven at its next feasible floor (67): the workshop sites on X1', () => {
  const s = site(EN.ENCHANT_SITE.levelAlts)
  assert.ok(s.ok, JSON.stringify(s.sectors?.map(r => [r.proofEx, r.rejects])))
  assert.deepStrictEqual(s.record.anchor, [27, -64]); assert.strictEqual(s.record.orient, 'W')
  assert.strictEqual(s.record.floor, 67)
  assert.ok(s.record.earthwork.fill <= EN.ENCHANT_EARTH.fill && s.record.earthwork.cut <= EN.ENCHANT_EARTH.cut)
  assert.ok(s.sectors.some(r => /L67$/.test(r.levelFallback ?? '')), 'the fallback is named on the row')
})
await t('levelFor names the other feasible levels least-earthwork first; `only` forces one; screenSite carries them as `alts`', () => {
  const { pad } = B.footprint(bp, { x: 27, z: -64 }, 'W')
  const lv = B.levelFor(read, home, pad, EN.ENCHANT_EARTH)
  assert.ok(lv.ok && lv.L === 68, JSON.stringify(lv.L)); assert.deepStrictEqual(lv.alts, [67])
  assert.strictEqual(B.levelFor(read, home, pad, EN.ENCHANT_EARTH, 67).L, 67)
  assert.strictEqual(B.levelFor(read, home, pad, EN.ENCHANT_EARTH, 69).ok, false, 'over the fill limit')
  assert.deepStrictEqual(B.levelAltsOf({ alts: [67] }), [67]); assert.deepStrictEqual(B.levelAltsOf({}), [])
})
await t('MUTANT: the fallback cut (levelAltsOf names none) -- the workshop finds no proven site again', async () => {
  await withMutant('../src/buildsite.mjs', 'export const levelAltsOf = site => (Array.isArray(site?.alts) ? site.alts : [])', 'export const levelAltsOf = site => []', async M => {
    const sp = EN.enchantSitingPlan(home, X1, [])
    const s = M.siteBlueprint(read, plan, bp, { zones: [], wells: [], farm: [], z0: null, stood: [], sectors: sp.sectors, plot: EN.ENCHANT_PLOT,
      earth: sp.earth, domain: sp.domain, standDomain: sp.standDomain, walkR: sp.walkR, line: sp.line, levelAlts: 3 })
    assert.strictEqual(s.ok, false)
  })
})
await t('the wiring (structural): the workshop\'s siting passes levelAlts in skills.mjs and the offline script', () => {
  for (const f of ['../src/skills.mjs', '../scripts/enchantshop-offline.mjs']) {
    const src = strip(readFileSync(new URL(f, import.meta.url), 'utf8'))
    assert.ok(/earth: sp\.earth, domain: sp\.domain, standDomain: sp\.standDomain, walkR: sp\.walkR, line: sp\.line, levelAlts: sp\.levelAlts \}/.test(src), f)
  }
  assert.strictEqual(EN.enchantSitingPlan(home, X1, []).levelAlts, EN.ENCHANT_SITE.levelAlts)
})

console.log('STATIONZONE-01')
const at = (x, y, z, name = 'anvil') => ({ name, position: { x, y, z } })
const VILLAGE = { id: 'village-taiga-6_1', box: [49, -64, -59, 157, 90, 45] }
await t('the workshop\'s own station wins over a nearer one', () => {
  const own = at(27, 69, -64), near = at(5, 70, 5)
  assert.strictEqual(E.pickStation({ own, found: [near], zones: [] }), own)
})
await t('a scanned station inside a protected zone (a village\'s anvil) is never used; the next one outside is', () => {
  const inV = at(60, 70, 0), out = at(40, 70, 0)
  assert.strictEqual(E.pickStation({ own: null, found: [inV], zones: [VILLAGE] }), null)
  assert.strictEqual(E.pickStation({ own: null, found: [inV, out], zones: [VILLAGE] }), out)
})
await t('POSITIVE CONTROL: with no zone over it the nearest scanned station is used; zones UNKNOWN -> none scanned (the workshop\'s only)', () => {
  const inV = at(60, 70, 0)
  assert.strictEqual(E.pickStation({ own: null, found: [inV], zones: [] }), inV)
  assert.strictEqual(E.pickStation({ own: null, found: [inV], zones: [], zonesKnown: false }), null)
  const own = at(27, 69, -64)
  assert.strictEqual(E.pickStation({ own, found: [inV], zonesKnown: false }), own)
})
await t('MUTANT: the zone test cut -- the village anvil is used (the test fails for that reason)', async () => {
  await withMutant('../src/enchant.mjs', 'if (p && Number.isFinite(p.x) && !inZone(p)) return b', 'if (p && Number.isFinite(p.x)) return b', async M => {
    assert.strictEqual(M.pickStation({ own: null, found: [at(60, 70, 0)], zones: [VILLAGE] }).position.x, 60)
  })
})
await t('the wiring (structural): stationNear asks the workshop first, scans with findBlocks and picks through pickStation with the zones', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const body = src.slice(src.indexOf('const stationNear = ('), src.indexOf('const enSkipRow = ('))
  assert.ok(body.length > 100 && body.length < 2000, `stationNear not found (${body.length})`)
  assert.ok(/const own = enchantStationAt\(bot, names\)\n\s*if \(own\) return own/.test(body))
  assert.ok(/bot\.findBlocks\?\.\(\{ matching: ids, maxDistance: dist, count: 16 \}\)/.test(body))
  assert.ok(/return pickStation\(\{ own: null, found, zones: zv\?\.zones \?\? \[\], zonesKnown: !!zv\?\.known \}\)/.test(body))
  assert.ok(!/bot\.findBlock\?\.\(/.test(body), 'the single nearest-block scan is gone')
})

console.log(`\nlevelfall: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

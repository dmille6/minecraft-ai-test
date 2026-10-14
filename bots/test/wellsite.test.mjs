// wellsite-01 (10-13): the junk well's site search, said and backed off; a sand wall that cannot fall.
//
// Measured 10-12 (24 h, 80 bots): 3,197 build_well orders in 12 towns (55 bots) ran the whole site search and found no
// cell -- the towns' ground within 14 of home is dug out (WALLS and RING fail on 80-100% of candidates in every town,
// working ones included) -- and every one was free, so it came back every town visit. And a sealed well (placebo-b) was
// retired for one sand block resting on dirt that an escape pillar left in its wall.
//
// Behaviour only, through the exported pure functions: the outcome's backoff and the scheduler that reads it, the
// search's exhausted flag and tally, the refusal classes, siteAnswer, steadyWall and containmentRefusal, retireLog.
// Mutants assert their anchor present and unique (withMutant). The skill-level chain (buildWell -> row -> outcome; the
// stand re-check; one retirement row) is in well.test.mjs, beside the fake town it needs.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-wellsite-${process.pid}`
process.env.BOT_NAME = 'TestBot'
process.env.POOL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'wellsite-store-'))
const W = await import('../src/well.mjs')
const { siteAnswer } = await import('../src/skills.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.11')
const PBlock = require('prismarine-block')('1.21.11')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`)
  }
}
const WP = new URL('../src/well.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${file.pathname}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// the real registry's collision shapes (well.mjs fullCube reads them)
const shapesOf = name => { const d = REG.blocksByName[name]; return PBlock.fromStateId(d.defaultState ?? d.minStateId, 0).shapes }
const B = name => ({ name, boundingBox: REG.blocksByName[name].boundingBox, hardness: REG.blocksByName[name].hardness, shapes: shapesOf(name) })
const AIR = B('air')
const TD = (half, open = false, facing = 'north') => ({ name: 'oak_trapdoor', boundingBox: 'block', hardness: 3, props: { half, open, facing }, shapes: [] })
const G = 63
const flatRead = (extra = {}) => (x, y, z) => (Object.prototype.hasOwnProperty.call(extra, `${x},${y},${z}`) ? extra[`${x},${y},${z}`] : (y > G ? AIR : y === G ? B('grass_block') : B('dirt')))
const CAP = { x: 5, y: G, z: 0 }
const HOMEFAR = { x: -20, y: 64, z: 0 }
const NOW = 10_000_000

// =====================================================================================================================
// A3: A FALLING BLOCK THAT CANNOT FALL IS A WALL
// =====================================================================================================================
await t('steadyWall: ground is a wall; sand / red_sand / gravel only over non-falling full ground; unknown support is null', () => {
  assert.equal(W.steadyWall(B('dirt'), null), true, 'ground needs no support read')
  assert.equal(W.steadyWall(B('sand'), B('dirt')), true)
  assert.equal(W.steadyWall(B('gravel'), B('stone')), true)
  assert.equal(W.steadyWall(B('red_sand'), B('andesite')), true)
  assert.equal(W.steadyWall(B('sand'), AIR), false, 'over air it falls')
  assert.equal(W.steadyWall(B('sand'), B('sand')), false, 'over another faller: not judged steady (no chains)')
  assert.equal(W.steadyWall(B('red_sand'), B('water')), false)
  assert.equal(W.steadyWall(B('sand'), B('short_grass')), false, 'a replaceable plant lets it fall')
  assert.equal(W.steadyWall(B('sand'), null), null, 'never on a guess')
  assert.equal(W.steadyWall(B('suspicious_sand'), B('stone')), false, 'left out on purpose')
  assert.equal(W.steadyWall(B('white_concrete_powder'), B('stone')), false, 'left out on purpose')
  assert.equal(W.steadyWall(AIR, B('stone')), false)
  assert.equal(W.steadyWall(B('oak_leaves'), B('stone')), false)
})
await t('containmentRefusal: a supported sand wall at g or g-1 holds; over air it is "wall is sand"; an unloaded support is "unknown"; the floor and the column keep the strict rule', () => {
  assert.equal(W.containmentRefusal(flatRead(), CAP), null, 'positive control: flat ground')
  assert.equal(W.containmentRefusal(flatRead({ '6,63,1': B('sand') }), CAP), null, 'g, diagonal (placebo-b), on dirt')
  assert.equal(W.containmentRefusal(flatRead({ '4,62,0': B('gravel') }), CAP), null, 'g-1, cardinal, on dirt (the g-2 ring)')
  assert.equal(W.containmentRefusal(flatRead({ '6,63,1': B('sand'), '6,62,1': AIR }), CAP), 'wall is sand')
  assert.equal(W.containmentRefusal(flatRead({ '6,63,1': B('sand'), '6,62,1': B('sand') }), CAP), 'wall is sand', 'sand on sand: not steady')
  assert.equal(W.containmentRefusal(flatRead({ '6,63,1': B('sand'), '6,62,1': null }), CAP), 'unknown')
  assert.equal(W.containmentRefusal(flatRead({ '6,63,1': B('suspicious_sand') }), CAP), 'wall is suspicious_sand')
  // only walls: the floor, the cap and the shaft are judged as before
  assert.match(W.wellSiteRefusal(flatRead({ '5,61,0': B('sand') }), CAP, HOMEFAR), /floor is sand/)
  assert.match(W.wellSiteRefusal(flatRead({ '5,63,0': B('sand') }), CAP, HOMEFAR), /column is sand/)
})
await t('a sand stand floor or hinge is never steadied: the stand moves to a side whose floor and hinge are ground', () => {
  const s0 = W.wellStand(flatRead(), CAP)
  assert.equal(s0.facing, 'north', 'positive control')
  const s1 = W.wellStand(flatRead({ '5,63,-1': B('sand') }), CAP)   // the north stand stands on sand (and the south hinge is it)
  assert.ok(s1 && s1.facing !== 'north' && s1.facing !== 'south', JSON.stringify(s1))
  assert.equal(W.wellSiteRefusal(flatRead({ '5,63,-1': B('sand') }), CAP, HOMEFAR), null, 'the site still holds from a side')
  assert.ok(W.coverRef(flatRead({ '5,63,0': AIR, '5,62,0': AIR, '6,63,0': B('sand'), '4,63,0': B('sand') }), CAP, { x: 5, y: 64, z: -1 }), 'a pit with sand side walls can still be covered')
})
await t('placebo-b, as the region file read it 10-13: andesite/granite/dirt/sand up the diagonal column -- breached before, a well now', () => {
  const extra = { '6,60,1': B('andesite'), '6,61,1': B('granite'), '6,62,1': B('dirt'), '6,63,1': B('sand'), '5,63,0': TD('top', false, 'west'), '5,62,0': TD('bottom') }
  const read = flatRead(extra)
  assert.equal(W.wellIdentity(read, CAP).ok, true)
  assert.equal(W.wellBreach(read, CAP, 'west'), null)
  const loose = flatRead({ ...extra, '6,62,1': AIR })
  assert.equal(W.wellBreach(loose, CAP, 'west'), 'wall is sand', 'positive control: the escape column left open under the sand is a breach')
})
await t('MUTANT: a faller with no support read is a wall (sand over air accepted)', async () => {
  await withMutant(WP, '  return ground(below)\n}', '  return true\n}', async m => {
    // sand on sand on dirt: the top one is not judged steady (its support is itself a faller); the mutant lets both stand
    assert.equal(m.containmentRefusal(flatRead({ '6,63,1': B('sand'), '6,62,1': B('sand') }), CAP), null, 'mutant inert')
  })
})
await t('MUTANT: an unloaded support read as "not a wall" retires a well whose chunk is loading', async () => {
  await withMutant(WP, '  if (!below) return null\n', '  if (!below) return false\n', async m => {
    assert.equal(m.containmentRefusal(flatRead({ '6,63,1': B('sand'), '6,62,1': null }), CAP), 'wall is sand', 'mutant inert')
  })
})
await t('MUTANT: suspicious sand let in', async () => {
  await withMutant(WP, 'export const STEADY_FALLERS = /^(sand|red_sand|gravel)$/', 'export const STEADY_FALLERS = /^(sand|red_sand|gravel|suspicious_sand)$/', async m => {
    assert.equal(m.steadyWall(B('suspicious_sand'), B('stone')), true, 'mutant inert')
  })
})

// =====================================================================================================================
// A1: AN EXHAUSTED SEARCH BACKS THE BUILD ORDER OFF; EVERYTHING ELSE STAYS FREE
// =====================================================================================================================
await t('wellOrderOutcome: no_effect + well_no_site -> 2 h; a no_effect without it, or with any other class, stays free; a failed build is unchanged', () => {
  const f = W.wellOrderOutcome
  assert.equal(W.WELL_NO_SITE_BACKOFF_MS, 2 * 60 * 60 * 1000)
  assert.equal(f('build_well', 'no_effect', NOW, {}, 'well_no_site').buildBackoffUntil, NOW + W.WELL_NO_SITE_BACKOFF_MS)
  assert.equal(f('build_well', 'no_effect', NOW, {}).buildBackoffUntil ?? 0, 0, 'a deferral (no class) is free')
  assert.equal(f('build_well', 'no_effect', NOW, {}, 'well_attended').buildBackoffUntil ?? 0, 0)
  assert.equal(f('dispose_well', 'no_effect', NOW, {}, 'well_no_site').disposeBackoffUntil ?? 0, 0, 'only the build order')
  assert.equal(f('build_well', 'failed', NOW, {}, 'well_place').buildBackoffUntil, NOW + W.WELL_BUILD_BACKOFF_MS)
  assert.equal(f('build_well', 'no_effect', NOW, { buildBackoffUntil: NOW + 9e9 }, 'well_no_site').buildBackoffUntil, NOW + 9e9, 'never shortens a longer hold')
})
await t('THE CHAIN through wellOrder: after a no-site, no build order for 2 h -- but an open pit is still covered, and a well found open is still closed', () => {
  const st = W.wellOrderOutcome('build_well', 'no_effect', NOW, { lastBuildAt: NOW }, 'well_no_site')
  const o = (now, x = {}) => W.wellOrder({ now, distHome: 3, slots: 10, freeSlots: 26, junkStacks: 0, well: null, buildPlan: { carried: true, slotsNeeded: 0 }, myName: 'a', peers: [], state: st, ...x }).order?.skill ?? null
  const free = (now) => W.wellOrder({ now, distHome: 3, slots: 10, freeSlots: 26, junkStacks: 0, well: null, buildPlan: { carried: true, slotsNeeded: 0 }, myName: 'a', peers: [], state: { lastBuildAt: NOW } }).order?.skill ?? null
  assert.equal(free(NOW + W.WELL_BUILD_COOLDOWN_MS + 1), 'build_well', 'positive control: a free skip re-orders after the cooldown')
  assert.equal(o(NOW + W.WELL_BUILD_COOLDOWN_MS + 1), null)
  assert.equal(o(NOW + W.WELL_BUILD_COOLDOWN_MS + 1, { pit: { attended: false, coverable: true } }), 'close_well', 'the pit cover is not held by the build backoff')
  assert.equal(o(NOW + W.WELL_BUILD_COOLDOWN_MS + 1, { well: { open: true, attended: false, breached: true } }), 'close_well')
  assert.equal(o(NOW + W.WELL_NO_SITE_BACKOFF_MS + 1), 'build_well', 'after 2 h it asks the ground again')
})
await t('MUTANT: the no-site backoff line removed -- the order comes back every 5 minutes', async () => {
  await withMutant(WP, '    s.buildBackoffUntil = Math.max(s.buildBackoffUntil ?? 0, now + WELL_NO_SITE_BACKOFF_MS)\n', '', async m => {
    assert.equal(m.wellOrderOutcome('build_well', 'no_effect', NOW, {}, 'well_no_site').buildBackoffUntil ?? 0, 0, 'mutant inert')
  })
})
await t('MUTANT: every build skip backed off (a deferral held for 2 h)', async () => {
  await withMutant(WP, "  if (skill === 'build_well' && status === 'no_effect' && failClass === 'well_no_site') {", "  if (skill === 'build_well' && status === 'no_effect') {", async m => {
    assert.equal(m.wellOrderOutcome('build_well', 'no_effect', NOW, {}).buildBackoffUntil, NOW + m.WELL_NO_SITE_BACKOFF_MS, 'mutant inert')
  })
})

await t('noSiteHold: fresh and same world -> held with the time left; aged out, from the future, another world, malformed or absent -> not held', () => {
  const H = W.WELL_NO_SITE_BACKOFF_MS
  assert.deepEqual(W.noSiteHold({ record: { at: NOW - 60_000, world: 'w' }, now: NOW, world: 'w' }), { held: true, leftMs: H - 60_000 })
  assert.equal(W.noSiteHold({ record: { at: NOW - 60_000, world: null }, now: NOW, world: 'w' }).held, true, 'an unknown world id never invalidates (sameWorld)')
  assert.equal(W.noSiteHold({ record: { at: NOW - H, world: 'w' }, now: NOW, world: 'w' }).held, false, 'aged out')
  assert.equal(W.noSiteHold({ record: { at: NOW + 1, world: 'w' }, now: NOW, world: 'w' }).held, false, 'from the future')
  assert.equal(W.noSiteHold({ record: { at: NOW - 1, world: 'old' }, now: NOW, world: 'new' }).held, false, 'a reseeded world')
  assert.equal(W.noSiteHold({ record: { at: 'x' }, now: NOW }).held, false)
  assert.equal(W.noSiteHold({ record: null, now: NOW }).held, false)
})
await t('MUTANT: the hold ignores its age (a town never searches again)', async () => {
  await withMutant(WP, '  if (age < 0 || age >= WELL_NO_SITE_BACKOFF_MS) return { held: false, leftMs: 0 }\n', '', async m => {
    assert.equal(m.noSiteHold({ record: { at: NOW - 3 * m.WELL_NO_SITE_BACKOFF_MS }, now: NOW }).held, true, 'mutant inert')
  })
})

// =====================================================================================================================
// A4: THE SEARCH SAYS WHETHER IT FINISHED, AND WHAT REFUSED
// =====================================================================================================================
const HOME0 = { x: 0, y: 64, z: 0 }
await t('canonicalWellSite: a site found is never exhausted; an unknown cell is never exhausted; only a search that read and refused every column is', () => {
  const ok = W.canonicalWellSite({ home: HOME0, read: flatRead() })
  assert.ok(ok.site); assert.equal(ok.exhausted, false); assert.equal(ok.tally.cols, 1, 'the first column holds')
  const noFloor = {}
  for (let dx = -14; dx <= 14; dx++) for (let dz = -14; dz <= 14; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) >= 7) noFloor[`${dx},${G - 2},${dz}`] = AIR
  const none = W.canonicalWellSite({ home: HOME0, read: flatRead(noFloor) })
  assert.equal(none.site, null); assert.equal(none.exhausted, true); assert.equal(none.why, W.NO_VALID_CELL)
  assert.equal(none.tally.cols, 672, 'rings 7..14')
  assert.equal(Object.entries(none.tally).filter(([k]) => k !== 'cols').reduce((a, [, v]) => a + v, 0), 672, 'each column one class')
  assert.ok(none.tally.floor > 0 && none.tally.beyond > 0, JSON.stringify(none.tally))
  const unk = W.canonicalWellSite({ home: HOME0, read: (x, y, z) => (x === 7 && z === 7 ? null : flatRead(noFloor)(x, y, z)) })
  assert.equal(unk.site, null); assert.equal(unk.exhausted, false); assert.match(unk.why, /unknown cell/)
})
await t('refusalClass: every refusal the rule can say maps to its class (none to "other"); tallyText is compact, largest first', () => {
  const r = (extra, cap = CAP, home = HOMEFAR, avoid = []) => W.wellSiteRefusal(flatRead(extra), cap, home, { avoid })
  const cases = [
    [W.wellSiteRefusal(flatRead(), { x: 1, y: G, z: 0 }, HOME0), 'home'],
    [r({ '5,64,0': B('stone') }), 'open'],
    [r({ '5,63,0': TD('top'), '5,62,0': TD('bottom') }), 'well'],
    [r({ '5,63,0': B('oak_leaves') }), 'column'],
    [r({ '5,61,0': AIR }), 'floor'],
    [r({ '6,63,0': AIR }), 'walls'],
    [r({ '7,60,0': AIR }), 'ring'],
    [r({ '8,63,0': B('water') }), 'liquid'],
    [r({ '6,64,1': B('chest') }), 'container'],
    [r({ '6,64,2': B('oak_door') }), 'container'],
    [r({}, CAP, HOMEFAR, [{ x: 6, z: 1, r: 7, what: 'a bank container' }]), 'avoid'],
    [r({}, CAP, HOMEFAR, [{ x: 6, z: 1 }]), 'avoid'],
  ]
  for (const [why, cls] of cases) assert.equal(W.refusalClass(why), cls, `${why} -> ${cls}`)
  assert.equal(W.refusalClass('no site'), 'other')
  assert.equal(W.tallyText({ cols: 672, floor: 3, walls: 400, beyond: 3, ring: 0 }), 'cols:672,walls:400,beyond:3,floor:3')
  assert.equal(W.tallyText(null), '-')
})
await t('stand refusal class: every stand blocked', () => {
  const blocked = {}
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) blocked[`${5 + dx},64,${dz}`] = B('oak_fence')
  const why = W.wellSiteRefusal(flatRead(blocked), CAP, HOMEFAR)
  assert.match(why, /nowhere to stand/); assert.equal(W.refusalClass(why), 'stand')
})
await t('siteAnswer: exhausted only when THIS call searched, the search finished empty, and the resolver said its words', () => {
  const searched = { site: null, why: W.NO_VALID_CELL, exhausted: true, tally: { cols: 672, floor: 672 } }
  assert.deepEqual(siteAnswer({ site: null, why: W.NO_VALID_CELL, defer: true }, searched), { site: null, why: W.NO_VALID_CELL, defer: true, exhausted: true, tally: searched.tally })
  assert.equal(siteAnswer({ site: null, why: 'unknown cell around the town\'s composter site', defer: true }, null).exhausted, false, 'the record reused: no search ran')
  assert.equal(siteAnswer({ site: null, why: 'the site another bot just recorded is refused here (wall is air)', defer: true }, { site: { x: 1, y: 2, z: 3 }, why: null, exhausted: false }).exhausted, false, 'a race lost after a site was found')
  assert.equal(siteAnswer({ site: null, why: 'unknown cell at 1,2,3', defer: true }, { site: null, why: 'unknown cell at 1,2,3', exhausted: false }).exhausted, false)
  assert.equal(siteAnswer({ site: { x: 1, y: 2, z: 3 }, gen: 2 }, null).exhausted, false)
})
await t('MUTANT: the unknown return marked exhausted (an unloaded chunk would back the build off for 2 h)', async () => {
  await withMutant(WP, "if (!cell || !under) return { site: null, why: `unknown cell at ${x},${y},${z}`, exhausted: false, tally }", "if (!cell || !under) return { site: null, why: `unknown cell at ${x},${y},${z}`, exhausted: true, tally }", async m => {
    // the spiral's first column (ring 7, smallest bearing) is -7,-1: unloaded there, the search stops at once
    const r = m.canonicalWellSite({ home: HOME0, read: (x, y, z) => (x === -7 && z === -1 ? null : flatRead()(x, y, z)) })
    assert.match(r.why, /unknown cell at -7,/, 'positive control: the unloaded column was the one read')
    assert.equal(r.exhausted, true, 'mutant inert')
  })
})

// =====================================================================================================================
// A5: ONE RETIREMENT ROW PER WELL AND REASON
// =====================================================================================================================
await t('retireLog: says a (cap, why) once; a new reason or a cleared cap says it again; caps are independent', () => {
  const L = W.retireLog()
  const a = { x: 1, y: 2, z: 3 }, b = { x: 4, y: 5, z: 6 }
  assert.equal(L.say(a, 'wall_is_air'), true); assert.equal(L.say(a, 'wall_is_air'), false)
  assert.equal(L.say(b, 'wall_is_air'), true, 'another well')
  assert.equal(L.say(a, 'wall_is_sand'), true, 'a new reason'); assert.equal(L.say(a, 'wall_is_sand'), false)
  L.clear(a); assert.equal(L.say(a, 'wall_is_sand'), true, 'read sealed in between')
  assert.equal(W.retireLog().say(a, 'wall_is_sand'), true, 'a fresh log (a fresh bot) says it')
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)

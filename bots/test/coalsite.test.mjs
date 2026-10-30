// COALSITE-01 (LIVE showcase 10-30 10:15Z): the coal run is never issued while the bot stands on a town project's site -- inside
// any project record's box + COAL_SITE_MARGIN, or the paths' / wall's own column zones -- and a site that cannot be read refuses
// it (fail closed). Behaviour on real record files in a pool directory, the reading the order takes (skills.mjs coalSiteOf ->
// coalrun.mjs projectSiteHit over shop.mjs recordZones), the order's refusal, and an anchored mutant.
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-coalsite-logs-'))
process.env.BOT_NAME = 'CoalSiteBot'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'showcase'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-coalsite-pool-'))
for (const k of ['MONUMENT', 'MONUMENT_POOLS', 'HOUSE', 'PATHS', 'PATHS_POOLS', 'WALL', 'WALL_POOLS', 'COALFIRST']) delete process.env[k]

const C = await import('../src/coalrun.mjs')
const SK = await import('../src/skills.mjs')
const S = await import('../src/shop.mjs')
const PJ = await import('../src/buildproj.mjs')

const HOME = { x: 0, y: 70, z: 0 }
const dir = () => process.env.POOL_STATE_DIR
const rec = (plot, blueprint, extra) => assert.equal(PJ.publishRecord(dir(), PJ.projKey(HOME, plot), () => ({ v: 1, blueprint, plot, cells: [], segments: [], structure_complete: true, completeAt: 1, state: 'complete', ...extra })).result, 'accepted')
// the live showcase's records (10-30): the boxes and two of the zones as they are on the VM
rec('shop', 'workshop@1', { box: [20, 26, 28, 32] })
rec('house1', 'house@1', { box: [-39, -9, -33, -3] })
rec('monument', 'ziggurat@1', { box: [-55, -43, -26, -14] })
rec('paths', 'paths@1', { zones: [{ box: [-22, -64, -30, -16, 320, -27], why: 'project:paths' }] })
rec('wall', 'wall@1', { zones: [{ box: [2, -64, -21, 9, 320, -19], why: 'project:wall' }] })
const bot = (x, y, z) => ({ username: 'CoalSiteBot', entity: { position: { x, y, z } }, inventory: { items: () => [] } })
const order = site => C.coalRunOrder({ now: 1e9, heldCoal: 0, freeSlots: 10, tripPick: true, state: {},
  townCoal: { ok: true, total: 0, containers: 4, site }, ore: { block: 'coal_ore', dist: 7 } })

test('COALSITE projectSiteHit: inclusive boxes, the floor of a fractional position, malformed zones skipped', () => {
  const z = [{ box: [0, 60, 0, 4, 70, 4], why: 'project:a' }, { box: [1, 2] }, null]
  assert.equal(C.projectSiteHit({ x: 4.9, y: 70.5, z: 0 }, z), 'project:a')
  assert.equal(C.projectSiteHit({ x: 5, y: 65, z: 0 }, z), null)
  assert.equal(C.projectSiteHit({ x: -0.1, y: 65, z: 0 }, z), null, 'floor(-0.1) is -1: outside')
  assert.equal(C.projectSiteHit({ x: 2, y: 59, z: 2 }, z), null)
  assert.equal(C.projectSiteHit(null, z), null)
  assert.equal(C.projectSiteHit({ x: 1, y: 1, z: 1 }, []), null)
})

test('COALSITE coalSiteOf on the live records: the LIVE spot (inside the ziggurat foundation) and the margin refuse; open ground and home issue', () => {
  // LIVE 10-30 10:14:59Z: Bravo at -26.5,65,-31.7 (the ziggurat's east foundation) was issued a coal run and walled itself in
  const live = SK.coalSiteOf(bot(-26.5, 65, -31.7))
  assert.deepEqual(live, { ok: true, hit: 'project:monument' })
  assert.equal(order(live).skip, 'on_site')
  assert.equal(order(live).order, null)
  // the margin: 2 east of the box's edge x=-26 is refused, 3 east is not
  assert.equal(SK.coalSiteOf(bot(-24, 69, -30)).hit, 'project:monument')
  assert.equal(SK.coalSiteOf(bot(-23, 69, -40)).hit, null)
  // every project's site: the workshop, the house, a path zone, a wall zone (zones are their own columns, every height)
  assert.equal(SK.coalSiteOf(bot(24, 71, 29)).hit, 'project:shop')
  assert.equal(SK.coalSiteOf(bot(-41, 68, -6)).hit, 'project:house1')
  assert.equal(SK.coalSiteOf(bot(-20, 40, -28)).hit, 'project:paths')
  assert.equal(SK.coalSiteOf(bot(5, 71, -20)).hit, 'project:wall')
  // control: open ground away from every record, and home (no record there) -> issued
  for (const p of [[60, 64, 60], [0, 70, 0]]) {
    const s = SK.coalSiteOf(bot(...p))
    assert.deepEqual(s, { ok: true, hit: null }, `${p}`)
    assert.ok(order(s).order, `${p}: the run is issued off every site`)
  }
})

test('COALSITE fail closed: no position, an unreadable record directory, or no site reading -> refused', () => {
  assert.equal(SK.coalSiteOf({ entity: null }).ok, false)
  assert.equal(order(SK.coalSiteOf({ entity: null })).skip, 'site_unknown')
  assert.equal(order(undefined).skip, 'site_unknown', 'a townCoal reading without a site never issues')
  const keep = process.env.POOL_STATE_DIR
  try {
    // a path that is a FILE, not a directory (ENOTDIR): unreadable; a directory that does not exist yet is a fresh pool (no record)
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-coalsite-f-')), 'not-a-dir'); fs.writeFileSync(f, 'x')
    process.env.POOL_STATE_DIR = f
    const s = SK.coalSiteOf(bot(60, 64, 60))
    assert.equal(s.ok, false, 'an unreadable directory is not "no record"')
    assert.equal(order(s).skip, 'site_unknown')
  } finally { process.env.POOL_STATE_DIR = keep }
  // positive control: the same spot with the directory back is issued
  assert.ok(order(SK.coalSiteOf(bot(60, 64, 60))).order)
})

test('COALSITE the projects are read as the siting reads them (shop.mjs recordZones with COAL_SITE_MARGIN)', () => {
  const z = S.recordZones([{ plot: 'monument', box: [-55, -43, -26, -14] }], C.COAL_SITE_MARGIN)
  assert.deepEqual(z[0].box, [-57, -64, -45, -24, 320, -12])
})

test('COALSITE MUTANT KILLED: without the on_site refusal the LIVE spot is issued a run', async () => {
  const src = fs.readFileSync(new URL('../src/coalrun.mjs', import.meta.url), 'utf8')
  const old = "  if (t.site.hit) return skip('on_site')\n"
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-coalsite-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, ''))
  try {
    const M = await import(out.href)
    const r = M.coalRunOrder({ now: 1e9, heldCoal: 0, freeSlots: 10, tripPick: true, state: {},
      townCoal: { ok: true, total: 0, containers: 4, site: SK.coalSiteOf(bot(-26.5, 65, -31.7)) }, ore: { block: 'coal_ore', dist: 7 } })
    assert.ok(r.order, 'the mutant issues the run the guard refuses: the test above is about the guard')
  } finally { fs.unlinkSync(out) }
})

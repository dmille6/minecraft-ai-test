// STUCKWAIT-01 (LIVE showcase 10-30 10:24Z on): a project inside its F4 stuck back-off waits behind the other projects, so one
// project's unreachable cells no longer hold every bot's build_shop for SHOP_STUCK_RETRY_MS. Pure (shop.mjs stuckBackoff) and the
// chain through skills.mjs shopActive on real record + stuck files, with the control and an anchored mutant.
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-stuckwait-logs-'))
process.env.BOT_NAME = 'StuckWaitBot'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'showcase'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-stuckwait-pool-'))
for (const k of ['MONUMENT', 'MONUMENT_POOLS', 'HOUSE', 'PATHS', 'PATHS_POOLS', 'WALL', 'WALL_POOLS']) delete process.env[k]
process.env.SHAFT = 'off'   // shaft-02's town stair (the second project) has its own order test: town-stair.test.mjs

const S = await import('../src/shop.mjs')
const SK = await import('../src/skills.mjs')
const PJ = await import('../src/buildproj.mjs')

const NOW = 1_800_000_000_000
const st = (plot, o = {}) => ({ plot, exists: true, complete: false, damaged: false, ...o })

test('STUCKWAIT stuckBackoff: a stuck complete repair is only due; a stuck open project is not free; outside the window, or a bad stamp, nothing changes', () => {
  const states = [st('shop', { complete: true }), st('monument', { complete: true, damaged: true }), st('wall')]
  const at = { monument: NOW - 60_000 }
  const out = S.stuckBackoff(states, p => at[p] ?? null, NOW)
  assert.deepEqual(out[1], { ...states[1], damaged: false, due: true, stuck: true })
  assert.deepEqual(out[0], states[0]); assert.deepEqual(out[2], states[2])
  assert.equal(S.activeProject(out, S.PROJECTS.filter(p => ['shop', 'monument', 'wall'].includes(p.plot)).map(p => ({ ...p, after: undefined }))).plot, 'wall')
  // control: the same states with no stamp -> the repair first, as before
  assert.equal(S.activeProject(S.stuckBackoff(states, () => null, NOW), S.PROJECTS.filter(p => ['shop', 'monument', 'wall'].includes(p.plot)).map(p => ({ ...p, after: undefined }))).plot, 'monument')
  assert.deepEqual(S.stuckBackoff([st('monument')], () => NOW - 1000, NOW)[0], { ...st('monument'), free: false, stuck: true })
  for (const sa of [NOW - S.SHOP_STUCK_RETRY_MS, NOW + 120_000, NaN, null]) assert.deepEqual(S.stuckBackoff([st('monument')], () => sa, NOW)[0], st('monument'), `${sa}`)
  assert.deepEqual(S.stuckBackoff([st('monument')], () => { throw new Error('x') }, NOW)[0], st('monument'))
  assert.deepEqual(S.stuckBackoff([{ plot: 'wall', exists: false }], () => NOW, NOW)[0], { plot: 'wall', exists: false })
  assert.equal(S.stuckBackoff(states, null, NOW), states)
})

const HOME = { x: 0, y: 70, z: 0 }
const dir = () => process.env.POOL_STATE_DIR
const key = plot => PJ.projKey(HOME, plot)
const rec = (plot, blueprint, complete) => assert.equal(PJ.publishRecord(dir(), key(plot), () => ({ v: 1, blueprint, plot, cells: [{ at: [0, 0, 0], role: 'base', seg: 'a' }], segments: [{ seg: 'a', deps: [] }], structure_complete: complete, ...(complete ? { completeAt: 1 } : {}) })).result, 'accepted')

test('STUCKWAIT chain (shopActive on real files): the stuck ziggurat yields to the open wall; without the stamp the ziggurat stays first', async () => {
  rec('shop', 'workshop@1', true); rec('house1', 'house@1', true); rec('paths', 'paths@1', true)
  rec('monument', 'ziggurat@1', false); rec('wall', 'wall@1', false)
  const now = Date.now()
  assert.equal(SK.shopActive(null, now).plot, 'monument', 'control: the first open project with a slot')
  assert.ok(PJ.stuckWrite(dir(), key('monument'), 'showcase-Gale', { '-33,67,-33': { visits: 3 } }, { now, stuckAt: now - 60_000 }))
  assert.equal(SK.shopActive(null, now).plot, 'wall', 'the stuck ziggurat waits; the wall is worked')
  // the order's back-off reads the ACTIVE project's stuck stamp: the wall has none, so build_shop is issued again
  assert.equal(SK.shopStuckAt(now), null)
  assert.equal(S.buildOrder({ shared: true, atTown: true, now, planned: true, stuckAt: SK.shopStuckAt }).skip, null)
  // past the back-off the ziggurat is first again
  assert.equal(SK.shopActive(null, now + S.SHOP_STUCK_RETRY_MS + 1000).plot, 'monument')
})

test('STUCKWAIT MUTANT KILLED: without stuckBackoff in shopActive the stuck ziggurat holds the active slot (real files)', async () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const old = 'const waited = stuckBackoff(states, plot => projStuckAt(dir, projKeyOf(plot), { before: now + 60_000 }), now)'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-stuckwait-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, 'const waited = states').replace(/from '\.\//g, "from '../src/"))
  try {
    const M = await import(out.href)
    const now = Date.now()   // the same pool as the chain test: the ziggurat is stuck, the wall open
    assert.ok(PJ.stuckAt(dir(), key('monument')) > 0, 'precondition: the stuck stamp is there')
    assert.equal(M.shopActive(null, now).plot, 'monument', 'the mutant keeps the stuck project active')
    assert.ok(Number.isFinite(M.shopStuckAt(now)), 'and its order back-off holds every build_shop')
    assert.equal(SK.shopActive(null, now).plot, 'wall', 'the real module, same files')
  } finally { fs.unlinkSync(out) }
})

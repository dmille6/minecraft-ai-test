// WHSITE-01 rc2 (src/whsitefile.mjs, src/whsite.mjs whSiteOfSeed): the storehouse's site comes from the town's own site file when the
// environment names none -- and a file without the key, or with a bad one, is no project and breaks nothing else the file says.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-whsitefile-${process.pid}`
process.env.BOT_NAME = 'TestBot'
delete process.env.WAREHOUSE_SITE
const W = await import('../src/whsite.mjs')
const F = await import('../src/whsitefile.mjs')
const TP = await import('../src/townplan.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const P = n => new URL(`../src/${n}.mjs`, import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} in ${p.pathname} (a mutant that was never written reads as killed)`)
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (p, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(p, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const HOME = { x: 0, y: 70, z: 0 }
const KEY = { core: [38, -51, 62, -27], grow: [38, -58, 78, -18], floor: 68 }
const SITE = { core: [38, -51, 62, -27], grow: [38, -58, 78, -18], floor: 68 }
const seed = (warehouse, extra = {}) => ({ home: [0, 70, 0], town_plan: { template: 'ring@1', orientation: 'N', s: 70, avoid: [] }, ...(warehouse === undefined ? {} : { warehouse }), ...extra })

await t('the key is read by the switch\'s own rules; absent or malformed is NO PROJECT; another home\'s file is not this town\'s', async () => {
  assert.deepEqual(W.whSiteOfSeed(seed(KEY), HOME), SITE)
  assert.deepEqual(W.whSiteOfSeed({ home: { x: 0, y: 70, z: 0 }, warehouse: KEY }, HOME), SITE, 'home as an object')
  assert.deepEqual(W.whSiteOfSeed({ warehouse: KEY }, HOME), SITE, 'a file that names no home')
  assert.equal(W.whSiteOfSeed(seed(undefined), HOME), null, 'positive control above: no key, no project')
  for (const bad of [null, 'x', 5, [], {}, { core: KEY.core, grow: KEY.grow }, { ...KEY, floor: '68' }, { ...KEY, floor: 68.5 }, { ...KEY, core: [38, -51, 62] }, { ...KEY, core: ['38', -51, 62, -27] }, { ...KEY, core: [38, -51, 62, -27.5] },
    { ...KEY, core: [30, -51, 62, -27] } /* leaves the growth box */, { ...KEY, core: [62, -51, 38, -27] }, { ...KEY, grow: 'big' }, { ...KEY, floor: 999 }]) assert.equal(W.whSiteOfSeed(seed(bad), HOME), null, JSON.stringify(bad))
  assert.equal(W.whSiteOfSeed({ home: [400, 70, 0], warehouse: KEY }, HOME), null, 'another home')
  assert.equal(W.whSiteOfSeed(null, HOME), null); assert.equal(W.whSiteOfSeed('x', HOME), null)
  await killedBy(P('whsite'), W, 'if (home && h && (h.x !== home.x || h.y !== home.y || h.z !== home.z)) return null', '', M => assert.equal(M.whSiteOfSeed({ home: [400, 70, 0], warehouse: KEY }, HOME), null))
  await killedBy(P('whsite'), W, 'if (!ints(w.core) || !ints(w.grow) || !Number.isSafeInteger(w.floor)) return null', '', M => assert.equal(M.whSiteOfSeed(seed({ ...KEY, core: ['38', -51, 62, -27] }), HOME), null))
})

await t('THE REST OF THE FILE IS READ AS BEFORE: parseSeed gives the same answer with the key, without it, and with a broken one', () => {
  const base = TP.parseSeed(seed(undefined), { home: HOME })
  assert.equal(base.ok, true); assert.equal(base.use.orientation, 'N'); assert.equal(base.use.s, 70)
  for (const w of [KEY, 'garbage', { core: 'x' }, null, 7]) assert.deepEqual(TP.parseSeed(seed(w), { home: HOME }), base, `parseSeed is unchanged by warehouse=${JSON.stringify(w)}`)
})

await t('the environment first, then the file; `off` in the environment forces no project; no file is no project', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'whsite-'))
  assert.equal(F.whSiteNow({}, dir, HOME), null, 'no file')
  writeFileSync(path.join(dir, 'town-site.json'), JSON.stringify(seed(KEY)))
  assert.deepEqual(F.whSiteNow({}, dir, HOME), SITE, 'the file\'s key')
  assert.deepEqual(F.whSiteNow({ WAREHOUSE_SITE: '' }, dir, HOME), SITE, 'an empty switch is unset')
  assert.deepEqual(F.whSiteNow({ WAREHOUSE_SITE: '0,0,24,24/0,0,40,40/64' }, dir, HOME), { core: [0, 0, 24, 24], grow: [0, 0, 40, 40], floor: 64 }, 'the environment wins')
  for (const v of ['off', '0', 'false', 'no']) assert.equal(F.whSiteNow({ WAREHOUSE_SITE: v }, dir, HOME), null, `${v}: forced off`)
  assert.equal(F.whSiteNow({}, dir, { x: 400, y: 70, z: 0 }), null, 'another town\'s file')
  writeFileSync(path.join(dir, 'town-site.json'), '{ not json')
  assert.equal(F.whSiteNow({}, dir, HOME), null, 'an unreadable file')
  writeFileSync(path.join(dir, 'town-site.json'), JSON.stringify(seed({ core: 'x' })))
  assert.equal(F.whSiteNow({}, dir, HOME), null, 'a malformed key')
  assert.equal(W.whSiteEnvOff({}), false); assert.equal(W.whSiteEnvOff({ WAREHOUSE_SITE: 'off' }), true); assert.equal(W.whSiteEnvOff({ WAREHOUSE_SITE: '1,2,3,4/1,2,3,4/5' }), false)
  // the town's directory and home are the configuration's own (config.mjs names and defaults; worldfacts.mjs poolStateDir's rule)
  assert.equal(F.townDirOf({ STATE_DIR: '/a/b/state', MEMORY_POOL: 'showcase' }), '/a/b/_pool-showcase'); assert.equal(F.townDirOf({ POOL_STATE_DIR: '/p', STATE_DIR: '/a/b/state' }), '/p')
  assert.equal(F.townDirOf({}), '/srv/minecraft/bots/_pool-hive'); assert.deepEqual(F.homeOf({}), { x: 0, y: 70, z: 0 }); assert.deepEqual(F.homeOf({ HOME_X: '400', HOME_Y: '64', HOME_Z: '-8' }), { x: 400, y: 64, z: -8 })
  const cfg = readFileSync(P('config'), 'utf8'), wf = readFileSync(P('worldfacts'), 'utf8')
  for (const line of ["pool: req('MEMORY_POOL', 'hive'),", "homeX: Number(req('HOME_X', '0')),", "homeY: Number(req('HOME_Y', '70')),", "homeZ: Number(req('HOME_Z', '0')),", "stateDir: req('STATE_DIR', '/srv/minecraft/bots/state'),"]) assert.equal(cfg.split(line).length, 2, `config.mjs still reads ${line}`)
  assert.equal(wf.split("return process.env.POOL_STATE_DIR ||\n         path.join(path.dirname(stateDir), `_pool-${pool}`)").length, 2, 'worldfacts.mjs poolStateDir is still this rule')
  // this process: no switch, no site file in the test's pool directory -- no project (the default the release ships with)
  assert.equal(W.WHSITE.on, false)
  const shop = readFileSync(P('shop'), 'utf8')
  assert.ok(shop.indexOf("export { whSiteNow } from './whsitefile.mjs'") >= 0 && shop.indexOf("export { whSiteNow } from './whsitefile.mjs'") < shop.indexOf('export const PROJECTS'), 'the site is set before the project list is built')
})

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)

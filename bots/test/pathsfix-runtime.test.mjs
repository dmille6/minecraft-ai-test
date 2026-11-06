// PATHSFIX-01 AT RUNTIME (skills.mjs shopActive over real record files in a temp pool dir): an UNSITED paths record (no_site, not
// complete) is SETTLED for the order -- the wall after the paths starts -- and, once due, its retry is a repair (first); and the
// rollback (Codex r1 BLOCK 1): PATHSFIX=off reads the same persisted record complete, as the base read its own, so the wall never
// waits behind a record this code wrote.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathsfix-rt-'))
process.env.POOL_STATE_DIR = dir
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pathsfix-rt-logs-'))
process.env.BOT_NAME = 'PathsBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '71'; process.env.HOME_Z = '0'
for (const k of ['SHAFT', 'SHAFT_POOLS', 'HOUSE', 'PATHS', 'PATHS_POOLS', 'WALL', 'PATHSFIX']) delete process.env[k]
process.env.MONUMENT = 'off'; process.env.TREEFARM = 'off'; process.env.TIDY = 'off'
const { config } = await import('../src/config.mjs')
const PJ = await import('../src/buildproj.mjs')
const K = await import('../src/skills.mjs')
const P = await import('../src/paths.mjs')
const S = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const home = { x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }
const key = plot => PJ.projKey(home, plot)
const done = (plot, blueprint) => ({ v: 1, blueprint, plot, structure_complete: true, state: 'complete', completeAt: 1, cells: [] })
const bot = { username: 'PathsBot', blockAt: () => null }

console.log('THE ORDER WITH AN UNSITED PATHS RECORD')
const list = S.projectsOn().map(p => p.plot)
await t('the projects on here: the workshop, the stair, the house, the paths, the wall (the wall waits on the paths)', () => {
  for (const p of ['shop', 'house1', 'paths', 'wall']) assert.ok(list.includes(p), `${p} in ${list}`)
})
for (const [plot, bp] of [['shop', 'workshop@1'], ['shaft', 'shaft@2'], ['house1', 'house@1']]) PJ.publishRecord(dir, key(plot), () => done(plot, bp))
let now = Date.now()
const later = () => (now += 61_000)
await t('an unsited record not yet due: SETTLED -- the wall is the project (CONTROL: no paths record -> the paths)', () => {
  assert.strictEqual(K.shopActive(bot, later()).plot, 'paths', 'CONTROL: no paths record yet')
  const r = P.pathsNoSite({ home, now, by: 'X', why: 'unrouted:shop:unreachable', fix: true })
  assert.strictEqual(r.structure_complete, false)
  assert.strictEqual(PJ.publishRecord(dir, key('paths'), () => r).result, 'accepted')
  assert.strictEqual(K.shopActive(bot, later()).plot, 'wall')
})
await t('the same record DUE: its retry is a repair, first -- before the open wall', () => {
  const t1 = now + P.PATHS_UNSITED_RETRY_MS + 1
  assert.strictEqual(K.shopActive(bot, t1).plot, 'paths')
})
await t('Codex r1 BLOCK 1 -- PATHSFIX=off: the persisted unsited record reads complete (the base): the wall, not the paths', () => {
  const run = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const K = await import('./src/skills.mjs'); console.log(JSON.stringify({ pick: K.shopActive({ username: 'PathsBot', blockAt: () => null }, Date.now() + 61000).plot }))`],
  { cwd: new URL('..', import.meta.url), env: { ...process.env, PATHSFIX: 'off' }, encoding: 'utf8' }).trim().split('\n').pop()
  assert.strictEqual(JSON.parse(run).pick, 'wall')
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

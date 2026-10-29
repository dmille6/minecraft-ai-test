// CHESTREACH-01: a deposit whose walk to the chest found no route from OUTSIDE town walks home, then deposits once more.
// Measured 24 h to 10-28 22:30Z (ES, 80 bots): 164 of 386 deposits failed "could not reach the chest"; 141 in under 1 s with
// nothing moved, 121 of those from 3+ blocks below the chest (a mine under town); 81 repeated on the next deposit; 15 went home.
// Behaviour through the real deposit skill on the fake world (fakeworld.mjs), and the refusal CHAIN: far no-path -> home ->
// retry -> (in-town no-path -> the town sweep).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-chestreach-logs-'))
process.env.BOT_NAME = 'ReachBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
// the deposit's clock IS config.skills.defaultTimeoutMs (the runner sets 300 ms per file); these tests are about that clock
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.PLINTH_FIRST = '0'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-chestreach-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const { homeFirst, HOME_RETRY_MIN_MS, townKey } = await import('../src/chestfull.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }
const RECS = []
tapRecords(r => RECS.push(r))
const retryRows = () => RECS.filter(r => r.skill?.name === '_deposit_home_retry')
const run = (bot, runner = undefined, skills = SKILLS) => skills.deposit.run({ bot, runner }, {}, new AbortController().signal)
const KEY = townKey({ x: 0, y: 64, z: 0 })
const memEntry = k => { try { return JSON.parse(fs.readFileSync(path.join(process.env.POOL_STATE_DIR, `${KEY}.containers.json`), 'utf8')).entries[k] } catch { return undefined } }
/** A town (home 0,64,0) with an EMPTY chest at 5,64,0 and the bot deep under it; walks from below y 60 find no route. */
const underTown = (at = [3.5, 44, 0.5]) => {
  freshPool()
  const w = fakeWorld({ bag: [stack('oak_log', 30)], at })
  w.set(5, 64, 0, 'chest')
  const goto = w.bot.pathfinder.goto
  w.homeGoals = 0
  w.bot.pathfinder.goto = async g => {
    if (g.constructor?.name !== 'GoalBlock' && g.x === 0 && g.z === 0) w.homeGoals++
    if (w.bot.entity.position.y < 60 && !(g.x === 0 && g.z === 0)) throw new Error('No path to the goal!')
    return goto(g)
  }
  return w
}

console.log('THE DECISION (pure)')
await t('homeFirst: only a no-path/timeout walk from OUTSIDE town, once, with time left; never a sweep attempt or an interruption', () => {
  const ok = { kind: 'no_path', beganInTown: false, noRecovery: false, homed: false, leftMs: HOME_RETRY_MIN_MS }
  assert.strictEqual(homeFirst(ok), true)
  assert.strictEqual(homeFirst({ ...ok, kind: 'timeout' }), true)
  assert.strictEqual(homeFirst({ ...ok, kind: 'interrupted' }), false, 'someone else has the pathfinder')
  assert.strictEqual(homeFirst({ ...ok, kind: 'other' }), false)
  assert.strictEqual(homeFirst({ ...ok, beganInTown: true }), false, 'the town sweep handles a walk from town')
  assert.strictEqual(homeFirst({ ...ok, noRecovery: true }), false, "the sweep's own attempts are unchanged")
  assert.strictEqual(homeFirst({ ...ok, homed: true }), false, 'once per deposit')
  assert.strictEqual(homeFirst({ ...ok, leftMs: HOME_RETRY_MIN_MS - 1 }), false, 'not enough time to walk home and deposit')
})

console.log('THE CHAIN (the real deposit skill)')
await t('POSITIVE CONTROL: the same world, the bot already in town, deposits straight into the chest (no walk home)', async () => {
  const w = underTown([3.5, 64, 2.5])
  const r = await run(w.bot)
  assert.strictEqual(r.status, 'success', r.detail)
  assert.strictEqual(w.homeGoals, 0)
})
await t('a deposit from a mine UNDER town walks home, then deposits into the chest it could not reach', async () => {
  const w = underTown()
  const n0 = retryRows().length
  const r = await run(w.bot)
  assert.strictEqual(r.status, 'success', r.detail)
  assert.ok(w.homeGoals >= 1, 'it walked home')
  assert.match(r.detail, /after walking home: the chest at 5,64,0 was out of reach from 3,44,0/)
  assert.ok(w.spy.opened.includes('5,64,0'))
  const row = retryRows().slice(n0)
  assert.strictEqual(row.length, 1); assert.match(row[0].skill.detail, /chest=5,64,0 from=3,44,0 why=no_path home=success retry=success/)
})
await t('COMPOSED with the town sweep: the chest is unreachable from town too -> after home the sweep banks into the barrel', async () => {
  const w = underTown()
  w.set(-5, 64, 0, 'barrel')
  const inner = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = async g => { if (g.x === 5 && g.z === 0) throw new Error('No path to the goal!'); return inner(g) }
  const r = await run(w.bot)
  assert.strictEqual(r.status, 'success', r.detail)
  assert.ok(w.spy.opened.includes('-5,64,0'), 'the sweep opened the barrel')
  assert.ok(!w.spy.opened.includes('5,64,0'))
  assert.strictEqual(memEntry('5,64,0')?.o, 'unknown', 'the retry from town struck the unreachable chest, as any in-town walk does')
})
await t('home fails (the bot cannot leave the mine): ONE walk home, one retry, a failure that names both -- no loop', async () => {
  const w = underTown()
  const inner = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = async g => { if (g.x === 0 && g.z === 0) { w.homeGoals++; throw new Error('No path to the goal!') } return inner(g) }
  const n0 = retryRows().length
  const r = await run(w.bot)
  assert.strictEqual(r.status, 'failed', r.detail)
  assert.match(r.detail, /^could not reach the chest at 5,64,0/)
  assert.match(r.detail, /\[after walking home: failed\]/)
  assert.strictEqual(retryRows().length - n0, 1, 'one retry')
  assert.strictEqual(memEntry('5,64,0'), undefined, 'never in town: no strike')
})
await t('an INTERRUPTED walk from the mine does not walk home', async () => {
  const w = underTown()
  w.bot.pathfinder.goto = async g => { if (g.x === 0 && g.z === 0) w.homeGoals++; throw new Error('The goal was changed before it could be completed!') }
  const r = await run(w.bot)
  assert.strictEqual(r.failClass, 'path_interrupted', r.detail)
  assert.strictEqual(w.homeGoals, 0)
})
await t('less than HOME_RETRY_MIN_MS left: the failure stands, no walk home', async () => {
  const w = underTown()
  const r = await run(w.bot, { current: { startedAt: Date.now() - (180_000 - HOME_RETRY_MIN_MS + 5_000) } })
  assert.strictEqual(r.status, 'failed', r.detail)
  assert.match(r.detail, /^could not reach the chest at 5,64,0: No path/)
  assert.strictEqual(w.homeGoals, 0)
})
await t('MUTANT KILLED: without the home-first branch the mine deposit fails exactly as measured', async () => {
  const p = new URL('../src/skills.mjs', import.meta.url)
  const src = readFileSync(p, 'utf8')
  const old = 'if (homeFirst({ kind, beganInTown: walkBeganInTown, noRecovery, homed, leftMs: msLeft(Infinity) })) {'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, 'if (false) {').replace(/from '\.\//g, "from '../src/"))
  try {
    const mod = await import(out.href)
    const w = underTown()
    const r = await run(w.bot, undefined, mod.SKILLS)
    assert.strictEqual(r.status, 'failed', 'the mutant still deposited: the test above proves nothing')
    assert.match(r.detail, /could not reach the chest at 5,64,0: No path/)
  } finally { try { unlinkSync(out) } catch {} }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
process.exit(0)

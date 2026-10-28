// ironsmelt-01's shared test fixture (the town, the index writers, withMutant, the harness): imported by the four
// ironsmelt*.test.mjs files. Not a test file itself (no .test.mjs), so the runner never runs it alone.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ironsmelt-logs-'))
process.env.BOT_NAME = 'IronSmeltBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'shared'; process.env.MEMORY_POOL = 'hive-test'
process.env.SKILL_TIMEOUT_MS = '180000'   // withdraw's clock is the skill timeout; the suite's 300 ms leaves no walk
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'            // as toolkit/kitsearch: this fake town has no junk well by construction
delete process.env.SMELT_JOB   // IRONSMELT / SMELT_RULEOUT are each test file's (set before importing this)
const freshPool = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ironsmelt-pool-')) }
freshPool()

const SJ = await import('../src/smeltjob.mjs')
const S0 = await import('../src/skills.mjs')
const CF = await import('../src/chestfull.mjs')
const TI = await import('../src/townindex.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const FW = await import('./fakeworld.mjs')
const { fakeWorld, stack } = FW

export const score = { pass: 0, fail: 0 }
const t = async (name, fn) => {
  try { await fn(); score.pass++; console.log(`  PASS  ${name}`) } catch (e) { score.fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const sig = () => new AbortController().signal
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SJ_PATH = new URL('../src/smeltjob.mjs', import.meta.url)
// climb-escape.test.mjs's withMutant: the anchor must be present AND unique, or the "kill" is no kill
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

const HOME = { x: 0, y: 64, z: 0 }
const memDir = () => process.env.POOL_STATE_DIR
const HK = TI.indexHomeKey(HOME)
const count = (slots, name) => slots.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const kOf = ([x, y, z]) => `${x},${y},${z}`
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
/** smeltsearch.test.mjs's town: 9 single chests (the bot at 6.5,64,0.5), each holding dirt unless set; COPPER the nearest. */
const CHESTS = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4]]
const NEAR = CHESTS[0], FAR = CHESTS[7]
function town ({ bag = [stack('cobblestone', 3)], stock = {} } = {}) {
  freshPool(); clearWithdrawHolds(); TI.resetIndexCache(); offset += 3 * 60 * 60_000      // a fresh town; every earlier miss stale
  const w = withServer(fakeWorld({ bag: bag.map((s, i) => ({ ...s, slot: 9 + i })) }))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  for (const [k, items] of Object.entries(stock)) w.stock(...k.split(',').map(Number), items)
  return w
}
const chest = (w, c) => w.containers.get(kOf(c)).slots
const townTotal = (w, name) => CHESTS.reduce((n, c) => n + count(chest(w, c), name), 0)
const job = (S, w, ctx = {}) => S.SKILLS.smelt_town.run({ bot: w.bot, ...ctx }, {}, sig())
const lastRow = () => RECS.filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? ''
const field = (row, k) => (row.match(new RegExp(`(?:^| )${k}=(\\S+)`)) || [])[1]
/** An index observation of container `c` (what an open by any skill writes: townindex.mjs), with `names` the server's contents. */
const seenByIndex = (c, names = { dirt: [5, 1] }, at = Date.now()) =>
  TI.appendIndex(memDir(), HK, null, { t: 'obs', id: `o-${at}-${kOf(c)}-${Math.random().toString(36).slice(2, 6)}`, k: kOf(c), h: [kOf(c)], at, bot: 'Other', by: 'count_town', names, used: 1, size: 27 })
// smeltgate-01: what the deposit verb writes for one move -- its xfer record (ok 0), then the closing mark
const depositByIndex = (c, name, n, at = Date.now()) => {
  TI.appendIndex(memDir(), HK, null, { t: 'xfer', id: `x-${at}-${kOf(c)}-${name}`, op: `op-${at}`, pre: null, ver: null, gen: null, bot: 'Other', by: 'deposit', at, k: kOf(c), h: [kOf(c)], slot: null, name, n, ok: 0 })
  return dirtyByIndex(c, at + 1)
}
const dirtyByIndex = (c, at = Date.now()) =>
  TI.appendIndex(memDir(), HK, null, { t: 'dirty', id: `d-${at}-${kOf(c)}`, k: kOf(c), h: [kOf(c)], at, bot: 'Other', by: 'deposit', phase: 'post', op: `op-${at}` })


export const done = () => { Date.now = realNow; console.log(`\n${score.pass} passed, ${score.fail} failed`); process.exit(score.fail ? 1 : 0) }
export { CF, CHESTS, FAR, FW, HK, HOME, NEAR, RECS, S0, SJ, SJ_PATH, SKILLS_PATH, TI, chest, clearWithdrawHolds, count, depositByIndex, dirtyByIndex, fakeWorld, field, freshPool, job, kOf, killedBy, lastRow, later, memDir, offset, realNow, seenByIndex, sig, stack, t, tapRecords, town, townTotal, withMutant, withServer }

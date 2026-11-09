// CHESTCARRY-01 (OWNER 11-09, approved): a chest the bot ALREADY CARRIES is placed as town storage past the 4-a-day budget on
// NEW chests (up to NEW_CHESTS_PER_DAY_CARRIED, standing up to MAX_RECOVERY_CHESTS_CARRIED); a chest that would be CRAFTED keeps
// the base's 4 a day. The budget is tested by what it returns; the refusal chain is driven THROUGH THE REAL deposit skill over
// chest-full.test.mjs's fake world (a full town chest, four claims already spent today). Every mutant's anchor is asserted
// present and unique, and each is killed.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-chestcarry-logs-'))
process.env.BOT_NAME = 'CarryBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.PLINTH_FIRST = '0'
delete process.env.CHESTCARRY
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-chestcarry-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const CF = await import('../src/chestfull.mjs')
const { chestBudget, readClaims, writeClaimState, townKey, DAY_MS, NEW_CHEST_INTERVAL_MS, NEW_CHESTS_PER_DAY, NEW_CHESTS_PER_DAY_CARRIED,
        MAX_RECOVERY_CHESTS, MAX_RECOVERY_CHESTS_CARRIED } = CF
const { SKILLS } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, total } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const lastRow = () => RECS.filter(r => r.skill?.name === '_deposit_new_chest').at(-1)?.skill?.detail ?? ''
const HOME = { x: 0, y: 64, z: 0 }
const KEY = townKey(HOME)
const town = (bag, at) => { freshPool(); const w = fakeWorld({ bag, at }); w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0); return w }
const pastClaim = (dir, n, at, state = 'placed') => {
  fs.writeFileSync(path.join(dir, `${KEY}.c${n}.json`), JSON.stringify({ x: 30 + n, y: 64, z: 30, world: null, at: new Date(at).toISOString() }))
  writeClaimState(dir, KEY, n, state, at)
}
/** The town has already made its four new chests today (1-4 h ago: past the interval, inside the day). */
const spentToday = dir => { for (let n = 1; n <= NEW_CHESTS_PER_DAY; n++) pastClaim(dir, n, Date.now() - n * 3600_000) }

// ---------------------------------------------------------------- the budget ---
const now = 100 * DAY_MS
const c = (at, state = 'placed') => ({ n: 1, at, state, world: null })
await t('chestBudget: four today refuses a crafted chest and admits a CARRIED one; the carried day limit and the interval still bind', () => {
  const four = [1, 2, 3, 4].map(h => c(now - h * 3600_000))
  assert.match(String(chestBudget({ claims: four, now, on: true }).why), /used its new-chest budget \(4 in 24 h\)/, 'crafted: the base')
  assert.equal(chestBudget({ claims: four, now, carried: true, on: true }).ok, true, 'carried: past the four')
  const full = Array.from({ length: NEW_CHESTS_PER_DAY_CARRIED }, (_, i) => c(now - (i + 1) * 1200_000))
  assert.match(String(chestBudget({ claims: full, now, carried: true, on: true }).why), /used its new-chest budget \(16 in 24 h\)/, 'carried: its own day limit')
  assert.equal(chestBudget({ claims: [c(now - 60_000)], now, carried: true, on: true }).ok, false, 'one new chest per town per 10 min, carried or not')
  assert.equal(chestBudget({ claims: [c(now - NEW_CHEST_INTERVAL_MS)], now, carried: true, on: true }).ok, true)
})
await t('chestBudget: standing recovery chests -- 12 for a crafted chest, 24 for a carried one', () => {
  const stand = k => Array.from({ length: k }, (_, i) => c(now - DAY_MS - i * 3600_000))
  assert.equal(chestBudget({ claims: stand(MAX_RECOVERY_CHESTS), now, on: true }).ok, false)
  assert.equal(chestBudget({ claims: stand(MAX_RECOVERY_CHESTS), now, carried: true, on: true }).ok, true)
  assert.match(String(chestBudget({ claims: stand(MAX_RECOVERY_CHESTS_CARRIED), now, carried: true, on: true }).why), /24 chests made for overflow standing/)
})
await t('CHESTCARRY=off: a carried chest has the base budget (in a fresh process)', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import('${path.join(SRC, 'chestfull.mjs')}').then(m => { const now = 100 * m.DAY_MS; const four = [1,2,3,4].map(h => ({ n: 1, at: now - h * 3600000, state: 'placed', world: null })); console.log(JSON.stringify([m.chestCarryOn(), m.chestBudget({ claims: four, now, carried: true }).ok])) })`],
  { env: { ...process.env, CHESTCARRY: 'off' }, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(r.stdout), [false, false], r.stderr)
})

// ---------------------------------------------------------------- THE CHAIN, through the real deposit ---
async function carriedChain (S = SKILLS) {
  const w = town([stack('oak_log', 64), stack('oak_log', 30), stack('chest', 1), stack('apple', 5)])
  const dir = process.env.POOL_STATE_DIR
  spentToday(dir)
  const before = total(w.bag)
  const r = await S.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
  return { w, r, before, dir }
}
await t('THE CHAIN: town chest full, four new chests already today, a chest IN THE BAG -> it is placed and the deposit banks into it', async () => {
  const { w, r, before, dir } = await carriedChain()
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.placed.length, 1, 'the carried chest was placed')
  assert.equal(w.spy.recipesFor + w.spy.craft, 0, 'nothing crafted')
  assert.equal(w.bag.find(i => i.name === 'chest')?.count ?? 0, 0)
  const banked = w.containers.get(w.spy.placed[0]).slots.filter(Boolean).reduce((n, s) => n + s.count, 0)
  assert.ok(banked > 0, 'banked into the new chest')
  assert.equal(total(w.bag), before - banked - 1, 'conservation')
  assert.match(lastRow(), /^decision=place_carried /)
  assert.equal(readClaims(dir, KEY).length, NEW_CHESTS_PER_DAY + 1, 'the fifth claim of the day is on the ledger')
})
await t('THE CHAIN, crafted: the same town with NO chest in the bag is refused at the budget -- nothing crafted, nothing placed', async () => {
  const w = town([stack('oak_log', 64), stack('oak_log', 30), stack('apple', 5)])
  spentToday(process.env.POOL_STATE_DIR)
  const r = await SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
  assert.notEqual(r.status, 'success')
  assert.match(String(r.detail), /new-chest budget \(4 in 24 h\)/, r.detail)
  assert.equal(w.spy.placed.length, 0); assert.equal(w.spy.recipesFor + w.spy.craft, 0)
})

// ---------------------------------------------------------------- mutants ---
async function withMutant (file, pairs, fn) {
  const p = path.join(SRC, file)
  let src = fs.readFileSync(p, 'utf8')
  for (const [old, neu] of pairs) { assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${old.slice(0, 70)}`); src = src.replace(old, neu) }
  const tmp = path.join(SRC, `_mut_${process.pid}_${Math.random().toString(36).slice(2)}_${file}`)
  fs.writeFileSync(tmp, src)
  try { return await fn(await import(`${tmp}?${Date.now()}`)) } finally { fs.unlinkSync(tmp) }
}
await t('MUTANT KILLED: the deposit judging the budget without `carried` (the base) refuses the carried chest', async () => {
  await withMutant('skills.mjs', [["  budget = chestBudget({ claims, world, carried: !!carried })", '  budget = chestBudget({ claims, world })']], async M => {
    const { r, w } = await carriedChain(M.SKILLS)
    assert.notEqual(r.status, 'success', 'the mutant placed it anyway: the chain proves nothing')
    assert.equal(w.spy.placed.length, 0)
  })
})
await t('MUTANT KILLED: the claim taken without `carried` refuses at the ledger after the budget said yes', async () => {
  await withMutant('skills.mjs', [["claimNewChest({ dir, key, site, world, carried: !!carried })", 'claimNewChest({ dir, key, site, world })']], async M => {
    const { r, w } = await carriedChain(M.SKILLS)
    assert.notEqual(r.status, 'success'); assert.equal(w.spy.placed.length, 0)
  })
})
await t('MUTANT KILLED: carried always (no tie to the bag) lets a crafted chest past the four', async () => {
  await withMutant('chestfull.mjs', [['  const perDay = carried && on ? NEW_CHESTS_PER_DAY_CARRIED : NEW_CHESTS_PER_DAY', '  const perDay = on ? NEW_CHESTS_PER_DAY_CARRIED : NEW_CHESTS_PER_DAY']], async M => {
    const four = [1, 2, 3, 4].map(h => c(now - h * 3600_000))
    assert.equal(M.chestBudget({ claims: four, now, on: true }).ok, true, 'the mutant refused the crafted chest anyway')
  })
})

console.log(`\nchestcarry: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

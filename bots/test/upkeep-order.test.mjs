// UPKEEP-01 FLEET PORT: THE ORDER'S COMPLETION CHECK (Codex fleet r1 BLOCKER). cognitive.mjs issues build_shop
// for the active pick only while `!(rec.structure_complete && !shopDamaged(bot, rec))`: a complete record must read "damaged" there
// (recordDamaged with `tidy` on) when it wants a visit. Without it a stale upkeep list (complete, due to its next survey) was
// refused `complete` for good. On real record files in a pool directory, through the
// exported shopDamaged; each rule's mutant fails.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-uorder-logs-'))
process.env.BOT_NAME = 'OrderBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'hive-a'   // a named pool: the upkeep on by default
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-uorder-pool-'))
delete process.env.UPKEEP; delete process.env.GROUNDSKEEPER; delete process.env.LANDPLAN; delete process.env.TIDY
const PJ = await import('../src/buildproj.mjs')
const HOME = { x: 0, y: 70, z: 0 }
const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
// a bot that sees an empty world (no drops, no blocks read: every listed job reads unread = left)
const bot = () => ({ username: 'OrderBot', blockAt: () => null, entities: {}, inventory: { items: () => [], emptySlotCount: () => 30 }, entity: { position: { x: 0, y: 70, z: 0 } } })
const fresh = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-uorder-pool-')) }
const pub = (plot, body) => PJ.publishRecord(process.env.POOL_STATE_DIR, PJ.projKey(HOME, plot), () => body)
async function withMutant (old, neu, fn) {
  const src = fs.readFileSync(SRC, 'utf8')
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = path.join(path.dirname(SRC), `_mutant-skills-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const SK = await import('../src/skills.mjs')
const UK = await import('../src/upkeep.mjs')

console.log('THE UPKEEP: a stale list wants its survey; a fresh quiet one does not')
await t('a complete upkeep list due its survey reads as wanting a visit (the order is issued); a fresh quiet one reads complete', async () => {
  const stale = { ...UK.upkeepRecord({ clear: [], cells: [] }, { home: HOME, now: Date.now() - 31 * 60_000 }) }
  const quiet = { ...UK.upkeepRecord({ clear: [], cells: [] }, { home: HOME, now: Date.now() }) }
  const scenario = M => {
    const b1 = bot(); assert.strictEqual(M.shopDamaged(b1, stale), true, 'stale: the order goes')
    const b2 = bot(); assert.strictEqual(M.shopDamaged(b2, quiet), false, 'quiet: complete')
  }
  await scenario(SK)
  let killed = false
  await withMutant("    if (r?.blueprint === UPKEEP_BLUEPRINT) return tidy && upkeepStateNow(bot, r).due\n", '\n', async M => { try { await scenario(M) } catch (e) { if (e instanceof assert.AssertionError) killed = true } })
  assert.ok(killed, 'the mutant (no upkeep case) survived')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

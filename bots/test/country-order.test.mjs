// COUNTRY-01 + UPKEEP-01: THE ORDER'S COMPLETION CHECK (Codex fleet r1 BLOCKER, the showcase's too). cognitive.mjs issues build_shop
// for the active pick only while `!(rec.structure_complete && !shopDamaged(bot, rec))`: a complete record must read "damaged" there
// (recordDamaged with `tidy` on) when it wants a visit. Without it a stale upkeep list (complete, due to its next survey) and a quiet
// inside while the country wants a band were refused `complete` for good. On real record files in a pool directory, through the
// exported shopDamaged; each rule's mutant fails.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-corder-logs-'))
process.env.BOT_NAME = 'OrderBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'hive-a'   // a named pool: the groundskeeper, the land plan, the country lane and the upkeep on by default
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-corder-pool-'))
delete process.env.COUNTRY; delete process.env.UPKEEP; delete process.env.GROUNDSKEEPER; delete process.env.LANDPLAN; delete process.env.TIDY
const PJ = await import('../src/buildproj.mjs')
const HOME = { x: 0, y: 70, z: 0 }
const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
// a bot that sees an empty world (no drops, no blocks read: every listed job reads unread = left)
const bot = () => ({ username: 'OrderBot', blockAt: () => null, entities: {}, inventory: { items: () => [], emptySlotCount: () => 30 }, entity: { position: { x: 0, y: 70, z: 0 } } })
const fresh = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-corder-pool-')) }
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

console.log('THE COUNTRY: a quiet inside wants its crew while the country wants a band')
await t('a complete inside stage, nothing due: complete with no country work; wanting a visit while the country has no record yet (a band to site)', async () => {
  const tidyRec = { v: 1, blueprint: 'tidy@1', plot: 'tidy', stageId: 'inwall', terraceV: 1, cells: [], cut: [], clear: [], structure_complete: true, completeAt: Date.now() }
  const scenario = M => {
    fresh()
    pub('country', { ...UK.upkeepRecord({ clear: [], cells: [] }, { home: HOME }), blueprint: 'country@1', plot: 'country', stageId: 'c128', structure_complete: true, completeAt: Date.now(), cells: [] })
    assert.strictEqual(M.shopDamaged(bot(), tidyRec), false, 'the country quiet: complete')
    fresh()
    assert.strictEqual(M.shopDamaged(bot(), tidyRec), true, 'no country record: the keeper is ordered to site c48')
  }
  await scenario(SK)
  let killed = false
  await withMutant("    const v = recordDamaged(bot, r) || (r?.blueprint === TIDY_BLUEPRINT && COUNTRY_ON && GROUNDS.on && LANDP.on && countryDemandNow() != null)\n", '    const v = recordDamaged(bot, r)\n', async M => { try { await scenario(M) } catch (e) { if (e instanceof assert.AssertionError) killed = true } })
  assert.ok(killed, 'the mutant (no country case) survived')
})

await t('Codex r7 BLOCKER: shopActive\'s tidy state stays the inside\'s own read -- a quiet inside with an OPEN country band reads OPEN (the crew\'s finite tier), never due (behind the sinks)', async () => {
  fresh()
  pub('shop', { v: 1, blueprint: 'workshop@1', plot: 'shop', cells: [], segments: [], structure_complete: true, completeAt: 1 })
  pub('tidy', { v: 1, blueprint: 'tidy@1', plot: 'tidy', stageId: 'inwall', terraceV: 1, cells: [], cut: [], clear: [], segments: [], structure_complete: true, completeAt: Date.now() })
  pub('country', { v: 1, blueprint: 'country@1', plot: 'country', stageId: 'c48', cells: [{ at: [40, 70, 0], role: 'earth', seg: 'T-00-0' }], cut: [], clear: [], segments: [{ seg: 'T-00-0', deps: [] }], structure_complete: false })
  SK.shopActiveForget()
  const b = bot()
  SK.shopActive(b, Date.now())
  const ti = (SK.shopActiveStates() ?? []).find(q => q.plot === 'tidy')
  assert.ok(ti && ti.exists && ti.complete === false && ti.due === false && ti.country === 'open', JSON.stringify(ti))
  assert.strictEqual(SK.shopDamaged(bot(), { v: 1, blueprint: 'tidy@1', plot: 'tidy', stageId: 'inwall', terraceV: 1, structure_complete: true, completeAt: Date.now() }), true, 'and the order goes')
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

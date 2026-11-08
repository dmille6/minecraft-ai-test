// LOGCAP-02 (OWNER 11-08: a town log gathering cap): the town-store logs batch has no means while the town holds more than
// LOGCAP_HIGH logs, and gets them back only at or below LOGCAP_LOW; an open logs batch is met at once when the town is capped;
// the personal wood rungs (tool crafting) never read the cap; a capped bot already holding its wood keep is told so in the
// TOWN WOOD line. Behaviour on the pure functions and on the real MilestoneController; anchored mutants at the end.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const LC = await import('../src/logcap.mjs')
const IW = await import('../src/idlework.mjs')
const MS = await import('../src/milestones.mjs')
const PR = await import('../src/prompt.mjs')
const { config } = await import('../src/config.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const CFG = { on: true, high: 1024, low: 768, src: 'default' }
const ALL = { iron: true, logs: true, coal: true, grounds: true }
const NONE_BUT_LOGS = { iron: false, logs: true, coal: false, grounds: false }

// ---- the setting ----
await t('logCapConfig: defaults 1024/768; a valid env pair; anything else -> the defaults (src=invalid); LOGCAP=0|off -> off', () => {
  assert.deepEqual(LC.logCapConfig({}), { on: true, high: 1024, low: 768, src: 'default' })
  assert.deepEqual(LC.logCapConfig({ LOGCAP_HIGH: '2048', LOGCAP_LOW: '1536' }), { on: true, high: 2048, low: 1536, src: 'env' })
  assert.deepEqual(LC.logCapConfig({ LOGCAP_HIGH: '2048' }), { on: true, high: 2048, low: 768, src: 'env' })
  for (const bad of [{ LOGCAP_HIGH: '700' }, { LOGCAP_LOW: '400' }, { LOGCAP_HIGH: 'lots' }, { LOGCAP_HIGH: '900', LOGCAP_LOW: '900' }, { LOGCAP_LOW: '-1' }, { LOGCAP_HIGH: '1e4' }]) {
    const c = LC.logCapConfig(bad)
    assert.deepEqual([c.high, c.low, c.src], [1024, 768, 'invalid'], JSON.stringify(bad))
  }
  for (const v of ['0', 'off', 'OFF', ' no ', 'false']) assert.equal(LC.logCapConfig({ LOGCAP: v }).on, false, v)
  assert.equal(LC.logCapConfig({ LOGCAP: '1' }).on, true)
})
await t('townLogsIn: every species and stems; planks, saplings and wood blocks are not logs', () => {
  assert.equal(LC.townLogsIn({ oak_log: 900, birch_log: 100, jungle_log: 30, crimson_stem: 2, oak_planks: 400, oak_sapling: 50, oak_wood: 7, stripped_oak_log: 3 }), 1035)
  assert.equal(LC.townLogsIn({}), 0)
  assert.equal(LC.townLogsIn(null), 0)
})

// ---- the decision ----
await t('logCapNext: capped only ABOVE high, uncapped only AT OR BELOW low, the band holds the previous decision', () => {
  const N = 1_000_000
  const at = (logs, prev = null, coverage = 1) => LC.logCapNext(prev, { ok: true, logs, coverage }, CFG, N)
  assert.equal(at(1024).capped, false, '1024 is not above 1024')
  assert.equal(at(1025).capped, true)
  assert.equal(at(1025).why, 'above_high')
  const on = at(4247)
  assert.equal(at(900, on).capped, true, 'the band holds a cap')
  assert.equal(at(900, on).why, 'band')
  assert.equal(at(769, on).capped, true)
  assert.equal(at(768, on).capped, false, 'at low the cap lifts')
  assert.equal(at(768, on).why, 'below_low')
  assert.equal(at(900, at(500)).capped, false, 'the band holds an uncapped town uncapped')
})
await t('logCapNext: a lower bound above high proves the cap at ANY coverage; uncapping needs the coverage; unreadable holds a recent cap, then fails open', () => {
  const N = 5_000_000
  assert.equal(LC.logCapNext(null, { ok: true, logs: 2000, coverage: 0.1 }, CFG, N).capped, true, 'an under-count above high is still above high')
  const capped = { capped: true, at: N - 60_000 }
  const low = LC.logCapNext(capped, { ok: true, logs: 300, coverage: 0.5 }, CFG, N)
  assert.deepEqual([low.capped, low.why], [true, 'held'], 'a low count from a half-seen town cannot lift a recent cap')
  const stale = { capped: true, at: N - LC.LOGCAP_HOLD_MS - 1 }
  const open = LC.logCapNext(stale, { ok: true, logs: 300, coverage: 0.5 }, CFG, N)
  assert.deepEqual([open.capped, open.why], [false, 'coverage'], 'past the hold it fails open (the base)')
  assert.deepEqual(['capped', 'why'].map(k => LC.logCapNext(capped, null, CFG, N)[k]), [true, 'held'])
  assert.deepEqual(['capped', 'why'].map(k => LC.logCapNext(stale, { ok: false }, CFG, N)[k]), [false, 'unread'])
  assert.deepEqual(['capped', 'why'].map(k => LC.logCapNext(null, null, CFG, N)[k]), [false, 'unread'])
  // a held decision keeps its PROVEN time: holding never extends itself
  assert.equal(LC.logCapNext(capped, null, CFG, N).at, capped.at)
  assert.deepEqual(['capped', 'why'].map(k => LC.logCapNext(capped, { ok: true, logs: 5000, coverage: 1 }, { ...CFG, on: false }, N)[k]), [false, 'off'])
})

// ---- the means x the rotation: never a dead end ----
await t('a capped town never opens a logs batch, in either rotation, at any cycle; uncapped it does at its slot', () => {
  for (const rotation of [IW.IDLE_ROTATION, IW.IDLE_ROTATION_GK]) {
    for (let c = 0; c < 16; c++) {
      const k = IW.idlePick(c, { means: LC.logCapMeans(ALL, true), rotation })
      assert.notEqual(k, 'logs', `cycle ${c}`)
      assert.notEqual(k, 'none', `cycle ${c}`)
    }
  }
  assert.equal(IW.idlePick(1, { means: LC.logCapMeans(ALL, false), rotation: IW.IDLE_ROTATION }), 'logs', 'the base: slot 1 is logs')
  assert.deepEqual(LC.logCapMeans(ALL, false), ALL)
  assert.deepEqual(LC.logCapMeans(ALL, true), { ...ALL, logs: false }, 'only the logs flag changes')
})
await t('THE REFUSAL CHAIN: capped with no pickaxe and no grounds work -> the scout lap (the old patrol), never logs, never none', () => {
  for (const rotation of [IW.IDLE_ROTATION, IW.IDLE_ROTATION_GK]) {
    for (let c = 0; c < 8; c++) assert.equal(IW.idlePick(c, { means: LC.logCapMeans(NONE_BUT_LOGS, true), rotation }), 'scout', `cycle ${c}`)
  }
  // ...and composed with the bag stop (idlework-02) and the keeper lease (gkstay-01): still scout, never none
  const m = IW.holderMeans(IW.idleBagMeans(ALL, 33, { on: true }), true, true)
  assert.equal(IW.idlePick(1, { means: LC.logCapMeans({ ...m, grounds: false }, true) }), 'scout')
  // only a barred scout ends in none -- the base rule, unchanged
  assert.equal(IW.idlePick(1, { means: LC.logCapMeans(NONE_BUT_LOGS, true), barred: new Map([['scout', Date.now() + 1e9]]) }), 'none')
})
await t('logCapMet: only a logs batch, only while capped', () => {
  assert.equal(LC.logCapMet('logs', true), true)
  assert.equal(LC.logCapMet('logs', false), false)
  for (const k of ['iron', 'coal', 'grounds', 'scout', 'none']) assert.equal(LC.logCapMet(k, true), false, k)
})

// ---- the controller, on a fake clock and a fake bot ----
let NOW = 2_000_000_000
const realNow = Date.now
Date.now = () => NOW
const H = { x: config.world.homeX, z: config.world.homeZ }
// idlework2.test.mjs's bag: every ladder rung met, so the chain reaches the idle rung
const mkItems = () => [
  { name: 'oak_log', count: 16 }, { name: 'stick', count: 2 }, { name: 'cobblestone', count: 64 },
  { name: 'crafting_table', count: 1 }, { name: 'furnace', count: 1 }, { name: 'coal', count: 4 },
  { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 },
  { name: 'iron_pickaxe', count: 1, maxDurability: 250, durabilityUsed: 0 }, { name: 'bucket', count: 1 },
  { name: 'iron_ingot', count: 3 },
]
let ITEMS = mkItems()
let DIST = 3
const bot = {
  entity: { position: { x: H.x, y: 64, z: H.z, distanceTo: () => DIST } },
  inventory: { items: () => ITEMS },
  registry: { blocks: {} },
  findBlock: () => null,
}
let CAP = null   // the reader's decision the hook hands out
LC.setLogCapState(() => CAP)
function controller (ms = MS) {
  const progress = { attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {}, progressAt: {} }
  const lessons = { getProgress: () => progress, setProgress: (a, s, sa, sc, cy, co, pa) => Object.assign(progress, { attempts: a, skipped: s, skippedAt: sa, skipCount: sc, cycle: cy, completions: co, progressAt: pa }), save () {} }
  const c = new ms.MilestoneController(bot, 'gatherer', lessons)
  c.chain = c.chain.slice(c.chain.length - ms.SUSTAINING.length)
  return c
}
const base = id => String(id ?? '').split('#')[0]
const reset = (ms = MS) => { ms._idleReset(); ITEMS = mkItems(); DIST = 3; CAP = null }

await t('idleMeans (the real one): capped -> logs false, every other means as without the cap; no decision -> the base', () => {
  reset()
  const free = MS.idleMeans(bot)
  assert.equal(free.logs, true)
  CAP = { capped: true, why: 'above_high', logs: 4247 }
  const capped = MS.idleMeans(bot)
  assert.equal(capped.logs, false)
  assert.deepEqual({ ...capped, logs: true }, free, 'nothing else changes')
  CAP = { capped: false, why: 'below_low', logs: 600 }
  assert.equal(MS.idleMeans(bot).logs, true)
})
await t('THE CONTROLLER: a logs batch open when the town caps is met at once (reason logcap) and the lap goes on; the next laps open no logs batch', () => {
  reset()
  // walk cycles until the idle rung opens a logs batch (uncapped)
  let opened = false
  for (let cy = 0; cy < 16 && !opened; cy++) {
    MS._idleReset()
    const c = controller()
    c.lessons.getProgress().cycle = cy
    c.cycle = cy
    for (let i = 0; i < 4; i++) { c.refresh(); if (base(c.status().id) === 'idle_work') break }
    if (base(c.status().id) === 'idle_work' && MS._idleState().state?.kind === 'logs') {
      opened = true
      DIST = 120
      c.refresh()
      assert.equal(base(c.status().id), 'idle_work', 'uncapped, the batch goes on (0/16)')
      CAP = { capped: true, why: 'above_high', logs: 4247 }
      c.refresh()
      assert.notEqual(base(c.status().id), 'idle_work', `capped: the batch is met (${c.status().id})`)
      assert.ok(MS._idleState().state.gained < IW.IDLE_NEEDS.logs.n, 'met by the cap, not by its 16')
      assert.equal(MS._idleState().barred.size, 0, 'the cap bars nothing')
    }
  }
  assert.ok(opened, 'positive control: some cycle opened a logs batch')
})
await t('THE PERSONAL RUNGS NEVER READ THE CAP: stockpile_wood still asks a capped bot holding 4 logs for wood (tool crafting)', () => {
  reset()
  CAP = { capped: true, why: 'above_high', logs: 4247 }
  ITEMS = [{ name: 'oak_log', count: 4 }, { name: 'cobblestone', count: 20 }]
  const sw = MS.SUSTAINING.find(m => m.id === 'stockpile_wood')
  assert.ok(sw, 'the rung exists')
  assert.equal(sw.done(bot, 99), false, 'a capped town does not satisfy the bag\'s own keep')
  ITEMS = [{ name: 'oak_log', count: 16 }]
  assert.equal(sw.done(bot, 99), true, 'positive control: 16 meets it')
  const chain = MS.gathererChain()
  const wood = chain.find(m => /log/.test(m.id))
  assert.ok(wood, 'the gatherer chain has its wood rung')
  ITEMS = [{ name: 'oak_log', count: 2 }]
  assert.equal(wood.done(bot, 0), false, 'the chain\'s 12 logs are still asked of a capped bot')
})

// ---- the TOWN WOOD line ----
await t('logCapLine: only while capped AND the bag holds the wood keep; names the count and the cap; LOGCAP_PROMPT=0 -> none', () => {
  const d = { capped: true, logs: 4247 }
  const line = LC.logCapLine(d, 24, { cfg: CFG, keep: 16, prompt: true })
  assert.match(line, /^TOWN WOOD: /)
  assert.match(line, /4247 logs/)
  assert.match(line, /1024 cap/)
  assert.equal(LC.logCapLine(d, 15.75, { cfg: CFG, keep: 16, prompt: true }), '', 'short of its own keep: no line')
  assert.equal(LC.logCapLine({ capped: false, logs: 4247 }, 64, { cfg: CFG, keep: 16, prompt: true }), '')
  assert.equal(LC.logCapLine(null, 64, { cfg: CFG, keep: 16, prompt: true }), '')
  assert.equal(LC.logCapLine(d, 64, { cfg: CFG, keep: 16, prompt: false }), '')
  assert.equal(LC.logCapPromptOn({ LOGCAP_PROMPT: '0' }), false)
  assert.equal(LC.logCapPromptOn({}), true)
})
await t('townWoodSituation (the prompt\'s): planks count a quarter; a capped bot with 12 logs + 16 planks (16 units) sees the line, with 12 + 12 does not', () => {
  CAP = { capped: true, why: 'above_high', logs: 3000 }
  ITEMS = [{ name: 'birch_log', count: 12 }, { name: 'oak_planks', count: 16 }]
  assert.match(PR.townWoodSituation(bot), /TOWN WOOD: the town store holds 3000 logs/)
  ITEMS = [{ name: 'birch_log', count: 12 }, { name: 'oak_planks', count: 12 }]
  assert.equal(PR.townWoodSituation(bot), '')
  CAP = null
  ITEMS = [{ name: 'oak_log', count: 64 }]
  assert.equal(PR.townWoodSituation(bot), '', 'no decision: no line')
})

// ---- mutants (anchored: present and unique, or the mutant is refused) ----
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} -- ANCHOR MISSING`)
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const LC_PATH = new URL('../src/logcap.mjs', import.meta.url)
const MS_PATH = new URL('../src/milestones.mjs', import.meta.url)
await t('MUTANT KILLED: idleMeans without the cap -> a capped bot still has the logs means', async () => {
  await withMutant(MS_PATH, '  return logCapMeans(holderMeans(idleBagMeans({ iron: hasTripPickaxe(items), logs: true, coal: pick, grounds: groundsMeans(b) }, items.length), holdsGrounds(b)), townLogCapped(b))\n',
    '  return holderMeans(idleBagMeans({ iron: hasTripPickaxe(items), logs: true, coal: pick, grounds: groundsMeans(b) }, items.length), holdsGrounds(b))\n', async mod => {
      reset(); CAP = { capped: true, why: 'above_high', logs: 4247 }
      assert.equal(mod.idleMeans(bot).logs, true, 'the mutant keeps the logs means')
    })
  reset(); CAP = { capped: true }
  assert.equal(MS.idleMeans(bot).logs, false)
})
await t('MUTANT KILLED: the band does not hold (between low and high always uncapped) -> a capped town flaps open at 900', async () => {
  await withMutant(LC_PATH, "  return { capped: !!prev?.capped, why: 'band', logs, coverage, at: now }\n", "  return { capped: false, why: 'band', logs, coverage, at: now }\n", async mod => {
    assert.equal(mod.logCapNext({ capped: true, at: 0 }, { ok: true, logs: 900, coverage: 1 }, CFG, 1).capped, false)
  })
  assert.equal(LC.logCapNext({ capped: true, at: 0 }, { ok: true, logs: 900, coverage: 1 }, CFG, 1).capped, true)
})
await t('MUTANT KILLED: the coverage gate before the lower-bound rule -> a half-seen town with 2,000 logs is never capped', async () => {
  await withMutant(LC_PATH, '  if (logs > cfg.high) return', '  if (coverage >= LOGCAP_MIN_COVERAGE && logs > cfg.high) return', async mod => {
    assert.equal(mod.logCapNext(null, { ok: true, logs: 2000, coverage: 0.3 }, CFG, 1).capped, false)
  })
  assert.equal(LC.logCapNext(null, { ok: true, logs: 2000, coverage: 0.3 }, CFG, 1).capped, true)
})
await t('MUTANT KILLED: uncapping without the coverage gate -> a recent cap lifts on a half-seen low count', async () => {
  await withMutant(LC_PATH, "  if (coverage < LOGCAP_MIN_COVERAGE) return { capped: recent, why: recent ? 'held' : 'coverage', logs, coverage, at: recent ? prev.at : now }\n", '', async mod => {
    assert.equal(mod.logCapNext({ capped: true, at: 0 }, { ok: true, logs: 300, coverage: 0.5 }, CFG, 1000).capped, false)
  })
  assert.equal(LC.logCapNext({ capped: true, at: 0 }, { ok: true, logs: 300, coverage: 0.5 }, CFG, 1000).capped, true)
})
await t('MUTANT KILLED: the line without the wood-keep condition -> a capped bot short of its own wood is told not to cut', async () => {
  await withMutant(LC_PATH, '  if (!prompt || !d?.capped || !Number.isFinite(wood) || wood < keep) return \'\'\n', '  if (!prompt || !d?.capped || !Number.isFinite(wood)) return \'\'\n', async mod => {
    assert.notEqual(mod.logCapLine({ capped: true, logs: 4000 }, 3, { cfg: CFG, keep: 16, prompt: true }), '')
  })
  assert.equal(LC.logCapLine({ capped: true, logs: 4000 }, 3, { cfg: CFG, keep: 16, prompt: true }), '')
})
await t('MUTANT KILLED: no cap-met for an open batch -> a logs batch open at the cap waits on 16 logs it should not cut', async () => {
  await withMutant(MS_PATH, '  const capMet = !base && logCapMet(st.kind, townLogCapped(b))\n', '  const capMet = false\n', async mod => {
    let saw = false
    for (let cy = 0; cy < 16 && !saw; cy++) {
      mod._idleReset(); ITEMS = mkItems(); DIST = 3; CAP = null
      const c = controller(mod)
      c.lessons.getProgress().cycle = cy
      c.cycle = cy
      for (let i = 0; i < 4; i++) { c.refresh(); if (base(c.status().id) === 'idle_work') break }
      if (base(c.status().id) === 'idle_work' && mod._idleState().state?.kind === 'logs') {
        saw = true
        DIST = 120
        CAP = { capped: true }
        c.refresh()
        assert.equal(base(c.status().id), 'idle_work', 'the mutant keeps the batch open')
      }
    }
    assert.ok(saw, 'the mutant run opened a logs batch')
  })
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

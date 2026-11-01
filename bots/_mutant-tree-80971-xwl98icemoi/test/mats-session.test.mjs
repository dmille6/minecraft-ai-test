// mats-01: THE FURNACE SESSION ON PLANKS ONLY (skills.mjs matsSession), driven through the real code against a fake
// furnace window whose slots play the real API (put/take; an empty-slot take throws, as mineflayer's assert does). The
// furnace is found by the real townFurnaces scan and leased with the real furnacelease.mjs in a temp pool directory.
// MAT-FURN (coal in the fuel slot, foreign iron output, the job's own stone), MAT-HOT (lit with an empty fuel slot), the
// lease (held, unrecordable) and an abort mid-session; and the design-3.3 case: coal AND planks in the bag -> planks burned,
// coal untouched, by the session's own fuel booking.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mats-session-logs-'))
process.env.BOT_NAME = 'MatsSessionBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'shared'; process.env.MEMORY_POOL = 'mats-test'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mats-pool-'))
process.env.LOG_LEVEL = 'error'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const S = await import('../src/skills.mjs')
const FL = await import('../src/furnacelease.mjs')
const { fakeWorld, stack, NAMES } = await import('./fakeworld.mjs')
const { Vec3 } = (await import('node:module')).createRequire(import.meta.url)('vec3')

const FURN = [3, 64, 3]
const SMELTS = { cobblestone: 'stone', sand: 'glass', oak_log: 'charcoal' }
const bagCount = (w, n) => w.bag.filter(Boolean).reduce((t, it) => t + (it.name === n ? it.count : 0), 0)
const addBag = (bag, name, count) => {
  const s = bag.find(it => it && it.name === name && it.count < 64)
  if (s) s.count += count; else bag.push({ name, type: NAMES.indexOf(name), count })
}
const takeBag = (bag, type, count) => {
  let left = count
  for (let i = 0; i < bag.length && left > 0; i++) {
    const it = bag[i]
    if (!it || it.type !== type) continue
    const m = Math.min(it.count, left); it.count -= m; left -= m
    if (!it.count) bag[i] = null
  }
  if (left) throw new Error(`Can't find ${type}`)
}
/** A fake furnace at FURN: `slots` { input, fuel, output } as { name, count } or null; `lit` the block state; `burning` the
 *  window's burn progress at the open. Cooking is instant once input and fuel are both in: 1.5 items a plank, as the server
 *  burns them -- or, with `cook: { items, planks }`, only that much (a session cut short). THE WINDOW KEEPS ITS OWN COPY OF
 *  THE BAG until the close (mineflayer inventory.js: the window's slots are updated, bot.inventory is copied back at the
 *  close), so a count read from bot.inventory while it is open is the STALE bag, as on the fleet (Codex r1 P1-4). */
function town ({ bag = [], slots = {}, lit = 'false', otherLease = false, burning = 0, cook: partial = null } = {}) {
  const w = fakeWorld({ bag: bag.map((s, i) => ({ ...s, slot: 9 + i })) })
  w.set(...FURN, 'furnace', { lit, facing: 'north' })
  const f = { input: slots.input ?? null, fuel: slots.fuel ?? null, output: slots.output ?? null }
  w.slots = f
  w.opens = 0
  const cook = () => {
    if (!f.input || !f.fuel) return
    const per = /_planks$/.test(f.fuel.name) ? 1.5 : f.fuel.name === 'coal' ? 8 : 1
    const burn = partial ? Math.min(f.fuel.count, partial.planks) : Math.min(f.fuel.count, Math.ceil(f.input.count / per))
    const made = partial ? Math.min(f.input.count, partial.items) : Math.min(f.input.count, Math.floor(burn * per))
    if (!made && !burn) return
    const out = SMELTS[f.input.name]
    f.output = f.output ? { ...f.output, count: f.output.count + made } : { name: out, count: made }
    f.input.count -= made; if (!f.input.count) f.input = null
    f.fuel.count -= burn; if (!f.fuel.count) f.fuel = null
    w.burned = (w.burned ?? 0) + burn
  }
  w.bot.openFurnace = async () => {
    w.opens++
    const wbag = w.bag.filter(Boolean).map(it => ({ ...it }))          // the window's copy of the bag
    const take = k => { const it = f[k]; if (!it) throw new Error(`${k} empty`); f[k] = null; addBag(wbag, it.name, it.count) }
    const win = {
      selectedItem: null, fuel: burning,
      inputItem: () => f.input, fuelItem: () => f.fuel, outputItem: () => f.output,
      async putInput (type, _m, count) { takeBag(wbag, type, count); f.input = { name: NAMES[type], count }; if (w.onInput) w.onInput(); cook() },
      async putFuel (type, _m, count) { takeBag(wbag, type, count); f.fuel = { name: NAMES[type], count }; w.fuelPut = { name: NAMES[type], count }; if (w.onFuel) w.onFuel(); cook() },
      async takeOutput () { take('output') }, async takeInput () { take('input') }, async takeFuel () { take('fuel') },
      emptySlotCount: () => 36 - wbag.filter(Boolean).length,
      items: () => wbag.filter(Boolean),
      close () { w.closed = (w.closed ?? 0) + 1; w.bag.length = 0; for (const it of wbag.filter(Boolean)) w.bag.push(it) },
    }
    return win
  }
  if (otherLease) FL.acquireFurnaceLease(process.env.POOL_STATE_DIR, new Vec3(...FURN), 'Other:1', { what: 'smelt' })
  return w
}
const run = (w, opts = {}, signal = new AbortController().signal, deadline = Date.now() + 170_000) =>
  S.matsSession({ bot: w.bot }, { input: 'cobblestone', n: 12, planksName: 'oak_planks', out: 'stone', own: null, ...opts }, signal, deadline)
const fresh = () => { for (const f of fs.readdirSync(process.env.POOL_STATE_DIR)) fs.rmSync(path.join(process.env.POOL_STATE_DIR, f), { recursive: true, force: true }) }

test('a clean cold furnace: 12 cobble on EXACTLY 8 planks -> 12 stone; the bag\'s coal untouched (design 3.3)', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8), stack('coal', 5)] })
  const r = await run(w)
  assert.equal(r.stop, 'done'); assert.equal(r.made, 12); assert.equal(r.burned, 8)
  assert.deepEqual(w.fuelPut, { name: 'oak_planks', count: 8 }, 'planks only, exactly the batch\'s')
  assert.equal(bagCount(w, 'coal'), 5, 'coal untouched'); assert.equal(bagCount(w, 'stone'), 12)
  assert.equal(bagCount(w, 'cobblestone'), 0); assert.equal(bagCount(w, 'oak_planks'), 0)
  assert.deepEqual(w.slots, { input: null, fuel: null, output: null }, 'the furnace is left empty')
})

test('MAT-FURN: coal already in the fuel slot -> the furnace is closed UNTOUCHED and skipped; nothing loaded', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], slots: { fuel: { name: 'coal', count: 3 } } })
  const r = await run(w)
  assert.equal(r.stop, 'no_furnace'); assert.equal(r.made, 0); assert.equal(w.opens, 1)
  assert.deepEqual(w.slots.fuel, { name: 'coal', count: 3 }, 'its coal stays (furnace_drain owns foreign contents)')
  assert.equal(bagCount(w, 'cobblestone'), 12); assert.equal(bagCount(w, 'coal'), 0)
  assert.ok(w.bot.matsFurnaceSkip?.['3,64,3'] > Date.now(), 'skipped for a while')
  assert.match(r.tried.join(';'), /fuel:coal/)
})

test('MAT-FURN: foreign iron in the output -> untouched; ANY stone in the output is another session\'s (own=null) -> untouched', async () => {
  fresh()
  const iron = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], slots: { output: { name: 'iron_ingot', count: 4 } } })
  const a = await run(iron)
  assert.equal(a.stop, 'no_furnace'); assert.deepEqual(iron.slots.output, { name: 'iron_ingot', count: 4 }); assert.equal(bagCount(iron, 'iron_ingot'), 0)
  fresh()
  const stone = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], slots: { output: { name: 'stone', count: 3 } } })
  const b = await run(stone)
  assert.equal(b.stop, 'no_furnace'); assert.deepEqual(stone.slots.output, { name: 'stone', count: 3 }, 'the job never leaves its own output: this is someone\'s')
  assert.equal(bagCount(stone, 'stone'), 0)
})

test('MAT-HOT\'s second reading: the window\'s burn progress > 0 (fuel slot empty, coal burning) -> closed untouched', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], burning: 0.4 })
  const r = await run(w)
  assert.equal(r.stop, 'no_furnace'); assert.match(r.tried.join(';'), /burning/); assert.equal(bagCount(w, 'cobblestone'), 12)
})

test('THE PLANK BOUNDARY (Codex r1 P1-4): a session cut short reads the planks in the WINDOW\'s bag before the drain -- burned is what burned', async () => {
  fresh()
  // 1 cobble on 1 plank, the furnace cooks nothing before the clock: the drain returns the cobble and the plank
  const w = town({ bag: [stack('cobblestone', 1), stack('oak_planks', 1)], cook: { items: 0, planks: 0 } })
  const r = await run(w, { n: 1 }, new AbortController().signal, Date.now() + 23_000)
  assert.equal(r.burned, 0, 'nothing burned (the stale-bag read made this 1)'); assert.equal(r.made, 0)
  assert.equal(bagCount(w, 'oak_planks'), 1); assert.equal(bagCount(w, 'cobblestone'), 1)
  assert.equal(r.cut, true, 'the wait ended on the clock: the batch is cut (Claude r2 P2-B)')
  // and a partial burn: 3 cobble on 2 planks, 1 cooked on 1 plank before the clock -> burned 1, made 1 (n=3 keeps the wait ~31 s:
  // the suite runner kills a file at 120 s)
  fresh()
  const p = town({ bag: [stack('cobblestone', 3), stack('oak_planks', 2)], cook: { items: 1, planks: 1 } })
  const q = await run(p, { n: 3 }, new AbortController().signal, Date.now() + 43_000)
  assert.equal(q.burned, 1); assert.equal(q.made, 1); assert.equal(bagCount(p, 'oak_planks'), 1); assert.equal(bagCount(p, 'cobblestone'), 2)
  assert.equal(q.cut, true)
})

test('THE LOAD RECORD is written BEFORE anything goes in (a kill after it leaves a drainable note)', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)] })
  let recorded = null, inputAtRecord = null
  w.onInput = () => { inputAtRecord = recorded }
  const r = await run(w, { onLoad: ld => { recorded = ld } })
  assert.deepEqual(recorded?.input, { name: 'cobblestone', n: 12 }); assert.deepEqual(recorded?.fuel, { name: 'oak_planks', n: 8 })
  assert.ok(inputAtRecord, 'the record existed when the input went in')
  // the second record carries the bag's input AFTER the load, from the window's bag (the recovery balance's baseline)
  assert.equal(recorded.inputAfter, 0); assert.equal(r.cut, undefined, 'a batch that finished is not cut')
})

test('MAT-HOT: a furnace whose block reads lit=true (an empty fuel slot, coal still burning) is never opened', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], lit: 'true' })
  const r = await run(w)
  assert.equal(r.stop, 'no_furnace'); assert.equal(w.opens, 0, 'a free skip: nothing opened')
  // positive control: the same furnace cold is used
  fresh()
  const c = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], lit: 'false' })
  assert.equal((await run(c)).stop, 'done')
})

test('the lease: another bot\'s session -> skipped, never opened; an unrecordable lease store -> the job stops (fail closed)', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], otherLease: true })
  const r = await run(w)
  assert.equal(r.stop, 'no_furnace', 'the leased furnace is out of the candidates'); assert.equal(w.opens, 0)
  // unrecordable: the pool directory is read-only
  fresh()
  const ro = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mats-ro-'))
  const saved = process.env.POOL_STATE_DIR
  try {
    fs.chmodSync(ro, 0o500)
    process.env.POOL_STATE_DIR = ro
    const v = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)] })
    const s = await run(v)
    assert.equal(s.stop, 'lease_unavailable'); assert.equal(v.opens, 0)
  } finally { process.env.POOL_STATE_DIR = saved; fs.chmodSync(ro, 0o700) }
})

test('an abort mid-session (after the fuel went in): the guarded drain brings back every input, fuel and output', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8), stack('coal', 2)] })
  const ac = new AbortController()
  // the furnace does not cook this time: the abort lands while input and fuel sit in it
  const open0 = w.bot.openFurnace
  w.bot.openFurnace = async (...a) => { const win = await open0(...a); const items = win.items; win.putFuel = async (type, m, count) => { const bag = items(); const it = bag.find(x => x.type === type); it.count -= count; w.slots.fuel = { name: NAMES[type], count }; w.fuelPut = { name: NAMES[type], count }; setTimeout(() => ac.abort(), 5) }; return win }
  let threw = false
  try { await run(w, {}, ac.signal) } catch (e) { threw = !!(e?.aborted || ac.signal.aborted) }
  assert.ok(threw, 'the abort propagates (the reflex owns the body)')
  assert.equal(bagCount(w, 'cobblestone'), 12, 'the input came back'); assert.equal(bagCount(w, 'oak_planks'), 8, 'the fuel came back')
  assert.equal(bagCount(w, 'coal'), 2)
  assert.deepEqual([w.slots.input, w.slots.fuel, w.slots.output], [null, null, null])
})

// ---- mutants: the session's own decisions, killed by the tests above ------------------------------------------------------
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SKILLS_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-matss-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

test('MUTANTS: burning the bag\'s coal, skipping the qualify check, or reusing a lit furnace are each caught', async () => {
  const cases = [
    ['the session burns coal', "const inDef = bot.registry.itemsByName[input], fDef = bot.registry.itemsByName[planksName]",
      "const inDef = bot.registry.itemsByName[input], fDef = bot.registry.itemsByName.coal",
      async X => { fresh(); const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8), stack('coal', 9)] }); await X.matsSession({ bot: w.bot }, { input: 'cobblestone', n: 12, planksName: 'oak_planks', out: 'stone', own: null }, new AbortController().signal, Date.now() + 170_000); assert.equal(bagCount(w, 'coal'), 9) }],
    ['the qualify check dropped', "      if (!q.ok || [rd('inputItem'), rd('fuelItem'), rd('outputItem')].includes(undefined)) {", "      if (false) {",
      async X => { fresh(); const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], slots: { fuel: { name: 'coal', count: 3 } } }); await X.matsSession({ bot: w.bot }, { input: 'cobblestone', n: 12, planksName: 'oak_planks', out: 'stone', own: null }, new AbortController().signal, Date.now() + 170_000).catch(() => {}); assert.deepEqual(w.slots.fuel, { name: 'coal', count: 3 }) }],
    ['lit furnaces are candidates', "const near = townFurnaces(bot).filter(f => !f.lit && !furnaceLeasedNow(f.k)", "const near = townFurnaces(bot).filter(f => !furnaceLeasedNow(f.k)",
      async X => { fresh(); const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 8)], lit: 'true' }); await X.matsSession({ bot: w.bot }, { input: 'cobblestone', n: 12, planksName: 'oak_planks', out: 'stone', own: null }, new AbortController().signal, Date.now() + 170_000).catch(() => {}); assert.equal(w.opens, 0) }],
  ]
  for (const [name, old, neu, check] of cases) {
    const killed = await withMutant(old, neu, async X => { try { await check(X); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } })
    assert.ok(killed, `mutant SURVIVED: ${name}`)
  }
})

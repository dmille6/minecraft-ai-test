// stoneworks-01: THE FURNACE SESSION ON A LADDER FUEL (skills.mjs matsSession with `planksName` = the fuel and `fuelN` its exact
// count), through the real code against mats-session.test.mjs's fake furnace (copied: the window keeps its own bag copy until the
// close, an empty-slot take throws). Bamboo burns 0.25 items each, coal 8: exactly the batch's fuel goes in, the bag's own coal is
// never touched on a bamboo session, and a session cut short reads the fuel in the WINDOW's bag before the drain.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-stoneworks-session-logs-'))
process.env.BOT_NAME = 'StoneworksSessionBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_SCOPE = 'shared'; process.env.MEMORY_POOL = 'stoneworks-test'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-stoneworks-pool-'))
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
    const per = /_planks$/.test(f.fuel.name) ? 1.5 : f.fuel.name === 'coal' ? 8 : f.fuel.name === 'bamboo' ? 0.25 : 1
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


test('BAMBOO: 12 cobble on EXACTLY 48 bamboo -> 12 stone; the bag\'s coal and planks untouched', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('bamboo', 60), stack('coal', 5), stack('oak_planks', 8)] })
  const r = await run(w, { planksName: 'bamboo', fuelN: 48 })
  assert.equal(r.stop, 'done'); assert.equal(r.made, 12); assert.equal(r.burned, 48)
  assert.deepEqual(w.fuelPut, { name: 'bamboo', count: 48 }, 'bamboo only, exactly the batch\'s')
  assert.equal(bagCount(w, 'coal'), 5); assert.equal(bagCount(w, 'oak_planks'), 8); assert.equal(bagCount(w, 'bamboo'), 12)
  assert.equal(bagCount(w, 'stone'), 12); assert.deepEqual(w.slots, { input: null, fuel: null, output: null })
})

test('COAL: 8 cobble on ONE coal (the town\'s take) -> 8 stone', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 8), stack('coal', 6)] })
  const r = await run(w, { n: 8, planksName: 'coal', fuelN: 1 })
  assert.equal(r.stop, 'done'); assert.equal(r.made, 8); assert.equal(r.burned, 1)
  assert.deepEqual(w.fuelPut, { name: 'coal', count: 1 }); assert.equal(bagCount(w, 'coal'), 5)
})

test('A BAMBOO SESSION CUT SHORT: the fuel back from the drain is read in the window\'s bag -- burned is what burned', async () => {
  fresh()
  // 2 cobble on 8 bamboo, 1 cooked on 4 bamboo before the clock -> burned 4, made 1 (n=2 keeps the wait ~21 s; the runner kills a
  // file at 120 s)
  const w = town({ bag: [stack('cobblestone', 2), stack('bamboo', 8)], cook: { items: 1, planks: 4 } })
  const r = await run(w, { n: 2, planksName: 'bamboo', fuelN: 8 }, new AbortController().signal, Date.now() + 33_000)
  assert.equal(r.burned, 4, JSON.stringify(r)); assert.equal(bagCount(w, 'bamboo'), 4)
  assert.equal(r.made, 1); assert.equal(bagCount(w, 'cobblestone'), 1, 'the unsmelted input came back'); assert.equal(r.cut, true)
})

test('the base call is unchanged: no fuelN -> planksToLoad(n) planks', async () => {
  fresh()
  const w = town({ bag: [stack('cobblestone', 12), stack('oak_planks', 9)] })
  const r = await run(w)
  assert.equal(r.made, 12); assert.deepEqual(w.fuelPut, { name: 'oak_planks', count: 8 })
})

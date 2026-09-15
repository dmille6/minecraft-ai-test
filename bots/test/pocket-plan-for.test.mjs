// pocketPlanFor reads the world into the pure plan: a Delta-class pocket (pickaxe held, 5 stone cells over a 4-deep
// pocket, blocks in the bag) is feasible; the same pocket bare-handed is refused by name; the wiring runs the rung
// only after the rescue has given up on a SEALED pocket.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pocketPlanFor } from '../src/reflex.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const V = (x, y, z) => ({ x, y, z })
const STONE = { name: 'stone', boundingBox: 'block', digTime: (tool) => tool ? 1150 : 7500 }
const WATER = { name: 'water', boundingBox: 'empty' }; const AIR = { name: 'air', boundingBox: 'empty' }
// column at (10, *, 10): stone floor at y=44, water 45..48 (the bot floats at 48), stone 49..53, air from 54
const world = (x, y, z) => { if (x !== 10 || z !== 10) return y <= 53 ? STONE : AIR; if (y <= 44) return STONE; if (y <= 48) return WATER; if (y <= 53) return STONE; return AIR }
const botWith = (items) => ({ entity: { position: V(10.5, 48.2, 10.5), onGround: false }, oxygenLevel: 18, inventory: { items: () => items } })
t('a Delta-class pocket with a pickaxe: floor 44, opening 54, 5 stone cells, feasible', () => {
  const r = pocketPlanFor(botWith([{ name: 'wooden_pickaxe', count: 1, type: 1 }, { name: 'cobblestone', count: 20, type: 2 }]), { blockAt: world })
  assert.equal(r.floorY, 44); assert.equal(r.firstDryY, 54); assert.equal(r.plan.ok, true, r.plan.why); assert.equal(r.plan.need, 9); assert.equal(r.plan.digs, 5)
})
t('the same pocket bare-handed is refused before anything moves', () => {
  const r = pocketPlanFor(botWith([{ name: 'cobblestone', count: 20, type: 2 }]), { blockAt: world })
  assert.equal(r.plan.ok, false); assert.match(r.plan.why, /no pickaxe/)
})
t('inflow: water BESIDE a ceiling cell is the pocket case and passes; liquid ABOVE it or lava beside it refuses', () => {
  const over = (o) => (x, y, z) => (o[`${x},${y},${z}`] !== undefined ? o[`${x},${y},${z}`] : world(x, y, z))
  const inv = [{ name: 'wooden_pickaxe', count: 1, type: 1 }, { name: 'cobblestone', count: 20, type: 2 }]
  const beside = pocketPlanFor(botWith(inv), { blockAt: over({ '11,50,10': { name: 'water', boundingBox: 'empty' } }) })
  assert.equal(beside.plan.ok, true, `water beside y=50: ${beside.plan.why}`)
  const lava = pocketPlanFor(botWith(inv), { blockAt: over({ '11,50,10': { name: 'lava', boundingBox: 'empty' } }) })
  assert.match(lava.plan.why ?? '', /liquid in/, 'lava beside y=50 refuses')
})
t('too few blocks is refused by count', () => {
  const r = pocketPlanFor(botWith([{ name: 'wooden_pickaxe', count: 1, type: 1 }, { name: 'cobblestone', count: 3, type: 2 }]), { blockAt: world })
  assert.match(r.plan.why, /need 13 placeable/)   // need + 4 since step 4b (two side fills, a seal, a spare)
})
t('WIRED: the sealed verdict only raises the want; the rung runs before the dry arms on the next free tick, once per cooldown, inside its grant; the arms wait on a pending pocket (source invariant, comments stripped)', () => {
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const i = src.indexOf("lastReleaseKind = 'drowning_ceiling_no_air'"); assert.ok(i > 0, 'ANCHOR MISSING: the ceiling-expiry branch')
  assert.match(src.slice(i, i + 1200), /pocketWanted = Date\.now\(\)/, 'the expiry raises the want')
  assert.equal((src.match(/floodedPocketRung\(bot, \{/g) || []).length, 1, 'exactly one call site')
  const j = src.indexOf('floodedPocketRung(bot, {'); const k = src.indexOf('const feet = bot.blockAt(bot.entity.position)')
  assert.ok(j > 0 && j < k, 'the rung runs BEFORE the danger branch and the dry arms in the tick')
  const before = src.slice(j - 1500, j)
  assert.match(before, /pocketWanted && Date\.now\(\) - pocketWanted < POCKET_WANT_MS && !escaping && !marooned && !pocketing/, 'waits for a free tick')
  assert.match(before, /takeBody\(bot, runner, 'flooded_pocket', PRIORITY\.escape\)/, 'takes the body at escape priority')
  assert.match(before, /const within = typeof withinBody === 'function' \? withinBody : \(g, fn\) => fn\(\)/, 'runs inside the grant where the arbiter exists, plainly where it does not')
  assert.match(before, /const \{ plan, floorY, firstDryY, tool, columnCells \} = pocketPlanFor\(bot\)/)
  for (const g of [/!pocketing && !pocketPending && Date\.now\(\) - lastEscapeAt/, /mstate === 'climb' && !pocketing && !pocketPending/, /!pocketing && !pocketPending && mstate === 'need_scaffold'/]) assert.equal((src.match(g) || []).length, 1, `arm waits: ${g}`)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

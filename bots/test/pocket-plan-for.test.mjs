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
t('too few blocks is refused by count', () => {
  const r = pocketPlanFor(botWith([{ name: 'wooden_pickaxe', count: 1, type: 1 }, { name: 'cobblestone', count: 3, type: 2 }]), { blockAt: world })
  assert.match(r.plan.why, /need 11 placeable/)
})
t('WIRED: the rung runs only inside the sealed-pocket expiry branch, once per cooldown, through the body arbiter (source invariant, comments stripped)', () => {
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const i = src.indexOf("lastReleaseKind = 'drowning_ceiling_no_air'"); assert.ok(i > 0, 'ANCHOR MISSING: the ceiling-expiry branch')
  const branch = src.slice(i, i + 3000)
  assert.match(branch, /Date\.now\(\) - lastPocketRungAt > POCKET_RUNG_COOLDOWN_MS && !escaping && !marooned && !pocketing/, 'cooldown and no other arm')
  assert.match(branch, /const \{ plan, floorY, firstDryY, tool, columnCells \} = pocketPlanFor\(bot\)/)
  assert.match(branch, /takeBody\(bot, runner, 'flooded_pocket', PRIORITY\.escape\)/, 'takes the body at escape priority')
  assert.match(branch, /withinBody\(pocketGrant, \(\) => floodedPocketRung\(bot, \{/, 'runs inside its grant')
  assert.equal((src.match(/floodedPocketRung\(bot, \{/g) || []).length, 1, 'exactly one call site')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

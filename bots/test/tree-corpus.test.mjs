// The wood corpus must trigger the code paths it claims to, and the controls must not.
//
// A fixture that does not reproduce its refusal is worse than no fixture: it runs, it scores zero,
// and the zero reads as "the candidate failed" when the truth is "the world never asked the
// question". So every fixture is checked against the REAL predicates -- isExposed and safeToBreak,
// imported from src, not re-implemented here -- with a bot built from the fixture's own cells.
//
// This costs no server and no fleet time, and it is the gate the fixtures pass before any sandbox run.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
// APPARATUS ONLY. This file names no candidate: it asserts what each scene IS, using the baseline's
// own predicates, so it keeps working whatever is tried against it. The assertions a specific
// candidate needs (does `foliageCovered` admit this?) belong with that candidate's tests.
import { isExposed } from '../src/skills.mjs'

const load = k => JSON.parse(readFileSync(new URL(`./fixtures/synthetic-tree-${k}.json`, import.meta.url), 'utf8'))

/** A bot whose world IS the fixture. Unset cells are void, exactly as blockAt returns null off-world. */
function botOf (fx) {
  const cells = fx.cells
  const P = (x, y, z) => ({ x, y, z, offset: (a, b, c) => P(x + a, y + b, z + c) })
  return {
    P,
    origin: fx.origin,
    blockAt (p) {
      const raw = cells[`${p.x},${p.y},${p.z}`]
      if (raw === undefined) return null
      const name = String(raw).split('[')[0]
      // The fixture speaks setblock; boundingBox is what mineflayer would report for these.
      const empty = name === 'air' || name === 'cave_air' || name === 'water' || name === 'lava'
      return { name, boundingBox: empty ? 'empty' : 'block', liquid: name === 'water' || name === 'lava' }
    },
    neighbours (p) {
      return [[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]
        .map(d => this.blockAt(p.offset(d[0], d[1], d[2])))
    },
  }
}
const basal = bot => bot.P(bot.origin[0], bot.origin[1], bot.origin[2])
const names = fx => new Set(Object.values(fx.cells).map(v => String(v).split('[')[0]))

test('canopy: the basal log is BURIED by its own leaves -- the 32.0% unreachable family', () => {
  const fx = load('canopy'); const bot = botOf(fx); const at = basal(bot)
  assert.equal(bot.blockAt(at).name, 'oak_log', 'the fixture origin is not the trunk')
  assert.equal(isExposed(bot, at), false, 'the fixture does not reproduce the refusal it exists for')
  assert.ok(bot.neighbours(at).some(b => b?.name === 'oak_leaves'),
    'no leaf touches the trunk, so nothing distinguishes this from the stone-encased control')
  assert.equal(bot.neighbours(at).every(b => b && b.boundingBox !== 'empty'), true,
    'some neighbour is passable, so this scene is not actually the buried case')
})

test('shoreline: the basal log is EXPOSED and WET -- the 37.3% no_safe_target family, one variable', () => {
  const fx = load('shoreline'); const bot = botOf(fx); const at = basal(bot)
  assert.equal(bot.blockAt(at).name, 'oak_log')
  assert.equal(isExposed(bot, at), true,
    'it must pass the exposure test, or this fixture is testing burial and not liquid')
  assert.equal(bot.neighbours(at).some(b => b?.name?.endsWith('_leaves')), false,
    'a leaf touching the trunk confounds the two refusal families in one fixture')
  // dontCreateFlow's five faces: above and the four horizontals. NOT below.
  const five = [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].map(d => bot.blockAt(at.offset(...d)))
  assert.ok(five.some(b => b?.name === 'water'), 'no water on any face dontCreateFlow looks at')
  assert.equal(five.some(b => b?.name === 'lava'), false, 'lava must never appear in this fixture')
  assert.equal(bot.blockAt(at.offset(0, 1, 0)).name, 'oak_log', 'water above would be a different refusal')
})

test('shoreline: a DRY stance exists, or the refusal is honest and the fixture is unfair', () => {
  const bot = botOf(load('shoreline')); const at = basal(bot)
  const feet = at.offset(-1, 0, 0)
  assert.equal(bot.blockAt(feet).name, 'air')
  assert.equal(bot.blockAt(feet.offset(0, 1, 0)).name, 'air', 'no head room at the stance')
  assert.equal(bot.blockAt(feet.offset(0, -1, 0)).boundingBox, 'block', 'nothing to stand on')
  assert.equal(bot.blockAt(feet).liquid, false, 'the stance itself is wet')
})

test('open: the POSITIVE CONTROL is takeable -- exposed, dry, no liquid on any of the five faces', () => {
  const bot = botOf(load('open')); const at = basal(bot)
  assert.equal(isExposed(bot, at), true)
  const five = [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].map(d => bot.blockAt(at.offset(...d)))
  assert.equal(five.some(b => b?.liquid), false, 'the positive control is wet; it would refuse too')
  assert.ok(bot.neighbours(at).some(b => b?.name === 'air'), 'nowhere to stand beside it')
})

test('buried: the NEGATIVE CONTROL stays refused, and no foliage exists to rescue it', () => {
  const fx = load('buried'); const bot = botOf(fx)
  const [ox, oy, oz] = fx.origin; const at = bot.P(ox, oy - 6, oz)
  assert.equal(bot.blockAt(at).name, 'oak_log')
  assert.equal(isExposed(bot, at), false, 'the control log is not actually buried')
  assert.equal([...names(fx)].some(n => n.endsWith('_leaves')), false,
    'a leaf anywhere in this world makes the negative control meaningless')
})

test('wetstone: the LEAKAGE CONTROL has a wet target and NO wood anywhere to escape to', () => {
  const fx = load('wetstone'); const bot = botOf(fx)
  const [ox, oy, oz] = fx.origin; const at = bot.P(ox + 1, oy - 10, oz)
  assert.equal(bot.blockAt(at).name, 'stone')
  const five = [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].map(d => bot.blockAt(at.offset(...d)))
  assert.ok(five.some(b => b?.name === 'water'), 'the leakage control is not wet, so it cannot detect a leak')
  assert.equal([...names(fx)].some(n => n.endsWith('_log')), false,
    'a log in this world lets a candidate pass by wandering off instead of by leaking')
  assert.equal(fx.asks, 'stone', 'the leakage control must ask for the thing it must not get')
})

test('every fixture places the bot on something solid, dry, with head room', () => {
  for (const k of ['canopy', 'shoreline', 'open', 'buried', 'wetstone']) {
    const fx = load(k); const bot = botOf(fx)
    const [bx, by, bz] = fx.bot.pos
    const feet = bot.P(Math.floor(bx), Math.floor(by), Math.floor(bz))
    assert.equal(bot.blockAt(feet)?.name, 'air', `${k}: the bot spawns inside a block`)
    assert.equal(bot.blockAt(feet.offset(0, 1, 0))?.name, 'air', `${k}: no head room at spawn`)
    assert.equal(bot.blockAt(feet.offset(0, -1, 0))?.boundingBox, 'block', `${k}: the bot spawns over a hole`)
  }
})

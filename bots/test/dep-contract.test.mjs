// DEPENDENCY CONTRACT TESTS.
//
// A whole class of bug was invisible to ~240 existing assertions, because our
// code is correct in isolation and wrong in composition:
//
//   mineflayer-collectblock's collect() does
//       this.movements = new Movements(bot)          // LIBRARY DEFAULTS
//       this.bot.pathfinder.setMovements(this.movements)
//   with no restore. We call setMovements exactly once, at spawn. So from each
//   bot's first `gather` onward, every goto/home/explore/unstick ran with
//   canDig=true, allowParkour=true, maxDropDown=4 -- the precise opposite of
//   four settings chosen deliberately and documented with evidence.
//
// Unit tests over pure functions cannot see this. Mocks cannot see it either --
// a mocked collectBlock does whatever we told it to. The only thing that catches
// it is asserting our invariant against the REAL installed dependency.
//
// These tests are SUPPOSED to fail when you bump a dependency. That is the
// feature, not a nuisance.
import assert from 'node:assert'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
let pass = 0, fail = 0, skip = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') { skip++; console.log(`  SKIP  ${name} (dependency not installed)`); return }
    fail++; console.log(`  FAIL  ${name}\n        ${e.message}`)
  }
}

// --- the exact defect, asserted against the installed package ---------------
t('collectblock still installs its own Movements (the clobber is real)', () => {
  const src = require_('node:fs').readFileSync(
    require_.resolve('mineflayer-collectblock/lib/CollectBlock.js'), 'utf8')
  const constructs = /this\.movements\s*=\s*new\s+\w+\.?Movements\(/.test(src)
  const installs = /pathfinder\.setMovements\(this\.movements\)/.test(src)
  assert.ok(constructs && installs,
    'collectblock no longer clobbers Movements -- if this fails after a dependency bump, ' +
    'the workaround in index.mjs/skills.mjs may be removable. Verify before deleting it.')
})

// THE CLOBBER IS LOAD-BEARING, which is the opposite of what it looks like.
t('collect() gates every dig on safeToBreak, which gates on canDig', () => {
  const fs = require_('node:fs')
  const cb = fs.readFileSync(require_.resolve('mineflayer-collectblock/lib/CollectBlock.js'), 'utf8')
  assert.match(cb, /pathfinder\.movements\.safeToBreak\(/,
    'if mineBlock stops consulting safeToBreak, injecting our Movements becomes safe')

  const { Movements } = require_('mineflayer-pathfinder')
  const mcData = require_('minecraft-data')('1.21.8')
  const ours = new Movements({ registry: mcData })
  ours.canDig = false
  assert.equal(ours.safeToBreak({ position: { x: 0, y: 0, z: 0 }, type: 1 }), false,
    'canDig=false makes every block unbreakable, so handing collectblock our own ' +
    'Movements would make collect() drop every target and mine nothing, silently')
})

t('the Movements we lend collectblock grants digging and nothing else', () => {
  // Mirrors index.mjs. If this drifts from the real thing, gather either breaks
  // (canDig lost) or starts parkouring off ledges again.
  const { Movements } = require_('mineflayer-pathfinder')
  const mcData = require_('minecraft-data')('1.21.8')
  const moves = new Movements({ registry: mcData })
  moves.canDig = false; moves.allowParkour = false
  moves.allow1by1towers = true; moves.maxDropDown = 6

  const lent = Object.create(Object.getPrototypeOf(moves))
  Object.assign(lent, moves)
  lent.canDig = true

  assert.equal(lent.canDig, true, 'collect() cannot mine without it')
  assert.equal(lent.allowParkour, false, 'gather must not parkour')
  assert.equal(lent.maxDropDown, 6, 'gather must keep our drop limit, not the default 4')
  assert.equal(moves.canDig, false, 'lending must not mutate our own config')
  assert.equal(typeof lent.safeToBreak, 'function',
    'the clone must keep the prototype, or safeToBreak is undefined and gather throws')
})

t('collectblock does NOT restore the previous Movements itself', () => {
  const src = require_('node:fs').readFileSync(
    require_.resolve('mineflayer-collectblock/lib/CollectBlock.js'), 'utf8')
  // A restore would have to stash the old object first. If a future version does,
  // this test should fail and our finally-block becomes redundant.
  const stashes = /(prev|old|saved|original)Movements/i.test(src)
  assert.ok(!stashes,
    'collectblock appears to stash/restore Movements now -- re-check whether our restore is still needed')
})

// --- the library defaults really are the opposite of our config -------------
t('library-default Movements differ from our navigation config', () => {
  const { Movements } = require_('mineflayer-pathfinder')
  const mcData = require_('minecraft-data')('1.21.8')
  const m = new Movements({ registry: mcData })
  // These four are the settings index.mjs sets deliberately, each with a
  // recorded incident behind it.
  assert.equal(m.canDig, true, 'default canDig should be true (we set false)')
  assert.equal(m.allowParkour, true, 'default allowParkour should be true (we set false)')
  assert.equal(m.maxDropDown, 4, 'default maxDropDown should be 4 (we set 6)')
})

// --- our own guard must actually detect and repair a swap -------------------
t('assertNav detects a swapped Movements and puts ours back', () => {
  const { Movements } = require_('mineflayer-pathfinder')
  const mcData = require_('minecraft-data')('1.21.8')

  // Reproduce index.mjs's setup and guard without booting a bot.
  const ours = new Movements({ registry: mcData })
  ours.canDig = false; ours.allowParkour = false; ours.maxDropDown = 6
  const fp = m => [m.canDig, m.allowParkour, m.allow1by1towers, m.allowSprinting,
                   m.maxDropDown, m.scafoldingBlocks?.length, m.blocksCantBreak?.size].join('|')
  const wanted = fp(ours)

  const bot = { pathfinder: { movements: ours, setMovements(m) { this.movements = m } } }
  const assertNav = () => {
    const live = bot.pathfinder.movements
    if (fp(live) === wanted) return false
    bot.pathfinder.setMovements(ours)
    return true
  }

  assert.equal(assertNav(), false, 'no drift when nothing changed')

  // Now do exactly what collectblock does.
  bot.pathfinder.setMovements(new Movements({ registry: mcData }))
  assert.equal(bot.pathfinder.movements.canDig, true, 'the clobber should have taken effect')
  assert.equal(assertNav(), true, 'drift must be detected')
  assert.equal(bot.pathfinder.movements.canDig, false, 'ours must be restored')
  assert.equal(bot.pathfinder.movements.maxDropDown, 6)
})

// --- the same hazard class, guarded against silent reintroduction ----------
t('nothing outside index.mjs calls setMovements', () => {
  const fs = require_('node:fs')
  const dir = new URL('../src/', import.meta.url).pathname
  const offenders = []
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.mjs'))) {
    if (f === 'index.mjs') continue
    if (/pathfinder\.setMovements\(/.test(fs.readFileSync(dir + f, 'utf8'))) offenders.push(f)
  }
  assert.deepEqual(offenders, [],
    `setMovements should be owned by index.mjs alone; found in: ${offenders.join(', ')}`)
})

console.log(`  ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`)
process.exit(fail ? 1 : 0)

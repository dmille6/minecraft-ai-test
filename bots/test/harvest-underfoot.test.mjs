// THE CHEAPEST ESCAPE WAS NOT IN THE LIST.
//
// `HARVEST_OFFSETS` names twelve neighbours -- four at foot level, four above,
// four diagonally below -- and omits `[0,-1,0]`: the block the bot is standing
// on, and the one cell guaranteed solid for any bot that is standing up at all.
//
// For a bot marooned on a pillar that cell is a block it placed itself, and
// breaking it is the only move that improves BOTH halves of the trap at once --
// it yields material and it descends one. Every other rung either costs blocks
// the bot has not got, or goes up, which is the direction that got it here.
//
// It was omitted for a real reason and the fix has to answer it. Every other
// offset opens a cell BESIDE the feet; this one opens the cell UNDER them, and
// the bot falls. `harvestSafe` cannot price that -- read it, it looks for lava
// and nothing else -- so the underfoot cell needs its own predicate.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import { mayHarvestUnderfoot, survivableDrop, FALL_FREE } from '../src/mining.mjs'

test('POSITIVE CONTROL: the predicate can say both things', () => {
  // Without this, every assertion below could pass because it always refused.
  assert.equal(mayHarvestUnderfoot({ drop: 1, health: 20 }), true)
  assert.equal(mayHarvestUnderfoot({ drop: 60, health: 20 }), false)
})

test('THE PILLAR CASE: one block down onto your own column', () => {
  // A bot at y=207 on a pillar it built. The cell below the target is the next
  // block of that pillar, so the fall is exactly one and costs nothing.
  assert.equal(mayHarvestUnderfoot({ drop: 1, health: 20 }), true)
})

test('a free fall stays free even for a nearly-dead bot', () => {
  // Minecraft deals max(0, blocks - 3). A three-block drop does ZERO damage, so
  // health cannot be a reason to refuse it -- and refusing it would strand
  // exactly the bots that most need a cheap way down.
  assert.equal(FALL_FREE, 3)
  for (const hp of [20, 10, 6, 2, 1]) {
    assert.equal(mayHarvestUnderfoot({ drop: 3, health: hp }), true,
      `a 3-block drop is free; hp ${hp} must not refuse it`)
    assert.equal(mayHarvestUnderfoot({ drop: 1, health: hp }), true)
  }
  // ...and survivableDrop alone would have refused those, which is why the
  // FALL_FREE branch exists rather than deferring to it for everything.
  assert.equal(survivableDrop(6), 0)
})

test('a fall that costs health is priced against the health there is', () => {
  assert.equal(mayHarvestUnderfoot({ drop: 17, health: 20 }), true, 'the cap at full health')
  assert.equal(mayHarvestUnderfoot({ drop: 18, health: 20 }), false, 'one past the cap')
  // A hurt bot is allowed less, but never less than free.
  assert.equal(mayHarvestUnderfoot({ drop: 10, health: 20 }), true)
  assert.equal(mayHarvestUnderfoot({ drop: 10, health: 8 }), false,
    '8hp cannot pay for a 10-block fall')
  assert.equal(mayHarvestUnderfoot({ drop: 3, health: 8 }), true,
    '...but a free drop is still allowed at 8hp')
})

test('AN UNMEASURED DROP IS REFUSED — the same rule as mayStepDown', () => {
  // null means the probe never found a floor. The entire point of pricing a fall
  // is to stop guessing about the ones too deep to see the bottom of, and a bot
  // that breaks its own floor over a void does not get a second chance.
  assert.equal(mayHarvestUnderfoot({ drop: null, health: 20 }), false)
  assert.equal(mayHarvestUnderfoot({ drop: undefined, health: 20 }), false)
  assert.equal(mayHarvestUnderfoot({ drop: Infinity, health: 20 }), false)
  assert.equal(mayHarvestUnderfoot({ drop: NaN, health: 20 }), false)
  assert.equal(mayHarvestUnderfoot({}), false)
  assert.equal(mayHarvestUnderfoot(), false)
})

test('nonsense is refused rather than guessed at', () => {
  assert.equal(mayHarvestUnderfoot({ drop: -1, health: 20 }), false)
})

test('the allowed drop never exceeds what the health can pay', () => {
  // Property: above the free band, every accepted drop must leave the bot alive
  // with the margin intact.
  for (let hp = 1; hp <= 20; hp++) {
    for (let d = FALL_FREE + 1; d <= 30; d++) {
      if (!mayHarvestUnderfoot({ drop: d, health: hp })) continue
      const damage = Math.max(0, d - FALL_FREE)
      assert.ok(hp - damage >= 6 - 1e-9,
        `hp ${hp} accepted a ${d}-block drop, landing on ${hp - damage}`)
    }
  }
})

// Same shape as `withMutant` in climb-escape.test.mjs, which CLAUDE.md says to
// reuse: assert the anchor is present AND unique, write the mutant to a TEMP
// file under test/ (never into src/ -- the runner SIGKILLs, and an in-place
// mutant survives on disk and gets deployed within six hours), import it, and
// delete it.
async function withMutant (url, old, neu, fn) {
  const src = fs.readFileSync(url, 'utf8')
  assert.ok(src.includes(old), 'MUTANT ANCHOR MISSING: it was never written, which reads as killed')
  assert.strictEqual(src.split(old).length, 2, 'MUTANT ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`,
                      import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

test('MUTANT: dropping the unmeasured guard must be caught', async () => {
  // `null <= 3` is TRUE in JavaScript, so without the guard an unmeasured drop
  // reads as a free one -- the bot breaks its own floor over a void it never saw
  // the bottom of. That is the failure this predicate exists to prevent.
  await withMutant(new URL('../src/mining.mjs', import.meta.url),
    '  if (drop == null || !Number.isFinite(drop)) return false',
    '  if (false) return false',
    async mut => {
      assert.equal(mut.mayHarvestUnderfoot({ drop: null, health: 20 }), true,
        'the mutant must actually change behaviour, or it proves nothing')
      assert.equal(mayHarvestUnderfoot({ drop: null, health: 20 }), false,
        'and the real module must still refuse an unmeasured drop')
    })
})

// THE LAST RUNG, AND THE ONE BLOCK TYPE THAT WOULD KILL.
//
// Three bots pillared to the build limit and stayed eight hours. Over six of
// those hours they made 164 descent attempts -- 13% of every decision -- and
// not one was permitted. By the time the other four guards were fixed, one
// refusal was left, and it was CORRECT:
//
//     mine -> "stopped at y=320: open space at least 4 blocks under"
//
// There is a 250-block void under them. Digging is a fall.
//
// In open air the only placeable position is against a face of the block you
// stand on, and the only useful exposed face is its underside. So the move is
// not to dig into nothing: put something there first, break the floor, drop
// exactly one block onto what you placed. The void becomes ground, one block
// at a time, and fall exposure never exceeds one.
//
// Which makes the block list safety-critical rather than cosmetic. Place SAND
// beneath the floor and break the floor and the sand falls the instant it is
// unsupported -- the bot goes with it, 250 blocks, into the void it was
// bridging. The block that looks most like scaffold is the one that kills.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { RESCUE_BLOCK, rescueBlocks } from '../src/skills.mjs'

const code = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const skills = code('skills.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const inv = names => ({ inventory: { items: () => names.map(n => ({ name: n, count: 1 })) } })

t('SAND AND GRAVEL ARE REFUSED — this one is lethal, not untidy', () => {
  for (const n of ['sand', 'red_sand', 'gravel']) {
    assert.strictEqual(rescueBlocks(inv([n])).length, 0,
      `${n} was offered as a rescue block; placed under the floor it falls the ` +
      'moment the floor breaks and takes the bot down with it')
  }
})

t('logs ARE accepted, or the rescue never fires for the bots that need it', () => {
  // Between them the two stranded bots carry 327 logs and THREE blocks that
  // the ordinary SCAFFOLD list recognises. A careful list leaves them stranded.
  const got = rescueBlocks(inv(['oak_log', 'jungle_log', 'oak_planks', 'coarse_dirt', 'sandstone']))
  assert.strictEqual(got.length, 5, `expected all five usable, got ${got.map(i => i.name)}`)
})

t('non-blocks are not mistaken for building material', () => {
  const got = rescueBlocks(inv(['stick', 'wheat_seeds', 'bamboo', 'flint', 'torch', 'egg']))
  assert.strictEqual(got.length, 0, `offered non-blocks: ${got.map(i => i.name)}`)
})

t('the regex does not accidentally admit a falling block by suffix', () => {
  // `.*_log` and friends are broad. Anything that falls must fail regardless.
  for (const n of ['sand', 'gravel', 'red_sand'])
    assert.ok(!(RESCUE_BLOCK.test(n) && !['sand', 'gravel', 'red_sand'].includes(n)),
      `${n} slipped through the pattern`)
})

t('THE WIRING: it hangs off goto, after the pathfinder proved no route', () => {
  // Not a new skill. The model already proposes `goto <the ground>` and is
  // right to; a new verb would add prompt, admission and telemetry surface for
  // a state affecting 3 bots in 80.
  assert.ok(/rideFloorDown\(bot, \{ signal \}\)/.test(skills),
    'rideFloorDown is defined and never called — dead code, again')
  const call = skills.indexOf('rideFloorDown(bot, { signal })')
  const retry = skills.indexOf('withDescentMovements')
  assert.ok(retry > 0 && call > retry,
    'the rescue runs before the ordinary descent retry — it must be the LAST rung')
})

t('THE PRECONDITIONS: a normal bot on a cliff must never reach it', () => {
  const guard = skills.slice(skills.indexOf('if (!rodeDown'), skills.indexOf('rideFloorDown(bot, { signal })'))
  assert.ok(/SEA_LEVEL \+ 20/.test(guard), 'no altitude floor — a bot at y=64 could trigger it')
  assert.ok(/health \?\? 20\) >= 18/.test(guard), 'no health gate — 169 of 868 deaths are already falls')
  assert.ok(/rescueBlocks\(bot\)\.length > 0/.test(guard), 'no check that it can build at all')
  assert.ok(/!rodeDown/.test(guard), 'not latched — it could loop within one goto')
})

t('every attempt is logged, because a silent rescue is an unlogged confound', () => {
  assert.ok(/kind: 'ride_floor_down'/.test(skills),
    'the rescue emits no event — across four arms that is a confound nobody can see')
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

// EVERY AWAIT IN THE GATHER PATH MUST HAVE A BOUND.
//
// 48+ OOM kills in 8 hours, every victim role=gatherer, scouts and the miner
// never once. The heap at death: 180,061 __awaiter closures, 360,166
// Generators, 903,562 Contexts -- all REACHABLE, so GC freed none of it and V8
// died with "Ineffective mark-compacts near heap limit".
//
// They were pending awaits inside mineflayer-collectblock, which has three with
// no timeout and a cancel that cannot cancel:
//
//   collectAll's Entity branch:  yield waitForPickup   <- resolved only by an
//     `entityGone` event for that exact drop. An item that floats off in water,
//     despawns unobserved, or cannot be reached never fires it. Only gatherers
//     chase drops, which is the entire role-specificity of this bug.
//   gotoChest:                   yield bot.pathfinder.goto(...)  no timeout
//   cancelTask():                yield once(bot, 'collectBlock_finished')
//     -- it stops the pathfinder and then WAITS for a loop that will not end.
//
// And collect() calls cancelTask() as its FIRST action, so ONE stuck pickup
// makes every later gather hang on its opening line, for the life of the
// process. That is the amplifier that turns one lost item into 180,000 frames.
//
// Two rounds of patching from outside failed, because none of it is reachable
// from outside. So gather no longer uses the library at all. This file guards
// the property that replaced it: bounded waits, everywhere.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '../src/skills.mjs'), 'utf8')

const body = (name) => {
  const i = src.indexOf(`async function ${name}(`)
  assert.ok(i > 0, `${name}() not found`)
  // Crude but sufficient: to the next top-level `async function`.
  const j = src.indexOf('\nasync function ', i + 10)
  return src.slice(i, j === -1 ? src.length : j)
}

t('gather routes to collectManually by default', () => {
  assert.match(src, /const COLLECTBLOCK_ENABLED = process\.env\.COLLECTBLOCK_ENABLED === 'true'/)
  assert.match(src, /const mustCollectManually = name =>\s*\n\s*!COLLECTBLOCK_ENABLED/,
    'the default must be manual collection; the library is opt-IN, not opt-out')
})

t('collectManually never awaits a dig without a bound', () => {
  const b = body('collectManually')
  assert.ok(!/await bot\.dig\(block\)(?!\s*,)/.test(b) || /withTimeout\(bot\.dig\(/.test(b),
    'bot.dig() resolves only when the server confirms the break and waits ' +
    'forever when that never comes')
  assert.match(b, /withTimeout\(bot\.dig\(block\), \d+/,
    'the dig must be wrapped in withTimeout')
})

t('collectManually stops digging when the dig times out', () => {
  assert.match(body('collectManually'), /stopDigging/,
    'a timed-out dig that is never stopped leaves the bot mining into a wall')
})

t('collectManually bounds its pathing', () => {
  assert.match(body('collectManually'), /withTimeout\(\s*\n?\s*bot\.pathfinder\.goto/,
    'the walk to the block must be bounded too')
})

t('pickupNearbyItems is bounded in both attempts and time', () => {
  const b = body('pickupNearbyItems')
  assert.match(b, /for \(let i = 0; i < \d+; i\+\+\)/, 'a fixed attempt count')
  assert.match(b, /withTimeout\(bot\.pathfinder\.goto/, 'and a timeout per walk')
  // The library's failure was waiting for an event that never arrives. Ours
  // gives up on the same drop instead.
  assert.match(b, /drop\.id === last/,
    'the same drop twice means walking to it is not working -- stop, do not wait')
})

t('any surviving collectblock call bounds the cancel too', () => {
  // COLLECTBLOCK_ENABLED=true is still a supported path for reproducing the
  // bug, so it must not be able to hang the fleet while doing so.
  if (!/collectBlock\.collect\(/.test(src)) { return }   // fine if it is gone entirely
  assert.match(src, /Promise\.race\(\[\s*\n?\s*Promise\.resolve\(bot\.collectBlock/,
    'cancelTask() waits on an event a wedged loop never emits; awaiting it ' +
    'unbounded was itself a leak (measured: solo2 0 -> 35 kills per 30min)')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

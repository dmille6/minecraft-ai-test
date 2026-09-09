// "ARRIVED, COLLECT DID NOTHING" WAS THE BIGGEST BUCKET IN GATHER.
//
// 1,005 runs across 79 bots, 93.1% of them gaining nothing at all, and 26.4% of
// ALL the time the fleet spends gathering. The bot travelled (median 6 blocks,
// same as successes), the call returned cleanly, and the inventory did not move.
//
// Two verified library behaviours make that possible, and our code trusted both:
//
//   pathfinder's goto RESOLVES AS SUCCESS on an empty path. lib/goto.js checks
//   `results.path.length === 0` and cleans up BEFORE checking
//   `results.status === 'noPath'`, so the commonest unreachable case returns
//   like a success. Our catch then swallowed whatever was left.
//
//   bot.dig() has NO server acknowledgement. digging.js arms
//   `setTimeout(finishDigging, waitTime)` and, when that local timer fires,
//   calls `_updateBlockState(pos, 0)` -- writing air into our own world model.
//   The promise resolving means a timer elapsed. Grepping digging.js for
//   ack/acknowledge returns zero hits.
//
// Composed: stand still, "dig" a block 40 blocks away, read back the air we
// wrote ourselves, collect nothing, report success-shaped nothing.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const CODE = strip(fs.readFileSync(path.join(SRC, 'skills.mjs'), 'utf8'))

test('the live path is collectManually, not collectblock', () => {
  // COLLECTBLOCK_ENABLED is unset on the fleet, so mustCollectManually() is true
  // for every block. Any reasoning about collectblock's internals is therefore
  // about code this fleet never executes -- worth asserting so the next reader
  // does not spend a day there, as I did.
  assert.match(CODE, /const COLLECTBLOCK_ENABLED = process\.env\.COLLECTBLOCK_ENABLED === 'true'/)
  assert.match(CODE, /!COLLECTBLOCK_ENABLED \|\|/,
    'unset env must route every block to collectManually')
})

test('arrival is asserted before digging', () => {
  assert.match(CODE, /bot\.canDigBlock && !bot\.canDigBlock\(here\)/,
    'canDigBlock is the honest reach test — diggable, and within 5.1 of the eye')
  assert.match(CODE, /failClass: 'arrived_out_of_reach'/,
    'and it gets its own class, so it stops being counted as no_path')
})

test('the break is verified against the server, not against our own cache', () => {
  assert.match(CODE, /const nowNamed = bot\.blockAt\(p\)\?\.name/)
  assert.match(CODE, /failClass: 'dig_unconfirmed'/)
  // The settle is the whole mechanism: reading immediately just returns the air
  // that _updateBlockState wrote locally. The server re-sends the real block
  // when it disagrees, so the wait is what makes the read mean anything.
  const idx = CODE.indexOf('const nowNamed')
  const before = CODE.slice(Math.max(0, idx - 400), idx)
  assert.match(before, /await sleep\(\d+, signal\)/,
    'there must be a settle between the dig and the re-read')
})

test('the ORDER is dig, then settle, then re-read', () => {
  // My first version of this was a doesNotMatch that forbade dig and the
  // re-read appearing within 200 characters -- which the correct code also
  // violates, because the settle between them is short. A negative assertion
  // that the right code fails is worse than no assertion. The order is the
  // thing that matters, so assert the order.
  assert.match(CODE,
    /bot\.dig\(block\)[\s\S]*?await sleep\(\d+, signal\)[\s\S]*?const nowNamed = bot\.blockAt/,
    'dig, then a settle for the server to correct us, then the read')
})

test('the false claim about dig() waiting for the server is gone', () => {
  const raw = fs.readFileSync(path.join(SRC, 'skills.mjs'), 'utf8')
  assert.ok(!/it resolves when the\n\s*\/\/ server confirms the break/.test(raw),
    'digging.js has zero ack handling; the comment asserting otherwise must not survive')
})

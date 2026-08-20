/**
 * THE LEAK THE HEAP LIMIT COULD NOT SEE.
 *
 * Fifteen hours into a 40-bot run: every process pinned at its 1GB cgroup
 * ceiling, 29 of 40 bots dropped by their servers, host load 35 on 24 cores --
 * and every unit still reporting `active` with NRestarts=0.
 *
 *     heap_used_mb=172  heap_total_mb=189  external_mb=325  array_buffers_mb=321
 *
 * The JS heap was flat. All the growth was ArrayBuffers holding chunk columns,
 * which `--max-old-space-size=768` does not bound -- so the cap did nothing, no
 * heap snapshot was ever written, and the process thrashed against the cgroup
 * limit until the protocol timed out.
 */
import assert from 'node:assert'
import { startChunkEvictor } from '../src/evictor.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

function fakeBot(cx, cz, columnKeys) {
  const cols = Object.fromEntries(columnKeys.map(k => [k, {}]))
  const unloaded = []
  return {
    unloaded,
    entity: { position: { x: cx * 16 + 8, y: 70, z: cz * 16 + 8 } },
    world: {
      getColumns: () => cols,
      unloadColumn: (x, z) => { unloaded.push(`${x},${z}`); delete cols[`${x},${z}`] },
    },
  }
}

// run one sweep synchronously by driving the timer
function sweepOnce(bot, opts = {}) {
  const real = global.setInterval
  let fn = null
  global.setInterval = f => { fn = f; return { unref() {} } }
  try { startChunkEvictor(bot, opts); fn() } finally { global.setInterval = real }
}

t('columns beyond the radius are unloaded', () => {
  const bot = fakeBot(0, 0, ['0,0', '5,5', '40,40', '-40,-40'])
  sweepOnce(bot, { radius: 12 })
  assert.deepEqual(bot.unloaded.sort(), ['-40,-40', '40,40'])
})

t('columns INSIDE the radius are kept -- the bot still needs to see', () => {
  const bot = fakeBot(0, 0, ['0,0', '12,0', '0,-12', '8,8'])
  sweepOnce(bot, { radius: 12 })
  assert.deepEqual(bot.unloaded, [], `evicted live columns: ${bot.unloaded}`)
})

t('the radius exceeds the server view distance, so nothing live is dropped', () => {
  // server.properties runs view-distance=8; anything the server still updates
  // must survive, or the evictor would be deleting fresh data.
  const bot = fakeBot(100, -100, ['108,-100', '100,-108', '92,-92'])
  sweepOnce(bot, { radius: 12 })
  assert.deepEqual(bot.unloaded, [], 'evicted a column inside view distance')
})

t('it measures from the BOT, not the origin', () => {
  // the bug this would hide: a bot 5000 blocks out evicting everything it owns
  const bot = fakeBot(300, 300, ['300,300', '305,305', '0,0'])
  sweepOnce(bot, { radius: 12 })
  assert.deepEqual(bot.unloaded, ['0,0'])
})

t('a bot with no position does nothing rather than throwing', () => {
  const bot = fakeBot(0, 0, ['40,40'])
  bot.entity = null
  sweepOnce(bot, { radius: 12 })
  assert.deepEqual(bot.unloaded, [])
})

t('a world that changed shape evicts nothing instead of everything', () => {
  const bot = fakeBot(0, 0, [])
  bot.world.getColumns = () => null
  sweepOnce(bot, { radius: 12 })
  assert.deepEqual(bot.unloaded, [])
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

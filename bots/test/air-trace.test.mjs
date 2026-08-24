// A RECORDER THAT LIES IS WORSE THAN NO RECORDER, because the next fix gets
// built on it. This afternoon four fixes were shipped on a counter that watched
// a derived value change rather than raw packets, and its `5 ours to 2156
// foreign` could not support the conclusion drawn from it.
//
// So the trace gets the same treatment as anything else here: the corpse it is
// meant to photograph is a fixture, and the tests fail if it photographs
// something else.
import assert from 'node:assert'
import { traceAir, summarise, MAX_ROWS } from '../src/air-trace.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

/** A client that reproduces mineflayer's unguarded write, with real ordering. */
function fakeBot (selfId = 7) {
  const pre = [], post = []
  const bot = {
    entity: { id: selfId },
    oxygenLevel: null,
    entities: { 7: { name: 'player' }, 88: { name: 'cod' }, 91: { name: 'dolphin' } },
    _client: {
      prependListener: (ev, fn) => { if (ev === 'entity_metadata') pre.push(fn) },
      on: (ev, fn) => { if (ev === 'entity_metadata') post.push(fn) },
      removeListener: (ev, fn) => {
        for (const a of [pre, post]) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) }
      },
    },
  }
  // pre-listeners, then mineflayer's write, then post-listeners. That order is
  // the entire mechanism the recorder depends on.
  const emit = (entityId, airSupply, metadata) => {
    const p = { entityId, metadata }
    for (const h of pre) h(p)
    if (airSupply != null) bot.oxygenLevel = Math.round(airSupply / 15)
    for (const h of post) h(p)
  }
  return { bot, emit }
}

t('THE FINDING IN ONE ROW: a foreign packet that moved our oxygen names the fish', () => {
  const rows = []
  const { bot, emit } = fakeBot()
  traceAir(bot, { sink: r => rows.push(r) })
  emit(7, 300)            // us: 20
  emit(88, 4800)          // a cod: 320
  const fishy = rows.find(r => r.changed && !r.own)
  assert.ok(fishy, 'the corruption produced no row at all')
  assert.equal(fishy.name, 'cod')
  assert.equal(fishy.before, 20)
  assert.equal(fishy.after, 320)
})

t('and if the claim is WRONG, no such row exists', () => {
  // A mineflayer that guards correctly: foreign packets never write.
  const rows = []
  const { bot, emit } = fakeBot()
  traceAir(bot, { sink: r => rows.push(r) })
  emit(7, 300)
  emit(88, null)          // foreign packet, no write
  assert.equal(rows.filter(r => r.changed && !r.own).length, 0,
    'the recorder invents corruption that did not happen')
})

t('our own packets are kept even when nothing changed', () => {
  // These are the rows that answer "how often does the server tell us", which
  // is the question the previous counter could not answer.
  const rows = []
  const { bot, emit } = fakeBot()
  traceAir(bot, { sink: r => rows.push(r) })
  emit(7, 300)
  emit(7, 300)            // same value, still ours, still evidence
  assert.equal(rows.filter(r => r.own).length, 2)
})

t('a foreign packet that changed nothing is not recorded', () => {
  const rows = []
  const { bot, emit } = fakeBot()
  traceAir(bot, { sink: r => rows.push(r) })
  emit(91, null)
  assert.equal(rows.length, 0, 'noise from distant entities would swamp the trace')
})

t('raw metadata is kept for OUR packets, which is where the true scale lives', () => {
  const rows = []
  const { bot, emit } = fakeBot()
  traceAir(bot, { sink: r => rows.push(r) })
  emit(7, 300, [{ key: 1, value: 300 }, { key: 9, value: 20 }, { key: 2, value: 'name' }])
  assert.deepEqual(rows[0].meta, { 1: 300, 9: 20 },
    'numeric metadata is what identifies the air field offline')
})

t('foreign rows carry no metadata dump — volume, not secrecy', () => {
  const rows = []
  const { bot, emit } = fakeBot()
  traceAir(bot, { sink: r => rows.push(r) })
  emit(7, 300)
  emit(88, 4800, [{ key: 1, value: 4800 }])
  assert.equal(rows.find(r => !r.own).meta, undefined)
})

t('IT STOPS. A recorder on 40 bots that does not stop is its own outage', () => {
  const rows = []
  const { bot, emit } = fakeBot()
  let clock = 0
  traceAir(bot, { sink: r => rows.push(r), minutes: 1, now: () => clock })
  emit(7, 300)
  clock = 61_000
  emit(7, 150)
  emit(7, 300)
  assert.equal(rows.length, 1, `recorded ${rows.length} rows past its own deadline`)
})

t('and it stops on row count too', () => {
  const rows = []
  const { bot, emit } = fakeBot()
  traceAir(bot, { sink: r => rows.push(r), maxRows: 3 })
  for (let i = 0; i < 50; i++) emit(7, 300 - i)
  assert.equal(rows.length, 3)
})

t('stopping removes BOTH listeners', () => {
  const rows = []
  const { bot, emit } = fakeBot()
  const stop = traceAir(bot, { sink: r => rows.push(r) })
  emit(7, 300)
  stop()
  emit(88, 4800)
  emit(7, 150)
  assert.equal(rows.length, 1, 'the recorder kept running after stop()')
})

t('summarise keeps numbers and drops everything else', () => {
  assert.deepEqual(summarise([{ key: 0, value: 5 }, { key: 1, value: { a: 1 } }]), { 0: 5 })
  assert.equal(summarise(null), null)
})

t('the row cap is bounded to something a fleet can survive', () => {
  assert.ok(MAX_ROWS <= 100_000, `MAX_ROWS ${MAX_ROWS} is not a cap`)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

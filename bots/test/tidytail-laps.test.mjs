// TIDYTAIL-01SHOW x FLOATCLEAN/PILLARS (control session 11-22: "a 'productive' tidy close that stops the clean-up is the wrong trade").
// floatclean's and pillars' laps run at the head of a TIDY crew visit. With only set-aside tail cells left the tidy stops being offered
// (tidytail) -- which would stop the laps too. So the tidy stays OFFERED while either lap's last survey left takeable work (or no lap
// has surveyed yet), and the visit itself still stops after the laps (the tail is quiet: nothing else to do).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ttl-logs-'))
process.env.BOT_NAME = 'TailLapBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ttl-pool-'))
const S = await import('../src/skills.mjs')
const { gkwSig } = await import('../src/gkwork.mjs')
const L = S._lapLeftForTest
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }
const NOW = Date.now()
const quietRec = () => { const r = { sitedAt: 1, stage: 0, cells: [{ at: [14, 68, -36], role: 'earth', seg: 'S1' }], cut: [], waived: {}, aside: { '14,68,-36': { why: 'no_stand' } } }; r.tail = { code: L.code(), sig: gkwSig(r), at: NOW - 60_000 }; return r }

await t('the tail all set aside AND the pillar list still has takeable work -> the tidy stays OFFERED (its crew visit runs the lap)', () => {
  L.reset(); L.note('fc', { standing: 0, aside: 0 }); L.note('pl', { standing: 12, aside: 2, unread: 0 })
  assert.strictEqual(L.owed(), true)
  assert.strictEqual(L.quiet(quietRec(), NOW), false, 'offered: the laps are owed')
  assert.strictEqual(L.quiet(quietRec(), NOW, { laps: false }), true, 'the visit itself still stops after its laps: only the tail is quiet')
})
await t('the same with the FLOATING list owed', () => {
  L.reset(); L.note('fc', { standing: 3, aside: 0 }); L.note('pl', { standing: 0, aside: 0 })
  assert.strictEqual(L.quiet(quietRec(), NOW), false)
})
await t('no lap has surveyed yet this process -> owed (never silenced by not knowing)', () => {
  L.reset()
  assert.strictEqual(L.quiet(quietRec(), NOW), false)
})
await t('POSITIVE CONTROL: both lists done (or every standing cell set aside) -> the tail-quiet tidy is not offered', () => {
  L.reset(); L.note('fc', { standing: 4, aside: 4 }); L.note('pl', { standing: 0, aside: 0, unread: 0 })
  assert.strictEqual(L.owed(), false)
  assert.strictEqual(L.quiet(quietRec(), NOW), true)
})
await t('MUTANT KILLED (anchored): the laps dropped from the offer -> a pillar list with work is silenced', async () => {
  const p = new URL('../src/skills.mjs', import.meta.url)
  const src = readFileSync(p, 'utf8'), old = ' && !(laps && lapsOwed())'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, '').replace(/from '\.\//g, "from '../src/"))
  try {
    const M = await import(out.href)
    M._lapLeftForTest.reset(); M._lapLeftForTest.note('pl', { standing: 12, aside: 0 })
    const r = quietRec(); r.tail.code = M._lapLeftForTest.code()
    assert.strictEqual(M._lapLeftForTest.quiet(r, NOW), true, 'the mutant silences the lap')
  } finally { try { unlinkSync(out) } catch {} }
})
console.log(`\ntidytail-laps: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

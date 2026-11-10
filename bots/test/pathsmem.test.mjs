// PATHSMEM-01 (LIVE showcase, 24 h to 11-10 16:30Z): 406 paths visits, 402 `complete` with nothing placed ("complete; used 0, laid
// 610/610"), ~30 a bot. Iris 12:53-16:56Z: 15 new connections (`_sink_mode` rows), 15 paths visits, each 20 s - 4 min after one. The
// extension's clock and unrouted set lived ON the bot object, which index.mjs makes anew after every disconnect: after each reconnect
// the laid network read DUE its extension again (skills.mjs recordDamaged -> pathsExtendDue), the order sent the bot there first (a
// repair), and the extension answered `unrouted:enchantshop:unreachable` (offline, scripts/pathsite-offline.mjs --extend on the 11-10
// 17:16Z copy). The fix: both in the process memory (procmem.mjs), an unrouted destination asked again after PATHS_UNROUTED_MS.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const P = await import('../src/paths.mjs')
const { procMemOf } = await import('../src/procmem.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const PATHS_PATH = new URL('../src/paths.mjs', import.meta.url)
const EXTEND_MS = 30 * 60_000   // skills.mjs PATHS_EXTEND_MS
const DESTS = [{ id: 'enchantshop', to: 'enchantshop', cols: [[30, 40]] }]   // the one destination the laid network does not serve
// Iris's connections 11-10 (the `_sink_mode` rows, UTC)
const CONNECTS = ['12:53:33', '13:06:40', '13:08:53', '13:30:10', '13:31:04', '14:23:44', '15:03:53', '15:19:43', '15:37:51', '15:40:57', '15:43:23', '16:09:10', '16:22:14', '16:34:57', '16:52:15', '16:56:34'].map(s => Date.parse(`2026-11-10T${s}Z`) + 20_000)
/** The live sequence: a new bot object per connection; the extension asked when due (pathsExtendDue's test), its outcome noted. */
function replay (M, { proc = true, ended = false } = {}) {
  const store = new Map()
  let visits = 0
  for (const now of CONNECTS) {
    const bot = { username: 'showcase-Iris' }   // index.mjs connect(): a NEW object
    const mem = procMemOf(store, bot, proc)
    const due = now - (mem.pathsExtendAt ?? -Infinity) >= EXTEND_MS && DESTS.some(d => !M.pathsUnroutedNow(mem, d.to, now))
    if (!due) continue
    visits++
    M.pathsExtendNote(mem, ['enchantshop'], { now, ended })   // extendPaths: unrouted:enchantshop:unreachable
  }
  return visits
}
await t('POSITIVE CONTROL -- memory on the connection (PROCMEM=off shape): every connection visits (16 of 16, live 15 in the window)', () => {
  assert.strictEqual(replay(P, { proc: false }), CONNECTS.length)
})
await t('THE FIX: the process memory -- one visit in the 4 h; the unrouted wait holds across the reconnects', () => {
  assert.strictEqual(replay(P), 1)
})
await t('an unrouted destination is asked again after PATHS_UNROUTED_MS (never "never"); a visit on an ended connection notes nothing', () => {
  const mem = {}
  P.pathsExtendNote(mem, ['enchantshop'], { now: 1000 })
  assert.ok(P.pathsUnroutedNow(mem, 'enchantshop', 1000 + P.PATHS_UNROUTED_MS - 1))
  assert.ok(!P.pathsUnroutedNow(mem, 'enchantshop', 1000 + P.PATHS_UNROUTED_MS))
  assert.ok(!P.pathsUnroutedNow(mem, 'farm', 1001), 'another destination: not waiting')
  assert.strictEqual(mem.pathsExtendAt, 1000)
  const m2 = {}
  P.pathsExtendNote(m2, ['enchantshop'], { now: 1000, ended: true })
  assert.deepStrictEqual(m2, {}, 'ended: no clock, no wait')
  assert.strictEqual(replay(P, { ended: true }), CONNECTS.length, 'every connection ended: nothing learned, asked each time')
})
await t('MUTANTS KILLED: the wait never read (every connection visits again); the ended guard dropped (an ended visit stamps the clock)', async () => {
  await withMutant(PATHS_PATH, 'export const pathsUnroutedNow = (mem, to, now = Date.now()) => Number(mem?.pathsUnrouted?.get?.(to)) > now', 'export const pathsUnroutedNow = () => false', async M => {
    assert.ok(replay(M) > 1, 'MUTANT: the wait never read')
  })
  await withMutant(PATHS_PATH, '  if (!mem || ended) return mem\n', '  if (!mem) return mem\n', async M => {
    const m = {}; M.pathsExtendNote(m, [], { now: 5, ended: true })
    assert.strictEqual(m.pathsExtendAt, 5, 'MUTANT: an ended visit stamps the clock')
  })
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
await t('skills.mjs: pathsExtendDue and buildPaths read and write the process memory; nothing of it on the bot', () => {
  const S = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const n = s => S.split(s).length - 1
  assert.strictEqual(n('bot.pathsExtendAt'), 0); assert.strictEqual(n('bot.pathsUnrouted'), 0); assert.strictEqual(n('bot?.pathsExtendAt'), 0)
  assert.strictEqual(n('const pm = procMem(bot)'), 2)
  assert.strictEqual(n('newDests(rec, D.dests ?? []).some(d => !pathsUnroutedNow(pm, d.to, now))'), 1)
  assert.strictEqual(n("pathsExtendNote(pm, x.failed ?? [], { ended: clientEnded(bot) })"), 1)
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

// GKROOM-01 (bagfull-01's piece 2, control session 11-07): the keeper whose FOREST visit is refused for room (8 free slots) works the
// TIDY (2 free) instead. Showcase 06:40-15:01Z: 16 `_shop_skip why=room` rows from the keeper lease holder, every one with 2-7 free
// slots; the keeper's order leads with the forest. Behaviour (shop.mjs roomFallback, buildOrder's refusal chain), then the wiring.
import assert from 'node:assert'
import fs from 'node:fs'
const S = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const K = { on: true, plot: 'forest', need: 8, keeper: true, tidyWork: true, tidyQuiet: false }

console.log('THE FALLBACK (shop.mjs roomFallback)')
await t('LIVE: the keeper with 2-7 free slots and the forest refused goes to the tidy; 1 free, 8 free, not the keeper, no tidy work, quiet: none', async () => {
  await killedBy(SHOP_PATH, S, '  if (!(freeSlots >= MONUMENT_BAG_SLOTS_MIN && freeSlots < need)) return null\n', '', M => {
    assert.strictEqual(M.roomFallback({ ...K, freeSlots: 1 }), null, 'below the tidy\'s own 2: no visit')
  })
  for (const f of [2, 5, 7]) assert.strictEqual(S.roomFallback({ ...K, freeSlots: f }), 'tidy')
  assert.strictEqual(S.roomFallback({ ...K, freeSlots: 8 }), null)
  assert.strictEqual(S.roomFallback({ ...K, freeSlots: 5, keeper: false }), null, 'a helper or any other bot')
  assert.strictEqual(S.roomFallback({ ...K, freeSlots: 5, tidyWork: false }), null)
  assert.strictEqual(S.roomFallback({ ...K, freeSlots: 5, tidyQuiet: true }), null)
  assert.strictEqual(S.roomFallback({ ...K, freeSlots: 5, plot: 'hall' }), null, 'only the forest')
  assert.strictEqual(S.roomFallback({ ...K, freeSlots: 5, on: false }), null, 'GKROOM=0')
  assert.strictEqual(S.gkroomOn({ GKROOM: '0' }), false)
})

console.log('THE REFUSAL CHAIN (buildOrder: room bank first, then the tidy, else the skip)')
const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, freeSlots: 5, record: { plot: 'forest', structure_complete: false } }
const chain = M => {
  try {
    M.setRoomAsk(() => null)   // bagfull-01 found nothing to bank
    M.setTidyWork(() => ({ keeper: true, tidyWork: true }))
    const r = M.buildOrder(base)
    assert.deepStrictEqual(r, { order: { skill: 'build_shop', args: { plot: 'tidy', why: 'room_fallback' } }, skip: null })
    M.setRoomAsk(() => ({ order: { skill: 'build_shop', args: { roomBank: true } } }))
    assert.deepStrictEqual(M.buildOrder(base).order.args, { roomBank: true }, 'the room bank still comes first')
    M.setRoomAsk(() => null)
    M.setTidyWork(() => ({ keeper: false, tidyWork: true }))
    assert.strictEqual(M.buildOrder(base).skip, 'room', 'not the keeper: the skip, as before')
    M.setTidyWork(() => { throw new Error('boom') })
    assert.strictEqual(M.buildOrder(base).skip, 'room', 'an unreadable lease is no fallback')
    M.setTidyWork(() => ({ keeper: true, tidyWork: true }))
    assert.strictEqual(M.buildOrder({ ...base, freeSlots: 1 }).skip, 'room', 'one free slot: no visit fits')
  } finally { M.setRoomAsk(null); M.setTidyWork(() => ({ keeper: false, tidyWork: false })) }
}
await t('a keeper refused the forest for room is ordered the tidy (never no visit); the room bank first; anyone else keeps the skip', async () => {
  await killedBy(SHOP_PATH, S, "    if (fb) return { order: { skill: 'build_shop', args: { plot: fb, why: 'room_fallback' } }, skip: null }\n", '', chain)
})

console.log('THE VISIT\'S READS (shop.mjs roomFallbackPick)')
await t('Codex r1 BLOCKER: while the fallback visit runs (busy, marked) every active-project read names the tidy; not busy, unmarked, or a stale mark: no', async () => {
  await killedBy(SHOP_PATH, S, 'export const roomFallbackPick = (mark, now = Date.now(), busy = false) => !!busy && !!mark', 'export const roomFallbackPick = (mark, now = Date.now(), busy = false) => !!mark', M => {
    assert.strictEqual(M.roomFallbackPick({ at: 1000 }, 2000, false), false, 'the visit ended: the mark holds nothing')
  })
  assert.strictEqual(S.roomFallbackPick({ at: 1000 }, 2000, true), true)
  assert.strictEqual(S.roomFallbackPick(null, 2000, true), false)
  assert.strictEqual(S.roomFallbackPick({ at: 1000 }, 1000 + S.SHOP_SKILL_MS, true), false, 'a crash-left mark never outlives a visit')
})

console.log('WIRING (skills.mjs, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = s => {
  const one = re => { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one("ctx\\.bot\\.roomFallback = args\\?\\.why === 'room_fallback' && args\\?\\.plot === TIDY_PLOT \\? \\{ at: Date\\.now\\(\\) \\} : null")
  one('setTidyWork\\(\\(\\) => \\{')
  one('const fbPick = roomFallbackPick\\(b\\?\\.roomFallback \\?\\? null, now, !!b\\?\\.shopVisitBusy\\) \\? list\\.find\\(p => p\\.plot === TIDY_PLOT\\) \\?\\? null : null')
  one('if \\(fbPick\\) return fbPick')
  one('if \\(ctx\\.bot\\.roomFallback && ctx\\.bot\\.projReserve\\) ctx\\.bot\\.projReserve\\.at = -Infinity')
  one('if \\(!b \\|\\| !keeperLeaseNow\\(b\\)\\) return \\{ keeper: false, tidyWork: false \\}')
}
await t('the visit honours the fallback; the keeper read is the lease itself; a cut line fails', () => {
  const s = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(s)
  const cut = 'if (!b || !keeperLeaseNow(b)) return { keeper: false, tidyWork: false }'
  assert.ok(s.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(s.replace(cut, '')), assert.AssertionError)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1

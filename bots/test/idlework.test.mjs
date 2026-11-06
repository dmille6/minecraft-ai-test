// IDLEWORK-01: the idle rung asks for one bounded batch of productive work per lap (iron, logs, coal; one lap in eight the old
// scout), gained since it opened; a skip bars the KIND, never the rung; an exhausted chain re-enters for it; IDLEWORK=0 is the
// patrol exactly as before. And the return-first order: `return` before `deposit_surplus`, whose done now agrees with the
// deposit's own plan. Behaviour on the pure functions and on the real MilestoneController; anchored mutants at the end.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const IW = await import('../src/idlework.mjs')
const MS = await import('../src/milestones.mjs')
const { config } = await import('../src/config.mjs')
const BK = await import('../src/bankable.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const ALL = { iron: true, logs: true, coal: true }

// ---- idlePick ----
await t('the rotation: slot = cycle mod 8, scout one lap in eight', () => {
  const kinds = Array.from({ length: 8 }, (_, c) => IW.idlePick(c, { means: ALL }))
  assert.deepEqual(kinds, [...IW.IDLE_ROTATION])
  assert.equal(kinds.filter(k => k === 'scout').length, 1)
  assert.equal(IW.idlePick(8 + 3, { means: ALL }), IW.IDLE_ROTATION[3])
})
await t('a kind without its means is passed over to the next kind in the rotation (no pickaxe: logs only)', () => {
  for (let c = 0; c < 8; c++) {
    const k = IW.idlePick(c, { means: { logs: true } })
    assert.ok(k === 'logs' || (k === 'scout' && IW.IDLE_ROTATION[c] === 'scout'), `cycle ${c}: ${k}`)
  }
  assert.equal(IW.idlePick(0, { means: { logs: true, coal: true } }), 'logs', 'iron slot, no trip pickaxe -> the next (logs)')
})
await t('a barred kind waits its bar out; then it is asked again', () => {
  const now = 1e9
  const barred = IW.idleBar(new Map(), 'iron', now)
  assert.equal(IW.idlePick(0, { means: ALL, barred, now }), 'logs')
  assert.equal(IW.idlePick(0, { means: ALL, barred, now: now + IW.IDLE_BAR_MS }), 'iron')
})
await t('every work kind barred or without means -> scout (never worse than the old lap); scout barred too -> none', () => {
  const now = 1e9
  let barred = new Map()
  for (const k of IW.IDLE_KINDS) barred = IW.idleBar(barred, k, now)
  assert.equal(IW.idlePick(0, { means: ALL, barred, now }), 'scout')
  assert.equal(IW.idlePick(0, { means: {}, now }), 'scout')
  assert.equal(IW.idlePick(0, { means: ALL, barred: IW.idleBar(barred, 'scout', now), now }), 'none')
  assert.equal(IW.idleBar(new Map(), 'none', now).size, 0, 'none is never barred')
})
await t('a bad cycle reads as slot 0', () => {
  assert.equal(IW.idlePick(NaN, { means: ALL }), IW.IDLE_ROTATION[0])
  assert.equal(IW.idlePick(-3, { means: ALL }), IW.IDLE_ROTATION[0])
})
await t('NEVER COBBLE: no idle need names a cobble-family item (every town is at its cap)', () => {
  for (const n of Object.values(IW.IDLE_NEEDS)) for (const x of [...n.count, n.wants, ...n.wantsAny]) assert.ok(!/cobble|^stone$|deepslate$/.test(x), x)
})

// ---- the batch counter ----
await t('a batch opens at the bag count and counts only rises (a deposit or a scaffold spend never takes it back)', () => {
  let s = IW.idleStep(null, 4, 'logs', 17)
  assert.deepEqual([s.gained, s.last], [0, 17])
  s = IW.idleStep(s, 4, 'logs', 25); assert.equal(s.gained, 8)
  s = IW.idleStep(s, 4, 'logs', 3); assert.equal(s.gained, 8, 'a deposit to 3 keeps the 8')
  s = IW.idleStep(s, 4, 'logs', 11); assert.equal(s.gained, 16)
  assert.equal(IW.idleMet(s), true)
  const n = IW.idleStep(s, 5, 'iron', 11)
  assert.deepEqual([n.cycle, n.kind, n.gained], [5, 'iron', 0], 'a new lap opens a new batch')
})
await t('HOLDING is not GATHERING: a bag already over the batch does not meet it', () => {
  const s = IW.idleStep(null, 0, 'iron', 64)
  assert.equal(IW.idleMet(s), false)
})
await t('idleMet: scout by distance, none always, a work kind by its n', () => {
  assert.equal(IW.idleMet({ kind: 'scout' }, { dist: 81 }), true)
  assert.equal(IW.idleMet({ kind: 'scout' }, { dist: 79 }), false)
  assert.equal(IW.idleMet({ kind: 'none' }), true)
  assert.equal(IW.idleMet({ kind: 'coal', gained: 7 }), false)
  assert.equal(IW.idleMet({ kind: 'coal', gained: 8 }), true)
  assert.equal(IW.idleMet(null), false)
})

// ---- the order ----
await t('return-first: return moves in front of deposit_surplus; off is the old order', () => {
  const ids = l => l.map(m => m.id)
  const base = ids(MS.SUSTAINING)
  assert.ok(base.indexOf('deposit_surplus') < base.indexOf('return'), 'the declared list is the old order')
  const on = ids(MS.sustainingOrder(MS.SUSTAINING, true))
  assert.equal(on.indexOf('return') + 1, on.indexOf('deposit_surplus'))
  assert.deepEqual(ids(MS.sustainingOrder(MS.SUSTAINING, false)), base)
  assert.deepEqual([...on].sort(), [...base].sort(), 'nothing added or lost')
  assert.ok(base.indexOf('idle_work') === base.indexOf('patrol') - 1, 'the idle rung sits where the patrol was')
})

// ---- the controller, on a fake clock and a fake bot ----
let NOW = 2_000_000_000
const realNow = Date.now
Date.now = () => NOW
let DIST = 3
const H = { x: config.world.homeX, z: config.world.homeZ }
const mkItems = () => [
  // every rung before the idle one is met, and nothing is bankable (logs at the keep, one stack of cobble, kept tools)
  { name: 'oak_log', count: 16 }, { name: 'stick', count: 2 }, { name: 'cobblestone', count: 64 },
  { name: 'crafting_table', count: 1 }, { name: 'furnace', count: 1 }, { name: 'coal', count: 4 },
  { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 },
  { name: 'iron_pickaxe', count: 1, maxDurability: 250, durabilityUsed: 0 }, { name: 'bucket', count: 1 },
  { name: 'iron_ingot', count: 3 },
]
let ITEMS = mkItems()
const CHEST = { v: false }
const bot = {
  entity: { position: { x: H.x, y: 64, z: H.z, distanceTo: () => DIST } },
  inventory: { items: () => ITEMS },
  registry: { blocks: {} },
  findBlock: () => (CHEST.v ? { position: { x: H.x, y: 64, z: H.z } } : null),
}
const add = (name, n) => { const it = ITEMS.find(i => i.name === name); if (it) it.count += n; else ITEMS.push({ name, count: n }) }
function controller (role = 'gatherer') {
  const progress = { attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {}, progressAt: {} }
  const lessons = { getProgress: () => progress, setProgress: (a, s, sa, sc, cy, co, pa) => Object.assign(progress, { attempts: a, skipped: s, skippedAt: sa, skipCount: sc, cycle: cy, completions: co, progressAt: pa }), save () {} }
  const c = new MS.MilestoneController(bot, role, lessons)
  // only the sustaining lap: this file's subject (a static fixture cannot climb a role chain)
  c.chain = c.chain.slice(c.chain.length - MS.SUSTAINING.length)
  return { c, progress }
}
const base = id => String(id ?? '').split('#')[0]
/** refresh until the current rung is idle_work or the safety bound; -> the status */
function settle (c, n = 4) { let s; for (let i = 0; i < n; i++) { c.refresh(); s = c.status(); if (base(s.id) === 'idle_work') break } return s }

await t('THE LAP: idle work (a batch), then return, then deposit -- and the chain re-enters for the next batch', () => {
  MS._idleReset(); ITEMS = mkItems(); DIST = 3; CHEST.v = false
  const { c } = controller()
  const s0 = settle(c)
  assert.equal(base(s0.id), 'idle_work', `current ${s0.id}`)
  const k0 = MS._idleState().state.kind
  assert.ok(['iron', 'logs', 'coal'].includes(k0), k0)
  assert.equal(s0.wants, IW.IDLE_NEEDS[k0].wants, 'the status forwards the batch\'s wants (the value classifier and the exemption read it)')
  assert.match(s0.describe, /Mine|Cut/)
  // gather the batch out in the field
  DIST = 120
  add(IW.IDLE_NEEDS[k0].count[0], IW.IDLE_NEEDS[k0].n)
  c.refresh()
  assert.equal(base(c.status().id), 'return', `after the batch: ${c.status().id} (patrol must be stepped over, return before deposit)`)
  DIST = 3; CHEST.v = true
  add('raw_copper', 20)   // bankable surplus (DEPOSIT_ALWAYS) at home with a chest
  c.refresh()
  assert.equal(base(c.status().id), 'deposit_surplus', `home with surplus: ${c.status().id}`)
  const cy = c.cycle
  const banked = new Set(BK.depositPlan(ITEMS).map(p => p.name))
  ITEMS = ITEMS.filter(i => !banked.has(i.name))   // the deposit banked its plan
  c.refresh(); c.refresh()   // the chain runs off its end, then the next refresh re-enters (as it always has)
  assert.ok(c.cycle > cy, `one more lap (cycle ${cy} -> ${c.cycle}, current ${c.status().id})`)
  assert.ok(!['deposit_surplus', 'return'].includes(base(c.status().id)), c.status().id)
  add('oak_log', 16)   // the wood rung (the deposit banked the logs too) is not this file's subject
  CHEST.v = false
  const s1 = settle(c)
  assert.equal(base(s1.id), 'idle_work', `the next batch: ${s1.id}`)
  assert.equal(MS._idleState().state.gained, 0, 'a fresh batch')
})
await t('A SKIP BARS THE KIND, NOT THE RUNG: 45 min with no serving progress -> the next lap asks another kind', () => {
  MS._idleReset(); ITEMS = mkItems(); DIST = 3; CHEST.v = false
  const { c, progress } = controller()
  settle(c)
  const k0 = MS._idleState().state.kind
  c.noteAttempt({ failed: false, executed: true, serving: false })   // the rung's deadline clock starts at its first decision
  NOW += MS.NO_PROGRESS_MS + 1000
  const skipped = c.noteAttempt({ failed: false, executed: true, serving: false })
  assert.equal(skipped, true)
  assert.equal(c.lastSkip.id, 'idle_work')
  assert.ok(!progress.skipped.includes('idle_work'), 'the rung is never on the skip list')
  assert.ok(MS._idleState().barred.has(k0), `${k0} barred`)
  // the lap finishes (return, deposit are met at home with nothing to bank) and re-enters
  const s = settle(c)
  assert.equal(base(s.id), 'idle_work', `back on the idle rung: ${s.id}`)
  assert.notEqual(MS._idleState().state.kind, k0, 'a different kind')
})
await t('COMPOSED: every kind failing in turn ends on the scout lap, never on a dead end, and never spins', () => {
  MS._idleReset(); ITEMS = mkItems(); DIST = 3; CHEST.v = false
  const { c } = controller()
  const seen = []
  for (let i = 0; i < 8 && !seen.includes('scout'); i++) {
    const s = settle(c)
    assert.equal(base(s.id), 'idle_work', `round ${i}: ${s.id} (kinds so far ${seen})`)
    seen.push(MS._idleState().state.kind)
    c.noteAttempt({ failed: false, executed: true, serving: false })
    NOW += MS.NO_PROGRESS_MS + 1000
    c.noteAttempt({ failed: false, executed: true, serving: false })
  }
  assert.deepEqual([...seen].sort(), ['coal', 'iron', 'logs', 'scout'], `every work kind, then the scout: ${seen}`)
  // scout barred as well: nothing re-opens, the chain stays put (no cycle spin)
  const cy = c.cycle
  for (let i = 0; i < 5; i++) c.refresh()
  assert.ok(c.cycle - cy <= 1, `cycle spun ${cy} -> ${c.cycle}`)
  // the bars lapse: the work comes back
  NOW += IW.IDLE_BAR_MS + 1000
  const s = settle(c, 6)
  assert.equal(base(s.id), 'idle_work')
  assert.ok(['iron', 'logs', 'coal'].includes(MS._idleState().state.kind))
})
await t('IDLEWORK=0: the patrol lap, exactly as before (patrol current at home, the old deposit/return order)', () => {
  MS._idleReset(); ITEMS = mkItems(); DIST = 3; CHEST.v = false
  process.env.IDLEWORK = '0'
  try {
    const { c } = controller()
    c.refresh()
    assert.equal(base(c.status().id), 'patrol')
    assert.equal(c.status().describe, 'Scout terrain away from home and come back.')
  } finally { delete process.env.IDLEWORK }
})
await t('servesRung: a work batch is served by gathering its ore or logs (not by walking); the scout lap by walking', () => {
  MS._idleReset(); ITEMS = mkItems(); DIST = 3
  const { c } = controller()
  settle(c)
  const st = MS._idleState().state
  const need = IW.IDLE_NEEDS[st.kind]
  const wanted = new Set(need.wantsAny)
  assert.equal(MS.servesRung('gather', { block: need.wantsAny[0] }, { id: 'idle_work#3' }, wanted), true)
  assert.equal(MS.servesRung('explore', {}, { id: 'idle_work#3' }, wanted), false)
})

// ---- deposit_surplus agrees with the deposit ----
const surplus = MS.SUSTAINING.find(m => m.id === 'deposit_surplus')
await t('depositSurplusMet: no chest -> met; a chest and a plan that moves nothing -> met (return-first); =0 -> the old rule', () => {
  assert.equal(MS.depositSurplusMet({ chest: false }), true)
  assert.equal(MS.depositSurplusMet({ chest: true, planEmpty: () => true, returnFirst: true }), true)
  assert.equal(MS.depositSurplusMet({ chest: true, planEmpty: () => false, returnFirst: true }), false)
  assert.equal(MS.depositSurplusMet({ chest: true, planEmpty: () => true, returnFirst: false }), false)
})
await t('deposit_surplus at a chest: real surplus is still asked for (positive control), none is met', () => {
  CHEST.v = true
  ITEMS = Array.from({ length: 6 }, () => ({ name: 'oak_log', count: 64 }))
  assert.ok(BK.depositPlan(ITEMS).length > 0 && BK.bankableInventory(ITEMS).count >= 4, 'fixture: logs over the keep are banked')
  assert.equal(surplus.done(bot), false)
  ITEMS = [{ name: 'oak_log', count: 3 }]
  assert.equal(surplus.done(bot), true)
  CHEST.v = false
})

// ---- mutants (anchored: present and unique, or the mutant is refused) ----
const MS_PATH = new URL('../src/milestones.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} -- ANCHOR MISSING`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
function lapWith (mod) {
  mod._idleReset(); ITEMS = mkItems(); DIST = 3; CHEST.v = false
  const progress = { attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {}, progressAt: {} }
  const lessons = { getProgress: () => progress, setProgress: (a, s, sa, sc, cy) => Object.assign(progress, { attempts: a, skipped: s, skippedAt: sa, skipCount: sc, cycle: cy }), save () {} }
  const c = new mod.MilestoneController(bot, 'gatherer', lessons)
  c.chain = c.chain.slice(c.chain.length - mod.SUSTAINING.length)
  return { c, progress }
}
await t('MUTANT KILLED: the rung put on the skip list (no noBar) -> the idle work is barred for the backoff, the patrol-free lap stalls', async () => {
  await withMutant(MS_PATH, "  noBar: true,\n", "  noBar: false,\n", async mod => {
    const { c, progress } = lapWith(mod)
    settle(c)
    c.noteAttempt({ failed: false, executed: true, serving: false })
    NOW += mod.NO_PROGRESS_MS + 1000
    c.noteAttempt({ failed: false, executed: true, serving: false })
    assert.ok(progress.skipped.includes('idle_work'), 'the mutant must bar the rung itself')
  })
})
await t('MUTANT KILLED: no re-entry for the idle rung -> the chain ends at "Nothing to do"', async () => {
  await withMutant(MS_PATH, "        if (typeof m.reopens === 'function') { try { if (m.reopens(this.bot, this.cycle ?? 0)) return true } catch { /* no */ } return false }\n", "", async mod => {
    const { c } = lapWith(mod)
    settle(c)
    const k = mod._idleState().state.kind
    add(IW.IDLE_NEEDS[k].count[0], IW.IDLE_NEEDS[k].n)
    for (let i = 0; i < 4; i++) c.refresh()
    assert.equal(c.status().id, 'idle', `the mutant leaves the chain exhausted (got ${c.status().id}); the real code re-enters`)
  })
})
await t('MUTANT KILLED: batch = HOLD N (not gained) -> a bot already holding the batch walks past it', async () => {
  const IW_PATH = new URL('../src/idlework.mjs', import.meta.url)
  const src = readFileSync(IW_PATH, 'utf8')
  const old = '  return state.gained >= (IDLE_NEEDS[state.kind]?.n ?? Infinity)\n'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const mod = await import('data:text/javascript,' + encodeURIComponent(src.replace(old, '  return state.last >= (IDLE_NEEDS[state.kind]?.n ?? Infinity)\n')))
  assert.equal(mod.idleMet(mod.idleStep(null, 0, 'iron', 64)), true, 'the mutant meets on holding')
  assert.equal(IW.idleMet(IW.idleStep(null, 0, 'iron', 64)), false, 'the real code does not')
})
await t('MUTANT KILLED: the old order (deposit before return) -> the lap reaches return with the deposit vacuous far out', async () => {
  await withMutant(MS_PATH, "const SUSTAINING_RUN = sustainingOrder(SUSTAINING)\n", "const SUSTAINING_RUN = SUSTAINING\n", async mod => {
    const ids = new mod.MilestoneController(bot, 'gatherer', null).chain.map(m => m.id)
    assert.ok(ids.indexOf('deposit_surplus') < ids.indexOf('return'), 'the mutant keeps the old order')
  })
  const ids = new MS.MilestoneController(bot, 'gatherer', null).chain.map(m => m.id)
  assert.ok(ids.indexOf('return') < ids.indexOf('deposit_surplus'), 'the real chain returns first')
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

// TIDYFLOW-01 (bots/src/tidyflow.mjs; skills.mjs buildTidyVisit / tidyRefresh / the order's idle hook). Owner 11-16: the town's
// clean-up "has not happened after 4-5 days of work". Measured on the live showcase (14 bots, 8 h to 18:00Z): 47 tidy visits laid 35
// blocks and dug 0 cuts; 14 of them drew at the yard first (48-51 s for about 4 cobblestone) and reached their segment with 0-15 s
// left; the hourly refresh ran twice in 18 h; 5 keeper terms in 100 min; 28 visits ended `aborted`.
//
// The pure rules at their boundaries, each with its positive control and an anchored mutant; then the CHAINS (two correct guards
// composing into a dead end is this repo's repeated failure) -- through the real runVisit on buildfake's world (the draw skipped ->
// a staircase with no stone; the cuts as the material), over real lease files (the refresh's back-off), against reflex.mjs's own
// stuckDecision (the heartbeat lapses, and never outlives the visit), and through shop.mjs's real buildOrder (the keeper's order).
// Last: what the synchronous in-wall survey costs on a record of the live size (printed, not asserted: see the report).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-tidyflow-logs-'))
process.env.BOT_NAME = 'FlowBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'hive-a'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-tidyflow-pool-'))
for (const k of ['TIDYFLOW_DRAW', 'TIDYFLOW_REFRESH', 'TIDYFLOW_STILL', 'TIDYFLOW_KEEPER', 'TIDYFLOW_LONG', 'TIDYFLOW_ALLHANDS', 'TIDYFLOW_ALLHANDS_SHARE', 'GROUNDS2', 'GROUNDSKEEPER', 'TIDY', 'COUNTRY', 'LANDPLAN', 'GKFILLSHARE']) delete process.env[k]
const { withMutant } = await import('./helpers/mutant.mjs')
const { G, HOME, server, bot: fakeBot, PJ, R, rowSurvives } = await import('./helpers/buildfake.mjs')
const F = await import('../src/tidyflow.mjs')
const T = await import('../src/tidy.mjs')
const TR = await import('../src/tidyrefresh.mjs')
const GK = await import('../src/groundskeeper.mjs')
const C = await import('../src/country.mjs')
const S = await import('../src/shop.mjs')
const LP = await import('../src/landplan.mjs')
const { stuckDecision } = await import('../src/reflex.mjs')

const FLOW_PATH = new URL('../src/tidyflow.mjs', import.meta.url)
const SRC = n => path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', n)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 7).join('\n        ')}`) }
}
/** The scenario passes on the real module and FAILS (an assertion, not a crash) on the anchored mutant. */
const killedBy = async (old, neu, scenario) => {
  await scenario(F)
  let why = null
  await withMutant(FLOW_PATH, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const MIN = 60_000
const PAL = T.TIDY_PALETTE
const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), `tflow-${tag}-`))

console.log('THE SWITCHES (four, each on unless its own variable says off) AND THE LICENCE ROW')
await t('each switch: default on; off|0|false|no (any case, padded) is off; one switch never moves another', () => {
  const sw = { TIDYFLOW_DRAW: F.flowDrawOn, TIDYFLOW_REFRESH: F.flowRefreshOn, TIDYFLOW_STILL: F.flowStillOn, TIDYFLOW_KEEPER: F.flowKeeperOn, TIDYFLOW_LONG: F.flowLongOn, TIDYFLOW_ALLHANDS: F.flowAllOn, TIDYFLOW_ALLHANDS_SHARE: F.flowShareOn }
  for (const [name, fn] of Object.entries(sw)) {
    assert.strictEqual(fn({}), true, `${name} default`)
    for (const v of ['off', '0', 'false', 'no', ' OFF ', 'No']) assert.strictEqual(fn({ [name]: v }), false, `${name}=${v}`)
    for (const v of ['on', '1', '', 'yes']) assert.strictEqual(fn({ [name]: v }), true, `${name}=${v}`)
    for (const [other, g] of Object.entries(sw)) if (other !== name) assert.strictEqual(g({ [name]: 'off' }), true, `${name}=off leaves ${other} on`)
  }
  assert.deepStrictEqual({ ...F.TFLOW }, { draw: true, refresh: true, still: true, keeper: true, long: true, all: true, share: true, stillVisit: true }, 'this process: all eight on (stillvisit-01show: + stillVisit)')
  assert.ok(Object.isFrozen(F.TFLOW) && Object.isFrozen(F.TIDYFLOW))
  assert.deepStrictEqual([F.TIDYFLOW.enough, F.TIDYFLOW.stillMs, F.TIDYFLOW.lease, F.TIDYFLOW.leaseMs], [8, 20_000, 'refresh', 10 * MIN])
})
await t('`_tidyflow`: one row says every switch and the numbers; a rollback is visible', () => {
  assert.strictEqual(F.flowModeDetail(), 'v=1 draw=1 refresh=1 still=1 keeper=1 long=1 all=1 enough=8 still_ms=20000 lease_ms=600000 long_ms=600000 idle_ms=120000 idle_rows=12 all_bots=12 all_country=8 all_cooldown_ms=180000 share=1 share_every=3 all_aborts=2 stillvisit=1 stillvisit_ms=20000')
  assert.strictEqual(F.flowModeDetail({ draw: false, refresh: true, still: false, keeper: true, long: false, all: false }), 'v=1 draw=0 refresh=1 still=0 keeper=1 long=0 all=0 enough=8 still_ms=20000 lease_ms=600000 long_ms=600000 idle_ms=120000 idle_rows=12 all_bots=12 all_country=8 all_cooldown_ms=180000 share=0 share_every=3 all_aborts=2 stillvisit=0 stillvisit_ms=20000')
  const feat = strip(fs.readFileSync(SRC('features.mjs'), 'utf8'))
  assert.strictEqual(feat.split("logEvent({ kind: 'tidyflow', status: 'success', snapshot: snapshot(bot), detail: flowModeDetail() })").length, 2, 'features.mjs writes it once at spawn')
})

console.log('THE DRAW (drawPlan): no draw while the bag holds one visit\'s work, none while a cut waits; the draw when neither')
await t('the bag: 8 spare earth is one visit\'s work whatever the backlog (LIVE: bill 25 = 7 spare, a 48 s yard draw); a smaller backlog needs only itself', async () => {
  await killedBy('const lack = o > 0 ? num(earth) < Math.min(o, T.enough)', 'const lack = o > 0 ? num(earth) < o', M => {
    assert.deepStrictEqual(M.drawPlan({ open: 1300, earth: 8 }), { skip: true, tag: 'skip:bag' })
  })
  assert.deepStrictEqual(F.drawPlan({ open: 1300, earth: 7 }), { skip: false, tag: 'draw' }, '7 of 8: short, and no cut -- the draw as before')
  assert.deepStrictEqual(F.drawPlan({ open: 3, earth: 3 }), { skip: true, tag: 'skip:bag' })
  assert.deepStrictEqual(F.drawPlan({ open: 3, earth: 2 }), { skip: false, tag: 'draw' })
  // stairs only: stone is what counts
  assert.deepStrictEqual(F.drawPlan({ open: 0, openAccess: 5, earth: 64, stone: 5 }), { skip: true, tag: 'skip:bag' })
  assert.deepStrictEqual(F.drawPlan({ open: 0, openAccess: 5, earth: 64, stone: 4 }), { skip: false, tag: 'draw' }, 'dirt lays no staircase')
  // nothing open: nothing decided (the visit's bill is its lights, saplings and plants: as before)
  assert.deepStrictEqual(F.drawPlan({ open: 0, openAccess: 0, earth: 0, cuts: 9, clearFree: true }), { skip: false, tag: null })
})
await t('the cuts are the material: short of earth with a cut this bot may dig -> no draw; the clear lease another\'s, or no cut -> the draw', async () => {
  await killedBy("  if (!cutsDry && num(cuts) > 0 && yes(clearFree)) return { skip: true, tag: 'skip:cuts' }\n", '', M => {
    assert.deepStrictEqual(M.drawPlan({ open: 900, earth: 0, cuts: 493, clearFree: true }), { skip: true, tag: 'skip:cuts' })
  })
  await killedBy('num(cuts) > 0 && yes(clearFree)) return', 'num(cuts) > 0) return', M => {
    assert.deepStrictEqual(M.drawPlan({ open: 900, earth: 0, cuts: 493, clearFree: false }), { skip: false, tag: 'draw' }, 'the one clear lease is another bot\'s: no cut is this visit\'s')
  })
  assert.deepStrictEqual(F.drawPlan({ open: 900, earth: 0, cuts: 0, clearFree: true }), { skip: false, tag: 'draw' })
  assert.deepStrictEqual(F.drawPlan({ open: 900, earth: 5, cuts: 2, clearFree: true }), { skip: true, tag: 'skip:cuts' }, 'a few blocks and a cut: the cuts first')
  // the cut list and the lease are read only when the bag is short (a function is asked lazily)
  let asked = 0
  const count = v => () => { asked++; return v }
  assert.strictEqual(F.drawPlan({ open: 900, earth: 8, cuts: count(5), clearFree: count(true) }).tag, 'skip:bag')
  assert.strictEqual(asked, 0, 'the bag is enough: nothing read')
  assert.strictEqual(F.drawPlan({ open: 900, earth: 0, cuts: count(5), clearFree: count(true) }).tag, 'skip:cuts')
  assert.strictEqual(asked, 2)
  assert.strictEqual(F.drawPlan({ open: 900, earth: 0, cuts: count(0), clearFree: count(true) }).tag, 'draw')
  assert.strictEqual(asked, 3, 'no cut: the lease is not read')
})
await t('TIDYFLOW_DRAW=off: nothing is decided -- no skip, no tag (the bill and the row as they were), whatever the bag', async () => {
  await killedBy('  if (!on) return { skip: false, tag: null }\n', '', M => {
    for (const q of [{ open: 900, earth: 64 }, { open: 900, earth: 0, cuts: 9, clearFree: true }, { open: 0, openAccess: 3, stone: 9 }]) assert.deepStrictEqual(M.drawPlan({ ...q, on: false }), { skip: false, tag: null })
  })
  // ...and every consumer of the plan then leaves its input alone
  const off = F.drawPlan({ on: false, open: 900, earth: 64 })
  const need = { cobblestone: 25, torch: 2 }, share = { clearMax: 16, clearsLast: true, behind: true }
  assert.strictEqual(F.billTrim(need, { skip: off.skip, keeper: false }), need); assert.deepStrictEqual(need, { cobblestone: 25, torch: 2 })
  assert.strictEqual(F.cutsFirst(share, off), share)
  assert.strictEqual(F.drawTag(off, { yard: 4, chest: 3 }), null, 'no `draw=` on the row')
  assert.strictEqual(F.cutsDryAfter(false, off, 0), false); assert.strictEqual(F.cutsDryAfter(true, off, 0), true)
})
await t('billTrim: a worker that does not draw draws NOTHING; the keeper keeps its saplings and lights (only the cobblestone goes); a drawing visit\'s bill is untouched', async () => {
  await killedBy("if (!keeper || k === 'cobblestone') delete need[k]", "if (k === 'cobblestone') delete need[k]", M => {
    assert.deepStrictEqual(M.billTrim({ cobblestone: 25, torch: 2, dirt: 6 }, { skip: true, keeper: false }), {}, 'a worker: no 30 s walk to the chests for two torches')
  })
  assert.deepStrictEqual(F.billTrim({ cobblestone: 25, torch: 2, oak_sapling: 1 }, { skip: true, keeper: true }), { torch: 2, oak_sapling: 1 })
  assert.deepStrictEqual(F.billTrim({ cobblestone: 25, torch: 2 }, { skip: false, keeper: false }), { cobblestone: 25, torch: 2 })
  assert.deepStrictEqual(F.billTrim({}, { skip: true }), {}); assert.strictEqual(F.billTrim(null, { skip: true }), null)
})
await t('drawTag: the row says why nothing was drawn, or where the draw came from', () => {
  assert.strictEqual(F.drawTag({ skip: true, tag: 'skip:bag' }, { yard: 9 }), 'skip:bag')
  assert.strictEqual(F.drawTag({ skip: true, tag: 'skip:cuts' }), 'skip:cuts')
  assert.strictEqual(F.drawTag({ skip: false, tag: 'draw' }, { yard: 4, chest: 0 }), 'yard')
  assert.strictEqual(F.drawTag({ skip: false, tag: 'draw' }, { yard: 0, chest: 21 }), 'chest')
  assert.strictEqual(F.drawTag({ skip: false, tag: 'draw' }, { yard: 4, chest: 21 }), 'yard+chest')
  assert.strictEqual(F.drawTag({ skip: false, tag: 'draw' }, {}), 'none', 'LIVE: `took=-`, the reserve gave nothing')
  assert.strictEqual(F.drawTag({ skip: false, tag: null }, { yard: 4 }), null)
})
await t('THE CHAIN (a refusal names a reachable remedy): cuts listed that no visit can dig must not starve the bag -- a dry cuts-first visit, then the DRAW', async () => {
  const bag = { open: 900, earth: 0, cuts: 493, clearFree: true }
  const scenario = M => {
    let dry = false
    const v1 = M.drawPlan({ ...bag, cutsDry: dry })
    assert.strictEqual(v1.tag, 'skip:cuts')
    dry = M.cutsDryAfter(dry, v1, 0)                 // the visit dug nothing (no stand, water beside the cuts)
    const v2 = M.drawPlan({ ...bag, cutsDry: dry })
    assert.deepStrictEqual(v2, { skip: false, tag: 'draw' }, 'the next visit draws: the bot holds a block again')
    dry = M.cutsDryAfter(dry, v2, 0)
    assert.strictEqual(M.drawPlan({ ...bag, cutsDry: dry }).tag, 'skip:cuts', 'after a draw the cuts are asked again')
  }
  await killedBy("  if (plan?.tag === 'skip:cuts') return !(num(cleared) > 0)\n", "  if (plan?.tag === 'skip:cuts') return false\n", scenario)
  await killedBy('  if (!cutsDry && num(cuts) > 0', '  if (num(cuts) > 0', scenario)
  // positive control: a cuts-first visit that DID dig stays on the cuts
  assert.strictEqual(F.cutsDryAfter(false, { skip: true, tag: 'skip:cuts' }, 3), false)
  assert.strictEqual(F.cutsDryAfter(true, { skip: true, tag: 'skip:bag' }, 0), true, 'a visit that never asked the cuts changes nothing')
  assert.strictEqual(F.cutsDryAfter(true, { skip: true, tag: 'skip:bag' }, 2), false, 'a cut dug later (the fills done, time left) clears it')
})

// ---- the chains through the real runVisit ---------------------------------------------------------------------------------------
/** runVisit as skills.mjs buildTidyVisit calls it for a worker (grounds2.test.mjs workerVisit), with the visit's `alsoDone` and a dig
 *  that puts the dug block in the bag (a cut IS the material). */
async function visit ({ record, cuts = [], inv = {}, srv = server(), share = { clearMax: GK.GK.clearMax, clearsLast: false }, alsoDoneOf = null } = {}) {
  const dir = tmp('run'), me = 'W', key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, me, 4)
  const ops = []
  const dig = async (c, expect) => { const n = srv.read(...c)?.name; if (expect && n !== expect) return 'refused'; srv.set(c, 'air'); inv[n] = (inv[n] ?? 0) + 1; return 'confirmed' }
  const e = fakeBot(srv, me, { inv, feet: [0, G + 1, 2], dig })
  const log0 = e.log
  e.log = (k, d) => { if (k === '_build' && (d.op === 'place' || d.op === 'clear')) ops.push(`${d.op}:${(d.cell ?? []).join(',')}`); return log0(k, d) }
  const alsoDone = alsoDoneOf ? alsoDoneOf(e) : null
  const r = await R.runVisit({ dir, key, me, home: HOME, stood: [], record, tidy: cuts, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64,
    clearMax: share.clearMax, ...(share.clearsLast ? { clearsLast: true } : {}), tidyKeepOrder: true, deferSpent: true, stuckStalledOnly: true, skipOpenDeps: true, ...(alsoDone ? { alsoDone } : {}) }, e, { maxSteps: 200 })
  return { r, ops, srv, e, fills: ops.filter(o => o.startsWith('place:')).length }
}
// a staircase FIRST in the survey's order, then a plain pit
const stairFirstRec = () => ({
  cells: [{ at: [30, G + 1, 0], role: 'access', seg: 'T-00-0' }, ...[10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'T-01-0' }))],
  segments: [{ seg: 'T-00-0', deps: [] }, { seg: 'T-01-0', deps: [] }], clear: [], cut: [], replant: [],
})
const pitRec = () => ({ cells: [10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'T-00-0' })), segments: [{ seg: 'T-00-0', deps: [] }], clear: [], cut: [], replant: [] })
const bumps = srv => [-5, -6, -7].map(x => { const at = [x, G + 1, 0]; srv.set(at, 'dirt'); return { at, kind: 'tidy', name: 'dirt' } })

console.log('CHAIN 1: the draw skipped -> a staircase the bag has no stone for must not end the visit `no_material`')
await t('a bag of dirt, the staircase first in the order: with stoneSkip the pit is filled and the stair is left OPEN for a bag with stone; control: without it, `no_material`, nothing laid', async () => {
  const stair = [30, G + 1, 0]
  const scenario = async M => {
    const x = await visit({ record: stairFirstRec(), inv: { dirt: 8 }, alsoDoneOf: e => q => M.stoneSkip(q, e.has, PAL.access) })
    assert.notStrictEqual(x.r.stop, 'no_material', `the visit went on (${x.ops.join(' ')})`)
    assert.strictEqual(x.fills, 2, `both fills laid with the dirt: ${x.ops.join(' ')}`)
    assert.strictEqual(R.cellDone(x.srv.read(...stair), PAL, 'access'), false, 'the staircase is NOT done in the world: passed this visit, never laid in dirt, never waived')
  }
  await killedBy("return !!q && q.role === 'access' && !stone.some(n => has(n))", 'return false', scenario)
  // positive control: the same bag and order without the guard -- the dead end the draw used to cover
  const c = await visit({ record: stairFirstRec(), inv: { dirt: 8 } })
  assert.deepStrictEqual([c.fills, c.r.stop], [0, 'no_material'], c.ops.join(' '))
})
await t('the guard never hides a staircase the bag CAN build: with stone it is laid; and it passes only staircase cells', async () => {
  const scenario = async M => {
    const x = await visit({ record: stairFirstRec(), inv: { dirt: 8, cobblestone: 4 }, alsoDoneOf: e => q => M.stoneSkip(q, e.has, PAL.access) })
    assert.strictEqual(R.cellDone(x.srv.read(30, G + 1, 0), PAL, 'access'), true, `the stair is laid: ${x.ops.join(' ')}`)
    assert.strictEqual(x.ops[0], `place:30,${G + 1},0`, 'and first, as the order has it')
  }
  await killedBy("q.role === 'access' && !stone.some(n => has(n))", "q.role === 'access'", scenario)
  const none = () => false
  assert.strictEqual(F.stoneSkip({ at: [1, 2, 3], role: 'access' }, none, PAL.access), true)
  for (const role of ['earth', 'core', 'topsoil', 'light', undefined]) assert.strictEqual(F.stoneSkip({ at: [1, 2, 3], role }, none, PAL.access), false, `${role} is never passed for want of stone`)
  assert.strictEqual(F.stoneSkip(null, none, PAL.access), false)
  for (const n of PAL.access) assert.strictEqual(F.stoneSkip({ role: 'access' }, b => b === n, PAL.access), false, `${n} builds a stair`)
  assert.strictEqual(F.stoneSkip({ role: 'access' }, b => b === 'dirt', PAL.access), true, 'dirt never does (owner 11-04: no dirt steps)')
})

console.log('CHAIN 2: the cuts are the material -- LIVE: 0 cuts dug in 47 visits, because a worker\'s cuts go last once a block is in the bag')
await t('one block in the bag, two fills and three cuts: cuts first digs 3 and lays both fills from them; control (the worker\'s share as it was): 1 fill, `no_material`, 0 cuts', async () => {
  const behind = GK.tidyShare({ role: 'helper', fillsLeft: 2, fillsTotal: 2, cutsLeft: 3, cutsTotal: 6, fillReady: true })
  assert.deepStrictEqual(behind, { clearMax: GK.GK.clearMax, clearsLast: true, behind: true }, 'the base share: a worker with a fill ready digs last')
  const scenario = async M => {
    const srv = server()
    const x = await visit({ record: pitRec(), srv, cuts: bumps(srv), inv: { dirt: 1 }, share: M.cutsFirst(behind, { skip: true, tag: 'skip:cuts' }) })
    assert.ok(x.ops[0]?.startsWith('clear:'), `a cut is first: ${x.ops.join(' ')}`)
    assert.deepStrictEqual([x.r.cleared, x.r.placed], [3, 2], `the cuts dug and both fills laid from them: ${x.ops.join(' ')} (${x.r.stop})`)
  }
  await killedBy("(plan?.tag === 'skip:cuts' ? { ...share, clearsLast: false } : share)", '(share)', scenario)
  const srv = server()
  const c = await visit({ record: pitRec(), srv, cuts: bumps(srv), inv: { dirt: 1 }, share: behind })
  assert.deepStrictEqual([c.r.cleared, c.r.placed, c.r.stop], [0, 1, 'no_material'], `control, the measured failure: ${c.ops.join(' ')}`)
  // any other plan leaves the share alone (identity: nothing rebuilt)
  for (const plan of [{ skip: true, tag: 'skip:bag' }, { skip: false, tag: 'draw' }, { skip: false, tag: null }, null]) assert.strictEqual(F.cutsFirst(behind, plan), behind)
  assert.deepStrictEqual(F.cutsFirst({ clearMax: 4, clearsLast: false, behind: true }, { tag: 'skip:cuts' }), { clearMax: 4, clearsLast: false, behind: true }, 'the keeper\'s few cuts stay few')
})

console.log('THE REFRESH (refreshMay / keeperLane / refreshLeaseFree): a due refresh is the visit\'s first act, whoever keeps the grounds')
const inwall = (agoMs, now) => ({ blueprint: 'tidy@1', stageId: TR.TIDYREFRESH.inwallId, sitedAt: now - agoMs, cells: [], cut: [] })
await t('refreshMay: the keeper and any worker but a fall-through\'s late leg, while the record is due and the lease free', async () => {
  const now = 50_000_000
  const due = TR.refreshDue(inwall(61 * MIN, now), { now, env: {} })
  assert.strictEqual(due, true); assert.strictEqual(TR.refreshDue(inwall(59 * MIN, now), { now, env: {} }), false, 'positive control: the hour is the record\'s own')
  assert.deepStrictEqual(F.refreshMay({ due, site: true, free: true }), { run: true, by: 'keeper', why: 'due' })
  await killedBy("  return { run: true, by: site ? 'keeper' : 'worker', why: 'due' }\n", "  return site ? { run: true, by: 'keeper', why: 'due' } : no('worker')\n", M => {
    assert.deepStrictEqual(M.refreshMay({ due, site: false, free: true }), { run: true, by: 'worker', why: 'due' }, 'LIVE: 13.5 h for one bot\'s second visit in its own hour')
  })
  await killedBy("  if (late) return no('late')\n", '', M => {
    assert.deepStrictEqual(M.refreshMay({ due, site: false, late: true, free: true }), { run: false, by: null, why: 'late' }, 'half the skill\'s clock is gone: never a survey there')
  })
  await killedBy("  if (!free) return no('lease')\n", '', M => {
    assert.deepStrictEqual(M.refreshMay({ due, site: true, free: false }), { run: false, by: null, why: 'lease' })
  })
  await killedBy("  if (!due) return no('not_due')\n", '', M => {
    assert.deepStrictEqual(M.refreshMay({ due: false, site: true, free: true }), { run: false, by: null, why: 'not_due' })
  })
  await killedBy("  if (!on) return no('off')\n", '', M => {
    assert.deepStrictEqual(M.refreshMay({ on: false, due, site: true, free: true }), { run: false, by: null, why: 'off' }, 'TIDYFLOW_REFRESH=off: never the first act')
  })
})
await t('keeperLane: LIVE -- every new keeper\'s first visit was the country\'s (`keeper_turn:open`); with the refresh to run it is the inside\'s', async () => {
  const live = C.groundsLane({ on: true, role: 'keeper', inside: { open: true, due: false }, country: { demand: 'open' }, lastCountryAt: -Infinity })
  assert.deepStrictEqual(live, { lane: 'country', why: 'keeper_turn:open' }, 'positive control: the measured lane, from country.mjs itself')
  await killedBy("(on && role === 'keeper' && run && gl?.lane === 'country' ? { lane: 'inside', why: 'refresh_due' } : gl)", '(gl)', M => {
    assert.deepStrictEqual(M.keeperLane(live, { role: 'keeper', run: true }), { lane: 'inside', why: 'refresh_due' })
  })
  assert.deepStrictEqual(F.keeperLane(C.groundsLane({ on: true, role: 'keeper', inside: { open: true }, country: { demand: 'site' } }), { role: 'keeper', run: true }), { lane: 'inside', why: 'refresh_due' }, 'the country\'s siting waits one visit')
  assert.strictEqual(F.keeperLane(live, { role: 'keeper', run: false }), live, 'no refresh to run: the country\'s turn stands')
  assert.strictEqual(F.keeperLane(live, { on: false, role: 'keeper', run: true }), live, 'TIDYFLOW_REFRESH=off: country.mjs\'s answer itself')
  const helper = C.groundsLane({ on: true, role: 'helper', helper: 'helper2', cap: 2, inside: { open: true }, country: { demand: 'open' } })
  assert.strictEqual(F.keeperLane(helper, { role: 'helper', run: true }), helper, 'a worker\'s lane is never moved')
  const ins = { lane: 'inside', why: 'keeper_inside' }
  assert.strictEqual(F.keeperLane(ins, { role: 'keeper', run: true }), ins)
})
await t('THE LEASE over real files: free -> taken -> a failed survey keeps it (nobody, not even the holder, surveys again until it lapses) -> a published one gives it back', async () => {
  const dir = tmp('lease'), key = PJ.projKey(HOME, 'tidy'), L = F.TIDYFLOW.lease, t0 = Date.now()
  const st = () => PJ.leaseState(dir, key, L)
  assert.strictEqual(F.refreshLeaseFree(st(), t0), true, 'no lease yet')
  const a = PJ.takeLease(dir, key, L, 'A', { now: t0, ttl: F.TIDYFLOW.leaseMs })
  assert.strictEqual(a.ok, true)
  assert.strictEqual(PJ.takeLease(dir, key, L, 'B', { now: t0 + 1000, ttl: F.TIDYFLOW.leaseMs }).ok, false, 'one surveyor at a time (buildproj.mjs)')
  await killedBy('!st || now >= (Number.isFinite(st.blocksUntil) ? st.blocksUntil : Infinity)', '!st || now >= (Number.isFinite(st.holdsUntil) ? st.holdsUntil : Infinity)', M => {
    assert.strictEqual(M.refreshLeaseFree(st(), t0 + F.TIDYFLOW.leaseMs + 1), false, 'past the term, inside the reclaim: still another\'s')
  })
  assert.strictEqual(F.refreshLeaseFree(st(), t0 + 1000), false)
  assert.strictEqual(st().rec.holder, 'A')
  assert.strictEqual(F.refreshLeaseFree(st(), t0 + 5 * MIN), false, 'the HOLDER reads it held too: a survey that failed is not run again at its next visit (2 min later)')
  // the chain: lease held -> no refresh to run -> the keeper's lane is NOT pinned to the inside (the country and the water walk go on)
  const m = F.refreshMay({ due: true, site: true, free: F.refreshLeaseFree(st(), t0 + 5 * MIN) })
  assert.strictEqual(m.why, 'lease')
  const turn = { lane: 'country', why: 'keeper_turn:open' }
  assert.strictEqual(F.keeperLane(turn, { role: 'keeper', run: m.run }), turn)
  assert.strictEqual(F.refreshLeaseFree(st(), t0 + F.TIDYFLOW.leaseMs + PJ.RECLAIM_MS), true, 'lapsed: asked again')
  // a refresh that published: released, free at once (the record's own stamp is the clock from here)
  PJ.releaseLease(dir, key, L, 'A', a.gen)
  assert.strictEqual(F.refreshLeaseFree(st(), t0 + 2000), true)
  // an unreadable lease blocks (never two surveys on a torn file)
  assert.strictEqual(F.refreshLeaseFree({ gen: null, rec: null, holdsUntil: 0, blocksUntil: Infinity }, t0), false)
  assert.strictEqual(F.refreshLeaseFree({ blocksUntil: NaN }, t0), false)
})

console.log('THE HEARTBEAT (stillKeeper) against reflex.mjs stuckDecision: a visit that produces rows is working; one that stops is caught; the window never outlives the visit')
const STUCK_MS = 35_000
/** The reflex's own loop (reflex.mjs: a tick every 500 ms, the stillness clock restarted on a reset) over a bot that never moves,
 *  with the visit's rows at `rowsAt` (ms from the start) -> the ms at which the reflex fires | null. */
function standing ({ rowsAt = [], until = 180_000, deadline = 120_000, on = true, M = F, botIn = null } = {}) {
  const t0 = 1_000_000_000, bot = botIn ?? { stationaryUntil: 0 }
  const k = M.stillKeeper(bot, { on, deadline: t0 + deadline })
  const rows = [...rowsAt]
  let stillSince = t0
  for (let now = t0; now <= t0 + until; now += 500) {
    while (rows.length && t0 + rows[0] <= now) k.beat(t0 + rows.shift())
    const d = stuckDecision({ busy: true, stationaryUntil: bot.stationaryUntil, now, stillSince, stuckMs: STUCK_MS })
    if (d.reset) stillSince = now
    if (d.fire) return { at: now - t0, bot, k }
  }
  return { at: null, bot, k }
}
await t('a visit deferring cell after cell (a row every 10 s, the bot never moving) is not ended; control: the same visit without the heartbeat is ended at 35 s', async () => {
  const rowsAt = Array.from({ length: 12 }, (_, i) => i * 10_000)        // 0 .. 110 s
  await killedBy('      if (v !== (Number(bot.stationaryUntil) || 0)) { bot.stationaryUntil = v; mine = v }\n', '', M => {
    assert.strictEqual(standing({ rowsAt, until: 120_000, M }).at, null)
  })
  assert.strictEqual(standing({ rowsAt, until: 120_000, on: false }).at, 35_500, 'TIDYFLOW_STILL=off: the reflex as it was (LIVE: `interrupt:stuck build_shop aborted`)')
  assert.strictEqual(standing({ rowsAt: [], until: 120_000 }).at, 35_500, 'no row at all: no declaration, the reflex as it was')
})
await t('a visit that STOPS producing rows is still caught: the window lapses 20 s after its last row and the reflex fires 35 s later', async () => {
  await killedBy('const until = Math.min(now + ms, Number.isFinite(deadline) ? deadline : now + ms)', 'const until = Number.isFinite(deadline) ? deadline : now + ms', M => {
    const x = standing({ rowsAt: [0, 5_000, 10_000], until: 120_000, M })
    assert.strictEqual(x.at, 10_000 + F.TIDYFLOW.stillMs + STUCK_MS, 'wedged after its third row: caught at 65 s, not at the visit\'s end')
  })
  assert.strictEqual(F.stillUntil({ cur: 0, now: 1000, deadline: Infinity }), 1000 + F.TIDYFLOW.stillMs)
})
await t('the window never passes the visit\'s deadline, and a row after it declares nothing', async () => {
  const D = 5_000_000
  await killedBy('const until = Math.min(now + ms, Number.isFinite(deadline) ? deadline : now + ms)', 'const until = now + ms', M => {
    assert.strictEqual(M.stillUntil({ cur: 0, now: D - 5_000, deadline: D }), D, '5 s before the deadline: 5 s, not 20')
  })
  assert.strictEqual(F.stillUntil({ cur: 0, now: D - 60_000, deadline: D }), D - 60_000 + F.TIDYFLOW.stillMs)
  assert.strictEqual(F.stillUntil({ cur: 0, now: D + 3_000, deadline: D }), D, 'past the deadline: a time already gone (stuckDecision reads it lapsed)')
  assert.strictEqual(stuckDecision({ busy: true, stationaryUntil: F.stillUntil({ cur: 0, now: D + 3_000, deadline: D }), now: D + 3_000, stillSince: D - 40_000, stuckMs: STUCK_MS }).fire, true)
  // a longer window another skill declared is never shortened
  assert.strictEqual(F.stillUntil({ cur: D + 90_000, now: D - 5_000, deadline: D }), D + 90_000)
  // the whole visit, rows to its very end: the declaration is never later than the deadline
  const x = standing({ rowsAt: Array.from({ length: 24 }, (_, i) => i * 5_000 + 4_000), until: 119_500, deadline: 120_000 })
  assert.ok(x.bot.stationaryUntil <= 1_000_000_000 + 120_000, `declared to ${x.bot.stationaryUntil - 1_000_000_000} ms of a 120,000 ms visit`)
})
await t('given back however the visit ends -- a result, a THROW, an ABORT -- and only its own: another skill\'s longer declaration stands', async () => {
  const run = async (M, how) => {
    const bot = { stationaryUntil: 0 }
    const k = M.stillKeeper(bot, { deadline: Date.now() + 120_000 })
    let threw = null
    try {
      try {
        k.beat(); assert.ok(bot.stationaryUntil > Date.now(), 'declared')
        if (how === 'throw') throw new Error('boom')
        if (how === 'abort') { const e = new Error('aborted'); e.aborted = true; throw e }
      } finally { k.end() }
    } catch (e) { threw = e }
    return { bot, threw }
  }
  const scenario = async M => {
    for (const how of ['result', 'throw', 'abort']) {
      const x = await run(M, how)
      assert.strictEqual(x.bot.stationaryUntil, 0, `${how}: the window is gone with the visit`)
      assert.strictEqual(!!x.threw, how !== 'result', 'and the throw still reaches the caller')
    }
  }
  await killedBy('end () { if (bot && mine != null && bot.stationaryUntil === mine) bot.stationaryUntil = 0; mine = null }', 'end () { mine = null }', scenario)
  // only its own
  await killedBy('if (bot && mine != null && bot.stationaryUntil === mine) bot.stationaryUntil = 0', 'if (bot && mine != null) bot.stationaryUntil = 0', M => {
    const bot = { stationaryUntil: 0 }, k = M.stillKeeper(bot, { deadline: Date.now() + 120_000 })
    k.beat()
    const later = Date.now() + 100_000; bot.stationaryUntil = later          // a site search declared a longer window since
    k.end()
    assert.strictEqual(bot.stationaryUntil, later)
  })
  const bot = { stationaryUntil: Date.now() + 100_000 }, was = bot.stationaryUntil
  const k = F.stillKeeper(bot, { deadline: Date.now() + 120_000 })
  k.beat(); k.end()
  assert.strictEqual(bot.stationaryUntil, was, 'a longer window declared BEFORE the visit is neither shortened nor taken back')
  // off, or no bot: nothing is ever declared
  const b2 = { stationaryUntil: 0 }, off = F.stillKeeper(b2, { on: false, deadline: Date.now() + 120_000 })
  assert.strictEqual(off.beat(), null); off.end(); assert.strictEqual(b2.stationaryUntil, 0)
  assert.strictEqual(F.stillKeeper(null, {}).beat(), null)
  // end twice, or with no beat: harmless
  const b3 = { stationaryUntil: 7 }, k3 = F.stillKeeper(b3, {}); k3.end(); k3.end(); assert.strictEqual(b3.stationaryUntil, 7)
})

console.log('THE KEEPER\'S ORDER (keeperUnquiet): the mark a water walk or a country-lane visit left does not quiet the keeper while the inside is open')
const T0 = Date.parse('2026-11-16T16:00:00Z')
const BOT = { on: true, shared: true, atTown: true, planned: true, record: null, complete: false, freeSlots: 10, groundY: 70, feet: [2, 71, 0], state: { lastStop: 'waterwalk', lastAt: T0 } }
/** skills.mjs's idle hook, as it composes the two rules, through shop.mjs's real buildOrder (siteprepfold.test.mjs's harness). */
const orderAfter = (M, last, { open = true, keeper = true, on = true } = {}) => {
  const quiet = M.keeperUnquiet({ on, keeper, last, open }) ? false : S.tidyQuiet({ idle: true, keeper, prepWork: false, closing: false })
  S.setActivePlot(() => 'tidy'); S.setIdleNow(() => quiet)
  try { return S.buildOrder({ ...BOT, now: T0 + 30 * MIN }) } finally { S.setActivePlot(() => null); S.setIdleNow(() => false) }
}
await t('LIVE chain: keeper\'s first visit = country lane + water walk, no effect -> idle mark -> the order says `idle` for an hour -> `no_work_visit`. Now the order comes back', async () => {
  const ww = { crew: 'keeper', lane: 'inside', outcome: 'waterwalk' }, country = { crew: 'keeper', lane: 'country', outcome: 'cell_deferred' }
  // positive control: the base rule quiets this keeper (shop.mjs tidyQuiet), and the order then skips `idle`
  assert.strictEqual(S.tidyQuiet({ idle: true, keeper: true, prepWork: false, closing: false }), true)
  assert.strictEqual(orderAfter(F, ww, { on: false }).skip, 'idle', 'TIDYFLOW_KEEPER=off: the quiet as before')
  await killedBy("  return last.outcome === 'waterwalk' || last.lane === 'country'\n", '  return false\n', M => {
    assert.notStrictEqual(orderAfter(M, ww).skip, 'idle', 'after a water walk')
    assert.notStrictEqual(orderAfter(M, country).skip, 'idle', 'after a country-lane visit')
  })
  await killedBy("last.outcome === 'waterwalk' || last.lane === 'country'", "last.outcome === 'waterwalk'", M => {
    assert.notStrictEqual(orderAfter(M, country).skip, 'idle')
  })
  // the keeper's own INSIDE visit that fixed nothing still quiets it (sinkfix-04 unchanged: never an order every 2 minutes for nothing)
  await killedBy("  return last.outcome === 'waterwalk' || last.lane === 'country'\n", '  return true\n', M => {
    assert.strictEqual(orderAfter(M, { crew: 'keeper', lane: 'inside', outcome: 'cell_deferred' }).skip, 'idle')
  })
  // ...so the chain ends: water walk (exempt) -> the next order -> an inside visit that fixes nothing -> quiet, as before
  assert.strictEqual(orderAfter(F, { crew: 'keeper', lane: 'inside', outcome: 'complete' }).skip, 'idle')
})
await t('only the keeper itself, only while the inside record is open, only for its own keeper visit', async () => {
  const ww = { crew: 'keeper', lane: 'inside', outcome: 'waterwalk' }
  await killedBy("if (!on || !keeper || !open || !last || last.crew !== 'keeper') return false", "if (!on || !open || !last || last.crew !== 'keeper') return false", M => {
    assert.strictEqual(M.keeperUnquiet({ keeper: false, open: true, last: ww }), false, 'the lease was let go since: a worker\'s quiet is its own')
  })
  await killedBy("if (!on || !keeper || !open || !last || last.crew !== 'keeper') return false", "if (!on || !keeper || !last || last.crew !== 'keeper') return false", M => {
    assert.strictEqual(M.keeperUnquiet({ keeper: true, open: false, last: ww }), false, 'the inside complete: nothing there to come back to')
  })
  await killedBy("if (!on || !keeper || !open || !last || last.crew !== 'keeper') return false", 'if (!on || !keeper || !open || !last) return false', M => {
    assert.strictEqual(M.keeperUnquiet({ keeper: true, open: true, last: { crew: 'worker', lane: 'country', outcome: 'deadline' } }), false, 'the mark is from its visit as a worker')
  })
  assert.strictEqual(F.keeperUnquiet({ keeper: true, open: true, last: null }), false)
  assert.strictEqual(F.keeperUnquiet({ on: false, keeper: true, open: true, last: ww }), false)
  assert.strictEqual(F.keeperUnquiet({ keeper: true, open: true, last: ww }), true)
})

const SK = strip(fs.readFileSync(SRC('skills.mjs'), 'utf8'))
const VISIT = SK.slice(SK.indexOf('async function buildTidyVisit ('), SK.indexOf('function farmInputs ('))
const one = (src, a, why = '') => { assert.strictEqual(src.split(a).length, 2, `ANCHOR MISSING OR NOT UNIQUE (${why}): ${a.slice(0, 90)}`); return src.indexOf(a) }
console.log('THE LONG VISIT (TIDYFLOW_LONG; owner 11-16 "extend the visit time to like 10 min"): build_shop alone, and a visit with no headway ends itself')
await t('skillBudgetMs: build_shop runs to 600 s where the base is a production clock; every other skill, a short clock (the suite\'s 300 ms) and the switch off keep the base', async () => {
  await killedBy("if (!on || skill !== 'build_shop' || !(b >= T.longFloorMs)) return b", "if (!on || !(b >= T.longFloorMs)) return b", M => {
    assert.strictEqual(M.skillBudgetMs('build_shop', { on: true, base: 180_000 }), 600_000)
    for (const sk of ['gather', 'mine', 'goto', 'market_run', 'surface', 'craft', 'town_deposit', 'build_shop2', '']) assert.strictEqual(M.skillBudgetMs(sk, { on: true, base: 180_000 }), 180_000, `${sk} keeps 180 s`)
  })
  await killedBy("if (!on || skill !== 'build_shop' || !(b >= T.longFloorMs)) return b", "if (!on || skill !== 'build_shop') return b", M => {
    assert.strictEqual(M.skillBudgetMs('build_shop', { on: true, base: 300 }), 300, 'the suite\'s SKILL_TIMEOUT_MS=300: build_shop is aborted at 300 ms like every skill')
    assert.strictEqual(M.skillBudgetMs('build_shop', { on: true, base: 179_999 }), 179_999)
  })
  await killedBy("if (!on || skill !== 'build_shop' || !(b >= T.longFloorMs)) return b", "if (skill !== 'build_shop' || !(b >= T.longFloorMs)) return b", M => {
    assert.strictEqual(M.skillBudgetMs('build_shop', { on: false, base: 180_000 }), 180_000, 'TIDYFLOW_LONG=off: 180 s as today')
  })
  assert.strictEqual(F.skillBudgetMs('build_shop', { on: true, base: 900_000 }), 900_000, 'never shorter than the base')
  assert.strictEqual(F.skillBudgetMs('build_shop', { base: 180_000 }), 600_000, 'this process: on')
})
await t('visitBudgetMs: the tidy visit works to the long budget; a fall-through\'s late leg keeps the base (its clock is what the first project left of 180 s); never past SHOP_SKILL_MS', async () => {
  assert.strictEqual(S.SHOP_SKILL_MS, 600_000)
  assert.strictEqual(F.visitBudgetMs({ on: true, base: 180_000, cap: S.SHOP_SKILL_MS }), 600_000)
  await killedBy("return Math.min(cap, late ? Number(base) : skillBudgetMs('build_shop', { on, base, T }))", "return Math.min(cap, skillBudgetMs('build_shop', { on, base, T }))", M => {
    assert.strictEqual(M.visitBudgetMs({ on: true, base: 180_000, cap: S.SHOP_SKILL_MS, late: true }), 180_000)
  })
  assert.strictEqual(F.visitBudgetMs({ on: false, base: 180_000, cap: S.SHOP_SKILL_MS }), 180_000, 'off: min(cap, base), the line as it was')
  assert.strictEqual(F.visitBudgetMs({ on: true, base: 300, cap: S.SHOP_SKILL_MS }), 300, 'the suite\'s clock')
  assert.strictEqual(F.visitBudgetMs({ on: true, base: 900_000, cap: S.SHOP_SKILL_MS }), 600_000, 'the cap')
  // the visit's bounds, as the row will read them: 540 s of work on the long budget (the 60 s tail kept), 120 s on the base
  assert.deepStrictEqual([F.visitBudgetMs({ on: true, base: 180_000, cap: 600_000 }) - 60_000, F.visitBudgetMs({ on: false, base: 180_000, cap: 600_000 }) - 60_000], [540_000, 120_000])
})
await t('headway: 120 s, or 12 rows in a row, with nothing laid, dug or planted ends the visit; every block laid or dug starts both again; off: never', async () => {
  const t0 = 1_000_000
  await killedBy('over (now = Date.now()) { return !!on && (n >= T.idleRows || now - last >= T.idleMs) }', 'over (now = Date.now()) { return !!on && (n >= T.idleRows) }', M => {
    const h = M.headway({ start: t0 })
    assert.strictEqual(h.over(t0 + 119_999), false); assert.strictEqual(h.over(t0 + 120_000), true, 'a visit that never placed is as long as it was: 120 s')
  })
  await killedBy('over (now = Date.now()) { return !!on && (n >= T.idleRows || now - last >= T.idleMs) }', 'over (now = Date.now()) { return !!on && (now - last >= T.idleMs) }', M => {
    const h = M.headway({ start: t0 })
    for (let i = 0; i < 11; i++) h.row('deferred', t0 + i)
    assert.strictEqual(h.over(t0 + 20), false, '11 rows')
    h.row('tempstand_refused', t0 + 12)
    assert.strictEqual(h.over(t0 + 20), true, '12 deferred / refused rows in a row, seconds in')
  })
  await killedBy("row (op, now = Date.now(), count = undefined) { if (GAIN_OPS.has(String(op)) && !fellNone(op, count)) { last = now; n = 0 } else n++ }", 'row (op, now = Date.now(), count = undefined) { n++ }', M => {
    const h = M.headway({ start: t0 })
    for (let i = 0; i < 11; i++) h.row('deferred', t0 + 1000 * i)
    h.row('place', t0 + 100_000)
    assert.strictEqual(h.rows(), 0)
    assert.strictEqual(h.over(t0 + 219_999), false, 'a block laid at 100 s: the visit goes on to 220 s at least')
    assert.strictEqual(h.over(t0 + 220_000), true)
  })
  for (const op of ['place', 'clear', 'replant', 'fell', 'access_done']) { const h = F.headway({ start: t0 }); for (let i = 0; i < 20; i++) h.row('deferred'); h.row(op, t0, op === 'fell' ? 2 : undefined); assert.strictEqual(h.over(t0 + 1), false, `${op} is work done`) }
  for (const op of ['deferred', 'stuck_on_cell', 'access_refused', 'clear_failed', 'float_held', 'leaf_decay', undefined]) { const h = F.headway({ start: t0 }); for (let i = 0; i < 12; i++) h.row(op, t0); assert.strictEqual(h.over(t0 + 1), true, `${op} is not`) }
  await killedBy('over (now = Date.now()) { return !!on && (n >= T.idleRows || now - last >= T.idleMs) }', 'over (now = Date.now()) { return (n >= T.idleRows || now - last >= T.idleMs) }', M => {
    const h = M.headway({ on: false, start: t0 })
    for (let i = 0; i < 50; i++) h.row('deferred')
    assert.strictEqual(h.over(t0 + 3_600_000), false, 'TIDYFLOW_LONG=off (or a late leg): the visit ends as it always did')
  })
})
await t('IN A VISIT (the real runVisit): cells no stand reaches, row after row -> the visit ends `no_headway` and settles its stuck map; control: without the bound it works through them to the pit', async () => {
  // six cells in mid-air (nothing under or beside them), each its own segment, then a plain pit
  const air = [20, 23, 26, 29, 32, 35].map((x, i) => ({ at: [x, G + 9, 20], role: 'earth', seg: `T-0${i}-0` }))
  const rec = () => ({ cells: [...air, ...[10, 11].map(x => ({ at: [x, G + 1, 0], role: 'earth', seg: 'T-09-0' }))], segments: [...air.map(c => ({ seg: c.seg, deps: [] })), { seg: 'T-09-0', deps: [] }], clear: [], cut: [], replant: [] })
  const run = async (M, bound) => {
    const srv = server(), dir = tmp('head'), me = 'W', key = PJ.projKey(HOME, 'tidy')
    const pub = PJ.publishRecord(dir, key, () => rec()), slot = PJ.takeSlot(dir, key, me, 4)
    const e = fakeBot(srv, me, { inv: { dirt: 8 }, feet: [0, G + 1, 2] })
    const h = M.headway({ on: bound, T: { ...F.TIDYFLOW, idleRows: 3 } })
    const log0 = e.log, ops = []
    e.log = (k, d) => { if (k === '_build') { h.row(d?.op); ops.push(d.op) } return log0(k, d) }
    const r = await R.runVisit({ dir, key, me, home: HOME, stood: [], record: rec(), recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, deferSpent: true, stuckStalledOnly: true, skipOpenDeps: true, giveUp: () => h.over() }, e, { maxSteps: 300 })
    return { r, ops, stuck: PJ.stuckRead(dir, key, { holder: me }) }
  }
  const c = await run(F, false)
  assert.ok(c.ops.filter(o => o === 'deferred').length >= 6, `positive control: the mid-air cells ARE deferred row after row (${c.ops.join(' ')})`)
  assert.strictEqual(c.r.placed, 2, `and without the bound the visit reaches the pit (${c.r.stop})`)
  const scenario = async M => {
    const x = await run(M, true)
    assert.strictEqual(x.r.stop, 'no_headway', x.ops.join(' '))
    assert.strictEqual(x.r.placed, 0)
    assert.strictEqual(x.ops.filter(o => o === 'deferred').length, 3, 'after the third row in a row, at the next step')
    assert.strictEqual(Object.keys(x.stuck).length, 3, 'its deferrals are counted (the early exit settles the stuck map): the keeper\'s waiver and stuckLast read them')
  }
  await scenario(F)
  let why = null
  await withMutant(new URL('../src/buildrun.mjs', import.meta.url), "    if (typeof p.giveUp === 'function' && p.giveUp()) return 'no_headway'\n", '', async Rm => {
    const keep = R.runVisit
    try { const srv = server(), dir = tmp('headm'), me = 'W', key = PJ.projKey(HOME, 'tidy'); const pub = PJ.publishRecord(dir, key, () => rec()), slot = PJ.takeSlot(dir, key, me, 4); const e = fakeBot(srv, me, { inv: { dirt: 8 }, feet: [0, G + 1, 2] })
      const r = await Rm.runVisit({ dir, key, me, home: HOME, stood: [], record: rec(), recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 64, deferSpent: true, stuckStalledOnly: true, skipOpenDeps: true, giveUp: () => true }, e, { maxSteps: 300 })
      assert.strictEqual(r.stop, 'no_headway') } catch (err) { why = err }
    void keep
  })
  assert.ok(why instanceof assert.AssertionError, `MUTANT (runVisit never asks giveUp) survived: ${why}`)
})
await t('the runner (structural, runner.mjs / index.mjs, comments stripped): ONE timeout a run -- its abort, its hard stop, the path watchdog\'s exemption; an interrupt aborts at once whatever it is', () => {
  const RN = strip(fs.readFileSync(SRC('runner.mjs'), 'utf8'))
  const tm = one(RN, 'const timeoutMs = skillBudgetMs(skillName, { base: config.skills.defaultTimeoutMs })', 'this run\'s timeout')
  const cur = one(RN, 'const mine = { skill: skillName, args, controller, startedAt, owner, rescue, timeoutMs }', 'on `current`')
  const wd = one(RN, "      this.interruptedReason = 'timeout'\n      controller.abort()\n    }, timeoutMs)", 'the abort')
  const hs = one(RN, '          }, timeoutMs + HARD_STOP_GRACE_MS)', 'the hard stop: the same clock plus the grace')
  assert.ok(tm < cur && cur < wd && wd < hs)
  assert.strictEqual(RN.split('config.skills.defaultTimeoutMs').length - 1, 2, 'the base is read twice: for this run\'s timeout, and the body claim\'s ceiling (unchanged)')
  // the interrupt (every reflex: stuck, drowning, low_health, danger_block, stranded_high, air_pocket) aborts the run's controller with no clock in it
  const it = RN.slice(RN.indexOf('  interrupt('), RN.indexOf('  interrupt(') + 400)
  assert.ok(/this\.current\.controller\.abort\(\)/.test(it) && !/timeoutMs|defaultTimeoutMs/.test(it), 'interrupt() aborts the run at once, whatever its timeout')
  const IX = strip(fs.readFileSync(SRC('index.mjs'), 'utf8'))
  one(IX, 'skillTimeoutMs: runner?.current?.timeoutMs ?? config.skills.defaultTimeoutMs,', 'the path watchdog reads the run\'s own timeout')
  // the tidy visit: the long budget (never a late leg), the headway bound only on it, asked by runVisit
  one(VISIT, "const budgetLong = visitBudgetMs({ base: Number(config.skills?.defaultTimeoutMs) > 0 ? Number(config.skills.defaultTimeoutMs) : SHOP_SKILL_MS, cap: SHOP_SKILL_MS, late: !!bot.groundsPick?.late })", 'the budget')
  one(VISIT, 'const budget = budgetLong - (Number(bot.groundsPick?.used) || 0)', 'less what the skill has used')
  one(VISIT, 'flowHead = headway({ on: budgetLong > budgetBase, start: f.runAt })', 'the bound: only on the long budget')
  one(VISIT, "if (kind === '_build') flowHead?.row(d?.op, undefined, d?.n);", 'fed by the rows, each with its count')
  one(VISIT, 'giveUp: () => !!flowHead?.over(),', 'asked by runVisit')
  one(VISIT, 'effects, { deadline: t0 + budget - ZIG_VISIT_TAIL_MS, maxSteps: 400 })', 'the 60 s tail kept')
})

console.log('ALL HANDS (TIDYFLOW_ALLHANDS; owner 11-16: every bot on the town\'s land): the share, the caps, the cooldown -- each off-switch the old numbers')
const G2M = await import('../src/grounds2.mjs')
await t('the share: off its turn a visit is the grounds\' while the record is open; a damaged building or an offered service keeps the old share; off: never', async () => {
  // positive control: grounds-01's own share at the live backlog -- visits 1 and 3 are NOT the grounds'
  assert.deepStrictEqual([1, 2, 3, 4].map(turn => G2M.groundsTurn({ turn, open: 1300, now: 1 }).due), [false, true, false, true])
  assert.strictEqual(G2M.groundsTurn({ turn: 1, open: 60, now: 1 }).why, 'low', 'and below 100 open cells none at all')
  await killedBy("!!on && record === 'open' && !repair && !service", "!!on && record === 'open'", M => {
    assert.strictEqual(M.allTurn({ record: 'open' }), true)
    assert.strictEqual(M.allTurn({ record: 'open', repair: true }), false, 'a finished building stands damaged: the share as before (its repair keeps every other visit)')
    assert.strictEqual(M.allTurn({ record: 'open', service: true }), false)
  })
  await killedBy("!!on && record === 'open' && !repair && !service", '!!on && !repair && !service', M => {
    for (const record of ['complete', 'stuck', 'none', 'unreadable', 'no_workshop']) assert.strictEqual(M.allTurn({ record }), false, record)
  })
  await killedBy("!!on && record === 'open' && !repair && !service", "record === 'open' && !repair && !service", M => {
    assert.strictEqual(M.allTurn({ on: false, record: 'open' }), false, 'TIDYFLOW_ALLHANDS=off: the old shares exactly')
  })
  // the other links are groundsOnly's: a spent bot, the keeper, a bot underground, no slot -> not the grounds' (the order's own project)
  const L = { on: true, record: 'open', feet: [0, 70, 0], home: { x: 0, y: 70, z: 0 }, slotFree: true, now: 1000 }
  assert.strictEqual(G2M.groundsOnly({ ...L, why: 'all' }).took, 'tidy')
  assert.strictEqual(G2M.groundsOnly({ ...L, why: 'all', emptyUntil: 2000 }).fall, 'spent', 'the 10-minute back-off stays')
  assert.strictEqual(G2M.groundsOnly({ ...L, why: 'all', slotFree: false }).fall, 'full')
  assert.strictEqual(G2M.groundsOnly({ ...L, why: 'all', feet: [0, 20, 0] }).fall, 'underground')
  assert.strictEqual(G2M.groundsOnly({ ...L, why: 'all', keeper: true }).fall, 'keeper')
})
await t('the caps: 12 on the grounds (11 workers + the keeper\'s slot), 8 on the country (7 + 1); off: 4 and 3 as before', async () => {
  const base = G2M.groundsSlots(5)
  assert.deepStrictEqual([base, G2M.groundsSlots(5, { worker: true }), C.COUNTRY.builders], [4, 3, 3], 'positive control: the old numbers')
  await killedBy('(on ? Math.max(Number(base) || 0, Number(all) || 0) : base)', '(base)', M => {
    assert.deepStrictEqual([G2M.workerSlots(M.allCap(base, M.TIDYFLOW.allBots), false), G2M.workerSlots(M.allCap(base, M.TIDYFLOW.allBots), true)], [12, 11])
    assert.deepStrictEqual([G2M.workerSlots(M.allCap(C.COUNTRY.builders, M.TIDYFLOW.allCountry, true), false), G2M.workerSlots(M.allCap(C.COUNTRY.builders, M.TIDYFLOW.allCountry, true), true)], [8, 7])
  })
  await killedBy('(on ? Math.max(Number(base) || 0, Number(all) || 0) : base)', '(Math.max(Number(base) || 0, Number(all) || 0))', M => {
    assert.strictEqual(M.allCap(C.COUNTRY.builders, M.TIDYFLOW.allCountry, false), 3, 'off: the base itself')
  })
  // two bodies are still kept apart by the segment rule, whatever the slots (groundskeeper.mjs crewSegOk: GK.segGap columns)
  assert.strictEqual(GK.GK.segGap, 2)
})
await t('the cooldown: 3 minutes after a grounds visit, the order\'s own 10 after any other and while the turns are spent; through shop.mjs orderCooldown; off: 10', async () => {
  await killedBy('(on && lastGrounds && !spent ? T.allCooldownMs : null)', '(on && lastGrounds ? T.allCooldownMs : null)', M => {
    assert.strictEqual(M.allCooldown({ lastGrounds: true }), 180_000)
    assert.strictEqual(M.allCooldown({ lastGrounds: true, spent: true }), null, 'a visit that fixed nothing: the back-off is the order\'s own rhythm')
  })
  await killedBy('(on && lastGrounds && !spent ? T.allCooldownMs : null)', '(on && !spent ? T.allCooldownMs : null)', M => {
    assert.strictEqual(M.allCooldown({ lastGrounds: false }), null)
  })
  assert.strictEqual(F.allCooldown({ on: false, lastGrounds: true }), null)
  try {
    assert.strictEqual(S.orderCooldown(S.SHOP_PLOT), S.SHOP_COOLDOWN_MS, 'positive control: 10 minutes')
    S.setAllCooldown(() => F.allCooldown({ lastGrounds: true }))
    assert.strictEqual(S.orderCooldown(S.SHOP_PLOT), 180_000)
    S.setAllCooldown(() => F.allCooldown({ on: false, lastGrounds: true }))
    assert.strictEqual(S.orderCooldown(S.SHOP_PLOT), S.SHOP_COOLDOWN_MS, 'off: 10 minutes')
    S.setAllCooldown(() => { throw new Error('x') })
    assert.strictEqual(S.orderCooldown(S.SHOP_PLOT), S.SHOP_COOLDOWN_MS, 'a hook that throws: the order\'s own')
  } finally { S.setAllCooldown(null) }
})
await t('wired (structural): the share after the base decision, the two caps, the cooldown hook -- each behind TFLOW.all', () => {
  const gb = SK.slice(SK.indexOf('function groundsBegin ('), SK.indexOf('function groundsEnd ('))
  one(gb, "if (TFLOW.all && !only && d0.took !== 'tidy' && ['off_turn', 'low', 'open_unknown'].includes(d0.why) && allTurn({ record: R.state, repair: (shopActiveStates() ?? []).some(s => s && s.exists && s.complete && s.damaged && s.plot !== TIDY_PLOT), service: !!bot.serviceOffer })) {", 'the share')
  one(gb, "const da = groundsOnly({ ...L, why: 'all' })", 'the visit\'s other links')
  one(SK, 'if (p?.plot === TIDY_PLOT && G2.on && TFLOW.all) return workerSlots(allCap(groundsSlots(buildersOf(p)), TIDYFLOW.allBots), worker)', 'the grounds\' slots')
  one(SK, 'if (p?.plot === TIDY_PLOT && G2.on) return groundsSlots(buildersOf(p), { worker })', 'off: the old cap, the line as it was')
  one(VISIT, "if (!slot.ok && lane === 'country' && TFLOW.all && G2.on) slot = takeSlot(dir, key, me, workerSlots(allCap(COUNTRY.builders, TIDYFLOW.allCountry), worker))", 'the country\'s slots')
  one(SK, 'setAllCooldown(() => { const b = activeMem?.bot ?? null; return allCooldown({ on: TFLOW.all && G2.on, lastGrounds: b?.shopVisitPlot === TIDY_PLOT, spent: Date.now() < (b?.g2EmptyUntil ?? 0) }) })', 'the cooldown')
})

console.log('REVIEW r2 (11-17): the watchdog sees a block laid; a passed staircase is no strike; aborted grounds visits spend the turns; the storehouse\'s share')
const WD_PATH = new URL('../src/watchdog.mjs', import.meta.url)
const WDM = await import('../src/watchdog.mjs')
const { config: CFG } = await import('../src/config.mjs')
const W = await import('../src/gkwork.mjs')
const WHM = await import('../src/whsite.mjs')
/** One verdict of a REAL StagnationWatchdog (as test/watchdog-busy.test.mjs): a full window of busy samples, the bot standing in
 *  one place with a bag that only empties -- a fill visit as the watchdog sees it. `gainAgo`: the visit's last work row, ms ago. */
const wdVerdict = async (Mod, { gainAgo = null } = {}) => {
  const WIN = CFG.watchdog.windowMs, STEP = CFG.watchdog.sampleMs, N = Math.floor(WIN / STEP) + 2
  const cancels = []
  const now = Date.now()
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, food: 20, inventory: { items: () => [] }, time: { age: 1, day: 1 }, game: { dimension: 'overworld' }, pathfinder: { getPathTo: () => null, movements: {} }, quit () {} }
  if (gainAgo != null) bot.tidyflowGainAt = now - gainAgo
  const runner = { isBusy: () => true, cancel: r => cancels.push(r), resume () {}, run: async () => {} }
  const wd = new Mod.StagnationWatchdog(bot, runner, { running: true, milestones: { allDone: false } })
  wd.samples = Array.from({ length: N }, (_, i) => ({ t: now - (N - 1 - i) * STEP, x: 0, y: 64, z: 0, items: 64 - i, busy: true }))
  wd.lastActionAt = now
  await wd.check()
  return cancels
}
await t('BLOCKER 1 -- the samples since the last work row (sinceGain); only a block laid, dug, planted or felled is one (workRow)', async () => {
  const S5 = [100, 200, 300, 400, 500].map(t => ({ t }))
  await killedBy('return samples.some(s => s.t < g) ? samples.filter(s => s.t >= g) : samples', 'return samples', M => {
    assert.deepStrictEqual(M.sinceGain(S5, 300, 600).map(s => s.t), [300, 400, 500])
  })
  await killedBy('if (!(g > 0) || g > now) return samples', 'if (!(g > 0)) return samples', M => {
    assert.strictEqual(M.sinceGain(S5, 900, 600), S5, 'a mark in the future (a clock that jumped) drops nothing')
  })
  assert.strictEqual(F.sinceGain(S5, 0, 600), S5, 'no mark: the same array (the base: nothing changes)')
  assert.strictEqual(F.sinceGain(S5, undefined, 600), S5)
  assert.strictEqual(F.sinceGain(S5, 50, 600), S5, 'a mark older than every sample drops nothing')
  await killedBy('export const workRow = (op, count = undefined) => WORK_OPS.has(String(op)) && !fellNone(op, count)', 'export const workRow = (op, count = undefined) => !!op && !fellNone(op, count)', M => {
    for (const op of ['place', 'clear', 'replant']) assert.strictEqual(M.workRow(op), true, op)
    assert.strictEqual(M.workRow('fell', 3), true, 'a felling that felled')
    for (const op of ['defer', 'access_miss', 'access_done', 'stuck_on_cell', 'refreshed', 'waived', undefined, null]) assert.strictEqual(M.workRow(op), false, String(op))
  })
})
await t('Codex r2 -- a `fell` row that felled nothing (n: 0, the first dig did not land) is no work: neither the watchdog\'s mark nor the headway starts again', async () => {
  // positive control: buildrun.mjs writes the row whenever a trunk stands over the cell, whatever was felled (the finding's source)
  const BR = strip(fs.readFileSync(SRC('buildrun.mjs'), 'utf8'))
  one(BR, "if (trunk.length) e.log('_build', { op: 'fell', seg, cell: f.at, block: name, n: felled, ...(left ? { why: left } : {}) })", 'the felling\'s row carries n, 0 included')
  const t0 = 1_000_000
  await killedBy("const fellNone = (op, n) => String(op) === 'fell' && !(Number(n) > 0)", 'const fellNone = (op, n) => false', M => {
    assert.strictEqual(M.workRow('fell', 2), true, 'positive control: logs felled')
    for (const n of [0, undefined, null, 'x', -1]) assert.strictEqual(M.workRow('fell', n), false, `fell n=${n}`)
    // a blocked tree tried every 30 s: the visit ends itself at 120 s, as if the rows were deferrals
    const h = M.headway({ start: t0 })
    for (let i = 1; i <= 3; i++) h.row('fell', t0 + i * 30_000, 0)
    assert.strictEqual(h.rows(), 3, 'three rows with nothing done')
    assert.strictEqual(h.over(t0 + 120_000), true, 'no headway since the start')
    const h2 = M.headway({ start: t0 })
    for (let i = 0; i < 12; i++) h2.row('fell', t0 + i, 0)
    assert.strictEqual(h2.over(t0 + 20), true, '12 of them in a row end it at once')
  })
  // the count gates the felling alone: every other work row is written only after its block read placed or dug
  await killedBy("const fellNone = (op, n) => String(op) === 'fell' && !(Number(n) > 0)", 'const fellNone = (op, n) => !(Number(n) > 0)', M => {
    for (const op of ['place', 'clear', 'replant']) { assert.strictEqual(M.workRow(op), true, op); assert.strictEqual(M.workRow(op, 0), true, `${op} carries no count`) }
    const h = M.headway({ start: t0 }); for (let i = 0; i < 11; i++) h.row('deferred', t0); h.row('place', t0 + 5)
    assert.strictEqual(h.rows(), 0)
  })
  const h3 = F.headway({ start: t0 }); h3.row('fell', t0 + 100_000, 1)
  assert.strictEqual(h3.over(t0 + 219_999), false, 'one log felled at 100 s: headway')
})
await t('BLOCKER 1, the chain through the real watchdog: a visit laying blocks is not cancelled; one that stopped a full window ago IS; no mark: as before', async () => {
  assert.deepStrictEqual(await wdVerdict(WDM), ['stagnation'], 'positive control: standing, the bag emptying, no mark -> the watchdog cancels (the reviewer\'s finding, and the base)')
  assert.deepStrictEqual(await wdVerdict(WDM, { gainAgo: 20_000 }), [], 'a block laid 20 s ago: the window starts again there')
  assert.deepStrictEqual(await wdVerdict(WDM, { gainAgo: 100_000 }), [], 'and 100 s ago (inside headway\'s 120 s): still not judged')
  assert.ok(F.TIDYFLOW.idleMs < CFG.watchdog.windowMs * 0.9, 'a visit with no headway ends itself before the watchdog\'s window is full again')
  assert.deepStrictEqual(await wdVerdict(WDM, { gainAgo: CFG.watchdog.windowMs * 0.9 + CFG.watchdog.sampleMs }), ['stagnation'], 'the last block a full window ago: a hung visit does not escape')
  assert.deepStrictEqual(await wdVerdict(WDM, { gainAgo: 3_600_000 }), ['stagnation'], 'a mark an earlier visit left: nothing')
  // the mutant: the watchdog without the line cancels the working visit
  let why = null
  await withMutant(WD_PATH, '    this.samples = sinceGain(this.samples, this.bot.tidyflowGainAt)\n', '', async M => { try { assert.deepStrictEqual(await wdVerdict(M, { gainAgo: 20_000 }), []) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
})
await t('BLOCKER 1 wired (structural): the mark beside the headway\'s row, only on a work row, never with LONG and STILL both off; read after the pending guard, before the window\'s span', () => {
  const head = one(VISIT, "if (kind === '_build') flowHead?.row(d?.op, undefined, d?.n);", 'the headway\'s row')
  const mark = one(VISIT, "if (kind === '_build' && (TFLOW.long || TFLOW.still) && workRow(d?.op, d?.n)) bot.tidyflowGainAt = Date.now();", 'the mark, the row\'s count with it')
  assert.ok(head < mark)
  assert.strictEqual(SK.split('tidyflowGainAt').length, 2, 'written in one place')
  const WS = strip(fs.readFileSync(SRC('watchdog.mjs'), 'utf8'))
  const chk = WS.slice(WS.indexOf('  async check() {'), WS.indexOf('  async #escalate(pd) {'))
  const pend = one(chk, 'if (this.pending) { this.#pendingTick(); return }', 'a pending rescue is never touched')
  const cut = one(chk, 'this.samples = sinceGain(this.samples, this.bot.tidyflowGainAt)', 'the cut')
  const span = one(chk, 'if (span < config.watchdog.windowMs * 0.9) return', 'the full-window gate')
  assert.ok(pend < cut && cut < span)
  assert.strictEqual(WS.split('tidyflowGainAt').length, 2, 'read in one place; the stranding history and the runner\'s abort never read it')
})
await t('BLOCKER 2 -- a staircase cell passed for want of stone is not counted LEFT: three such visits never waive it; with stone, or the draw not skipped, as before', async () => {
  const REC = { sitedAt: 7, stageId: 'inwall', cells: [{ at: [1, 70, 1], role: 'access' }, { at: [2, 70, 2], role: 'earth' }, { at: [3, 70, 3], role: 'earth' }], cut: [], clear: [] }
  const STAIR = '1,70,1', EARTH = '2,70,2'
  const read = () => ({ name: 'air' })
  const fillDone = q => q.at[0] === 3                       // the completion's own: one cell laid
  const passedBy = has => q => F.stoneSkip(q, has, PAL.access)
  const left = T.tidyLeftKeys(REC, read, { fillDone })
  assert.deepStrictEqual(left, [STAIR, EARTH], 'positive control: the completion\'s count has the staircase open (it is open work)')
  await killedBy('export const leftDone = (fillDone, passed) => q => !!fillDone(q) || !!passed(q)', 'export const leftDone = (fillDone, passed) => q => !!fillDone(q)', M => {
    assert.deepStrictEqual(T.tidyLeftKeys(REC, read, { fillDone: M.leftDone(fillDone, passedBy(() => false)) }), [EARTH])
  })
  await killedBy('export const leftDone = (fillDone, passed) => q => !!fillDone(q) || !!passed(q)', 'export const leftDone = (fillDone, passed) => q => !!passed(q)', M => {
    assert.deepStrictEqual(T.tidyLeftKeys(REC, read, { fillDone: M.leftDone(fillDone, passedBy(() => false)) }), [EARTH], 'a laid cell is still not left')
  })
  assert.deepStrictEqual(T.tidyLeftKeys(REC, read, { fillDone: F.leftDone(fillDone, passedBy(() => true)) }), [STAIR, EARTH], 'stone in the bag: the staircase is left like any cell (nobody could lay it)')
  // the chain over the real files: three visits that skipped their draw and held no stone, then the keeper's read
  const dir = tmp('left'), key = 'project-0_70_0.tidy', T0 = Date.parse('2026-11-17T04:00:00Z')
  try {
    const counted = T.tidyLeftKeys(REC, read, { fillDone: F.leftDone(fillDone, passedBy(() => false)) })
    let town = null
    for (let i = 0; i < 3; i++) town = W.leftVisit(dir, key, `showcase-B${i}`, REC, counted, { now: T0 + i * MIN })
    assert.strictEqual(town.get(EARTH), 3, 'positive control: the earth fill was counted three times')
    assert.deepStrictEqual(W.leftWaiveDue(REC, town, left, { share: 1 }).map(d => d.k), [EARTH], 'the staircase is NOT waived (the keeper reads it open, with no strike)')
    // ...and what the code did before: the same three visits counting the completion's own list waive the staircase for good
    const dir2 = tmp('left0')
    try {
      for (let i = 0; i < 3; i++) town = W.leftVisit(dir2, key, `showcase-B${i}`, REC, left, { now: T0 + i * MIN })
      assert.deepStrictEqual(W.leftWaiveDue(REC, town, left, { share: 1 }).map(d => d.k), [STAIR, EARTH], 'positive control: the finding')
    } finally { fs.rmSync(dir2, { recursive: true, force: true }) }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
await t('BLOCKER 2 wired (structural): the strike list alone; the open count, the keeper\'s waive and the completion read the full list', () => {
  const full = one(VISIT, 'const left = tidyLeftKeys(rw, read2, progOpts)\n', 'the full list')
  const vis = one(VISIT, "const strikes = left => { const town = leftVisit(dir, key, me, rw, left, { count: r.stop === 'complete' }); return town }", 'the strikes: the count\'s own line as it was, over the list it is handed')
  const cnt = one(VISIT, 'const town = strikes(flowDp.skip ? tidyLeftKeys(rw, read2, { ...progOpts, fillDone: leftDone(progOpts.fillDone, noStone) }) : left)', 'the strike list (the draw not skipped, or TIDYFLOW_DRAW=off: the full list itself)')
  const opn = one(VISIT, 'openWrite(dir, key, me, rw, left.length + prog.cutLeft)', 'the open count')
  const due = one(VISIT, 'const due = caps.waive ? leftWaiveDue(rw, town, left) : []', 'the keeper\'s waive')
  assert.ok(full < vis && vis < cnt && cnt < opn && opn < due)
  assert.strictEqual(VISIT.split('leftVisit(').length, 2, 'the one writer of strikes')
})
await t('BLOCKER 3 -- two aborted grounds visits in a row spend a worker\'s turns (10 min: its own project gets them); one ended by itself starts the count again', async () => {
  const now = 1_000_000
  // positive control, the finding: grounds2.mjs's own rule never spends the turns of an aborted visit
  assert.deepStrictEqual(G2M.groundsAfter({ took: 'tidy', aborted: true, placed: 0, cleared: 0, emptyUntil: 0, now }), { empty: false, emptyUntil: 0 })
  await killedBy('return c + 1 >= T.allAborts ? { n: 0, emptyUntil: Math.max(e, now + T.allAbortMs) } : { n: c + 1, emptyUntil: e }', 'return { n: c + 1, emptyUntil: e }', M => {
    const a1 = M.abortsAfter({ took: 'tidy', aborted: true, n: 0, now })
    assert.deepStrictEqual(a1, { n: 1, emptyUntil: 0 }, 'one aborted visit: not yet (a reflex interrupts a good visit too)')
    assert.deepStrictEqual(M.abortsAfter({ took: 'tidy', aborted: true, n: a1.n, now }), { n: 0, emptyUntil: now + 10 * MIN })
  })
  await killedBy('if (!aborted) return { n: 0, emptyUntil: e }', 'if (!aborted) return { n: c, emptyUntil: e }', M => {
    assert.deepStrictEqual(M.abortsAfter({ took: 'tidy', aborted: false, n: 1, emptyUntil: 5, now }), { n: 0, emptyUntil: 5 }, 'IN A ROW: a visit that ended by itself starts the count again')
  })
  await killedBy("if (!on || keeper || took !== 'tidy') return { n: c, emptyUntil: e }", "if (!on || keeper) return { n: c, emptyUntil: e }", M => {
    assert.deepStrictEqual(M.abortsAfter({ took: 'other', aborted: true, n: 1, emptyUntil: 5, now }), { n: 1, emptyUntil: 5 }, 'another project\'s visit changes nothing')
  })
  await killedBy("if (!on || keeper || took !== 'tidy') return { n: c, emptyUntil: e }", "if (!on || took !== 'tidy') return { n: c, emptyUntil: e }", M => {
    assert.deepStrictEqual(M.abortsAfter({ took: 'tidy', keeper: true, aborted: true, n: 1, now }), { n: 1, emptyUntil: 0 }, 'the keeper has no turns to spend')
  })
  await killedBy("if (!on || keeper || took !== 'tidy') return { n: c, emptyUntil: e }", "if (keeper || took !== 'tidy') return { n: c, emptyUntil: e }", M => {
    assert.deepStrictEqual(M.abortsAfter({ on: false, took: 'tidy', aborted: true, n: 1, emptyUntil: 5, now }), { n: 1, emptyUntil: 5 }, 'TIDYFLOW_ALLHANDS=off: nothing')
  })
  assert.strictEqual(F.abortsAfter({ took: 'tidy', aborted: true, n: 1, emptyUntil: now + 60 * MIN, now }).emptyUntil, now + 60 * MIN, 'never shortens a longer back-off')
  // THE CHAIN: a bot whose grounds visits abort every time -- visit 3 is its own project's, and the order's own 10-minute rhythm
  const L = { on: true, record: 'open', feet: [0, 70, 0], home: { x: 0, y: 70, z: 0 }, slotFree: true }
  let st = { n: 0, emptyUntil: 0 }, clock = now
  const taken = []
  for (let i = 0; i < 5; i++) {
    const d = G2M.groundsOnly({ ...L, why: 'all', emptyUntil: st.emptyUntil, now: clock })
    taken.push(d.took === 'tidy' ? 'tidy' : d.fall)
    const emptyUntil = G2M.groundsAfter({ took: d.took, aborted: true, emptyUntil: st.emptyUntil, now: clock }).emptyUntil
    st = F.abortsAfter({ took: d.took, aborted: true, n: st.n, emptyUntil, now: clock })
    assert.strictEqual(F.allCooldown({ lastGrounds: d.took === 'tidy', spent: clock < st.emptyUntil }), d.took === 'tidy' && i === 0 ? 180_000 : null, `visit ${i + 1}: the cooldown`)
    clock += 3 * MIN
  }
  assert.deepStrictEqual(taken, ['tidy', 'tidy', 'spent', 'spent', 'spent'], 'two aborted grounds visits, then the bot\'s own order for the 10 minutes')
})
await t('BLOCKER 3 wired (structural): after grounds2\'s own rule, behind TFLOW.all, on the visit\'s own `aborted`', () => {
  const ge = SK.slice(SK.indexOf('function groundsEnd ('), SK.indexOf('function g3Links ('))
  const base = one(ge, 'bot.g2EmptyUntil = a.emptyUntil\n', 'the base rule, the line as it was')
  const ab = one(ge, 'if (TFLOW.all) { const ab = abortsAfter({ took, keeper: !!v.keeper, aborted, n: bot.tidyflowAborts, emptyUntil: bot.g2EmptyUntil }); bot.tidyflowAborts = ab.n; bot.g2EmptyUntil = ab.emptyUntil }', 'the count')
  one(ge, "const aborted = !r || r.status === 'aborted'", 'what aborted means: the visit threw, or said so')
  assert.ok(base < ab)
})
await t('THE STOREHOUSE\'S SHARE (owner 11-17) -- while its ground is open, every third visit all hands would take is the bot\'s own order\'s; not open or off: never', async () => {
  const run = (M, n, o) => { let c = 0; const out = []; for (let i = 0; i < n; i++) { const s = M.allShare({ ...o, n: c }); c = s.n; out.push(s.own) } return out }
  await killedBy('return k >= T.allShareEvery ? { own: true, n: 0 } : { own: false, n: k }', 'return { own: false, n: k }', M => {
    assert.deepStrictEqual(run(M, 7, { open: true }), [false, false, true, false, false, true, false])
  })
  await killedBy('if (!on || !open) return { own: false, n: 0 }', 'if (!on) return { own: false, n: 0 }', M => {
    assert.deepStrictEqual(run(M, 7, { open: false }), Array(7).fill(false), 'the storehouse not an open project: every visit the grounds\', as before')
    assert.deepStrictEqual(M.allShare({ open: false, n: 2 }), { own: false, n: 0 }, 'and the count starts again')
  })
  await killedBy('if (!on || !open) return { own: false, n: 0 }', 'if (!open) return { own: false, n: 0 }', M => {
    assert.deepStrictEqual(run(M, 7, { on: false, open: true }), Array(7).fill(false), 'TIDYFLOW_ALLHANDS_SHARE=off')
  })
  assert.deepStrictEqual(F.allShare({ open: true, n: 'x' }), { own: false, n: 1 }, 'a count that is not a number is none')
})
await t('the share wired (structural): asked only where all hands would take the visit, the storehouse\'s own plot, the count on the bot', () => {
  const gb = SK.slice(SK.indexOf('function groundsBegin ('), SK.indexOf('function groundsEnd ('))
  const da = one(gb, "const da = groundsOnly({ ...L, why: 'all' })", 'all hands would take it')
  const sh = one(gb, "const sh = da.took === 'tidy' ? allShare({ on: TFLOW.share, open: (shopActiveStates() ?? []).some(s => s && s.plot === WHS_PLOT && !s.complete && !s.waiting), n: bot.tidyflowShareN }) : null", 'the share, its switch, the storehouse open')
  const cnt = one(gb, 'if (sh) bot.tidyflowShareN = sh.n', 'the count')
  const take = one(gb, "if (da.took === 'tidy' && !sh?.own) d = { ...da, share: 1 }", 'the grounds\' unless the share says the order\'s')
  assert.ok(da < sh && sh < cnt && cnt < take)
  assert.strictEqual(WHM.WHS_PLOT, 'warehouse', 'the owner\'s plot')
})

console.log('THE ROWS: what a one-hour read needs reaches the logs (the formatters\' whitelists)')
await t('`_build_visit` carries draw / pre / work; `_build op=refreshed` carries ms / by; the old fields are where they were', () => {
  const v = S.buildVisitDetail({ project: 'tidy', outcome: 'deadline', placed: 6, cleared: 3, crew: 'worker', lane: 'inside', draw: 'skip:cuts', pre: 412, work: 118733, ms: 121014, why: 'x' })
  assert.strictEqual(v, 'project=tidy outcome=deadline placed=6 cleared=3 crew=worker lane=inside draw=skip:cuts pre=412 work=118733 ms=121014 why=x')
  assert.strictEqual(S.buildVisitDetail({ project: 'tidy', outcome: 'deadline', placed: 0, ms: 134906, why: 'x' }), 'project=tidy outcome=deadline placed=0 ms=134906 why=x', 'a visit with none of them: the row as it was')
  rowSurvives('_build', { project: 'tidy', op: 'refreshed', n: 12, kind: 'cut12/fill0/cols9/cap0', why: '-', gen: 184, ms: 2140, by: 'worker' })
  assert.strictEqual(S.buildRowDetail({ project: 'tidy', op: 'refreshed', n: 12, why: '-', gen: 184, ms: 2140, by: 'worker' }), 'project=tidy op=refreshed ms=2140 by=worker gen=184 n=12 why=-')
  assert.strictEqual(S.buildRowDetail({ project: 'tidy', op: 'place', seg: 'T-00-0', cell: [1, 2, 3], block: 'dirt' }), 'project=tidy op=place seg=T-00-0 cell=1,2,3 block=dirt', 'a row with neither: as it was')
})

console.log('THE WIRING (skills.mjs: structural, comments stripped -- what behaviour cannot reach from here)')
await t('the refresh: decided before the lane, run before the water walk and the siting, under the lease; the old site only with the switch off', () => {
  assert.ok(VISIT.length > 10_000, 'the visit\'s body was found')
  const dec = one(VISIT, "flowRef = refreshMay({ due: due0, site: caps.site, late: flowLate, free: due0 && refreshLeaseFree(projLeaseState(dir, key, TIDYFLOW.lease), Date.now()) })", 'the decision')
  one(VISIT, 'if (TFLOW.refresh && GROUNDS.on && LANDP.on) {', 'its switch')
  const lane = one(VISIT, '}), { on: TFLOW.refresh, role, run: flowRef.run })', 'the keeper\'s lane')
  const run = one(VISIT, "if (flowRef.run && lane === 'inside') {", 'the first act')
  const take = one(VISIT, 'const lz = projTakeLease(dir, key, TIDYFLOW.lease, me, { now: Date.now(), ttl: TIDYFLOW.leaseMs })', 'the lease')
  const call = one(VISIT, 'try { r2 = await tidyRefresh(bot, c, h, dir, key, rh, me, signal) } finally { siteStillEnd(stl); bot.tidyflowBy = null }', 'the survey, the bot declared still for it')
  one(VISIT, 'const stl = siteStillBegin(bot, TIDYFLOW.surveyStillMs)', 'declared still')
  const rel = one(VISIT, 'if (r2) { rh = r2; releaseLease(dir, key, TIDYFLOW.lease, me, lz.gen) }', 'given back only when published')
  const water = one(VISIT, "if (role === 'keeper' && bw3Due(procMem(bot))) {", 'the water walk')
  const site = one(VISIT, "const gkNext = lane === 'inside' && GROUNDS.on && LANDP.on", 'the siting')
  assert.ok(dec < lane && lane < run && run < take && take < call && call < rel && rel < water && water < site, 'in that order')
  // the base site: the same call as ever, inside the switch's off branch
  assert.ok(/if \(!TFLOW\.refresh\) \{\s*if \(GROUNDS\.on && LANDP\.on && caps\.site && rh\.head && refreshDue\(rh\.head\.rec\)\) \{\s*const r2 = await tidyRefresh\(bot, c, h, dir, key, rh, me, signal\)/.test(VISIT), 'TIDYFLOW_REFRESH=off: the keeper\'s refresh where it was')
  // the refreshed row: how long, and who
  const TRF = SK.slice(SK.indexOf('async function tidyRefresh ('), SK.indexOf('function withPlanCells ('))
  one(TRF, 'const r0 = rh.head.rec, tR = Date.now()', 'the clock')
  one(TRF, "gen: pub.gen, ms: Date.now() - tR, by: bot.tidyflowBy ?? 'keeper' }) })", 'the row')
  one(VISIT, 'bot.tidyflowBy = flowRef.by\n', 'who runs it')
  one(TRF, 'if (!cur || cur.structure_complete || cur.sitedAt !== r0.sitedAt || !refreshDue(cur, { now })) return null', 'the publish\'s own check is still the guard against a second writer')
})
await t('the draw: planned before anything is drawn, the bill trimmed before the yard and the chests; the cuts first; the staircase guard only in a visit that skipped its draw', () => {
  const plan = one(VISIT, 'const flowDp = drawPlan({ on: TFLOW.draw && GROUNDS.on && !floorOnly && !prepNow, open, openAccess,', 'the plan and its switch')
  one(VISIT, "earth: earthDirt(spare('dirt'), openSoil, TIDY_VISIT_FILLS) + spare('cobblestone'), stone: TIDY_PALETTE.access.reduce((n, b) => n + spare(b), 0),", 'the bill\'s own read of the bag')
  one(VISIT, "cuts: () => (flowMayCut ? (flowCuts0 = cutsRead()).length : 0), clearFree: () => { const st = projLeaseState(dir, key, 'seg-clear'); return !st || st.rec?.holder === me || Date.now() >= st.blocksUntil }, cutsDry: bot.tidyflowCutsDry === true })", 'the cuts this bot may dig, the clear lease, the dry memory')
  one(VISIT, 'const flowMayCut = !floorOnly && (caps.digs || (caps.cuts && !isTerrace && !prepNow))', 'the role\'s cuts')
  const trim = one(VISIT, 'billTrim(need, { skip: flowDp.skip, keeper: !!caps.site })', 'the trim')
  const written = one(VISIT, 'if (Object.keys(need).length && !drawnWrite(dir, key, me, drawn0, { bag: held0 })) return', 'the drawn record')
  const yard = one(VISIT, 'const got = await yardDrawFor(ctx, need.cobblestone, signal, t0 + budget - ZIG_VISIT_TAIL_MS)', 'the yard')
  const chest = one(VISIT, 'const w = await matsWithdraw(ctx, need, signal, 30_000, R0, PD.allow, PD.onTook, PD.onUncertain); took = w.took ?? {}', 'the chests')
  const tag = one(VISIT, 'const dt = drawTag(flowDp, { yard: f.fromYard, chest: Object.values(took).reduce((n, v) => n + (Number(v) || 0), 0) }); if (dt) f.draw = dt', 'the row\'s draw=')
  assert.ok(plan < trim && trim < written && written < yard && yard < chest && chest < tag, 'in that order')
  // the cut list is the plan's own read when nothing was drawn since, read after the draws otherwise (and always with the switch off)
  const cuts0 = one(VISIT, 'const cuts0 = flowDp.skip && flowCuts0 ? flowCuts0 : cutsRead()', 'the cut list')
  assert.ok(cuts0 > chest)
  const share = one(VISIT, 'share = cutsFirst(share, flowDp)', 'the cuts first')
  const stairs = one(VISIT, 'if (stairsHead) { try { share = stairsShare(share,', 'the stairs\' share')
  const tshare = one(VISIT, 'share = tidyShare({ role, fillsLeft: open + openSoil + openAccess,', 'the fill share')
  assert.ok(tshare < share && share < stairs, 'after the fill share, before a ready staircase\'s')
  one(VISIT, 'const noStone = q => flowDp.skip && stoneSkip(q, n => !!effects?.has?.(n), TIDY_PALETTE.access)', 'the guard, only when the draw was skipped')
  one(VISIT, 'alsoDone: q => waivedK(q) || noTorch(q) || noSoil(q) || !!skipV(q) || noStone(q), stuckStalledOnly: true,', 'in the visit\'s done test')
  assert.ok(!/const progOpts = \{[^\n]*noStone/.test(VISIT), 'NEVER in the completion\'s count: a passed staircase is still open work')
  one(VISIT, 'bot.tidyflowCutsDry = cutsDryAfter(bot.tidyflowCutsDry === true, flowDp, r.cleared)', 'the dry memory')
})
await t('the heartbeat: on every `_build` and `_build_seg` row of the tidy\'s own effects, bounded by the visit\'s deadline, given back in the visit\'s finally', () => {
  const mk = one(VISIT, 'const flowStill = stillKeeper(bot, { on: TFLOW.still, deadline: t0 + budget - ZIG_VISIT_TAIL_MS })', 'the keeper, its switch and the deadline')
  const beat = one(VISIT, "log: (kind, d) => { if (kind === '_build' || kind === '_build_seg') flowStill.beat();", 'the rows')
  const fin = one(VISIT, '} finally {\n    flowStill.end()', 'the finally')
  const tryAt = one(VISIT, '    const acks = (bot.shopAcks ??= shopAckInstall(bot))\n    presenceWrite(dir, key, me,', 'the first lines inside the visit\'s try')
  const runV = one(VISIT, 'const r = await runVisit({ dir, key, me, home, stood, record: GKW_ON ? dropWaivedClears(recV) : recV, tidy: cuts,', 'the visit')
  assert.ok(mk < tryAt && tryAt < beat && beat < runV && runV < fin, 'declared before the try whose finally gives it back; the visit runs inside it')
  // nothing between the finally and the function's end reads a second try: it is the visit's own
  assert.ok(!VISIT.slice(fin + 20).includes('\n  try {\n'), 'the last finally of buildTidyVisit')
})
await t('the visit row: pre is stamped at the work\'s start, work at its end, and out() closes an interrupted one; the idle hook reads the visit\'s facts', () => {
  const pre = one(VISIT, 'f.pre = Date.now() - t0; f.runAt = Date.now()', 'pre')
  const runV = VISIT.indexOf('const r = await runVisit({ dir, key, me, home, stood, record: GKW_ON')
  const work = one(VISIT, 'f.work = Date.now() - f.runAt; f.runAt = null\n', 'work')
  assert.ok(pre < runV && runV < work)
  one(VISIT, 'if (f.runAt != null) { f.work = Date.now() - f.runAt; f.runAt = null }', 'out() closes it on a throw')
  one(VISIT, 'bot.tidyflowLast = { at: Date.now(), crew: f.crew ?? null, lane: f.lane ?? null, outcome }', 'the facts')
  const hook = SK.slice(SK.indexOf('setIdleNow(plot => {'), SK.indexOf('function keeperLeaseNow ('))
  const un = one(hook, 'if (TFLOW.keeper && keeperUnquiet({ keeper: keeperLeaseNow(b), last: b?.tidyflowLast ?? null, open: !!gkwTownRead(b).sig })) return false', 'the exemption and its switch')
  const base = one(hook, 'return tidyQuiet({ idle, keeper: keeperLeaseNow(b), prepWork: prepKeeperWork(siteprepHead()), closing: GKW_ON && (gkwClosing(b?.gkwPending ?? null) || gkwTownClosing(b)) })', 'the base rule, untouched')
  const cheap = one(hook, 'if (!idle || plot !== TIDY_PLOT) return idle', 'asked only for a marked tidy')
  assert.ok(cheap < un && un < base)
})

console.log('THE SURVEY\'S COST (decision 6): the in-wall survey is SYNCHRONOUS -- measured here on a rough town of the live record\'s size')
await t('one in-wall survey over a 129 x 129 box of rough ground: printed (wall ms, block reads, the record\'s size); not asserted beyond "it ran"', async () => {
  const RR = 64
  const h = (x, z) => { let n = (x * 374761393 + z * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
  // flat grass at G; 7% of columns a dirt pillar 2-5 tall (a climb left standing), 7% a pit 1-4 deep, 3% one block of cobble litter
  const top = (x, z) => { const r = h(x, z); return r < 0.07 ? G + 2 + Math.floor(h(z, x) * 4) : r < 0.14 ? G - 1 - Math.floor(h(z, x) * 4) : r < 0.17 ? G + 1 : G }
  let reads = 0
  const read = (x, y, z) => {
    reads++
    if (Math.abs(x) > RR + 8 || Math.abs(z) > RR + 8 || y < G - 30 || y > G + 40) return null
    const tp = top(x, z)
    const n = y > tp ? 'air' : y > G ? (tp === G + 1 ? 'cobblestone' : 'dirt') : y === tp ? 'grass_block' : y < G - 6 ? 'stone' : 'dirt'
    return { name: n, boundingBox: n === 'air' ? 'empty' : 'block' }
  }
  const INWALL = LP.landStages().find(q => q.id === 'inwall')
  assert.ok(INWALL, 'the land plan has an inside-the-wall stage')
  const once = async () => {
    reads = 0
    const t0 = performance.now()
    const s = await T.siteStage(read, { home: HOME, land: { seed: 1 }, stage: INWALL, env: { ROUGH: 'on' }, terrace: { wall: { ring: [-RR, -RR, RR, RR] }, records: [], climbs: [] }, now: Date.now() })
    const ms = performance.now() - t0
    return { s, ms, reads }
  }
  await once()                                         // warm (the JIT's first pass is not the bot's steady state)
  const runs = [await once(), await once(), await once()]
  const { s } = runs[0]
  assert.strictEqual(s.ok, true, `the survey ran (${s.why})`)
  const fresh = s.record ? T.coreFills(s.record) : null
  const cells = fresh?.cells?.length ?? 0, cut = fresh?.cut?.length ?? 0
  const t1 = performance.now()
  const m = fresh ? TR.refreshMerge({ blueprint: 'tidy@1', stageId: 'inwall', sitedAt: 1, home: HOME, cells: [], cut: [], clear: [], segments: [] }, fresh, { now: Date.now() }) : null
  const mergeMs = performance.now() - t1
  const t2 = performance.now()
  const bytes = fresh ? JSON.stringify(fresh).length : 0
  const jsonMs = performance.now() - t2
  const ms = runs.map(r => Math.round(r.ms)).sort((a, b) => a - b)
  console.log(`        SURVEY COST box=${2 * RR + 1}x${2 * RR + 1} fills=${cells} cuts=${cut} segments=${fresh?.segments?.length ?? 0} record_bytes=${bytes} reads=${runs[0].reads} survey_ms=${ms.join('/')} merge_ms=${Math.round(mergeMs)} added=${(m?.added?.fill ?? 0) + (m?.added?.cut ?? 0)} stringify_ms=${Math.round(jsonMs)}`)
  assert.ok(runs[0].reads > 100_000, `a survey of this box reads the columns (${runs[0].reads} reads)`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

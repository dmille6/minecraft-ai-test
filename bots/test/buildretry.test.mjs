// BUILDRETRY-01 (codeeval 2026-11-06 phase 2.1): THE BUILD RETRY HOLE, CLOSED FOR EVERY PROJECT. Each failure kind is walked visit by
// visit on the fake server (test/helpers/buildfake.mjs): the visits that fail are COUNTED (buildretry.mjs, summed over builders),
// a cell RETRY_VISITS visits have failed is HELD (no walk, no dig, no click; its segment deferred into the F4 stuck map), a success
// by any builder resets it, BUILDRETRY=0 is the old behaviour. Every remedy is killed by a mutant whose anchor is asserted present
// and unique (withMutant). Live cases: isolated-c monument (3 leaves cells, 556 visits / 24.6 bot-h in 24 h, no_stand), board-d tidy
// (215 `blocked` visits on a block no dig tries), placebo-d wall (listed clears no stand reaches, skipped silently every visit).
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot, withMutant, noRetry } = await import('./helpers/buildfake.mjs')
const RT = await import('../src/buildretry.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 8).join('\n        ')}`) } }
const k = a => a.join(',')
/** The scenario passes on the real module; the mutant fails the scenario's OWN assertion. */
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const PAL = Object.freeze({ wall: ['cobblestone'], fill: ['cobblestone'] })
function projectOf (record, plot = 'wall') {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'buildretry-'))
  const key = PJ.projKey(HOME, plot)
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, 3)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slots[n].slot, slotGen: slots[n].gen, stands: { pending: null, bans: {} }, blockLayer: false, domain: () => true, walkR: 40, ...extra }
  }
  return { dir, key, p }
}
const rec = (cells, segs, clear = []) => ({ v: 1, plot: 'wall', cells, clear, replant: [], segments: segs.map(s => (typeof s === 'string' ? { seg: s, deps: [] } : s)) })
/** n visits by `who` (each a fresh effects object on the same server), -> [{ r, e }] */
async function visits (M, pr, srv, n, { who = 'A', extra = {}, botOpts = {} } = {}) {
  const out = []
  for (let v = 0; v < n; v++) { const e = bot(srv, who, { inv: { cobblestone: 32 }, ...botOpts }); out.push({ r: await M.runVisit(pr.p(who, extra), e, { maxSteps: 300 }), e }) }
  return out
}
/** the bot's dig calls at a cell, counted by wrapping the fake's dig */
const countingDig = (srv, cell, result = null) => {
  const n = { digs: 0 }
  const dig = async (c, expect) => {
    if (k(c) === k(cell)) { n.digs++; if (result) return result }
    if (expect && srv.read(...c)?.name !== expect) return 'refused'
    srv.set(c, 'air'); return 'confirmed'
  }
  return { n, dig }
}

// ---- 1. the ledger (pure + its file) --------------------------------------------------------------------------------------------
console.log('THE LEDGER (buildretry.mjs)')
await t('retryAfter: a failed key counts ONE visit (however many reasons), a resolved one leaves and writes a reset, old entries age out', () => {
  const now = 1_000_000_000
  let own = RT.retryAfter({ cells: {}, resets: {} }, new Map([['1,2,3', 'no_stand']]), new Set(), { now })
  own = RT.retryAfter(own, new Map([['1,2,3', 'dig refused'], ['4,5,6', 'kept chest']]), new Set(), { now: now + 1 })
  assert.deepStrictEqual([own.cells['1,2,3'].visits, own.cells['1,2,3'].why, own.cells['4,5,6'].visits], [2, 'dig refused', 1])
  const r = RT.retryAfter(own, new Map([['4,5,6', 'x']]), new Set(['4,5,6']), { now: now + 2 })
  assert.strictEqual(r.cells['4,5,6'], undefined, 'failed AND resolved in one visit: resolved (a remedy landed after a failure)')
  assert.strictEqual(r.resets['4,5,6'], now + 2)
  const old = RT.retryAfter(own, new Map(), new Set(), { now: now + RT.RETRY_FORGET_MS + 10 })
  assert.deepStrictEqual(old.cells, {}, 'a failure older than RETRY_FORGET_MS no longer counts')
})
await t('retryRead sums every holder; a reset ANY holder wrote voids older failures of every holder; retryHeld at RETRY_VISITS inside the hold', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rtread-')), key = 'project-0_70_0.wall', now = Date.now()
  RT.retryWrite(dir, key, 'A', { cells: { '1,2,3': { visits: 2, firstAt: now - 10, lastAt: now - 5, why: 'no_stand' } }, resets: {} })
  RT.retryWrite(dir, key, 'B', { cells: { '1,2,3': { visits: 1, firstAt: now - 4, lastAt: now - 3, why: 'unreached' } }, resets: {} })
  const sum = RT.retryRead(dir, key, { now })
  assert.deepStrictEqual([sum['1,2,3'].visits, sum['1,2,3'].why], [3, 'unreached'])
  assert.strictEqual(RT.retryHeld(sum['1,2,3'], now), true)
  assert.strictEqual(RT.retryHeld(sum['1,2,3'], now + RT.RETRY_HOLD_MS), false, 'the hold ends RETRY_HOLD_MS after the last failure: tried once more')
  assert.strictEqual(RT.retryHeld({ visits: 2, lastAt: now }, now), false, 'CONTROL: under RETRY_VISITS')
  RT.retryWrite(dir, key, 'C', { cells: {}, resets: { '1,2,3': now - 1 } })
  assert.deepStrictEqual(RT.retryRead(dir, key, { now }), {}, 'C saw it done: A\'s and B\'s older failures no longer count')
  fs.writeFileSync(path.join(dir, `${key}.retry.D.json`), '{ torn')
  assert.deepStrictEqual(RT.retryRead(dir, key, { now }), {}, 'a torn file reads as nothing')
})
await t('the switch: BUILDRETRY=0|off|false|no is the rollback; unset or anything else is on', () => {
  for (const v of ['0', 'off', ' OFF', 'false', 'no']) assert.strictEqual(RT.buildRetryOn({ BUILDRETRY: v }), false, v)
  for (const v of [undefined, '', '1', 'on']) assert.strictEqual(RT.buildRetryOn({ BUILDRETRY: v }), true, String(v))
})
await t('retryDeferrals: every open cell hard or waiting -> the hard ones; any cell with a chance left -> null', () => {
  const A = { at: [1, 1, 1] }, B = { at: [1, 2, 1] }, C = { at: [5, 1, 5] }
  assert.deepStrictEqual(RT.retryDeferrals([A, B], { why: c => (c === A ? 'kept chest' : null), waits: c => c === B }), [{ k: '1,1,1', why: 'kept chest' }])
  assert.strictEqual(RT.retryDeferrals([A, C], { why: c => (c === A ? 'kept chest' : null) }), null, 'C has a chance left')
  assert.strictEqual(RT.retryDeferrals([B], { waits: () => true }), null, 'waiting on nothing hard')
})

// ---- 2. a LISTED clear whose dig walk keeps failing (placebo-d wall: ~20 dig walks a visit to listed leaves, every one `unreached`) --
console.log('A LISTED CLEAR WHOSE DIG WALK FAILS')
const LEAF = [10, G + 1, 12]
const W1 = [20, G + 1, 10]
const clearScene = () => { const srv = server(); srv.set(LEAF, 'oak_leaves'); return { srv, r: rec([{ at: W1, role: 'wall', seg: 'W-00' }], ['W-00'], [{ at: LEAF, name: 'oak_leaves', kind: 'leaves' }]) } }
await t('CONTROL (BUILDRETRY=0, the live behaviour): the same failing dig walk every visit, nothing counted', () => noRetry(async () => {
  const { srv, r } = clearScene(), pr = projectOf(r)
  const cd = countingDig(srv, LEAF, 'unreached')
  await visits(R, pr, srv, RT.RETRY_VISITS + 2, { botOpts: { dig: cd.dig } })
  assert.ok(cd.n.digs >= RT.RETRY_VISITS + 2, `a dig every visit (${cd.n.digs})`)
  assert.deepStrictEqual(RT.retryRead(pr.dir, pr.key), {}, 'nothing in the ledger')
}))
await t('counted ONCE a visit (one dig a visit, however often clears() runs); HELD after RETRY_VISITS visits, named; the wall builds every visit', async () => {
  const scenario = async M => {
    const { srv, r } = clearScene(), pr = projectOf(r)
    const cd = countingDig(srv, LEAF, 'unreached')
    const rs = await visits(M, pr, srv, RT.RETRY_VISITS, { botOpts: { dig: cd.dig } })
    assert.strictEqual(srv.read(...W1).name, 'cobblestone', 'the record cell is built: a failing clear never holds the build')
    assert.strictEqual(cd.n.digs, RT.RETRY_VISITS, 'one dig a visit while it is counted')
    const led = RT.retryRead(pr.dir, pr.key)
    assert.deepStrictEqual([led[k(LEAF)]?.visits, led[k(LEAF)]?.why], [RT.RETRY_VISITS, 'unreached'])
    assert.ok(!rs.some(x => x.e.logs.some(([kk, d]) => kk === '_build' && d.why === 'retry_hold')), 'not held before RETRY_VISITS')
    const held = await visits(M, pr, srv, 2, { botOpts: { dig: cd.dig } })
    assert.strictEqual(cd.n.digs, RT.RETRY_VISITS, 'held: no dig walk in the two visits after')
    assert.ok(held[0].e.logs.some(([kk, d]) => kk === '_build' && d.op === 'deferred' && d.kind === 'retry' && d.why === 'retry_hold' && k(d.cell) === k(LEAF)), 'the held clear is named')
    assert.strictEqual(RT.retryRead(pr.dir, pr.key)[k(LEAF)].visits, RT.RETRY_VISITS, 'a held visit adds nothing (the hold does not slide)')
  }
  await killedBy("        if (!['confirmed', 'gone', 'fence', 'aborted'].includes(v)) fail(c.at, v)\n", '', scenario)
  await killedBy("        if (rt?.held.has(kOf(c.at))) { rt.skipped.add(kOf(c.at)); continue }", '        if (false) { }', scenario)
  await killedBy('        if (rt?.failed.has(kOf(c.at))) continue ', '        if (false) continue ', scenario)
})
await t('once the hold ends it is tried again; gone (another bot cleared it) resets it for everyone', async () => {
  const { srv, r } = clearScene(), pr = projectOf(r)
  const cd = countingDig(srv, LEAF, 'unreached')
  await visits(R, pr, srv, RT.RETRY_VISITS, { botOpts: { dig: cd.dig } })
  const f = path.join(pr.dir, `${pr.key}.retry.A.json`), j = JSON.parse(fs.readFileSync(f, 'utf8'))
  j.cells[k(LEAF)].lastAt -= RT.RETRY_HOLD_MS; fs.writeFileSync(f, JSON.stringify(j))
  await visits(R, pr, srv, 1, { botOpts: { dig: cd.dig } })
  assert.strictEqual(cd.n.digs, RT.RETRY_VISITS + 1, 'tried once more after the hold')
  srv.set(LEAF, 'air')                       // another bot dug it
  await visits(R, pr, srv, 1, { who: 'B' })
  assert.deepStrictEqual(RT.retryRead(pr.dir, pr.key), {}, 'B saw it gone: the cell is reset for every builder')
})
await t('a listed clear NO dig stand reaches costs nothing and is NOT counted (a pad built later may give it one: fell-01)', async () => {
  const srv = server(); const HIGH = [10, G + 8, 10]; srv.set(HIGH, 'oak_leaves')
  const pr = projectOf(rec([{ at: W1, role: 'wall', seg: 'W-00' }], ['W-00'], [{ at: HIGH, name: 'oak_leaves', kind: 'leaves' }]))
  await visits(R, pr, srv, RT.RETRY_VISITS + 1)
  assert.deepStrictEqual(RT.retryRead(pr.dir, pr.key), {})
})

// ---- 3. a FOREIGN block in a record cell whose dig keeps failing (isolated-c leaves no_stand; hive-a bamboo unreached) ------------
console.log('A FOREIGN BLOCK IN A RECORD CELL')
const C1 = [10, G + 1, 10], C2 = [30, G + 1, 10]
const foreignScene = () => { const srv = server(); srv.set(C1, 'dirt'); return { srv, r: rec([{ at: C1, role: 'wall', seg: 'W-00' }, { at: C2, role: 'wall', seg: 'W-01' }], ['W-00', 'W-01']) } }
await t('a dig refused every visit: `blocked` and retried at once for RETRY_VISITS visits (1b05c924), then HELD -- deferred, the other segment built', async () => {
  const scenario = async M => {
    const { srv, r } = foreignScene(), pr = projectOf(r)
    const cd = countingDig(srv, C1, 'refused')
    const rs = await visits(M, pr, srv, RT.RETRY_VISITS + 2, { botOpts: { dig: cd.dig } })
    assert.deepStrictEqual(rs.slice(0, RT.RETRY_VISITS).map(x => x.r.stop.replace('stuck_on_cell', 'blocked')).every(s => s === 'blocked' || s === 'cell_deferred'), true)
    assert.strictEqual(cd.n.digs, RT.RETRY_VISITS * R.BUILD_ATTEMPTS, `dug only while counted (${cd.n.digs})`)
    const held = rs.slice(RT.RETRY_VISITS)
    assert.ok(held.every(x => x.r.stop === 'cell_deferred' || x.r.stop === 'stuck_on_cell'), `held: deferred (${held.map(x => x.r.stop)})`)
    assert.ok(held.every(x => (x.r.deferred ?? []).some(d => d.k === k(C1) && /^retry dig refused/.test(d.why))), JSON.stringify(held.map(x => x.r.deferred)))
    assert.strictEqual(srv.read(...C2).name, 'cobblestone', 'the independent segment is built')
    assert.strictEqual(srv.read(...C1).name, 'dirt', 'the held cell is never dug')
  }
  await killedBy('if (rt.held.has(k) && !isDone(c)) { tries.set(k, BUILD_ATTEMPTS); rt.skipped.add(k) }', 'if (false) { }', scenario)
})
await t('CONTROL (BUILDRETRY=0): the same dig every visit, for good', () => noRetry(async () => {
  const { srv, r } = foreignScene(), pr = projectOf(r)
  const cd = countingDig(srv, C1, 'refused')
  const rs = await visits(R, pr, srv, RT.RETRY_VISITS + 2, { botOpts: { dig: cd.dig } })
  assert.strictEqual(cd.n.digs, (RT.RETRY_VISITS + 2) * R.BUILD_ATTEMPTS)
  assert.ok(rs.every(x => x.r.stop === 'blocked'), rs.map(x => x.r.stop).join(','))
}))
await t('a foreign dig with NO STAND (leaves no stand sees): deferred at once (unreached), counted, held after RETRY_VISITS, stuck_on_cell names it', async () => {
  const srv = server()
  const T1 = [10, G + 8, 10]                 // a record cell eight above the ground holding leaves
  srv.set(T1, 'oak_leaves')
  const r = rec([{ at: T1, role: 'wall', seg: 'W-00' }], ['W-00'])
  const pr = projectOf(r)
  const rs = await visits(R, pr, srv, RT.RETRY_VISITS + 1)
  assert.ok(rs.every(x => x.r.stop === 'cell_deferred' || x.r.stop === 'stuck_on_cell'), rs.map(x => x.r.stop).join(','))
  assert.ok(rs.slice(0, RT.RETRY_VISITS).every(x => x.r.deferred?.[0]?.why === 'unreached'))
  assert.match(rs.at(-1).r.deferred[0].why, /^retry dig no_stand/)
  assert.ok(Number.isFinite(PJ.stuckAt(pr.dir, pr.key)), 'nothing else open: the project is stamped and the order backs off')
  assert.strictEqual(RT.retryRead(pr.dir, pr.key)[k(T1)].visits, RT.RETRY_VISITS)
})

// ---- 4. a placement whose attempts are spent (hive-d tidy's fill no click lands on) -----------------------------------------------
console.log('A PLACEMENT NO CLICK LANDS ON')
const placeScene = () => ({ srv: server(), r: rec([{ at: C1, role: 'wall', seg: 'W-00' }, { at: C2, role: 'wall', seg: 'W-01' }], ['W-00', 'W-01']), ack: target => (k(target) === k(C1) ? 'refuse' : 'ok') })
await t('CONTROL (BUILDRETRY=0): `attempts_spent` -- the visit ends there, the independent segment waits', () => noRetry(async () => {
  const { srv, r, ack } = placeScene(), pr = projectOf(r)
  const rs = await visits(R, pr, srv, 2, { botOpts: { ack } })
  assert.deepStrictEqual(rs.map(x => x.r.stop), ['attempts_spent', 'attempts_spent'])
  assert.strictEqual(srv.read(...C2).name, 'air')
}))
await t('deferred in the SAME visit (the other segment built), counted; held after RETRY_VISITS visits: no click is sent to it', async () => {
  const scenario = async M => {
    const { srv, r, ack } = placeScene(), pr = projectOf(r)
    let clicks = 0
    const ack2 = (target, held) => { if (k(target) === k(C1)) clicks++; return ack(target, held) }
    const rs = await visits(M, pr, srv, RT.RETRY_VISITS + 1, { botOpts: { ack: ack2 } })
    assert.strictEqual(rs[0].r.stop, 'cell_deferred')
    assert.strictEqual(srv.read(...C2).name, 'cobblestone', 'the independent segment filled in the first visit')
    assert.deepStrictEqual(rs[0].r.deferred.map(d => [d.k, d.why]), [[k(C1), 'attempts refused']])
    assert.strictEqual(clicks, RT.RETRY_VISITS * R.BUILD_ATTEMPTS, `clicked only while counted (${clicks})`)
    assert.match(rs.at(-1).r.deferred[0].why, /^retry attempts/)
  }
  await killedBy("              return (tries.get(k) ?? 0) >= BUILD_ATTEMPTS ? `attempts ${lastTry.get(k) ?? 'spent'}` : null", '              return null', scenario)
})

// ---- 5. a block the visit never digs (board-d tidy: 215 `blocked` visits a day, no row at all) ----------------------------------
console.log('A BLOCK THE VISIT NEVER DIGS')
await t('a chest in a record cell: counted from the first visit (`kept chest`), deferred, stuck_on_cell at STUCK_VISITS, never dug', async () => {
  const scenario = async M => {
    const srv = server(); srv.set(C1, 'chest')
    const r = rec([{ at: C1, role: 'wall', seg: 'W-00' }], ['W-00']), pr = projectOf(r)
    const rs = await visits(M, pr, srv, R.STUCK_VISITS)
    assert.deepStrictEqual(rs.map(x => x.r.stop), [...Array(R.STUCK_VISITS - 1).fill('cell_deferred'), 'stuck_on_cell'])
    assert.strictEqual(rs[0].r.deferred[0].why, 'kept chest')
    assert.strictEqual(RT.retryRead(pr.dir, pr.key)[k(C1)].why, 'kept chest', 'the ledger names it')
    assert.strictEqual(srv.read(...C1).name, 'chest')
  }
  await killedBy("              if (!isClear(c.at)) return unreachedClears.has(k) ? 'unreached' : permanent(c) ? `kept ${nm(rd(...c.at))}` : null",
    "              if (!isClear(c.at)) return unreachedClears.has(k) ? 'unreached' : null", scenario)
})

// ---- 6. builders, aborts, completeness -------------------------------------------------------------------------------------------
console.log('BUILDERS, ABORTS, COMPLETENESS')
await t('three builders\' failing visits sum: A twice and B once hold the cell for C, who never digs it', async () => {
  const { srv, r } = foreignScene(), pr = projectOf(r)
  const cd = countingDig(srv, C1, 'refused')
  await visits(R, pr, srv, 2, { who: 'A', botOpts: { dig: cd.dig } })
  await visits(R, pr, srv, 1, { who: 'B', botOpts: { dig: cd.dig } })
  const before = cd.n.digs
  await visits(R, pr, srv, 1, { who: 'C', botOpts: { dig: cd.dig } })
  assert.strictEqual(cd.n.digs, before, 'C never dug it')
})
await t('r1 (Codex r1 BLOCK): A fails 3, B succeeds, A fails once more -> ONE visit counted, no hold (B\'s reset voids A\'s old failures)', async () => {
  const { srv, r } = foreignScene(), pr = projectOf(r)
  const cd = countingDig(srv, C1, 'refused')
  await visits(R, pr, srv, RT.RETRY_VISITS, { who: 'A', botOpts: { dig: cd.dig } })
  srv.set(C1, 'cobblestone')                  // B finds it built
  await visits(R, pr, srv, 1, { who: 'B' })
  assert.deepStrictEqual(RT.retryRead(pr.dir, pr.key), {})
  srv.set(C1, 'dirt')                         // dug out again, and A's dig fails again
  await visits(R, pr, srv, 1, { who: 'A', botOpts: { dig: cd.dig } })
  assert.strictEqual(RT.retryRead(pr.dir, pr.key)[k(C1)]?.visits, 1, 'one visit, not four')
  const before = cd.n.digs
  await visits(R, pr, srv, 1, { who: 'A', botOpts: { dig: cd.dig } })
  assert.ok(cd.n.digs > before, 'not held: A digs it again')
})
await t('a visit that ABORTS after a failure still counts it (the ledger settles on every exit)', async () => {
  const { srv, r } = foreignScene(), pr = projectOf(r)
  let digs = 0
  const e = bot(srv, 'A', { inv: { cobblestone: 32 }, dig: async () => { digs++; return 'refused' }, aborted: () => digs >= R.BUILD_ATTEMPTS })
  await R.runVisit(pr.p('A'), e, { maxSteps: 300 }).catch(() => null)
  assert.strictEqual(RT.retryRead(pr.dir, pr.key)[k(C1)]?.visits, 1)
})
await t('a held record cell stays OPEN: never counted done, the project never completes past it', async () => {
  const { srv, r } = foreignScene(), pr = projectOf(r)
  const cd = countingDig(srv, C1, 'refused')
  const rs = await visits(R, pr, srv, RT.RETRY_VISITS + 1, { botOpts: { dig: cd.dig } })
  assert.ok(rs.every(x => x.r.stop !== 'complete'), rs.map(x => x.r.stop).join(','))
})
await t('COMPOSED with tidydead-01 (the tidy\'s hardDefers) and its waiver: the hard cell deferred every visit, the waiver names it at WALL_WAIVE_AFTER', async () => {
  const { wallWaiveDue, WALL_WAIVE_AFTER } = await import('../src/wall.mjs')
  const srv = server(); const T1 = [10, G + 8, 10]; srv.set(T1, 'oak_leaves')
  const r = { ...rec([{ at: T1, role: 'earth', seg: 'T-05-5' }], ['T-05-5']), plot: 'tidy' }, pr = projectOf(r, 'tidy')
  const rs = await visits(R, pr, srv, WALL_WAIVE_AFTER, { extra: { hardDefers: true, stuckStalledOnly: true } })
  assert.ok(rs.every(x => x.r.stop === 'cell_deferred' || x.r.stop === 'stuck_on_cell'), rs.map(x => x.r.stop).join(','))
  assert.deepStrictEqual(wallWaiveDue(r, rs.at(-1).r.deferred).map(d => d.k), [k(T1)], 'the waiver still names it (its reason now the ledger\'s)')
})
await t('the wiring: runVisit reads the ledger before the visit and settles it in a finally (structural)', () => {
  const src = fs.readFileSync(new URL('../src/buildrun.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const line = '  try { r = await visitInner(p, e, opts, rt) } finally {\n    retrySettle(rt, p, e)\n'
  assert.strictEqual(src.split(line).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.strictEqual(src.split('  const rt = retryStart(p, e)').length, 2)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

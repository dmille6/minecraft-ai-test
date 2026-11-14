// TIDYDEAD-01 (fleet 11-04, the stuck-projects read): THE TIDY'S HARD CELLS ARE DEFERRED, so its waiver can name them.
//   placebo-b  T-05-5: ONE oak_leaves fill cell (271,64,-370) no dig stand reaches -> `blocked` on 455 of 512 visits, 1 of 245 left
//   hive-d     T-11-0: ONE clear fill (42,62,45) no click lands on -> `attempts_spent` on 252 visits; 205 fills in 78 other segments
// The tidy waives only cells a visit DEFERRED (wall.mjs wallWaiveDue), and neither stop deferred: both projects stood for good.
// Tested by what the visit DOES on the fake server (test/helpers/buildfake.mjs); each control is the live stop; each remedy is
// killed by a mutant whose anchor is asserted present and unique (withMutant).
// buildretry-01: this file proves ITS project remedy alone, its CONTROLS the live stop before it: the default deferral (BUILDRETRY,
// buildrun.mjs) would mask both, so it is off here; the composition of the two is tested in buildretry.test.mjs
process.env.BUILDRETRY = '0'
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const SC = await import('../src/stuckcells.mjs')
const { TIDY_PALETTE } = await import('../src/tidy.mjs')
const { wallWaiveDue, WALL_WAIVE_AFTER } = await import('../src/wall.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const k = a => a.join(',')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/** The scenario passes on the real module; the mutant fails the scenario's OWN assertion. */
const killedBy = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
function projectOf (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/tidydead-`)
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, 3)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: TIDY_PALETTE, slot: slots[n].slot, slotGen: slots[n].gen, stands: { pending: null, bans: {} }, blockLayer: false, domain: () => true, walkR: 40, stuckStalledOnly: true, ...extra }
  }
  return { dir, key, p }
}
const rec = (cells, segs) => ({ v: 1, plot: 'tidy', cells, clear: [], replant: [], segments: segs.map(seg => ({ seg, deps: [] })) })
const visits = async (pr, e, n, extra = {}) => { const out = []; for (let v = 0; v < n; v++) out.push(await (extra.M ?? R).runVisit(pr.p('A', extra.p ?? {}), e, { maxSteps: 200 })); return out }

// ---- 1. the decision (pure) ---------------------------------------------------------------------------------------------------
console.log('THE HARD CELLS (stuckcells.mjs hardDeferrals)')
const A = [10, G + 1, 10], A2 = [10, G + 2, 10], Bc = [12, G + 1, 10]
await t('a block whose clear this visit could not REACH is hard; a clear cell whose attempts are spent is hard; each named', () => {
  const clear = at => k(at) !== k(A)
  assert.deepStrictEqual(SC.hardDeferrals([{ at: A }], { clear, unreached: new Set([k(A)]), name: () => 'oak_leaves' }), [{ k: k(A), why: 'blocked oak_leaves unreached' }])
  assert.deepStrictEqual(SC.hardDeferrals([{ at: Bc }], { clear, tries: () => 2, max: 2, lastTry: new Map([[k(Bc), 'body']]) }), [{ k: k(Bc), why: 'attempts body' }])
})
await t('ANY cell with a chance left keeps the old stop (null): a dig refused or unconfirmed (Codex stuckcells r1), attempts unspent', () => {
  const clear = at => k(at) !== k(A)
  assert.strictEqual(SC.hardDeferrals([{ at: A }], { clear, unreached: new Set() }), null, 'a diggable block the visit did not fail to REACH')
  assert.strictEqual(SC.hardDeferrals([{ at: Bc }], { clear, tries: () => 1, max: 2 }), null, 'one attempt left')
  assert.strictEqual(SC.hardDeferrals([{ at: A }, { at: Bc }], { clear, unreached: new Set([k(A)]), tries: () => 1, max: 2 }), null, 'mixed: the clear cell may still land')
  assert.strictEqual(SC.hardDeferrals([], { clear }), null, 'nothing open')
})
await t('a cell WAITING on a hard cell below it neither blocks the deferral nor is deferred itself (it is placed once the hard one is waived)', () => {
  const clear = () => true
  const waits = c => k(c.at) === k(A2)
  assert.deepStrictEqual(SC.hardDeferrals([{ at: A }, { at: A2 }], { clear, tries: q => (q === k(A) ? 2 : 0), max: 2, waits }), [{ k: k(A), why: 'attempts spent' }])
  assert.strictEqual(SC.hardDeferrals([{ at: A2 }], { clear, waits }), null, 'waiting on nothing hard: no deferral')
})
await t('the switch: TIDYDEAD=off|0|false|no is the rollback; anything else (unset included) is on', () => {
  for (const v of ['off', 'OFF', ' 0', 'false', 'no']) assert.strictEqual(SC.tidyDeadOn({ TIDYDEAD: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.strictEqual(SC.tidyDeadOn({ TIDYDEAD: v }), true, String(v))
})

// ---- 2. placebo-b: a block no dig stand reaches --------------------------------------------------------------------------------
console.log('PLACEBO-B: THE LEAVES NO STAND REACHES')
// a fill cell holding oak_leaves eight above the ground: no stand's eye is in reach of it, so its clear fails `no_stand` every visit
const HIGH = [10, G + 8, 10]
const leavesScene = () => {
  const srv = server()
  srv.set(HIGH, 'oak_leaves')
  return { srv, rec: rec([{ at: HIGH, role: 'earth', seg: 'T-05-5' }], ['T-05-5']) }
}
await t('CONTROL (the live stop): `blocked` every visit, nothing deferred, so the waiver never names it', async () => {
  const { srv, rec: r } = leavesScene(), pr = projectOf(r), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
  const rs = await visits(pr, e, WALL_WAIVE_AFTER)
  assert.deepStrictEqual(rs.map(x => x.stop), Array(WALL_WAIVE_AFTER).fill('blocked'))
  assert.ok(e.logs.some(([kk, d]) => kk === '_build' && d.op === 'clear_failed' && d.result === 'no_stand'), 'the live row: clear_failed no_stand')
  assert.deepStrictEqual(wallWaiveDue(r, rs.at(-1).deferred ?? []), [])
})
await t('hardDefers: the cell is DEFERRED, counted visit by visit, and the waiver names it after WALL_WAIVE_AFTER visits', async () => {
  const scenario = async M => {
    const { srv, rec: r } = leavesScene(), pr = projectOf(r), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
    const rs = await visits(pr, e, WALL_WAIVE_AFTER, { M, p: { hardDefers: true } })
    assert.ok(rs.every(x => x.stop === 'cell_deferred' || x.stop === 'stuck_on_cell'), `stops ${rs.map(x => x.stop)}`)
    assert.deepStrictEqual(rs.at(-1).deferred.map(d => [d.k, d.why]), [[k(HIGH), 'blocked oak_leaves unreached']])
    assert.strictEqual(rs.at(-1).deferred[0].visits, WALL_WAIVE_AFTER, 'one count per visit')
    assert.deepStrictEqual(wallWaiveDue(r, rs.at(-1).deferred), [{ k: k(HIGH), why: 'blocked oak_leaves unreached' }])
    assert.strictEqual(srv.read(...HIGH).name, 'oak_leaves', 'nothing dug or placed that could not be')
  }
  await killedBy('          if (p.hardDefers && !needSapling) {', '          if (false) {', scenario)
  await killedBy("            if (v === 'no_stand' || v === 'unreached') unreachedClears.add(kOf(f.at))\n", '', scenario)
})
await t('THE CHAIN: once waived (the record\'s list, read as done), the next visit closes the segment -- the project is not stuck', async () => {
  const { srv, rec: r } = leavesScene(), pr = projectOf(r), e = bot(srv, 'A', { inv: { cobblestone: 8 } })
  const rs = await visits(pr, e, WALL_WAIVE_AFTER, { p: { hardDefers: true } })
  const waived = new Set(wallWaiveDue(r, rs.at(-1).deferred).map(d => d.k))
  const last = await R.runVisit(pr.p('A', { hardDefers: true, alsoDone: q => waived.has(k(q.at)) }), e, { maxSteps: 200 })
  assert.strictEqual(last.stop, 'complete')
})
await t('a TRANSIENT obstruction still keeps `blocked` with hardDefers on (Codex stuckcells r1): a reachable leaf whose dig is refused', async () => {
  const srv = server()
  srv.set(A, 'oak_leaves')
  const r = rec([{ at: A, role: 'earth', seg: 'T-0' }], ['T-0'])
  const pr = projectOf(r), e = bot(srv, 'A', { inv: { cobblestone: 8 }, dig: async () => 'refused' })
  const rs = await visits(pr, e, 3, { p: { hardDefers: true } })
  assert.deepStrictEqual(rs.map(x => x.stop), ['blocked', 'blocked', 'blocked'], 'retried at once every visit, never deferred')
  assert.strictEqual(PJ.stuckAt(pr.dir, pr.key), null)
})

await t('r2 (Codex r1 BLOCK): an `unreached` clear followed IN THE SAME VISIT by a dig that reaches and is refused keeps `blocked`', async () => {
  const scenario = async M => {
    const srv = server()
    srv.set(A, 'oak_leaves')
    const r = rec([{ at: A, role: 'earth', seg: 'T-0' }], ['T-0'])
    // the first dig of each visit fails `unreached`, the second reaches the cell and is refused: the LATEST result is a transient
    let n = 0
    const pr = projectOf(r), e = bot(srv, 'A', { inv: { cobblestone: 8 }, dig: async () => (n++ % 2 === 0 ? 'unreached' : 'refused') })
    const rs = await visits(pr, e, 3, { M, p: { hardDefers: true } })
    assert.ok(n >= 4, `both attempts made each visit (digs ${n})`)
    assert.deepStrictEqual(rs.map(x => x.stop), ['blocked', 'blocked', 'blocked'], 'never deferred: a reachable cell is never waived')
    assert.strictEqual(PJ.stuckAt(pr.dir, pr.key), null)
  }
  await killedBy('          unreachedClears.delete(kOf(f.at))\n', '', scenario)
})

// ---- 3. hive-d: a clear fill no click lands on, with the town's other segments behind it ------------------------------------------
console.log('HIVE-D: THE FILL NO CLICK LANDS ON')
const hivedScene = () => {
  const srv = server()
  // T-11-0's one open fill refuses every placement; T-12-0 is an ordinary fill in an independent segment (the live 78 others)
  return { srv, rec: rec([{ at: A, role: 'earth', seg: 'T-11-0' }, { at: Bc, role: 'earth', seg: 'T-12-0' }], ['T-11-0', 'T-12-0']), ack: target => (k(target) === k(A) ? 'refuse' : 'ok') }
}
await t('CONTROL (the live stop): `attempts_spent` on T-11-0, and the independent segment is never reached', async () => {
  const { srv, rec: r, ack } = hivedScene(), pr = projectOf(r), e = bot(srv, 'A', { inv: { cobblestone: 8 }, ack })
  const rs = await visits(pr, e, 2)
  assert.deepStrictEqual(rs.map(x => x.stop), ['attempts_spent', 'attempts_spent'])
  assert.strictEqual(srv.read(...Bc).name, 'air', 'the other segment waits for good')
})
await t('hardDefers: T-11-0\'s cell is deferred and the SAME visit fills the independent segment; the waiver names the cell', async () => {
  const scenario = async M => {
    const { srv, rec: r, ack } = hivedScene(), pr = projectOf(r), e = bot(srv, 'A', { inv: { cobblestone: 8 }, ack })
    const first = await M.runVisit(pr.p('A', { hardDefers: true }), e, { maxSteps: 200 })
    assert.strictEqual(srv.read(...Bc).name, 'cobblestone', 'the independent segment filled in the first visit')
    assert.strictEqual(first.stop, 'cell_deferred')
    assert.deepStrictEqual(first.deferred.map(d => [d.k, d.why]), [[k(A), 'attempts refused']])
    const rs = await visits(pr, e, WALL_WAIVE_AFTER - 1, { M, p: { hardDefers: true } })
    assert.deepStrictEqual(wallWaiveDue(r, rs.at(-1).deferred), [{ k: k(A), why: 'attempts refused' }])
  }
  await killedBy('          if (p.hardDefers && !needSapling) {', '          if (false) {', scenario)
  await killedBy('        lastTry.set(kOf(picked.at), v)\n', '', scenario)
})

// ---- 4. the wiring (structural: which visit asks for it) ----------------------------------------------------------------------
console.log('THE WIRING')
const SKILLS = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const TIDY_ASK = '...(tidyDeadOn() ? { hardDefers: true } : {}) }, effects, { deadline: t0 + budget - ZIG_VISIT_TAIL_MS, maxSteps: 400 })'
const wired = src => {
  const body = src.slice(src.indexOf('async function buildTidy ('), src.indexOf('\n}\n', src.indexOf('async function buildTidy (')))
  return body.split(TIDY_ASK).length === 2 && src.split('hardDefers').length === 2
}
await t('the tidy\'s visit (buildTidy) asks for hardDefers behind TIDYDEAD, and NO other visit does (monument, wall, shop unchanged)', () => {
  assert.ok(SKILLS.includes('async function buildTidy ('), 'ANCHOR: buildTidy')
  assert.strictEqual(wired(SKILLS), true)
  assert.strictEqual(wired(SKILLS.replace(TIDY_ASK, '}, effects, { deadline: t0 + budget - ZIG_VISIT_TAIL_MS, maxSteps: 400 })')), false, 'MUTANT: the ask removed')
  assert.strictEqual(wired(SKILLS + '\nconst x = { hardDefers: true }'), false, 'MUTANT: a second visit asks')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

// STUCKCLOSE-01 (11-08): A TIDY STAGE WHOSE LAST CUTS THE TOWN CANNOT REACH CLOSES. Live: hive-b / isolated-c / board-a tidy visits
// ended `complete` 219 / 179 / 172 times in 12 h with "cuts left 2/38", "4/8", "2/28" -- exactly the cuts the town's buildretry ledger
// held (summed visits 3-11, unreached). The held cut is never evaluated, so the per-bot TIDY_CUT_TRIES never gives it up, the stage
// never completes and no visit is ever empty. This walks the composed chain (ledger -> given -> progress -> empty visit) on the fake
// server, with the buildrun.mjs remedy killed by a mutant whose anchor is asserted present and unique (withMutant).
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
const { R, PJ, G, HOME, server, bot, withMutant } = await import('./helpers/buildfake.mjs')
const RT = await import('../src/buildretry.mjs')
const SC = await import('../src/stuckclose.mjs')
const TD = await import('../src/tidy.mjs')
const GW = await import('../src/gkwork.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 8).join('\n        ')}`) } }
const k = a => a.join(',')
const PAL = Object.freeze({ wall: ['cobblestone'], fill: ['cobblestone'] })
const W1 = [20, G + 1, 10]
function projectOf (record) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'stuckclose-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slots = {}
  const p = (n, extra = {}) => {
    slots[n] ??= PJ.takeSlot(dir, key, n, 3)
    return { dir, key, me: n, home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slots[n].slot, slotGen: slots[n].gen, stands: { pending: null, bans: {} }, blockLayer: false, domain: () => true, walkR: 40, ...extra }
  }
  return { dir, key, p }
}
async function visits (M, pr, srv, n, { who = 'A', extra = {}, botOpts = {} } = {}) {
  const out = []
  for (let v = 0; v < n; v++) { const e = bot(srv, who, { inv: { cobblestone: 32 }, ...botOpts }); out.push({ r: await M.runVisit(pr.p(who, extra), e, { maxSteps: 300 }), e }) }
  return out
}

console.log('THE PURE RULES (stuckclose.mjs)')
await t('the switch: default on; STUCKCLOSE=0|off|false|no off', () => {
  assert.strictEqual(SC.stuckcloseOn({}), true)
  for (const v of ['0', 'off', 'false', 'no', ' OFF ']) assert.strictEqual(SC.stuckcloseOn({ STUCKCLOSE: v }), false, v)
})
await t('townFailed: RETRY_VISITS summed visits or more, whatever the hold window', () => {
  assert.strictEqual(SC.townFailed(null), false)
  assert.strictEqual(SC.townFailed({ visits: RT.RETRY_VISITS - 1 }), false)
  assert.strictEqual(SC.townFailed({ visits: RT.RETRY_VISITS }), true)
  assert.strictEqual(SC.townFailed({ visits: 11, lastAt: 0 }), true, 'a hold that has lapsed still counts: the ledger forgets at 24 h, not 2 h')
})
await t('townGivenCuts: only standing record cuts the town has failed; a fill cell, a fallen cut, a weak entry are never given', () => {
  const rec = { cut: [{ at: [1, 2, 3], name: 'cobblestone' }, { at: [1, 3, 3], name: 'cobblestone' }, { at: [4, 5, 6], name: 'dirt' }], cells: [{ at: [9, 9, 9] }] }
  const ledger = { '1,2,3': { visits: 4, why: 'unreached' }, '1,3,3': { visits: 3, why: 'no_stand' }, '4,5,6': { visits: 2, why: 'unreached' }, '9,9,9': { visits: 9, why: 'attempts' } }
  const g = SC.townGivenCuts(rec, ledger, { standing: c => k(c.at) !== '1,3,3' })
  assert.deepStrictEqual([...g.entries()], [['1,2,3', 'unreached']])
  assert.strictEqual(SC.townGivenCuts(rec, {}).size, 0)
  assert.strictEqual(SC.townGivenCuts(null, ledger).size, 0)
})
await t('givenWaivers: names each given cut once (why cut_given:<why>), keeps an existing waiver, never mutates the record', () => {
  const w0 = { '1,2,3': { why: 'stalled:x', at: 5, by: 'B' } }
  const w = SC.givenWaivers(w0, new Map([['1,2,3', 'unreached'], ['7,8,9', 'no_stand']]), { now: 10, by: 'A' })
  assert.deepStrictEqual(w, { '1,2,3': { why: 'stalled:x', at: 5, by: 'B' }, '7,8,9': { why: 'cut_given:no_stand', at: 10, by: 'A' } })
  assert.deepStrictEqual(Object.keys(w0), ['1,2,3'])
})

console.log('THE COMPOSED CHAIN (fake server): ledger -> given -> progress -> an empty visit')
// a tidy cut eight above the ground: no dig stand reaches it (buildretry.test.mjs: a listed clear no stand reaches is not counted)
const HIGH = [10, G + 8, 10]
const scene = () => {
  const srv = server(); srv.set(HIGH, 'cobblestone'); srv.set(W1, 'cobblestone')   // the fill already laid: only the cut is left
  const rec = { v: 1, plot: 'tidy', cells: [{ at: W1, role: 'wall', seg: 'T-00-0' }], cut: [{ at: HIGH, kind: 'tidy', name: 'cobblestone' }], clear: [], replant: [], segments: [{ seg: 'T-00-0', deps: [] }] }
  return { srv, rec }
}
const chain = async (M, extra) => {
  const { srv, rec } = scene(), pr = projectOf(rec)
  // three DIFFERENT bots, one visit each: the keeper rotation (no bot reaches its own TIDY_CUT_TRIES)
  const rs = []
  for (const who of ['A', 'B', 'C']) rs.push(...await visits(M, pr, srv, 1, { who, extra: { tidy: rec.cut, ...extra } }))
  const mem = new Map()
  for (const x of rs) TD.tidyNoteCuts(mem, x.r.tidied ?? [], () => true)   // what ONE bot's memory would hold at best
  const given = SC.townGivenCuts(rec, RT.retryRead(pr.dir, pr.key), { standing: c => TD.cutStanding(srv.read, c) })
  const prog = TD.tidyProgress(rec, srv.read, { fillDone: () => true, given: key => TD.tidyGivenUp(mem, key, TD.TIDY_CUT_TRIES + 1) || given.has(key) })
  return { rs, given, prog, empty: GW.visitEmpty({ cutLeft: prog.cutLeft, fillLeft: prog.fillLeft }) }
}
await t('CONTROL (the live dead end, no tidyTownCount): every visit `complete`, the cut never counted town-wide, cutLeft 1, never empty', async () => {
  const c = await chain(R, {})
  assert.ok(c.rs.every(x => x.r.stop === 'complete'), c.rs.map(x => x.r.stop).join(','))
  assert.strictEqual(c.given.size, 0)
  assert.deepStrictEqual([c.prog.cutLeft, c.empty], [1, false])
})
await t('tidyTownCount: the stand-less cut is counted once a visit in the town ledger; at RETRY_VISITS the town gives it up, the visit is empty (mutant: not counted)', async () => {
  const scenario = async M => {
    const c = await chain(M, { tidyTownCount: true })
    assert.ok(c.rs.every(x => x.r.stop === 'complete'), c.rs.map(x => x.r.stop).join(','))
    assert.deepStrictEqual([...c.given.entries()], [[k(HIGH), 'no_stand']], 'given up by the town')
    assert.deepStrictEqual([c.prog.cutLeft, c.empty], [0, true], 'the stage can complete (or strike)')
  }
  await scenario(R)
  let why = null
  await withMutant("{ if (p.tidyTownCount && c.kind === 'tidy') fail(c.at, 'no_stand'); continue }", 'continue', async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
})
await t('a cut the town gave up that is later dug (another bot, a pad) is done, not given; its ledger resets on the next visit', async () => {
  const { srv, rec } = scene(), pr = projectOf(rec)
  for (const who of ['A', 'B', 'C']) await visits(R, pr, srv, 1, { who, extra: { tidy: rec.cut, tidyTownCount: true } })
  srv.set(HIGH, 'air')
  assert.strictEqual(SC.townGivenCuts(rec, RT.retryRead(pr.dir, pr.key), { standing: c => TD.cutStanding(srv.read, c) }).size, 0)
  await visits(R, pr, srv, 1, { who: 'D', extra: { tidy: rec.cut, tidyTownCount: true } })
  assert.deepStrictEqual(RT.retryRead(pr.dir, pr.key), {}, 'gone: reset for every builder')
})
await t('a HELD unreached cut (the live hive-b case: never evaluated) is given by the town', async () => {
  const { srv, rec } = scene(), pr = projectOf(rec)
  const now = Date.now()
  RT.retryWrite(pr.dir, pr.key, 'B', { cells: { [k(HIGH)]: { visits: 4, firstAt: now - 9e6, lastAt: now - 3e6, why: 'unreached' } }, resets: {} })
  RT.retryWrite(pr.dir, pr.key, 'E', { cells: { [k(HIGH)]: { visits: 3, firstAt: now - 6e6, lastAt: now - 36e5, why: 'unreached' } }, resets: {} })
  const rs = await visits(R, pr, srv, 1, { who: 'D', extra: { tidy: rec.cut, tidyTownCount: true } })
  assert.ok(!(rs[0].r.tidied ?? []).length, 'held: the visit never evaluates it (no per-bot count can ever reach TIDY_CUT_TRIES)')
  assert.deepStrictEqual([...SC.townGivenCuts(rec, RT.retryRead(pr.dir, pr.key), { standing: c => TD.cutStanding(srv.read, c) }).keys()], [k(HIGH)])
})

console.log('THE WIRING (skills.mjs buildTidy; structural, comments stripped)')
await t('buildTidy passes tidyTownCount, skips town-given cuts, counts them given in the progress, and names them on completion', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const body = src.slice(src.indexOf('async function buildTidy'), src.indexOf('function farmInputs'))
  assert.ok(body.length > 1000, 'buildTidy found')
  assert.match(body, /\.\.\.\(SCL_ON \? \{ tidyTownCount: true \} : \{\}\)/)
  assert.match(body, /const cuts0 = tidyCuts\(rec, read, mem\)\.filter\(q => !guard\.has\(q\.at\.join\(','\)\) && !tg0\.has\(q\.at\.join\(','\)\)\)/)
  assert.match(body, /given: k => guard\.has\(k\) \|\| tidyGivenUp\(mem, k\) \|\| tg\.has\(k\) \}\)/)
  assert.match(body, /waived: givenWaivers\(cur\.waived, tg, \{ now, by: me \}\)/)
  assert.match(src, /^const SCL_ON = stuckcloseOn\(\)/m)
  // the anchors are real: each wiring line removed, its assertion fails (the anchor present and unique first)
  for (const [line, re] of [["...(SCL_ON ? { tidyTownCount: true } : {}),", /tidyTownCount: true/], ['|| tidyGivenUp(mem, k) || tg.has(k) })', /tg\.has\(k\) \}\)/]]) {
    assert.strictEqual(body.split(line).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${line}`)
    assert.doesNotMatch(body.replace(line, ''), re)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

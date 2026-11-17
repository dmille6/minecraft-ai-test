// stillvisit-01show (TIDYFLOW_STILLVISIT): a build visit never stands still on cells it has just deferred or found stuck. LIVE
// showcase 11-17 14:21-15:21Z: 34 of 81 `_build_visit` rows were cut by the stuck reflex ("no movement for 35s") right after a
// deferred / stuck_on_cell / float_held row. The decision (tidyflow.mjs stillVisitStep) and its watch through the REAL visit runner
// (buildrun.mjs runVisit / stillWatch, on the fake server): the visit ends ITSELF `stuck_cells` inside the cap, its counts returned.
import assert from 'node:assert'
import fs from 'node:fs'
const F = await import('../src/tidyflow.mjs')
const G2 = await import('../src/grounds2.mjs')
const MC = await import('../src/minecrew.mjs')
const { R, PJ, withMutant, G, k3, server, bot, SITE, project, KIT } = await import('./helpers/buildfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
/** A mutant of tidyflow.mjs, its anchor present and unique (CLAUDE.md), imported from the test directory. */
async function withFlowMutant (old, neu, fn) {
  const src = fs.readFileSync(new URL('../src/tidyflow.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-flow-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
// A KILL MEANS AN ASSERTION: the mutant must fail the scenario's own assert, not die of something else
const killedBy = async (withM, old, neu, scenario, real) => {
  await scenario(real)
  let why = null
  await withM(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

console.log('THE DECISION (tidyflow.mjs stillVisitStep)')
const decide = M => {
  const s = M.stillVisitStep
  assert.strictEqual(s({ lastOp: null, sinceProgressMs: 60_000, sinceMoveMs: 60_000 }), 'continue', 'no stall row: the visit as it was')
  assert.strictEqual(s({ lastOp: 'deferred', sinceProgressMs: 1_000, sinceMoveMs: 1_000 }), 'next', 'a deferral: on to the next cell, no wait')
  assert.strictEqual(s({ lastOp: 'stuck_on_cell', sinceProgressMs: 25_000, sinceMoveMs: 19_999 }), 'next', 'moved inside the cap: go on')
  assert.strictEqual(s({ lastOp: 'stuck_on_cell', sinceProgressMs: 20_000, sinceMoveMs: 20_000 }), 'end', 'nothing laid or moved for 20 s: ends itself')
  assert.strictEqual(s({ lastOp: 'deferred', sinceProgressMs: 0, sinceMoveMs: 0, workable: false }), 'end', 'nothing workable: ends at once')
  assert.strictEqual(s({ on: false, lastOp: 'deferred', sinceProgressMs: 99_000, sinceMoveMs: 99_000, workable: false }), 'continue', 'off: exactly as before')
  assert.ok(M.STILLVISIT.capMs < 35_000, 'the cap is inside the stuck reflex\'s 35 s')
}
await t('continue / next / end, and off is the old visit', () => decide(F))
await t('MUTANT the cap ignored (moved OR progressed): never ends while one clock is fresh', () => killedBy(withFlowMutant,
  'if (Math.min(Number(sinceProgressMs) || 0, Number(sinceMoveMs) || 0) >= capMs) return \'end\'', '', decide, F))
await t('MUTANT nothing-workable not checked: the visit waits', () => killedBy(withFlowMutant,
  "  if (!workable) return 'end'\n", '', decide, F))
await t('MUTANT the switch ignored', () => killedBy(withFlowMutant,
  "if (!on || !lastOp) return 'continue'", "if (!lastOp) return 'continue'", decide, F))
await t('the stall rows: deferred, stuck_on_cell, float_held, a refused temporary stand -- and no others', () => {
  assert.deepStrictEqual(['deferred', 'stuck_on_cell', 'float_held'].map(o => F.stallRow(o)), [true, true, true])
  assert.strictEqual(F.stallRow('tempstand', { result: 'refused' }), true)
  assert.strictEqual(F.stallRow('tempstand', { result: 'built' }), false)
  assert.strictEqual(F.stallRow('place'), false)
})
await t('the switch: TIDYFLOW_STILLVISIT on by default, off|0|false|no turn it off', () => {
  assert.strictEqual(F.flowStillVisitOn({}), true)
  for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.strictEqual(F.flowStillVisitOn({ TIDYFLOW_STILLVISIT: v }), false, v)
})

console.log('THE BACK-OFFS READ A SELF-ENDED VISIT (not an abort)')
await t('stuck_cells falls through to the grounds; fixed nothing only with 0 placed and 0 cleared', () => {
  assert.ok(G2.fallStops('stuck_cells'))
  assert.strictEqual(G2.groundsAfter({ took: 'tidy', aborted: false, placed: 0, cleared: 0 }).empty, true, 'nothing done: empty')
  assert.strictEqual(G2.groundsAfter({ took: 'tidy', aborted: false, placed: 3, cleared: 0 }).empty, false, 'laid then ran out: not a failure')
  // minecrew: idle 10/20/40 counts only a visit that worked nothing
  const s1 = MC.steerAfter({ idleN: 1 }, { kind: 'grounds', worked: true, now: 0 })
  assert.strictEqual(s1.idleN, 0)
  const s2 = MC.steerAfter({ idleN: 1 }, { kind: 'grounds', worked: false, now: 0 })
  assert.strictEqual(s2.idleBackoffUntil, MC.CREW.idleBackoffMs[0])
  // tidyflow's two-aborts rest: a self-ended visit starts the count again
  assert.strictEqual(F.abortsAfter({ took: 'tidy', aborted: false, n: 1 }).n, 0)
})

console.log('THROUGH THE REAL VISIT RUNNER (buildrun.mjs runVisit, the fake server)')
// one record cell sealed in bedrock (no stand sees a face: deferred), first; then the workshop's own cells. After the deferral the
// walk to the next stand never arrives and never moves the bot (the live case) until the visit lets it go (`halt`).
const X = [5, G + 1, 25]
const sealed = () => Object.fromEntries([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => [k3(X.map((v, i) => v + d[i])), 'bedrock']))
const RECORD = { ...SITE.record,
  cells: [{ at: X, role: 'base', seg: 'extra', stand: [X[0] - 1, G + 1, X[2]], support: [X[0], G, X[2]], face: [0, 1, 0], order: -2 }, ...SITE.record.cells],
  segments: [{ seg: 'extra', deps: [] }, ...SITE.record.segments] }
async function hungVisit (Mod, { on = true, capMs = 150 } = {}) {
  const srv = server(sealed()), pr = project(RECORD)
  const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, 'A', { inv: { ...KIT(), stone_bricks: 91 } })
  let release = null, halts = 0
  const walk0 = e.walkTo
  e.walkTo = async (s, o) => {
    if (!e.logs.some(([k, d]) => k === '_build' && d.op === 'deferred')) return walk0(s, o)
    await new Promise(resolve => { release = resolve })   // stands, does not move
    return true
  }
  e.halt = () => { halts++; release?.() }
  const run = Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 4000, stillVisit: on, stillCapMs: capMs, stillTickMs: 20 })
  const timeout = new Promise(resolve => setTimeout(() => resolve('still running'), 1_500))
  const r = await Promise.race([run, timeout])
  if (r === 'still running') { release?.(); e.halt = () => {}; e.walkTo = walk0 }
  return { r, e, halts }
}
const runnerEnds = async Mod => {
  const t0 = Date.now()
  const { r, e, halts } = await hungVisit(Mod)
  assert.notStrictEqual(r, 'still running', 'the visit ended itself')
  assert.strictEqual(r.stop, 'stuck_cells', `its own named end (${r.stop}: ${r.why})`)
  assert.ok(Date.now() - t0 < 1_500, 'inside the cap, not the reflex')
  assert.ok(halts >= 1, 'the walk in flight was let go')
  assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'still_end'), 'a named row says why')
  assert.strictEqual(typeof r.placed, 'number', 'its counts come back (the back-offs read them)')
}
await t('a visit standing after a deferral ends itself stuck_cells, its walk let go', () => runnerEnds(R))
await t('switched off: the visit stands as before (the old behaviour, exact)', async () => {
  const { r } = await hungVisit(R, { on: false })
  assert.strictEqual(r, 'still running')
})
await t('MUTANT the guard does not ask the watch: the visit never ends itself', () => killedBy(withMutant,
  '    if (watch?.check()) return STILLVISIT.stop\n', '', runnerEnds, R))
await t('MUTANT the walk in flight not let go: the visit stands on its hung walk', () => killedBy(withMutant,
  '    try { e.halt?.() } catch { /* nothing walking */ }\n', '', runnerEnds, R))
await t('a visit that works normally is never ended by the watch', async () => {
  const srv = server({}), pr = project(SITE.record)
  const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, 'A', { inv: { ...KIT(), stone_bricks: 91 } })
  const r = await R.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 4000, stillVisit: true, stillCapMs: 150, stillTickMs: 20 })
  assert.notStrictEqual(r.stop, 'stuck_cells', `${r.stop}`)
  assert.ok(r.placed > 0)
})

console.log('REVIEW r1 (Codex blocker 1): PENDING CLEARS ARE WORK; A SELF-ENDED VISIT ADVANCES THE STUCK MAP AS THE OLD END DID')
// an EARTH cell no stand reaches, first; every other segment waits on it (pad on earth, the rest on pad); a listed log on a pad
// cell is the scaffold the visit clears LAST (`clearsLast`)
const B = await import('../src/buildsite.mjs')
const BP = B.loadBlueprint('workshop@1')
const E = [5, G + 1, 25]
const sealedE = () => Object.fromEntries([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => [k3(E.map((v, i) => v + d[i])), 'bedrock']))
const padAt = i => { const l = B.footprint(BP, { x: SITE.record.anchor[0], z: SITE.record.anchor[1] }, SITE.record.orient).pad[i]; return [l[0], G + 1, l[1]] }
const logAt = padAt(30), log2At = padAt(10)   // two clears: the second one's guard is where a hung first walk ends the visit EARLY
const EARTH = { ...SITE.record,
  cells: [{ at: E, role: 'fill', seg: 'earth', stand: [E[0] - 1, G + 1, E[2]], support: [E[0], G, E[2]], face: [0, 1, 0], order: -1 }, ...SITE.record.cells],
  segments: [{ seg: 'earth', deps: [] }, ...SITE.record.segments.map(sg => sg.seg === 'pad' ? { ...sg, deps: ['earth'] } : sg)],
  clear: [{ at: logAt, kind: 'tree', name: 'oak_log' }, { at: log2At, kind: 'tree', name: 'oak_log' }] }
/** R.STUCK_VISITS visits of the scene -> [[stop, cleared, stamped]] per visit. `hang`: every walk after the deferral stands (the live case). */
async function chain (Mod, { on = true, hang = false } = {}) {
  const srv = server({ ...sealedE(), [k3(logAt)]: 'oak_log', [k3(log2At)]: 'oak_log' }), pr = project(EARTH)
  const out = []
  for (let i = 0; i < R.STUCK_VISITS; i++) {
    const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, 'A', { inv: { ...KIT(), stone_bricks: 91 } })
    if (hang) {
      const walk0 = e.walkTo
      let release = null
      e.walkTo = async (st, o) => { if (!e.logs.some(([k, d]) => k === '_build' && d.op === 'deferred')) return walk0(st, o); await new Promise(resolve => { release = resolve }); return true }
      e.halt = () => release?.()
    }
    // the watch's tick is unref'd (it never holds a bot process open): the test keeps the loop alive while a walk hangs
    const keep = setInterval(() => {}, 1_000)
    let r
    try { r = await Promise.race([Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, clearsLast: true }, e, { maxSteps: 4000, stillVisit: on, stillCapMs: 150, stillTickMs: 20 }), new Promise(resolve => setTimeout(() => resolve({ stop: 'still running' }), 3_000))]) } finally { clearInterval(keep) }
    out.push([r.stop, r.cleared, Number.isFinite(PJ.stuckAt(pr.dir, pr.key))])
  }
  return out
}
const clearsGoOn = async Mod => {
  const off = await chain(Mod, { on: false }), on = await chain(Mod, { on: true })
  assert.ok(off.some(([, c]) => c > 0), `positive control: the switch-off visit clears the scaffold (${JSON.stringify(off)})`)
  assert.deepStrictEqual(on, off, 'on: the same clears, stops and stuck stamp, visit by visit, as off')
}
await t('a deferred fill with the scaffold still to clear: the clears happen and the stamp comes at the same visit as off', () => clearsGoOn(R))
await t('MUTANT pending clears not counted workable: the visit ends stuck_cells with the scaffold standing', () => killedBy(withMutant,
  ' || clearsPending())', ')', clearsGoOn, R))
const selfEndStamps = async Mod => {
  const off = await chain(Mod, { on: false })
  const stampOff = off.findIndex(([, , s]) => s)
  assert.ok(stampOff >= 0, `positive control: off stamps the back-off (${JSON.stringify(off)})`)
  const on = await chain(Mod, { on: true, hang: true })
  assert.ok(on.slice(0, -1).every(([st]) => st === 'stuck_cells'), `the hung visits end themselves (${JSON.stringify(on)})`)
  assert.strictEqual(on.findIndex(([, , s]) => s), stampOff, `the stuck stamp at the same visit as off (${JSON.stringify(on)} vs ${JSON.stringify(off)})`)
  assert.strictEqual(on[stampOff][0], 'stuck_on_cell', 'and that visit names its own hold')
}
await t('self-ended visits still advance the stuck map: stuck_on_cell and the project back-off at the same visit as off', () => selfEndStamps(R))
await t('MUTANT the self-ended visit settled as an early exit: the back-off never comes', () => killedBy(withMutant,
  '        const r = settleStuck(true)\n', '        const r = settleStuck(false)\n', selfEndStamps, R))

console.log('REVIEW r1 (Codex blocker 2): A PLACE OR DIG IN FLIGHT IS NEVER CUT')
// the sealed-X scene: X deferred first, then every placement's acknowledgement takes longer than the cap with the bot standing
const ackSlow = async Mod => {
  const srv = server(sealed()), pr = project(RECORD)
  const h = PJ.recordHead(pr.dir, pr.key), e = bot(srv, 'A', { inv: { ...KIT(), stone_bricks: 91 }, ack: () => 400 })
  const r = await Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 40, stillVisit: true, stillCapMs: 150, stillTickMs: 20 })
  assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'deferred'), 'positive control: the deferral happened')
  assert.ok(!e.logs.some(([k, d]) => k === '_build' && d.op === 'still_end'), `no cut while an acknowledgement is awaited (${r.stop})`)
  assert.notStrictEqual(r.stop, 'stuck_cells')
  assert.ok(r.placed >= 2, `the placements after the deferral landed and the visit went on (${r.placed})`)
}
await t('deferred, then each placement in flight past the cap: acknowledged, progress, the visit goes on', () => ackSlow(R))
await t('MUTANT the in-flight check dropped: the watch cuts an awaited acknowledgement', () => killedBy(withMutant,
  '    if (busy > 0) return false\n', '', ackSlow, R))
const digSlow = async Mod => {
  const srv = server({ ...sealedE(), [k3(logAt)]: 'oak_log', [k3(log2At)]: 'oak_log' }), pr = project(EARTH)
  const h = PJ.recordHead(pr.dir, pr.key)
  const e = bot(srv, 'A', { inv: { ...KIT(), stone_bricks: 91 }, dig: async c => { await new Promise(resolve => setTimeout(resolve, 400)); srv.set(c, 'air'); return 'confirmed' } })
  const r = await Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, clearsLast: true }, e, { maxSteps: 4000, stillVisit: true, stillCapMs: 150, stillTickMs: 20 })
  assert.ok(e.logs.some(([k, d]) => k === '_build' && d.op === 'deferred'), 'positive control: the deferral happened')
  assert.strictEqual(r.cleared, 2, 'both digs landed')
  assert.ok(!e.logs.some(([k, d]) => k === '_build' && d.op === 'still_end'), `no cut during the dig (${r.stop})`)
  assert.notStrictEqual(r.stop, 'stuck_cells')
}
await t('deferred, then a dig in flight past the cap that lands: not cut, not stuck_cells', () => digSlow(R))
await t('MUTANT the in-flight check dropped: the dig is cut', () => killedBy(withMutant,
  '    if (busy > 0) return false\n', '', digSlow, R))

console.log('REVIEW r2 (Codex): A WALK\'S OWN JUMP-APEX DIG, THROUGH THE REAL ADAPTER (buildbot.mjs botBuildEffects walkTo)')
const { botBuildEffects } = await import('../src/buildbot.mjs')
const { Vec3 } = await import('vec3')
const { EventEmitter } = await import('node:events')
// the reroof4 pit: feet 32,68,-71 on the pit floor, the planned path jumps up west onto the terrace under a listed natural leaf
const pit = new Map([['31,71,-71', 'spruce_leaves']])
const pitBlock = (x, y, z) => {
  const k = `${x},${y},${z}`
  if (pit.has(k)) return { name: pit.get(k), boundingBox: 'block', position: new Vec3(x, y, z), getProperties: () => ({ persistent: 'false' }) }
  if ((x <= 31 && y <= 68) || (x >= 32 && y <= 67)) return { name: 'stone', boundingBox: 'block', position: new Vec3(x, y, z), getProperties: () => ({}) }
  return { name: 'air', boundingBox: 'empty', position: new Vec3(x, y, z), getProperties: () => ({}) }
}
function apexBot (digMs) {
  const client = new EventEmitter(); client.write = () => {}
  const path = [{ x: 31.5, y: 69, z: -70.5 }, { x: 30.5, y: 69, z: -70.5 }]
  return {
    _client: client, registry: { blocksByStateId: { 0: { name: 'air' } } }, entity: { position: new Vec3(32.5, 68, -70.5) }, entities: {},
    blockAt: v => pitBlock(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)),
    dig: async blk => {
      await new Promise(resolve => setTimeout(resolve, digMs))
      pit.delete(`${blk.position.x},${blk.position.y},${blk.position.z}`)
      client.emit('packet', { location: blk.position, type: 0 }, { name: 'block_change' })
    },
    pathfinder: { movements: {}, setGoal: () => {}, goto: async () => {}, getPathFromTo: () => ({ next: () => ({ value: { result: { status: 'success', path } } }) }) },
  }
}
const apexInFlight = async Mod => {
  pit.set('31,71,-71', 'spruce_leaves')
  const rows = []
  const eff = botBuildEffects(apexBot(400), { log: (k, d) => rows.push([k, d]), apexDig: k => (k === '31,71,-71' ? 'spruce_leaves' : null) })
  const watch = Mod.stillWatch(eff, { on: true, capMs: 150, tickMs: 20 })
  try {
    watch.setWorkable(() => true)
    watch.e.log('_build', { op: 'deferred', cell: [0, 0, 0], n: 1 })
    const t0 = Date.now()
    await watch.e.walkTo([30, 69, -71])
    const tDone = Date.now()
    assert.ok(rows.some(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'leaves'), 'positive control: the apex leaf was dug and confirmed by the walk')
    assert.ok(tDone - t0 >= 380, `the dig crossed the cap (${tDone - t0} ms against 150)`)
    assert.strictEqual(watch.ended(), false, 'no end while the walk\'s dig was in flight')
    assert.strictEqual(watch.check(), false, 'its landed clear restarted the clock: not ended just after it')
    watch.e.log('_build', { op: 'deferred', cell: [0, 0, 0], n: 1 })
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.strictEqual(watch.check(), true, 'positive control: a fresh deferral with nothing after it ends at the cap')
  } finally { watch.stop(); eff.close?.() }
}
await t('deferral, then a jump-apex dig in the walk crossing the cap: no end until it settles, and its clear resets the clock', () => apexInFlight(R))
await t('MUTANT the walk\'s digs not seen: the watch ends during the apex dig', () => killedBy(withMutant,
  '    if ((Number(e.digsInFlight?.()) || 0) > 0) return false\n', '', apexInFlight, R))
await t('MUTANT the walk\'s landed clear not progress: ended right after it', () => killedBy(withMutant,
  '{ const wa = Number(e.walkWorkAt?.()) || 0; if (wa > progressAt) { progressAt = wa; if (wa >= stallAt) lastOp = null } }', '', apexInFlight, R))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

// BUILDWAIT-01 (codeeval 2026-11-06 phase 2.4): THE BUILD ENGINE'S INTENDED WAITS ARE DECLARED TO THE STUCK REFLEX. A bounded wait
// (an acknowledgement, a dig's server confirmation, a probe, the closer barrier, a body wait, the spawn quiet, a pillar step) sets
// bot.stationaryUntil for its own bound, capped STILL_ALLOW_MS after the visit's last progress; a WALK never does. Tested on the
// real effects (buildbot.mjs botBuildEffects) over a fake mineflayer bot, through the reflex's own pure decision (reflex.mjs
// stuckDecision, unchanged), and on the engine (buildrun.mjs) with fake effects that record every window. Controls at BUILDWAIT=0;
// mutants with their anchors asserted present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
const BB = await import('../src/buildbot.mjs')
const { stuckDecision } = await import('../src/reflex.mjs')
const { R, PJ, G, HOME, server, bot: fakeEffects, withMutant } = await import('./helpers/buildfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 8).join('\n        ')}`) } }
const withEnv = async (vars, fn) => {
  const was = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]))
  Object.assign(process.env, vars)
  try { return await fn() } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
}

// ---- the window (pure) --------------------------------------------------------------------------------------------------------
console.log('THE WINDOW (buildbot.mjs stillUntil)')
await t('bounded by the wait, by STILL_ALLOW_MS after the last progress, never shorter than another skill\'s window; nothing once the allowance is spent', () => {
  const now = 1_000_000
  assert.strictEqual(BB.stillUntil({ now, ms: 5_000, lastProgress: now }), now + 5_000)
  assert.strictEqual(BB.stillUntil({ now, ms: 90_000, lastProgress: now }), now + BB.STILL_ALLOW_MS, 'a long wait is cut at the allowance')
  assert.strictEqual(BB.stillUntil({ now, ms: 5_000, lastProgress: now - BB.STILL_ALLOW_MS + 1_000 }), now + 1_000, 'the allowance runs from the last progress')
  assert.strictEqual(BB.stillUntil({ now, ms: 5_000, lastProgress: now - BB.STILL_ALLOW_MS }), null, 'spent: no window')
  assert.strictEqual(BB.stillUntil({ now, ms: 5_000, lastProgress: now, prev: now + 40_000 }), now + 40_000, 'another skill\'s longer window stands')
})
await t('the switch: BUILDWAIT=0|off|false|no is the rollback; unset is on', () => {
  for (const v of ['0', 'off', 'false', 'no']) assert.strictEqual(BB.buildWaitOn({ BUILDWAIT: v }), false, v)
  for (const v of [undefined, '', '1']) assert.strictEqual(BB.buildWaitOn({ BUILDWAIT: v }), true, String(v))
})

// ---- the real effects over a fake mineflayer bot --------------------------------------------------------------------------------
console.log('THE EFFECTS (botBuildEffects on a fake mineflayer bot)')
function mfBot () {
  const client = new EventEmitter(); client.write = () => {}
  let pos = { x: 0.5, y: 70, z: 0.5 }
  const b = {
    _client: client, entity: { position: { ...pos, distanceTo: () => 0, clone () { return this } }, onGround: true },
    registry: { blocksByStateId: { 0: { name: 'air' } } }, inventory: { items: () => [], slots: [] }, heldItem: null,
    stationaryUntil: 0, targetDigBlock: null, entities: {},
    blockAt: () => ({ name: 'dirt', boundingBox: 'block' }),
    dig: async () => { b.targetDigBlock = null },
    pathfinder: { movements: {}, goto: async () => { b.seenDuringWalk = b.stationaryUntil }, setGoal: () => {}, getPathFromTo: () => null },
    setControlState: () => {}, lookAt: async () => {}, equip: async () => {}, swingArm: () => {},
  }
  return b
}
const acksFake = (waitMs = 50) => {
  const seen = { during: [] }
  return { seen, acks: { tracker: { next: () => 1, acked: 0, wait: async (seq, ms) => { seen.during.push(seen.bot.stationaryUntil); await new Promise(r => setTimeout(r, waitMs)); return 'acked' } }, track: () => {}, untrack: () => {}, seen: () => ({}), conn: 'c1', stop: () => {} } }
}
await t('an acknowledgement wait declares its window and releases it; a walk declares none', async () => {
  const b = mfBot(), { seen, acks } = acksFake(); seen.bot = b
  const fx = BB.botBuildEffects(b, { acks })
  const t0 = Date.now()
  await fx.waitAck(1, 5_000)
  assert.ok(seen.during[0] >= t0 + 5_000 && seen.during[0] <= Date.now() + 5_300, `declared for the wait's bound (${seen.during[0] - t0})`)
  assert.strictEqual(b.stationaryUntil, 0, 'released on exit')
  await fx.walkTo([3, 70, 3])
  assert.strictEqual(b.seenDuringWalk, 0, 'a walk is never declared')
  assert.strictEqual(fx.current().op, 'walk', 'the trace names the walk')
  fx.close()
})
await t('a dig\'s server confirmation is declared (and the confirmed dig is progress); another skill\'s window is restored, never cleared', async () => {
  const b = mfBot(), { acks } = acksFake()
  const fx = BB.botBuildEffects(b, { acks })
  let during = null
  const wait0 = fx.within
  const longer = Date.now() + 120_000
  b.stationaryUntil = longer
  const r = await fx.dig([1, 70, 1], 'dirt')   // the fake server never answers: 'unconfirmed' after DIG_CONFIRM_MS, inside the window
  assert.strictEqual(r, 'unconfirmed')
  assert.strictEqual(b.stationaryUntil, longer, 'the other skill\'s longer window stands')
  b.stationaryUntil = 0
  setTimeout(() => { during = b.stationaryUntil }, 200)
  await fx.dig([1, 70, 1], 'dirt')
  assert.ok(during > Date.now(), 'declared during the confirmation')
  assert.strictEqual(b.stationaryUntil, 0)
  assert.strictEqual(typeof wait0, 'function')
  fx.close()
})
await t('THROUGH THE REFLEX\'S OWN DECISION: a 40 s barrier at 0.5 s ticks is not fired on; the same wait undeclared (BUILDWAIT=0) is; a walk still is', async () => {
  const run = (declare) => {
    const T0 = 1_000_000, STUCK = 35_000
    let still = T0, fired = null
    const until = declare ? BB.stillUntil({ now: T0, ms: 41_000, lastProgress: T0 }) : 0
    for (let now = T0; now <= T0 + 40_000; now += 500) {
      const d = stuckDecision({ busy: true, stationaryUntil: until, now, stillSince: still, stuckMs: STUCK })
      if (d.reset) still = now
      if (d.fire && fired == null) fired = now - T0
    }
    return fired
  }
  assert.strictEqual(run(true), null, 'the declared barrier is never fired on')
  assert.ok(run(false) > 35_000, 'CONTROL: undeclared, the stuck reflex fires at 35 s')
  // the allowance: a wait that starts 60 s after the last progress declares nothing -- the reflex keeps its 35 s
  assert.strictEqual(BB.stillUntil({ now: 1_000_000, ms: 41_000, lastProgress: 1_000_000 - BB.STILL_ALLOW_MS }), null)
})
await t('BUILDWAIT=0: no window is ever written', () => withEnv({ BUILDWAIT: '0' }, async () => {
  const b = mfBot(), { seen, acks } = acksFake(); seen.bot = b
  const fx = BB.botBuildEffects(b, { acks })
  await fx.waitAck(1, 5_000)
  assert.deepStrictEqual(seen.during, [0])
  fx.close()
}))
await t('MUTANT KILLED: the ack wait undeclared (anchor asserted unique)', async () => {
  const src = fs.readFileSync(new URL('../src/buildbot.mjs', import.meta.url), 'utf8')
  const old = "    waitAck: (seq, ms) => within('ack', ms + 250, () => A.tracker.wait(seq, ms)),"
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const f = new URL(`../src/.mut-buildwait-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(f, src.replace(old, '    waitAck: (seq, ms) => A.tracker.wait(seq, ms),'))
  try {
    const M = await import(f.href)
    const b = mfBot(), { seen, acks } = acksFake(); seen.bot = b
    const fx = M.botBuildEffects(b, { acks })
    await fx.waitAck(1, 5_000)
    assert.deepStrictEqual(seen.during, [0], 'the mutant declares nothing')
    fx.close()
  } finally { fs.unlinkSync(f) }
})

// ---- the engine (buildrun.mjs) with recording effects ----------------------------------------------------------------------------
console.log('THE ENGINE (buildrun.mjs waits through e.within; the abort row)')
const PAL = { wall: ['cobblestone'] }
function projectOf (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/buildwait-`)
  const key = PJ.projKey(HOME, 'wall')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'A', 3)
  return { dir, key, p: (x = {}) => ({ dir, key, me: 'A', home: HOME, stood: [], record, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen, stands: { pending: null, bans: {} }, blockLayer: false, domain: () => true, walkR: 40, ...x }) }
}
const recording = e => { const ops = []; e.within = async (op, ms, fn) => { ops.push([op, ms]); return fn() }; e.progress = () => ops.push(['progress']); return ops }
await t('the spawn quiet goes through e.within with its bound; every placement is progress', async () => {
  const scenario = async M => {
    const srv = server(), C = [10, G + 1, 10]
    const r = { v: 1, plot: 'wall', cells: [{ at: C, role: 'wall', seg: 'W-00' }], clear: [{ at: [12, G + 1, 10], name: 'dirt', kind: 'cut' }], replant: [], segments: [{ seg: 'W-00', deps: [] }] }
    srv.set([12, G + 1, 10], 'dirt')
    const pr = projectOf(r), e = fakeEffects(srv, 'A', { inv: { cobblestone: 8 } })
    e.spawnedAt = () => Date.now()          // just spawned: the dig waits the quiet first
    const ops = recording(e)
    await M.runVisit(pr.p(), e, { maxSteps: 100 })
    assert.ok(ops.some(([op, ms]) => op === 'spawn_quiet' && ms === R.SPAWN_DIG_QUIET_MS + 500), JSON.stringify(ops))
    assert.ok(ops.some(([op]) => op === 'progress'), 'the placement is progress')
  }
  await scenario(R)
  let why = null
  await withMutant("await waitStill('spawn_quiet', SPAWN_DIG_QUIET_MS + 500, () => e.sleep(SPAWN_DIG_QUIET_MS))", 'await e.sleep(SPAWN_DIG_QUIET_MS)', async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, 'the mutant (the quiet undeclared) is killed')
})
await t('an ABORTED visit names the engine\'s operation in flight (`_build op=interrupted kind=<op> why=<s>`)', async () => {
  const srv = server(), C = [10, G + 1, 10]
  const r = { v: 1, plot: 'wall', cells: [{ at: C, role: 'wall', seg: 'W-00' }], clear: [], replant: [], segments: [{ seg: 'W-00', deps: [] }] }
  const pr = projectOf(r)
  let ab = false
  const e = fakeEffects(srv, 'A', { inv: { cobblestone: 8 }, aborted: () => ab })
  e.current = () => ({ op: 'walk', cell: [9, G + 1, 10], ms: 36_000 })
  const w = e.walkTo; e.walkTo = async s => { ab = true; return w(s) }
  await R.runVisit(pr.p(), e, { maxSteps: 100 }).catch(() => null)
  const row = e.logs.find(([k, d]) => k === '_build' && d.op === 'interrupted')
  assert.ok(row, 'the row'); assert.deepStrictEqual([row[1].kind, row[1].why], ['walk', '36s'])
  const e2 = fakeEffects(srv, 'A', { inv: { cobblestone: 8 } }); e2.current = () => ({ op: 'walk', ms: 1 })
  await R.runVisit(projectOf(r).p(), e2, { maxSteps: 100 })
  assert.ok(!e2.logs.some(([k, d]) => k === '_build' && d.op === 'interrupted'), 'CONTROL: a visit that is not aborted writes none')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

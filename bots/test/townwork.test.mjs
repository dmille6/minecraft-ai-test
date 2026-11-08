// WORKBOARD-01 (codeeval phase 3 item 1, phase A): THE TOWN WORK BOARD. Behaviour on the pure rules (townwork.mjs), the chain on
// real record and lease files (skills.mjs shopActiveAll + boardClaim + the pin), the refusal chain (every refusal ends in a back-off
// with a deadline; the gate's memory is asked before an order is issued), the wiring of the protected hook (structural: comments
// stripped, anchored on executable lines), and anchored mutants that must change the behaviour.
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-townwork-logs-'))
process.env.BOT_NAME = 'BoardBot'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'showcase'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-townwork-pool-'))
for (const k of ['MONUMENT', 'MONUMENT_POOLS', 'HOUSE', 'PATHS', 'PATHS_POOLS', 'WALL', 'WALL_POOLS', 'BUILDNEXT', 'BUILDNEXT_BREAKER', 'WORKBOARD']) delete process.env[k]
process.env.SHAFT = 'off'
process.env.TIDY = 'off'
process.env.TREEFARM = 'off'
process.env.STARVE = 'off'

const TW = await import('../src/townwork.mjs')
const SK = await import('../src/skills.mjs')
const PJ = await import('../src/buildproj.mjs')
const NOW = 1_800_000_000_000
const W = TW.WB
const OK_TOWN = { ok: true, why: 'at_town', travel: false }
const OK_WALK = { ok: true, why: 'travel', travel: true }
const JOB = { plot: 'monument', workable: true, why: 'ok', starved: false, cands: 1 }

// ---- the switch -------------------------------------------------------------------------------------------------------------------
test('workboardMode: on by default (the variant is the change); off/0/false/no roll back; shadow logs only', () => {
  assert.equal(TW.workboardMode({}), 'on')
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.equal(TW.workboardMode({ WORKBOARD: v }), 'off', v)
  assert.equal(TW.workboardMode({ WORKBOARD: 'shadow' }), 'shadow')
  assert.equal(TW.workboardMode({ WORKBOARD: '1' }), 'on')
})

// ---- what a job is ----------------------------------------------------------------------------------------------------------------
test('jobBlocked: an open, free project is a job; complete / stuck / unsited / held / full / the stair are not, each with its reason', () => {
  const st = (o = {}) => ({ plot: 'monument', exists: true, complete: false, damaged: false, ...o })
  assert.equal(TW.jobBlocked(st()), null)
  assert.equal(TW.jobBlocked(st({ free: true })), null)
  assert.equal(TW.jobBlocked({ plot: 'wall', exists: false }), null, 'an unsited project with no stamp: the visit sites it')
  assert.equal(TW.jobBlocked(st({ complete: true, damaged: true })), null, 'a repair is work')
  assert.equal(TW.jobBlocked(st({ complete: true, due: true })), null, 'due upkeep is work')
  assert.equal(TW.jobBlocked(st({ complete: true })), 'complete')
  assert.equal(TW.jobBlocked(st({ free: false, stuck: true })), 'stuck')
  assert.equal(TW.jobBlocked({ plot: 'wall', exists: false, free: false, unsited: true }), 'unsited')
  assert.equal(TW.jobBlocked(st({ free: false, nextHeld: 'repeat' })), 'held_repeat')
  assert.equal(TW.jobBlocked(st({ free: false })), 'full')
  assert.equal(TW.jobBlocked({ plot: 'shaft', exists: true, complete: false }), 'skip_plot', 'phase A never dispatches the stair')
  assert.equal(TW.jobBlocked(null), 'no_state')
})
test('boardJob: the pick is the job when workable; a held pick is no job (with why); cands counts the workable states', () => {
  const states = [{ plot: 'shop', exists: true, complete: true }, { plot: 'monument', exists: true, complete: false, free: false, stuck: true }, { plot: 'wall', exists: true, complete: false }]
  assert.deepEqual(TW.boardJob({ plot: 'wall' }, states), { plot: 'wall', workable: true, why: 'ok', starved: false, cands: 1 })
  const held = TW.boardJob({ plot: 'monument' }, states)
  assert.equal(held.workable, false); assert.equal(held.why, 'stuck')
  assert.equal(TW.boardJob(null, states).why, 'no_pick')
  assert.equal(TW.boardJob({ plot: 'wall' }, [{ plot: 'wall', exists: true, starved: true }]).starved, true)
})

// ---- the bot's fitness ------------------------------------------------------------------------------------------------------------
test('boardEligible: only a grounds lap; holds, health, bag room (light 2 / heavy 8), depth; at town / a walk / too far / walk back-off', () => {
  const base = { lap: true, health: 20, freeSlots: 20, light: true, dist: 10, dy: 0, now: NOW }
  assert.deepEqual(TW.boardEligible(base), { ok: true, why: 'at_town', travel: false })
  assert.equal(TW.boardEligible({ ...base, lap: false }).why, 'not_grounds_lap')
  assert.equal(TW.boardEligible({ ...base, holds: true }).why, 'milestone_holds')
  assert.equal(TW.boardEligible({ ...base, health: W.healthMin }).why, 'health')
  assert.equal(TW.boardEligible({ ...base, freeSlots: 1 }).why, 'room')
  assert.equal(TW.boardEligible({ ...base, freeSlots: 2 }).ok, true, 'a light plot needs 2 free')
  assert.equal(TW.boardEligible({ ...base, light: false, freeSlots: 7 }).why, 'room', 'a heavy plot needs 8 free')
  assert.equal(TW.boardEligible({ ...base, dy: -(W.dyMax + 1) }).why, 'depth', 'an underground bot is not walked home by the board')
  assert.equal(TW.boardEligible({ ...base, dist: Infinity }).why, 'no_position')
  assert.deepEqual(TW.boardEligible({ ...base, dist: W.townR + 1 }), { ok: true, why: 'travel', travel: true })
  assert.equal(TW.boardEligible({ ...base, dist: W.travelMax + 1 }).why, 'too_far')
  assert.equal(TW.boardEligible({ ...base, dist: 80, travelHeldUntil: NOW + 1 }).why, 'travel_backoff')
  assert.equal(TW.boardEligible({ ...base, dist: 20, travelHeldUntil: NOW + 1 }).ok, true, 'the walk back-off never stops work at town')
})

// ---- the step ---------------------------------------------------------------------------------------------------------------------
test('boardStep: at town -> build_shop; away -> home; both carry the job; the board owns the workshop slot for its population', () => {
  const a = TW.boardStep({ mode: 'on', elig: OK_TOWN, job: JOB, now: NOW })
  assert.equal(a.order.skill, 'build_shop'); assert.deepEqual(a.order.args, {}); assert.deepEqual(a.order.board, { plot: 'monument', travel: false }); assert.equal(a.owns, true)
  const b = TW.boardStep({ mode: 'on', elig: OK_WALK, job: JOB, now: NOW })
  assert.equal(b.order.skill, 'home'); assert.equal(b.order.board.travel, true)
})
test('boardStep: the chain stands as before when off, not a grounds lap, or the town unreadable (owns false); shadow issues nothing', () => {
  assert.deepEqual(TW.boardStep({ mode: 'off', elig: OK_TOWN, job: JOB }), { order: null, owns: false, why: 'off' })
  assert.equal(TW.boardStep({ mode: 'on', elig: { ok: false, why: 'not_grounds_lap' }, job: JOB }).owns, false)
  assert.equal(TW.boardStep({ mode: 'on', elig: OK_TOWN, job: null }).owns, false, 'no town read: the shop step decides')
  const s = TW.boardStep({ mode: 'shadow', elig: OK_TOWN, job: JOB, now: NOW })
  assert.equal(s.order, null); assert.equal(s.owns, false); assert.equal(s.why, 'shadow:build_shop')
})
test('boardStep: no workable job, a job in back-off, or a refusal the gate\'s memory would give -> NO order (the model decides), board owns', () => {
  const nj = TW.boardStep({ mode: 'on', elig: OK_TOWN, job: { ...JOB, workable: false, why: 'stuck' }, now: NOW })
  assert.equal(nj.order, null); assert.equal(nj.owns, true); assert.equal(nj.why, 'no_job:stuck')
  const held = TW.boardStep({ mode: 'on', elig: OK_TOWN, job: JOB, mem: { jobs: { monument: { n: 1, until: NOW + 5 } } }, now: NOW })
  assert.equal(held.order, null); assert.equal(held.why, 'job_backoff')
  for (const r of ['cooldown', 'learned_avoid', 'repeat_loop']) {
    const asked = []
    const x = TW.boardStep({ mode: 'on', elig: OK_WALK, job: JOB, now: NOW, refuses: (sk, a) => { asked.push([sk, a]); return r } })
    assert.equal(x.order, null, r); assert.equal(x.why, `refused:${r}`); assert.deepEqual(asked, [['home', {}]], 'asked for the order it would issue')
  }
  assert.equal(TW.boardStep({ mode: 'on', elig: OK_TOWN, job: JOB, now: NOW, refuses: () => { throw new Error('x') } }).order, null, 'a failed read issues nothing')
})

// ---- after the order --------------------------------------------------------------------------------------------------------------
test('boardAfter: work clears the job (the next visit may follow at once); empty visits back off 2 / 10 / 30 / 30 min; never mutates', () => {
  const m0 = { jobs: {}, travelUntil: 0 }
  let o = TW.boardAfter(m0, { plot: 'monument', r: { status: 'no_effect', placed: 0 }, now: NOW })
  assert.equal(o.backoffMs, W.emptyMs[0]); assert.equal(TW.boardHeld(o.mem, 'monument', NOW + 1), NOW + W.emptyMs[0])
  assert.deepEqual(m0, { jobs: {}, travelUntil: 0 }, 'pure')
  o = TW.boardAfter(o.mem, { plot: 'monument', r: { status: 'failed' }, now: NOW }); assert.equal(o.backoffMs, W.emptyMs[1])
  o = TW.boardAfter(o.mem, { plot: 'monument', r: { status: 'no_effect' }, now: NOW }); assert.equal(o.backoffMs, W.emptyMs[2])
  o = TW.boardAfter(o.mem, { plot: 'monument', r: { status: 'no_effect' }, now: NOW }); assert.equal(o.backoffMs, W.emptyMs[2], 'capped')
  const w = TW.boardAfter(o.mem, { plot: 'monument', r: { status: 'no_effect', placed: 3 }, now: NOW })
  assert.equal(w.worked, true); assert.equal(w.backoffMs, 0); assert.equal(TW.boardHeld(w.mem, 'monument', NOW), null, 'placed blocks are work')
  assert.equal(TW.boardAfter(m0, { plot: 'wall', r: { status: 'success' }, now: NOW }).worked, true)
})
test('boardAfter: a refused or declined order backs its job (or the walk) off; a walk that did not arrive holds every board walk 30 min', () => {
  const m0 = { jobs: {}, travelUntil: 0 }
  const rf = TW.boardAfter(m0, { plot: 'monument', refused: true, now: NOW })
  assert.equal(TW.boardHeld(rf.mem, 'monument', NOW), NOW + W.declineMs)
  const dw = TW.boardAfter(m0, { plot: 'monument', travel: true, declined: true, now: NOW })
  assert.equal(dw.mem.travelUntil, NOW + W.declineMs); assert.equal(TW.boardHeld(dw.mem, 'monument', NOW), null)
  const na = TW.boardAfter(m0, { plot: 'monument', travel: true, arrived: false, now: NOW })
  assert.equal(na.mem.travelUntil, NOW + W.travelFailMs)
  const ar = TW.boardAfter(m0, { plot: 'monument', travel: true, arrived: true, now: NOW })
  assert.equal(ar.backoffMs, 0); assert.equal(ar.mem.travelUntil, 0)
})

// ---- THE REFUSAL CHAIN (CLAUDE.md: a refusal must name a remedy the bot can perform; two guards must not compose a dead end) ---------
test('CHAIN: every way a board order can fail leaves the bot to the model within the tick and re-offers the job only after a deadline', () => {
  let mem = { jobs: {}, travelUntil: 0 }
  let now = NOW
  const step = (o = {}) => TW.boardStep({ mode: 'on', elig: OK_TOWN, job: JOB, mem, now, ...o })
  const seen = []
  for (let lap = 0; lap < 40; lap++) {
    const s = step()
    seen.push(s.order ? 'issue' : s.why)
    if (s.order) mem = TW.boardAfter(mem, { plot: 'monument', r: { status: 'no_effect', placed: 0 }, now }).mem   // always empty
    now += 30_000
  }
  const issues = seen.filter(x => x === 'issue').length
  assert.ok(issues >= 2 && issues <= 4, `an always-empty job is re-offered only after its back-offs (${issues} in 20 min)`)
  assert.ok(seen.every(x => x === 'issue' || x === 'job_backoff'), 'every other tick is the model\'s (no order)')
  // the walk: a walk that never arrives is tried once, then the bot is ineligible to walk for travelFailMs -> the model's
  mem = { jobs: {}, travelUntil: 0 }; now = NOW
  const s1 = TW.boardStep({ mode: 'on', elig: OK_WALK, job: JOB, mem, now })
  assert.equal(s1.order.skill, 'home')
  mem = TW.boardAfter(mem, { plot: 'monument', travel: true, arrived: false, now }).mem
  const e2 = TW.boardEligible({ lap: true, health: 20, freeSlots: 20, light: true, dist: 90, dy: 0, travelHeldUntil: mem.travelUntil, now: now + 60_000 })
  assert.equal(e2.ok, false); assert.equal(e2.why, 'travel_backoff')
  assert.equal(TW.boardStep({ mode: 'on', elig: e2, job: JOB, mem, now: now + 60_000 }).owns, false, 'not eligible: the chain as before (the model)')
})

// ---- rows -------------------------------------------------------------------------------------------------------------------------
test('boardDetail / rowDue: fixed-order key=value detail (effectwatch generic keys `_workboard:op:issue`); one yield row per reason per 10 min', () => {
  assert.equal(TW.boardDetail({ op: 'issue', skill: 'home', plot: 'monument', dist: 70, why: 'issue:home' }), 'op=issue skill=home plot=monument why=issue:home dist=70')
  assert.equal(TW.boardDetail({ op: 'end', worked: 'yes', placed: 0 }), 'op=end placed=0 worked=yes')
  let r = TW.rowDue({}, 'yield:x', NOW); assert.equal(r.emit, true)
  r = TW.rowDue(r.last, 'yield:x', NOW + 1000); assert.equal(r.emit, false)
  assert.equal(TW.rowDue(r.last, 'yield:y', NOW + 1000).emit, true)
  assert.equal(TW.rowDue(r.last, 'yield:x', NOW + W.rowEveryMs).emit, true)
})

// ---- the chain on real files (skills.mjs shopActiveAll + boardClaim + the pin) ----------------------------------------------------------
const dir = () => process.env.POOL_STATE_DIR
const HOME = { x: 0, y: 70, z: 0 }
const key = plot => PJ.projKey(HOME, plot)
const rec = (plot, blueprint, complete) => assert.equal(PJ.publishRecord(dir(), key(plot), () => ({ v: 1, blueprint, plot, cells: [{ at: [0, 0, 0], role: 'base', seg: 'a' }], segments: [{ seg: 'a', deps: [] }], structure_complete: complete, ...(complete ? { completeAt: 1 } : {}) })).result, 'accepted')
const bot = name => ({ username: name, blockAt: () => null, entity: { position: { x: 0, y: 70, z: 0 } }, inventory: { items: () => [] } })
let ready = false
const setup = () => { if (ready) return; ready = true; rec('shop', 'workshop@1', true); rec('house1', 'house@1', true); rec('paths', 'paths@1', true); rec('monument', 'ziggurat@1', false); rec('wall', 'wall@1', false) }

test('REAL FILES: the job is shopActive\'s pick with its marked states; a traveller\'s claim fills a slot, so the next bot\'s job moves on', async () => {
  setup()
  const { MONUMENT_BUILDERS } = await import('../src/ziggurat.mjs')
  const now = Date.now()
  const a = SK.shopActiveAll(bot('A1'), now)
  assert.equal(a.pick.plot, 'monument', 'control: the first open project')
  assert.ok(Array.isArray(a.states) && a.states.some(s => s.plot === 'wall'), 'the states it chose from')
  assert.equal(TW.boardJob(a.pick, a.states).workable, true)
  const claims = []
  for (let i = 0; i < MONUMENT_BUILDERS; i++) { const c = SK.boardClaim(bot(`C${i}`), 'monument', now); assert.equal(c.ok, true, `claim ${i}`); claims.push(c) }
  const late = SK.shopActiveAll(bot('Late'), now + 1)
  assert.equal(late.pick.plot, 'wall', 'every monument slot is claimed by travellers: the next bot is sent to the wall, not herded')
  assert.equal(SK.boardClaim(bot('Late'), 'monument', now + 1).ok, false, 'and cannot claim a monument slot')
  assert.equal(SK.shopActiveAll(bot('C0'), now + 2).pick.plot, 'monument', 'a claimant still sees its own job (its slot is its own)')
  SK.boardRelease(bot('C0'), 'monument', claims[0])
  assert.equal(SK.shopActiveAll(bot('Late'), now + 3).pick.plot, 'monument', 'a released claim frees the slot at once')
  for (let i = 1; i < claims.length; i++) SK.boardRelease(bot(`C${i}`), 'monument', claims[i])
})
test('REAL FILES: the pin holds the visit on the claimed project while it is workable and fresh, and never past its ttl', () => {
  setup()
  const now = Date.now()
  const b = bot('Pinned')
  assert.equal(SK.shopActive(b, now).plot, 'monument', 'control')
  SK.boardPin(b, 'wall', now)
  assert.equal(SK.shopActive(b, now + 1).plot, 'wall', 'pinned: the visit builds the job it walked to')
  assert.equal(SK.shopActive(b, now + W.claimTtlMs + 1).plot, 'monument', 'a stale pin is ignored')
  SK.boardPin(b, 'shop', now)
  assert.equal(SK.shopActive(b, now + 1).plot, 'monument', 'a pin on a project that is no job (complete) is ignored')
  SK.boardPin(b, null, now)
  assert.equal(b.boardPick, null)
})

// ---- the protected hook (structural: behaviour cannot reach #tick without a live bot) -----------------------------------------------
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const COG = strip(fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
test('WIRING (cognitive.mjs): the board runs before the workshop step, the step stands down when the board owns, refusals and outcomes reach boardAfter', () => {
  const hook = "if (!order && this.wbMode !== 'off') {"
  const shop = 'if (!order && SHOP.on && !boardOwns) {'
  for (const s of [hook, shop]) assert.equal(COG.split(s).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${s}`)
  assert.ok(COG.indexOf(hook) < COG.indexOf(shop), 'the board decides before the workshop step')
  assert.equal(COG.split('if (!check.ok && order?.board) this.#boardAfter(order, null, { refused: true })').length, 2, 'a refused board order is backed off')
  assert.equal(COG.split('if (order?.board && admitted.skill === order.skill) this.#boardAfter(order, r, { declined })').length, 2, 'its outcome is read')
  assert.ok(/refuses: \(s, a\) => this\.admission\.memoryRefuses\(s, a\)/.test(COG), 'the gate\'s memory is asked before an order is issued')
  assert.ok(/startsWith\('idle_work'\) && groundsBatchOpen\(\)/.test(COG), 'phase A population: a grounds lap of the idle_work rung')
})

// ---- anchored mutants (each anchor present and unique; each must change behaviour) ---------------------------------------------------
async function withMutant (rel, old, neu, fn) {
  const p = new URL(rel, import.meta.url)
  const src = fs.readFileSync(p, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${old.slice(0, 70)}`)
  const out = new URL(`./_mutant-townwork-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch { /* gone */ } }
}
test('MUTANT KILLED: without the memoryRefuses pre-check the board issues an order the gate will refuse (a veto spent every lap)', async () => {
  await withMutant('../src/townwork.mjs', '  if (r) return { order: null, owns: true, why: `refused:${r}` }\n', '', M => {
    const x = M.boardStep({ mode: 'on', elig: OK_TOWN, job: JOB, now: NOW, refuses: () => 'repeat_loop' })
    assert.ok(x.order, 'the mutant issues into the refusal')
  })
})
test('MUTANT KILLED: without the job back-off an always-empty job is re-issued every tick', async () => {
  await withMutant('../src/townwork.mjs', "  if (boardHeld(mem, job.plot, now) != null) return { order: null, owns: true, why: 'job_backoff' }\n", '', M => {
    let mem = { jobs: {}, travelUntil: 0 }, n = 0
    for (let i = 0; i < 10; i++) { const s = M.boardStep({ mode: 'on', elig: OK_TOWN, job: JOB, mem, now: NOW + i * 30_000 }); if (s.order) { n++; mem = M.boardAfter(mem, { plot: 'monument', r: { status: 'no_effect' }, now: NOW + i * 30_000 }).mem } }
    assert.equal(n, 10, 'every tick')
  })
})
test('MUTANT KILLED: a walk that did not arrive without its back-off sends the bot home again at once', async () => {
  await withMutant('../src/townwork.mjs', '    if (!arrived) { m.travelUntil = now + W.travelFailMs; return { mem: m, backoffMs: W.travelFailMs, worked: false } }\n', '', M => {
    const o = M.boardAfter({ jobs: {}, travelUntil: 0 }, { plot: 'monument', travel: true, arrived: false, now: NOW })
    assert.equal(o.mem.travelUntil, 0)
    assert.equal(M.boardEligible({ lap: true, health: 20, freeSlots: 20, light: true, dist: 90, travelHeldUntil: o.mem.travelUntil, now: NOW + 1 }).ok, true)
  })
})
test('MUTANT KILLED: without the stair skip the board would dispatch shaft excavation', async () => {
  await withMutant('../src/townwork.mjs', "export const BOARD_SKIP_PLOTS = Object.freeze(new Set(['shaft']))", 'export const BOARD_SKIP_PLOTS = Object.freeze(new Set([]))', M => {
    assert.equal(M.jobBlocked({ plot: 'shaft', exists: true, complete: false }), null)
  })
})
test('MUTANT KILLED (skills.mjs): without the pin the visit re-picks and builds a project other than the one it walked to', async () => {
  setup()
  await withMutant('../src/skills.mjs', '      if (sp && st && jobBlocked(st) == null) pick = sp\n', '', M => {
    const b = bot('PinMut'), now = Date.now()
    M.boardPin(b, 'wall', now)
    assert.equal(M.shopActive(b, now + 1).plot, 'monument', 'the mutant ignores the pin')
  })
})

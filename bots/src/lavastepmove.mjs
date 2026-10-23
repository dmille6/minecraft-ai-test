// LAVASTEP-01: THE EXECUTOR for lavastep.mjs's decision (F1, docs/reports/mineshaft-safety-2026-10-23.md §7).
//
// ONE MOVE AT A TIME, OWNED (design "Body control"):
//   - a PRIORITY RUNNER RESERVATION: runner.reserve('lavastep', MOVE_MS, 'danger_block') aborts the running skill and
//     declines every other run (`runner_reserved`), the model's danger_block decision included; the watchdog's and
//     poolescape's reserve() are REFUSED while it lives (runner.mjs), so their pending runs decline;
//   - a GENERATION TOKEN { gen, deadline }: after EVERY await and before EVERY control write or look the executor checks
//     gen, deadline, alive and air ownership; any mismatch ends the move at once. `moving()` -- what every arm, the
//     in-flight guard and the next firing ask -- ENDS the move synchronously when that check fails, so the move never
//     outlives its ownership by a re-assertion period (Codex + Claude code r1);
//   - RE-ASSERTION every REASSERT_MS while the gen is its own: the pathfinder goal is cleared (haltPath), the move's
//     controls (every movement control: the ones it does not use are held false) and look are set again -- a late skill
//     unwind that clears controls, or a lookAt inside an unwinding dig, is overridden within 50 ms;
//   - AIR PREEMPTION: the air rescue (drowning rescue, air pocket) outranks the move. If it holds the body at a firing the
//     move does not start; if it takes the body during one, the move ends WITHOUT touching the controls (the rescue's
//     stroke is the rescue's), and a relaxation's sneak is dropped. "The only water reflex is getting air" is unchanged.
//   - IN-FLIGHT DIGS AND PLACES: stopDigging() at the start; attachLavastepGuard (index.mjs, outermost) refuses bot.dig
//     and bot._genericPlace while the move lives, except the move's own seal (a one-shot token).
// EVERY FIRING WRITES ONE `_lava_retreat` ROW whose args carry every cell each decision read (lavastep.recordingAt), the
// candidates with reject reasons, the plan, the seal with its inputs (the seal items held, the item in hand at the place,
// the witnessing update), each aim's own full observation, each control write with its time and phase, the `after` state
// at +1.5 s and the `end` state -- the read (scripts/host/lavastepread.py) recomputes every gate from those inputs.
import { Vec3 } from 'vec3'
import { haltPath } from './pathhalt.mjs'
import { dangerCase, dangerMove, recordingAt, aimScores, chooseBearing, stepPlan, yawOf, stuckRelax, DANGER, WET, SEAL_ITEMS,
         REPLACEABLE, MOVE_MS, STEP_IN_MS, STEP_EDGE_MS, AIM_MS, SEAL_WITNESS_MS, REASSERT_MS, ARRIVE_R, RELAX_MS, STUCK_FIRINGS } from './lavastep.mjs'

export const GROUND_EVERY_MS = 2500    // one ground firing per 2.5 s (today's cadence)
export const AIR_EVERY_MS = 450        // one airborne firing per reflex tick (500 ms) until the bot lands
export const AFTER_MS = 1500           // the row's `after` state: +1.5 s from the firing
export const EPISODE_GAP_MS = 30_000   // firings no more than 30 s apart are one episode (the design's episode definition)
const MOVEMENT = ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'sneak']

const fl = v => Math.floor(v)
const cellOf = p => [fl(p.x), fl(p.y), fl(p.z)]
const rel = (c, o) => [c[0] - o[0], c[1] - o[1], c[2] - o[2]]
const r2 = v => Math.round(v * 100) / 100

/**
 * makeDangerMover(bot, runner, opts) -> { maybeFire, moving, effective, tick, takeSealToken, state }
 *   opts.airHolds()  true while the air rescue holds the body (reflex.mjs: rescuing || airPocketing || airPocketWanted())
 *   opts.emit(row)   writes the `_lava_retreat` row ({ detail, args }); opts.timing overrides the constants (tests only)
 */
export function makeDangerMover (bot, runner, { airHolds = () => false, emit = () => {}, now = () => Date.now(),
  sleep = ms => new Promise(r => setTimeout(r, ms)), timing = {} } = {}) {
  const T = { move: MOVE_MS, stepIn: STEP_IN_MS, stepEdge: STEP_EDGE_MS, aim: AIM_MS, seal: SEAL_WITNESS_MS, reassert: REASSERT_MS,
              ground: GROUND_EVERY_MS, air: AIR_EVERY_MS, after: AFTER_MS, relax: RELAX_MS, ...timing }
  let genCounter = 0
  let cur = null                    // the live move: { gen, deadline, check(), end(why), ... }
  let lastGround = -Infinity, lastAir = -Infinity, lastFiring = -Infinity
  let episode = 0, n = 0
  const moved = []                  // displacement of each COMPLETED dry ground move this episode, newest last
  const epCells = new Set()         // every cell a ground firing of this episode started in ("x,y,z")
  let relax = null                  // { cell: [x,y,z], name, until, sneak }
  let sealToken = false
  const at = (x, y, z) => { try { return bot.blockAt(new Vec3(x, y, z)) } catch { return null } }
  const alive = () => !!bot.entity && (bot.health ?? 20) > 0
  const wet = () => bot.entity?.isInWater === true

  /**
   * IS A MOVE LIVE? Not just "before its deadline": the moment the air rescue takes the body, the bot dies or loses its
   * entity, or the deadline passes, the move is ENDED HERE, synchronously, by whoever asks -- so the in-flight guard never
   * refuses the air rescue's own dig, no arm waits a re-assertion period, and no second move can overlap the first.
   */
  function moving () {
    if (!cur) return false
    const why = cur.check()
    if (why) { cur.end(why); return false }
    return true
  }
  const sameCell = (b, c) => !!b?.position && b.position.x === c[0] && b.position.y === c[1] && b.position.z === c[2]

  /** The names the arm and recoveryArmsMayRun see: a relaxed (cell, name) reads as no name at all. */
  function effective (feet, below) {
    const relaxed = b => !!relax && !!b && b.name === relax.name && sameCell(b, relax.cell)
    return { feet: relaxed(feet) ? null : (feet?.name ?? null), below: relaxed(below) ? null : (below?.name ?? null) }
  }

  function endRelax (why) {
    if (!relax) return
    const r = relax; relax = null
    if (r.sneak) { try { bot.setControlState('sneak', false) } catch {} }
    emit({ detail: `relax_end cell=${r.cell.join(',')} name=${r.name} why=${why}`, args: { phase: 'relax_end', cell: r.cell, name: r.name, why } })
  }
  // A BLOCK UPDATE at the relaxed cell (or at the bot's feet/below cell) ends the relaxation at once
  try {
    bot.on?.('blockUpdate', (_old, nb) => {
      if (!relax || !nb?.position) return
      const p = bot.entity?.position
      const feetC = p ? cellOf(p) : null
      const c = [nb.position.x, nb.position.y, nb.position.z]
      const hit = (a) => a && a[0] === c[0] && a[1] === c[1] && a[2] === c[2]
      if (hit(relax.cell) || hit(feetC) || (feetC && hit([feetC[0], feetC[1] - 1, feetC[2]]))) endRelax('block_update')
    })
  } catch {}

  /**
   * Every reflex tick, before the arm: the relaxation's end conditions -- expiry, death, no entity, the air rescue holding
   * the body or the bot in water (a sneaking swimmer's stroke is cut to 0.3: Claude code r1 P1), moving off the cell, a
   * new DANGER cell at the feet or below -- and its sneak re-asserted while it holds (an escape arm's seizeBody clears
   * every control).
   */
  function tick () {
    if (!relax) return
    const p = bot.entity?.position
    if (!p) return endRelax('no entity')
    if (!alive()) return endRelax('dead')
    if (airHolds()) return endRelax('air')
    if (wet()) return endRelax('in water')
    if (now() >= relax.until) return endRelax('expired')
    const feet = at(fl(p.x), fl(p.y), fl(p.z)), below = at(fl(p.x), fl(p.y) - 1, fl(p.z))
    // MOVED OFF = another column, or ON THE GROUND in another cell (a block placed on it, a step): never mid-jump, where the
    // handed-over pillar's own arc lifts the feet two cells above the relaxed floor (Claude code r2 P2-2)
    if (fl(p.x) !== relax.cell[0] || fl(p.z) !== relax.cell[2]) return endRelax('moved off')
    const onIt = sameCell(feet, relax.cell) || sameCell(below, relax.cell)
    if (!onIt && bot.entity.onGround !== false) return endRelax('moved off')
    for (const b of [feet, below]) {
      if (b && DANGER.has(b.name) && !(b.name === relax.name && sameCell(b, relax.cell))) return endRelax(`new danger ${b.name}`)
    }
    if (relax.sneak) { try { bot.setControlState('sneak', true) } catch {} }
  }

  /** The seal's one-shot pass through attachLavastepGuard: only the call made right after it was armed. */
  function takeSealToken () { if (sealToken && moving()) { sealToken = false; return true } return false }

  /**
   * Called by the reflex tick whenever the effective feet/below hold DANGER. Never re-classifies while a move is in
   * flight; never starts while the air rescue holds the body. -> null, { kase: 'airborne' }, or the move's promise.
   */
  function maybeFire ({ feet, below } = {}) {
    if (moving() || cur) return null
    if (airHolds()) return null
    if (!alive()) return null
    const eff = effective(feet, below)
    const onGround = bot.entity.onGround !== false
    const kase = dangerCase({ feet: eff.feet, below: eff.below, onGround })
    if (!kase) return null
    const t = now()
    if (kase === 'airborne') {
      if (t - lastAir < T.air) return null
      lastAir = t
      return airborne(eff, t)
    }
    if (t - lastGround < T.ground) return null
    lastGround = t
    const p = start(kase, eff, t)
    p.catch(() => {})
    return p
  }

  function nextEpisode (t) {
    if (t - lastFiring > EPISODE_GAP_MS) { episode = t; n = 0; moved.length = 0; epCells.clear() }   // "3 consecutive" is within one episode
    lastFiring = t
    n++
    return { episode: episode.toString(36), n }
  }

  function baseRow (kase, eff, t, ep) {
    const p = bot.entity.position
    return { phase: 'firing', episode: ep.episode, n: ep.n, case: kase, onGround: bot.entity.onGround !== false,
             inWater: wet(), feet: eff.feet, below: eff.below, from: [r2(p.x), r2(p.y), r2(p.z)],
             origin: cellOf(p), yaw0: r2(bot.entity.yaw ?? 0), hp0: bot.health ?? null }
  }
  const observe = (t0, startPos) => {
    try {
      const p = bot.entity?.position
      if (!p) return { alive: false }
      const f = at(fl(p.x), fl(p.y), fl(p.z)), b = at(fl(p.x), fl(p.y) - 1, fl(p.z))
      return { pos: [r2(p.x), r2(p.y), r2(p.z)], feet: f?.name ?? null, below: b?.name ?? null, hp: bot.health ?? null,
               ms: Math.round(now() - t0), moved: startPos ? r2(Math.hypot(p.x - startPos.x, p.y - startPos.y, p.z - startPos.z)) : null }
    } catch { return null }
  }
  /**
   * ONE ROW PER FIRING, written once both have happened: the `after` observation at +1.5 s from the firing (scheduled AT
   * the firing, so a long move still records its +1.5 s state), and the move's end (its own `end` state).
   */
  function rowWriter (row, t0, startPos) {
    let afterDone = false, endDone = false, written = false
    const write = () => {
      if (written || !afterDone || !endDone) return
      written = true
      const d = `case=${row.case} outcome=${row.outcome} path=${(row.path || []).join('>')} ` +
                `plan=${row.plan ? row.plan.length : 0} seal=${row.seal ? (row.seal.witnessed ? 'witnessed' : row.seal.ok === false ? 'no' : 'unwitnessed') : '-'} ` +
                `aim=${row.aim?.chosen != null ? row.aim.chosen : '-'} ended=${row.ended ?? '-'} episode=${row.episode} n=${row.n} ` +
                `from=${row.origin.join(',')} feet=${row.feet} below=${row.below} hp=${row.hp0}->${row.after?.hp ?? '?'}` +
                `${row.relax ? ` relax=${row.relax.name}` : ''}`
      try { emit({ detail: d, args: row }) } catch {}
    }
    const afterNow = () => { if (afterDone) return; afterDone = true; row.after = observe(t0, startPos); write() }
    const wait = Math.max(0, t0 + T.after - now())
    if (wait > 0) setTimeout(afterNow, wait); else afterNow()
    return { ended () { endDone = true; row.end = observe(t0, startPos); write() } }
  }

  /** `airborne`: release forward, sprint and jump; no steering; the skill is stopped and no other run starts mid-fall. */
  function airborne (eff, t) {
    const ep = nextEpisode(t)
    const row = baseRow('airborne', eff, t, ep)
    const w = rowWriter(row, t, bot.entity.position.clone?.() ?? { ...bot.entity.position })
    try { runner.reserve?.('lavastep', T.air * 2 + 100, 'danger_block') } catch {}
    haltPath(bot)
    const controls = []
    for (const c of ['forward', 'sprint', 'jump']) { try { bot.setControlState(c, false); controls.push([c, false, 0, 'airborne']) } catch {} }
    row.controls = controls
    row.outcome = 'released'
    row.path = ['airborne']
    row.ended = 'done'
    w.ended()
    return { kase: 'airborne' }
  }

  /** `in` / `edge`: plan, else seal (edge), else aim -- one bounded, owned sequence. */
  async function start (kase, eff, t0) {
    const gen = ++genCounter
    const ep = nextEpisode(t0)
    const row = baseRow(kase, eff, t0, ep)
    const startPos = bot.entity.position.clone?.() ?? { ...bot.entity.position }
    const writer = rowWriter(row, t0, startPos)
    const controls = []
    row.controls = controls
    row.path = []
    row.steps = []
    const me = { gen, deadline: t0 + T.move, ctl: {}, set: new Set(), look: null, ended: null, phase: 'start' }
    // AIR FIRST (Codex code r2 P1): a deadline that coincides with the air rescue's seize is the air rescue's
    me.check = () => airHolds() ? 'air' : !bot.entity ? 'no entity' : (bot.health ?? 20) <= 0 ? 'dead' : now() >= me.deadline ? 'deadline' : null
    me.end = why => end(why)          // assigned before `cur = me`: a synchronous unwind inside reserve() can already ask
    let timer = null
    cur = me
    epCells.add(row.origin.join())
    let resvGen = null
    // ENDED DURING ITS OWN SETUP (a synchronous unwind inside reserve/stopDigging/haltPath asked moving() while the check
    // failed): release what was taken and stop -- no dig stop, no path halt (the dig could be the rescue's own), no timer,
    // no control writes (Claude code r3 P3-4, r4 P3-3)
    const fenced = () => { if (!me.ended) return false; if (resvGen != null) { try { runner.releaseReservation?.(resvGen) } catch {} } return true }
    try { resvGen = runner.reserve?.('lavastep', T.move, 'danger_block')?.gen ?? null } catch {}
    if (fenced()) return
    try { if (bot.targetDigBlock) bot.stopDigging() } catch {}
    if (fenced()) return
    haltPath(bot)
    if (fenced()) return
    const owns = () => cur === me && !me.ended && !me.check()
    const reasonNow = () => me.ended ?? (cur !== me ? 'superseded' : me.check() ?? 'done')
    const setCtl = (name, v) => {
      if (!owns()) return false
      me.ctl[name] = v; if (v) me.set.add(name)
      try { bot.setControlState(name, v) } catch {}
      controls.push([name, v, Math.round(now() - t0), me.phase])
      return true
    }
    const setLook = (yaw, pitch = 0) => {
      if (!owns()) return false
      me.look = { yaw, pitch }
      try { bot.look(yaw, pitch, true)?.catch?.(() => {}) } catch {}
      return true
    }
    function end (why) {
      if (me.ended) return
      me.ended = why
      clearInterval(timer)
      // the controls the move set are cleared -- unless the air rescue holds the body NOW, whatever ended the move: its
      // stroke is the rescue's (Codex code r2 P1)
      if (why !== 'air' && !airHolds()) { for (const c of me.set) { try { bot.setControlState(c, false) } catch {} } }
      if (resvGen != null) { try { runner.releaseReservation?.(resvGen) } catch {} }
      if (cur === me) cur = null
      sealToken = false
      row.ended = why
      if (!row.outcome) row.outcome = why === 'done' ? 'none' : 'ended'
      // THE STUCK COUNTER COUNTS ONLY COMPLETED, DRY GROUND MOVES (Codex code r1 P1, Claude code r1 P1): an interrupted one
      // (air, death, deadline, a throw) or a wet one breaks the streak. The relaxation starts HERE, inside the lifecycle,
      // only if the bot is alive, on the ground, not in water, not held by the air rescue, and still on the very
      // (cell, name) the firing classified. The design scopes it to an enclosed DRY floor.
      const dry = row.onGround && !row.inWater && !WET.has(row.feet)
      if (why === 'done' && dry) {
        const p = bot.entity?.position
        // A FIRING THAT ENDS IN A CELL THIS EPISODE ALREADY STOOD IN DID NOT MOVE THE BOT. A walled bot's aimed sprints carry
        // it corner to corner of its own cell (0.56 block, the kinematic fake), or between two magma cells (Claude code
        // r2 P2-3), so "< 0.5 block" alone never trips and the handover would be unreachable. The aim settles on the
        // ground before the move ends, so the cell is the landed one (Claude code r2 P1).
        const landed = !!p && bot.entity?.onGround !== false
        const sameC = landed && epCells.has(cellOf(p).join())
        const d = !p ? Infinity : sameC ? 0 : !landed ? Infinity : Math.hypot(p.x - startPos.x, p.y - startPos.y, p.z - startPos.z)
        moved.push(d); if (moved.length > STUCK_FIRINGS) moved.shift()
        // THE (cell, name) RELAXED IS THE DANGER BLOCK THE BOT IS ON NOW -- the feet cell, else the one below -- read at the
        // landed position (Claude code r2 P3-7: never a cell it has already left; a bot shuttling between two magma cells
        // relaxes the one it stands on); stuckRelax admits only RELAXABLE names, so lava and fire never
        const fb = p ? [at(fl(p.x), fl(p.y), fl(p.z)), at(fl(p.x), fl(p.y) - 1, fl(p.z))] : []
        const under = fb.find(b => b && DANGER.has(b.name)) ?? null
        const dname = under?.name ?? null
        const cell = under?.position ? [under.position.x, under.position.y, under.position.z] : null
        if (!relax && cell && stuckRelax(moved, dname) && alive() && !airHolds() && !wet() && landed) {
          relax = { cell, name: dname, until: now() + T.relax, sneak: true }
          moved.length = 0
          try { bot.setControlState('sneak', true) } catch {}
          row.relax = { cell, name: dname, ms: T.relax, sneak: true }
        }
      } else moved.length = 0
      writer.ended()
    }
    timer = setInterval(() => {
      if (me.ended) return
      if (!owns()) return end(reasonNow())
      try { if (bot.pathfinder?.goal) haltPath(bot) } catch {}
      for (const c of MOVEMENT) { try { bot.setControlState(c, me.ctl[c] === true) } catch {} }
      if (me.look) { try { bot.look(me.look.yaw, me.look.pitch, true)?.catch?.(() => {}) } catch {} }
    }, T.reassert)
    // every movement control the move does not use is held false from the start (an unwinding skill's `back` or `left`
    // must not survive the move: Claude code r1 P3)
    if (owns()) for (const c of MOVEMENT) { if (me.ctl[c] === undefined) { me.ctl[c] = false; try { bot.setControlState(c, false) } catch {} } }
    const stop = () => { setCtl('forward', false); setCtl('sprint', false); setCtl('jump', false) }
    const nowCell = () => cellOf(bot.entity.position)
    const dangerHere = () => {
      const p = bot.entity.position
      const e = effective(at(fl(p.x), fl(p.y), fl(p.z)), at(fl(p.x), fl(p.y) - 1, fl(p.z)))
      return { ...e, kase: dangerCase({ ...e, onGround: bot.entity.onGround !== false }) }
    }
    /** A FULL observation from where the bot is now: the case, the search and the aim on ONE recorder (G2 replays it). */
    // the case is classified from the feet and below cells read THROUGH the observation's own recorder, so the row carries
    // the very cells the verdict came from (Codex code r6 P1: a `plan_missed_safe` audit had neither)
    const observeHere = () => {
      const o = nowCell(), rec = recordingAt(at, o)
      const e = effective(rec(o[0], o[1], o[2]), rec(o[0], o[1] - 1, o[2]))
      const kase = dangerCase({ ...e, onGround: bot.entity.onGround !== false })
      const sp = kase && kase !== 'airborne' ? stepPlan(rec, o, kase) : { plan: null, candidates: [] }
      const scores = aimScores(rec, o)
      return { origin: o, rec, kase, plan: sp.plan, candidates: sp.candidates, scores, choice: chooseBearing(scores, bot.entity.yaw ?? 0) }
    }
    const obsRow = (ob) => ({ origin: ob.origin, case: ob.kase, cells: ob.rec.cells, boxes: ob.rec.boxes,
      plan: ob.plan ? ob.plan.map(s2 => [...rel(s2.to, ob.origin), s2.dy]) : null, candidates: ob.candidates.map(c => [rel(c.to, ob.origin), c.d, c.why]) })

    // ---- one walk step to a plan cell, with its post-check. `from` = which observation the plan came from.
    async function walkStep (st, i, k, from, porigin) {
      const inStep = k === 'in'
      const target = { x: st.to[0] + 0.5, z: st.to[2] + 0.5 }
      const aimAt = () => { const q = bot.entity.position; return Math.atan2(-(target.x - q.x), -(target.z - q.z)) }
      const sprint = inStep && i === 0
      const jump = (inStep && i === 0) || st.dy === 1
      const rec = { plan: from, origin: porigin, i, to: st.to, dy: st.dy, sprint, jump, case: k, t0: Math.round(now() - t0) }
      row.steps.push(rec)
      me.phase = `step:${row.steps.length - 1}`
      if (!setLook(aimAt(), 0)) return 'lost'
      setCtl('sprint', sprint); setCtl('jump', jump)
      if (!setCtl('forward', true)) return 'lost'
      const until = now() + (inStep ? T.stepIn : T.stepEdge)
      let arrived = false
      while (now() < until) {
        await sleep(T.reassert)
        if (!owns()) return 'lost'
        const q = bot.entity.position
        if (Math.hypot(q.x - target.x, q.z - target.z) < ARRIVE_R) { arrived = true; break }
        setLook(aimAt(), 0)
      }
      stop()
      // settle: on the ground (a step up or down lands within ~0.4 s)
      for (let w = 0; w < 8 && bot.entity?.onGround === false; w++) { await sleep(T.reassert); if (!owns()) return 'lost' }
      if (!owns()) return 'lost'
      const c = nowCell(), dh = dangerHere()
      rec.t1 = Math.round(now() - t0); rec.arrived = arrived; rec.at = c
      rec.post = c[0] === st.to[0] && c[1] === st.to[1] && c[2] === st.to[2] && !DANGER.has(dh.feet) && !DANGER.has(dh.below)
      return rec.post ? 'ok' : 'failed'
    }
    async function runPlan (plan, k, from, porigin) {
      row.path.push(from === 'decision' ? 'plan' : 'replan')
      for (let i = 0; i < plan.length; i++) {
        const r = await walkStep(plan[i], i, k, from, porigin)
        if (r !== 'ok') return r
      }
      return 'ok'
    }
    // ---- the aimed escape. `ob` is the observation it is chosen from; `reason` says why it runs (G2's key):
    //   no_plan        the decision found no plan (and, at an edge, no seal): its observation is the decision's own cells
    //   seal_failed    the decision found no plan, the seal was not witnessed (design step 2); a fresh observation picks the
    //                  bearing (G2 replays the DECISION's cells, which had no plan)
    //   sealed         the seal was witnessed, the bot is still in danger, and the fresh observation (row.replan) found no plan
    //   in_step_missed an `in` plan step did not arrive (the design: straight to the aim, no re-plan; G2 exempts it)
    async function runAim (ob, reason, cellsRef = null) {
      row.path.push('aim')
      me.phase = 'aim'
      const yaw = yawOf(ob.choice.b)
      row.aim = { reason, ...(cellsRef ? { cellsRef, origin: ob.origin, case: ob.kase } : obsRow(ob)), yaw0: r2(bot.entity.yaw ?? 0),
                  scores: ob.scores.map(s => [s.support, s.collision, s.danger]), chosen: ob.choice.index, yaw: r2(yaw) }
      if (!setLook(yaw, 0)) return 'lost'
      setCtl('sprint', true); setCtl('jump', true)
      if (!setCtl('forward', true)) return 'lost'
      const until = now() + T.aim
      while (now() < until) { await sleep(T.reassert); if (!owns()) return 'lost' }
      stop()
      // SETTLE: the held jump re-fires on every landing (prismarine-physics autojump), so the bot is usually airborne at
      // +1.5 s; the move owns the body until it lands (<= 600 ms, inside the deadline), so the next firing and the stuck
      // counter see where it came down (Claude code r2 P1)
      for (let w = 0; w < 12 && bot.entity?.onGround === false; w++) { await sleep(T.reassert); if (!owns()) return 'lost' }
      return 'ok'
    }
    // ---- the seal (edge, a replaceable cell under the centre, a seal block held)
    async function runSeal (seal) {
      row.path.push('seal')
      me.phase = 'seal'
      const s = { ok: true, cell: seal.cell, ref: seal.ref, face: seal.face, item: seal.item, witnessed: false, next: null }
      row.seal = s
      const item = bot.inventory?.items?.().find(it => it.name === seal.item)
      if (!item) { s.ok = false; s.why = 'item gone'; s.next = 'aim'; return 'unwitnessed' }
      if (!owns()) return 'lost'
      try { await bot.equip(item, 'hand') } catch (e) { s.why = `equip: ${String(e?.message ?? e).slice(0, 60)}` }
      if (!owns()) return 'lost'
      const ref = at(...seal.ref), cell = at(...seal.cell)
      s.refName = ref?.name ?? null; s.cellName = cell?.name ?? null; s.held = bot.heldItem?.name ?? null
      if (!ref || ref.boundingBox !== 'block' || !cell || !REPLACEABLE.has(cell.name) || s.held !== seal.item) {
        s.ok = false; s.why = s.why ?? 'cell or reference changed, or the block is not in hand'; s.next = 'aim'; return 'unwitnessed'
      }
      const lookP = { x: seal.ref[0] + 0.5 + seal.face[0] * 0.5, y: seal.ref[1] + 0.5 + seal.face[1] * 0.5, z: seal.ref[2] + 0.5 + seal.face[2] * 0.5 }
      const eye = bot.entity.position.offset?.(0, bot.entity.eyeHeight ?? 1.62, 0) ?? bot.entity.position
      const dx = lookP.x - eye.x, dy = lookP.y - eye.y, dz = lookP.z - eye.z
      setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
      const ts = now()
      const witnessed = await new Promise(resolve => {
        let done = false
        const fin = v => { if (done) return; done = true; try { bot.removeListener?.('blockUpdate', h) } catch {}; clearTimeout(to); resolve(v) }
        const h = (_old, nb) => {
          if (nb?.position && nb.position.x === seal.cell[0] && nb.position.y === seal.cell[1] && nb.position.z === seal.cell[2]) {
            s.update = { name: nb.name ?? null, ms: Math.round(now() - ts) }
            if (nb.name === seal.item) fin(true)
          }
        }
        const to = setTimeout(() => fin(false), T.seal)
        try { bot.on('blockUpdate', h) } catch {}
        if (!owns()) return fin(false)
        s.placeHeld = bot.heldItem?.name ?? null
        sealToken = true
        try {
          const r = bot._genericPlace(ref, new Vec3(seal.face[0], seal.face[1], seal.face[2]), { swingArm: 'right', forceLook: 'ignore' })
          r?.catch?.(e => { s.why = `place: ${String(e?.message ?? e).slice(0, 60)}` })
        } catch (e) { s.why = `place: ${String(e?.message ?? e).slice(0, 60)}` }
        sealToken = false
      })
      s.ms = Math.round(now() - ts)
      s.witnessed = witnessed
      if (!owns()) return 'lost'
      s.next = witnessed ? 'reclassify' : 'aim'
      return witnessed ? 'witnessed' : 'unwitnessed'
    }
    /** After a seal: a fresh observation; its plan if it has one, else its aim, or nothing if the danger is gone. */
    async function afterSeal (reason) {
      const ob = observeHere()
      row.replan = obsRow(ob)
      row.reclass = ob.kase
      if (!ob.kase) return 'sealed'
      if (ob.kase === 'airborne') return `${reason}_airborne`
      if (ob.plan) {
        const r = await runPlan(ob.plan, ob.kase, 'replan', ob.origin)
        if (r === 'lost') return 'lost'
        if (r === 'ok') return `${reason}_plan`
        if (ob.kase !== 'in') return `${reason}_plan_missed`
        // a missed `in` step goes straight to the aimed escape, as in the decision's own plan (Codex code r2 P2) -- unless
        // the step has already carried the bot out of danger (an overshoot onto stone: Claude code r4 P2-1)
        const ob2 = observeHere()
        if (!ob2.kase) { row.missObs = { origin: ob2.origin, case: ob2.kase, cells: ob2.rec.cells, boxes: ob2.rec.boxes, relax: relax ? { cell: relax.cell, name: relax.name } : null }; return `${reason}_plan_missed_safe` }
        const a = await runAim(ob2, 'in_step_missed')
        return a === 'lost' ? 'lost' : `${reason}_plan_missed_aim`
      }
      const a = await runAim(ob, reason, 'replan')
      return a === 'lost' ? 'lost' : `${reason}_aim`
    }

    try {
      const origin = row.origin
      const rec = recordingAt(at, origin)
      const items = (bot.inventory?.items?.() ?? []).map(i => i.name)
      row.items = SEAL_ITEMS.filter(nm => items.includes(nm))   // the seal-item names the decision saw (G4's input)
      const dec = dangerMove({ at: rec, origin, feet: eff.feet, below: eff.below, onGround: row.onGround, items, yaw0: bot.entity.yaw ?? 0 })
      row.cells = rec.cells; row.boxes = rec.boxes
      row.candidates = dec.candidates.map(c => [rel(c.to, origin), c.d, c.why])
      row.plan = dec.plan ? dec.plan.map(s => [...rel(s.to, origin), s.dy]) : null
      if (dec.seal && !dec.seal.ok) row.seal = { ok: false, why: dec.seal.why, cell: dec.seal.cell }
      if (!owns()) return end(reasonNow())
      let outcome = null
      const plan = dec.plan
      if (plan) {
        const r = await runPlan(plan, kase, 'decision', origin)
        if (r === 'lost') return end(reasonNow())
        if (r === 'ok') outcome = 'plan'
        else if (kase === 'in') {        // a missed `in` step goes straight to the aimed escape (no waiting for the next firing)
          const ob2 = observeHere()
          if (!ob2.kase) {   // ...unless it already carried the bot out of danger (Claude code r4 P2-1); recorded for the read (r5 P3-1)
            row.missObs = { origin: ob2.origin, case: ob2.kase, cells: ob2.rec.cells, boxes: ob2.rec.boxes, relax: relax ? { cell: relax.cell, name: relax.name } : null }
            outcome = 'plan_missed_safe'
          }
          else {
            const a = await runAim(ob2, 'in_step_missed')
            if (a === 'lost') return end(reasonNow())
            outcome = 'plan_missed_aim'
          }
        } else outcome = 'plan_missed'   // `edge`: the move ends; the next firing re-classifies
      } else if (kase === 'edge' && dec.seal?.ok) {
        const s = await runSeal(dec.seal)
        if (s === 'lost') return end(reasonNow())
        // witnessed: RE-CLASSIFY AT ONCE on fresh reads. Not witnessed (or no block, or no face): the design's step 2, the
        // aimed escape, never a re-classification (G4) -- chosen from a fresh full observation, since the bot may have moved
        if (s === 'witnessed') {
          const o = await afterSeal('sealed')
          if (o === 'lost') return end(reasonNow())
          outcome = o
        } else {
          const a = await runAim(observeHere(), 'seal_failed')
          if (a === 'lost') return end(reasonNow())
          outcome = 'seal_failed_aim'
        }
      } else {
        const a = dec.aim
          ? await runAim({ origin, rec, kase, scores: dec.aim.scores, choice: dec.aim.choice, plan: null, candidates: dec.candidates }, 'no_plan', 'row')
          : await runAim(observeHere(), 'no_plan')
        if (a === 'lost') return end(reasonNow())
        outcome = 'aim'
      }
      row.outcome = outcome
      return end('done')
    } catch (e) {
      row.error = String(e?.message ?? e).slice(0, 120)
      return end(owns() ? 'error' : reasonNow())
    } finally {
      if (!me.ended) end(reasonNow())
    }
  }

  return { maybeFire, moving, effective, tick, takeSealToken,
           state: () => ({ moving: moving(), gen: cur?.gen ?? null, relax: relax ? { ...relax } : null, episode, n }) }
}

/**
 * THE IN-FLIGHT GUARD (index.mjs, OUTERMOST over digtown/keepout/protectzone): while a danger move lives, bot.dig and
 * bot._genericPlace (placeBlock, _placeBlockWithOptions and placeEntity all call it) are refused with a rejected promise
 * -- every caller already handles one -- except the move's own seal, which arms a one-shot token right before its call.
 * `moving()` ends a move that has lost the body (air, death, deadline) before answering, so the air rescue's first dig
 * is never refused.
 */
export function attachLavastepGuard (bot, mover, { onRefuse = () => {} } = {}) {
  if (!mover || typeof mover.moving !== 'function') return false
  for (const name of ['dig', '_genericPlace']) {
    const orig = bot[name]
    if (typeof orig !== 'function' || orig.__lavastep) continue
    const w = function (...a) {
      if (mover.moving()) {
        if (name === '_genericPlace' && mover.takeSealToken()) return orig.apply(this, a)
        try { onRefuse(name) } catch {}
        return Promise.reject(new Error(`lavastep: a danger move holds the body; ${name} refused (it ends within ${MOVE_MS / 1000} s)`))
      }
      return orig.apply(this, a)
    }
    w.__lavastep = orig
    bot[name] = w
  }
  return true
}

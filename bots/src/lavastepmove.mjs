// LAVASTEP-01: THE EXECUTOR for lavastep.mjs's decision (F1, docs/reports/mineshaft-safety-2026-10-23.md §7).
//
// ONE MOVE AT A TIME, OWNED (design "Body control"):
//   - a PRIORITY RUNNER RESERVATION: runner.reserve('lavastep', MOVE_MS, 'danger_block') aborts the running skill and
//     declines every other run (`runner_reserved`), the model's danger_block decision included; the watchdog's and
//     poolescape's reserve() are REFUSED while it lives (runner.mjs), so their pending runs decline;
//   - a GENERATION TOKEN { gen, deadline }: after EVERY await and before EVERY control write or look the executor checks
//     gen, deadline, alive and air ownership; any mismatch ends the move at once;
//   - RE-ASSERTION every REASSERT_MS while the gen is its own: the pathfinder goal is cleared (haltPath), the move's
//     controls and look are set again -- a late skill unwind that clears controls, or a lookAt inside an unwinding dig,
//     is overridden within 50 ms;
//   - AIR PREEMPTION: the air rescue (drowning rescue, air pocket) outranks the move. If it holds the body at a firing the
//     move does not start; if it takes the body during one, the next check ends the move WITHOUT touching the controls
//     (the rescue's stroke is the rescue's). "The only water reflex is getting air" is unchanged.
//   - IN-FLIGHT DIGS AND PLACES: stopDigging() at the start; attachLavastepGuard (index.mjs, outermost) refuses bot.dig
//     and bot._genericPlace while the move lives, except the move's own seal (a one-shot token).
// EVERY FIRING WRITES ONE `_lava_retreat` ROW whose args carry every cell the decision read (lavastep.recordingAt), the
// candidates with reject reasons, the plan, the seal, the aim scores, each control write with its time, and the after
// state at +1.5 s -- the read (scripts/host/lavastepread.py) recomputes every gate from those inputs.
import { Vec3 } from 'vec3'
import { haltPath } from './pathhalt.mjs'
import { dangerCase, dangerMove, recordingAt, aimScores, chooseBearing, stepPlan, yawOf, stuckRelax, DANGER, RELAXABLE,
         MOVE_MS, STEP_IN_MS, STEP_EDGE_MS, AIM_MS, SEAL_WITNESS_MS, REASSERT_MS, ARRIVE_R, RELAX_MS, STUCK_FIRINGS } from './lavastep.mjs'

export const GROUND_EVERY_MS = 2500    // one ground firing per 2.5 s (today's cadence)
export const AIR_EVERY_MS = 450        // one airborne firing per reflex tick (500 ms) until the bot lands
export const AFTER_MS = 1500           // the row's `after` state
export const EPISODE_GAP_MS = 30_000   // firings no more than 30 s apart are one episode (the design's episode definition)

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
  let cur = null                    // the live move: { gen, deadline, ... }
  let lastGround = -Infinity, lastAir = -Infinity, lastFiring = -Infinity
  let episode = 0, n = 0
  const moved = []                  // displacement of each ground firing, newest last (the stuck counter)
  let relax = null                  // { cell: [x,y,z], name, until, sneak }
  let sealToken = false
  const at = (x, y, z) => { try { return bot.blockAt(new Vec3(x, y, z)) } catch { return null } }

  const moving = () => !!cur && now() < cur.deadline
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

  /** Every reflex tick, before the arm: the relaxation's other end conditions, and its sneak re-asserted while it holds. */
  function tick () {
    if (!relax) return
    const p = bot.entity?.position
    if (!p) return endRelax('no entity')
    if (now() >= relax.until) return endRelax('expired')
    const feet = at(fl(p.x), fl(p.y), fl(p.z)), below = at(fl(p.x), fl(p.y) - 1, fl(p.z))
    const onIt = sameCell(feet, relax.cell) || sameCell(below, relax.cell)
    if (!onIt) return endRelax('moved off')
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
    if (moving()) return null
    if (airHolds()) return null
    if (!bot.entity) return null
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
    if (t - lastFiring > EPISODE_GAP_MS) { episode = t; n = 0 }
    lastFiring = t
    n++
    return { episode: episode.toString(36), n }
  }

  function baseRow (kase, eff, t, ep) {
    const p = bot.entity.position
    return { phase: 'firing', episode: ep.episode, n: ep.n, case: kase, onGround: bot.entity.onGround !== false,
             inWater: bot.entity.isInWater === true, feet: eff.feet, below: eff.below, from: [r2(p.x), r2(p.y), r2(p.z)],
             origin: cellOf(p), yaw0: r2(bot.entity.yaw ?? 0), hp0: bot.health ?? null }
  }

  /** `airborne`: release forward, sprint and jump; no steering; the skill is stopped and no other run starts mid-fall. */
  function airborne (eff, t) {
    const ep = nextEpisode(t)
    const row = baseRow('airborne', eff, t, ep)
    try { runner.reserve?.('lavastep', T.air * 2 + 100, 'danger_block') } catch {}
    haltPath(bot)
    const controls = []
    for (const c of ['forward', 'sprint', 'jump']) { try { bot.setControlState(c, false); controls.push([c, false, 0]) } catch {} }
    row.controls = controls
    row.outcome = 'released'
    row.path = ['airborne']
    finishRow(row, t, bot.entity.position.clone?.() ?? bot.entity.position)
    return { kase: 'airborne' }
  }

  function finishRow (row, t0, startPos) {
    const write = () => {
      try {
        const p = bot.entity?.position
        if (p) {
          const f = at(fl(p.x), fl(p.y), fl(p.z)), b = at(fl(p.x), fl(p.y) - 1, fl(p.z))
          row.after = { pos: [r2(p.x), r2(p.y), r2(p.z)], feet: f?.name ?? null, below: b?.name ?? null, hp: bot.health ?? null,
                        ms: Math.round(now() - t0), moved: startPos ? r2(Math.hypot(p.x - startPos.x, p.y - startPos.y, p.z - startPos.z)) : null }
        }
      } catch {}
      if (row.case !== 'airborne' && row.after?.moved != null) {
        moved.push(row.after.moved); if (moved.length > STUCK_FIRINGS) moved.shift()
        const dname = DANGER.has(row.feet) ? row.feet : row.below
        if (!relax && stuckRelax(moved, dname)) {
          const c = row.origin; const cell = DANGER.has(row.feet) ? c : [c[0], c[1] - 1, c[2]]
          relax = { cell, name: dname, until: now() + T.relax, sneak: true }
          moved.length = 0
          try { bot.setControlState('sneak', true) } catch {}
          row.relax = { cell, name: dname, ms: T.relax, sneak: true }
        }
      }
      const d = `case=${row.case} outcome=${row.outcome} path=${(row.path || []).join('>')} ` +
                `plan=${row.plan ? row.plan.length : 0} seal=${row.seal ? (row.seal.witnessed ? 'witnessed' : row.seal.ok === false ? 'no' : 'unwitnessed') : '-'} ` +
                `aim=${row.aim?.chosen != null ? row.aim.chosen : '-'} ended=${row.ended ?? '-'} episode=${row.episode} n=${row.n} ` +
                `from=${row.origin.join(',')} feet=${row.feet} below=${row.below} hp=${row.hp0}->${row.after?.hp ?? '?'}` +
                `${row.relax ? ` relax=${row.relax.name}` : ''}`
      emit({ detail: d, args: row })
    }
    const wait = Math.max(0, t0 + T.after - now())
    if (wait > 0) setTimeout(write, wait); else write()
  }

  /** `in` / `edge`: plan, else seal (edge), else aim -- one bounded, owned sequence. */
  async function start (kase, eff, t0) {
    const gen = ++genCounter
    const ep = nextEpisode(t0)
    const row = baseRow(kase, eff, t0, ep)
    const startPos = bot.entity.position.clone?.() ?? { ...bot.entity.position }
    const controls = []
    row.controls = controls
    row.path = []
    const me = { gen, deadline: t0 + T.move, ctl: {}, set: new Set(), look: null, ended: null, phase: 'start' }
    cur = me
    let resvGen = null
    try { resvGen = runner.reserve?.('lavastep', T.move, 'danger_block')?.gen ?? null } catch {}
    try { if (bot.targetDigBlock) bot.stopDigging() } catch {}
    haltPath(bot)
    const owns = () => cur === me && now() < me.deadline && !!bot.entity && (bot.health ?? 20) > 0 && !airHolds()
    const reasonNow = () => cur !== me ? 'superseded' : now() >= me.deadline ? 'deadline' : !bot.entity ? 'no entity'
      : (bot.health ?? 20) <= 0 ? 'dead' : airHolds() ? 'air' : 'done'
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
      if (why !== 'air') { for (const c of me.set) { try { bot.setControlState(c, false) } catch {} } }
      if (resvGen != null) { try { runner.releaseReservation?.(resvGen) } catch {} }
      if (cur === me) cur = null
      sealToken = false
      row.ended = why
      if (!row.outcome) row.outcome = why === 'done' ? 'none' : 'ended'
      finishRow(row, t0, startPos)
    }
    const timer = setInterval(() => {
      if (me.ended) return
      if (!owns()) return end(reasonNow())
      try { if (bot.pathfinder?.goal) haltPath(bot) } catch {}
      for (const [c, v] of Object.entries(me.ctl)) { try { bot.setControlState(c, v) } catch {} }
      if (me.look) { try { bot.look(me.look.yaw, me.look.pitch, true)?.catch?.(() => {}) } catch {} }
    }, T.reassert)
    const stop = () => { setCtl('forward', false); setCtl('sprint', false); setCtl('jump', false) }
    const nowCell = () => cellOf(bot.entity.position)
    const dangerHere = () => {
      const p = bot.entity.position
      const e = effective(at(fl(p.x), fl(p.y), fl(p.z)), at(fl(p.x), fl(p.y) - 1, fl(p.z)))
      return { ...e, kase: dangerCase({ ...e, onGround: bot.entity.onGround !== false }) }
    }

    // ---- one walk step to a plan cell, with its post-check
    async function walkStep (st, i, k) {
      const inStep = k === 'in'
      const target = { x: st.to[0] + 0.5, z: st.to[2] + 0.5 }
      const aimAt = () => { const q = bot.entity.position; return Math.atan2(-(target.x - q.x), -(target.z - q.z)) }
      const sprint = inStep && i === 0
      const jump = (inStep && i === 0) || st.dy === 1
      const rec = { i, to: st.to, dy: st.dy, sprint, jump, case: k, t0: Math.round(now() - t0) }
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
    async function runPlan (plan, k) {
      row.path.push('plan')
      for (let i = 0; i < plan.length; i++) {
        const r = await walkStep(plan[i], i, k)
        if (r !== 'ok') return r
      }
      return 'ok'
    }
    // ---- the aimed escape from wherever the bot is now
    async function runAim (aim) {
      row.path.push('aim')
      me.phase = 'aim'
      if (!aim) {
        const o = nowCell(); const rec = recordingAt(at, o)
        const scores = aimScores(rec, o)
        aim = { origin: o, rec, scores, choice: chooseBearing(scores, bot.entity.yaw ?? 0) }
      }
      const yaw = yawOf(aim.choice.b)
      row.aim = { origin: aim.origin, cells: aim.rec.cells, boxes: aim.rec.boxes, yaw0: r2(bot.entity.yaw ?? 0),
                  scores: aim.scores.map(s => [s.support, s.collision, s.danger]), chosen: aim.choice.index, yaw: r2(yaw) }
      if (!setLook(yaw, 0)) return 'lost'
      setCtl('sprint', true); setCtl('jump', true)
      if (!setCtl('forward', true)) return 'lost'
      const until = now() + T.aim
      while (now() < until) { await sleep(T.reassert); if (!owns()) return 'lost' }
      stop()
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
      try { await bot.equip(item, 'hand') } catch (e) { s.why = `equip: ${String(e?.message ?? e).slice(0, 60)}` }
      if (!owns()) return 'lost'
      const ref = at(...seal.ref), cell = at(...seal.cell)
      s.refName = ref?.name ?? null; s.cellName = cell?.name ?? null
      if (!ref || ref.boundingBox !== 'block' || !cell || !['lava', 'flowing_lava', 'fire', 'soul_fire'].includes(cell.name) || bot.heldItem?.name !== seal.item) {
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
          if (nb?.position && nb.position.x === seal.cell[0] && nb.position.y === seal.cell[1] && nb.position.z === seal.cell[2] && nb.name === seal.item) fin(true)
        }
        const to = setTimeout(() => fin(false), T.seal)
        try { bot.on('blockUpdate', h) } catch {}
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

    try {
      row.steps = []
      const origin = row.origin
      const rec = recordingAt(at, origin)
      const items = (bot.inventory?.items?.() ?? []).map(i => i.name)
      const dec = dangerMove({ at: rec, origin, feet: eff.feet, below: eff.below, onGround: row.onGround, items, yaw0: bot.entity.yaw ?? 0 })
      row.cells = rec.cells; row.boxes = rec.boxes
      row.candidates = dec.candidates.map(c => [rel(c.to, origin), c.d, c.why])
      row.plan = dec.plan ? dec.plan.map(s => [...rel(s.to, origin), s.dy]) : null
      if (dec.seal && !dec.seal.ok) row.seal = { ok: false, why: dec.seal.why, cell: dec.seal.cell }
      if (!owns()) return end(reasonNow())
      let outcome = null
      const plan = dec.plan
      if (plan) {
        const r = await runPlan(plan, kase)
        if (r === 'lost') return end(reasonNow())
        if (r === 'ok') outcome = 'plan'
        else if (kase === 'in') {        // a missed `in` step goes straight to the aimed escape (no waiting for the next firing)
          const a = await runAim(null)
          if (a === 'lost') return end(reasonNow())
          outcome = 'plan_missed_aim'
        } else outcome = 'plan_missed'   // `edge`: the move ends; the next firing re-classifies
      } else {
        let aimDec = dec.aim ? { origin, rec, scores: dec.aim.scores, choice: dec.aim.choice } : null
        if (kase === 'edge' && dec.seal?.ok) {
          const s = await runSeal(dec.seal)
          if (s === 'lost') return end(reasonNow())
          if (s === 'witnessed') {
            // RE-CLASSIFY AT ONCE, on fresh reads (a second recorder: the sealed cell changed)
            const dh = dangerHere()
            row.reclass = dh.kase
            if (!dh.kase) outcome = 'sealed'
            else {
              const o2 = nowCell(); const rec2 = recordingAt(at, o2)
              const sp = dh.kase === 'airborne' ? { plan: null, candidates: [] } : stepPlan(rec2, o2, dh.kase)
              row.replan = { origin: o2, case: dh.kase, cells: rec2.cells, boxes: rec2.boxes, plan: sp.plan ? sp.plan.map(s2 => [...rel(s2.to, o2), s2.dy]) : null,
                             candidates: sp.candidates.map(c => [rel(c.to, o2), c.d, c.why]) }
              if (sp.plan) {
                const r = await runPlan(sp.plan, dh.kase)
                if (r === 'lost') return end(reasonNow())
                outcome = r === 'ok' ? 'sealed_plan' : 'sealed_plan_missed'
              } else if (dh.kase !== 'airborne') {
                const sc = aimScores(rec2, o2)
                const a = await runAim({ origin: o2, rec: rec2, scores: sc, choice: chooseBearing(sc, bot.entity.yaw ?? 0) })
                if (a === 'lost') return end(reasonNow())
                outcome = 'sealed_aim'
              } else outcome = 'sealed_airborne'
            }
          } else {
            // not witnessed (or no block, or no face): the aimed escape, from where the bot now is
            aimDec = null
          }
        }
        if (!outcome) {
          const a = await runAim(aimDec)
          if (a === 'lost') return end(reasonNow())
          outcome = row.path.includes('seal') ? 'seal_failed_aim' : 'aim'
        }
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

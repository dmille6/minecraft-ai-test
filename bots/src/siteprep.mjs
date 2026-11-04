// SITEPREP-01: THE GROUNDSKEEPER PREPARES A PLOT WHEN A PROJECT FINDS NO SITE (owner 11-04, ledger siteprep-1104: "can we use the
// groundskeeper bots to clear land and repurpose land so we can build on it?" + "i have no problem with bots filling in water if it
// must, as a last resort"). Design: docs/reports/siteprep-design-2026-11-04.md (Claude + Codex, reconciled; both engines' blocker
// reviews folded in). PURE: the switch, the request and its state table, the candidates and their tiers, the grading (terrace.mjs
// gradeTerraces with `pin`), the never-worse walk, the work on the tidy record, the retirement of a dead request's work, the
// reservation, the hand-over decisions, the rows. skills.mjs supplies the readings and the effects (buildSink files and claims;
// buildTidy -- the keeper -- chooses, works and verifies).
//
// SLICE 1 (showcase): the stepped sinks -- towers and shrines (sinks.mjs). A request is filed only for a refusal the earth can fix
// (`earth`) or the last resort (`water`); a reservation, a zone, furniture, a tree, an unread chunk is never prepared away (`hard`).
// The deliverable is the REQUESTER'S OWN acceptance: its screen and its construction proof pass on the plot (simulated at choosing,
// on the real world at verifying). A graded pad is only an intermediate result.

import { gradeTerraces, terraceWalk, TERRACE } from './terrace.mjs'
import { tidyOverlay, cutStanding, waterColumn, TIDY_BLUEPRINT, TIDY_PLOT, TIDY_BUILDERS, TIDY } from './tidy.mjs'
import { towerCandidates, shrineSlots, towerDesign, shrineDesign, groundAt, sinkSeed, faceToward, groundStairCols, SITE_LIM, instancesOf } from './sinks.mjs'

export const SITEPREP_PLOT = 'siteprep'
export const SITEPREP_BLUEPRINT = 'siteprep@1'
export const PREP_KINDS = Object.freeze(['tower', 'shrine'])
/**
 * THE BOUNDS (offline on the showcase copy 11-04 08:58Z: blend 3 / colMax 4 graded no shrine slot -- the ground beside the pinned
 * square steps 6-7 -- blend 5 / colMax 6 prepared Z2 with cut 50, fill 140). blend: the ramp ring graded round the pinned square;
 * colMax: a column's cut or fill at most; cutMax /
 * fillMax: a plot's earthwork at most (fills + seals + dams); waterDepth / waterCols: the last resort's still water at most;
 * proofs: full gradings + acceptances a call (the rest wait for the next visit: `pending`, never "no dry land"); offsets: the spot's
 * shift (Chebyshev) tried round each requester candidate; smaller: base steps tried below the design's; estimateMax: cheap screens a
 * call; refileMs: a refused or abandoned kind files again after this; expireMs: a request not prepared by then expires; readyMs: a
 * prepared plot not claimed by then expires; verifyMax / retireMax: re-preps after a failed verify / an overlap; handFailsMax: failed
 * claims before a re-prep; gap: the zone's margin (PROJECT_GAP: the margin the instance's own zone will hold); walkPad: the walk
 * guard's margin round the town edge and the graded box.
 */
export const PREP = Object.freeze({ blend: 5, colMax: 6, cutMax: 200, fillMax: 400, waterDepth: 2, waterCols: 24, proofs: 4, offsets: 1, smaller: 2,
  estimateMax: 800, refileMs: 24 * 3600_000, expireMs: 48 * 3600_000, readyMs: 6 * 3600_000, verifyMax: 1, retireMax: 1, handFailsMax: 2, gap: 3, walkPad: 8, pad: 1 })
export const LIVE = Object.freeze(['filed', 'prepping', 'prepared'])
export const TERMINAL = Object.freeze(['handed', 'refused', 'expired', 'abandoned'])
export const TIERS = Object.freeze(['same', 'smaller', 'other_dry', 'water'])

/** THE SWITCH -> bool. SITEPREP=on|off; unset: on in SITEPREP_POOLS (default `showcase`). Pure. */
export function siteprepOn (env = process.env, pool = '') {
  const v = String(env?.SITEPREP ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.SITEPREP_POOLS ?? 'showcase').split(',').map(q => q.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}

// ---- what prep can fix ------------------------------------------------------------------------------------------------------------
const EARTH = new Set(['fill_deep', 'cut_deep', 'apron_low', 'apron_high', 'fill_share', 'cut_max', 'level', 'no_step', 'fill', 'cut', 'approach_too_deep', 'fill_too_deep', 'cut_too_high', 'earthwork', 'interior_unreachable'])
/**
 * A REQUESTER REFUSAL'S CLASS -> 'earth' | 'water' | 'reach' | 'hard'. Pure. `proof_` is the build proof's prefix (sinks.mjs siteSink).
 * earth: the ground's shape (graded away); water: a liquid in the site (the last resort); reach: no walk to it (an access ramp: slice
 * 3); hard: a reservation, a zone, furniture, a tree, an unread chunk, a bill -- never prepared away.
 */
export function prepClass (why) {
  const w = String(why ?? '').replace(/^proof_/, '')
  if (EARTH.has(w)) return 'earth'
  if (/^(base_|apron_|start_)?liquid$/.test(w)) return 'water'
  if (w === 'unreachable') return 'reach'
  return 'hard'
}
/** Does a requester's refusal tally hold a refusal prep may fix -- earth, reach (a sunken pad's approach: the requester's own proof on
 *  the after-world decides), or water (the last resort)? Never a tally of hard refusals alone. Pure. */
export const prepWorthy = (rejects = {}) => Object.entries(rejects ?? {}).some(([k, n]) => Number(n) > 0 && ['earth', 'reach', 'water'].includes(prepClass(k)))

// ---- the request and its state table ---------------------------------------------------------------------------------------------
export const requestsOf = rec => (Array.isArray(rec?.requests) ? rec.requests : [])
/** The request a town works now: the one prepping or prepared, else the oldest filed. Pure. */
export function prepActive (rec) {
  const rs = requestsOf(rec)
  return rs.find(r => r.state === 'prepping' || r.state === 'prepared') ?? rs.filter(r => r.state === 'filed').sort((a, b) => a.filedAt - b.filedAt)[0] ?? null
}
/**
 * SHOULD A REQUESTER'S `no_site` FILE A REQUEST? -> { file, why }. Pure. Its switch on, a slice kind, a refusal prep can fix, no live
 * request of the kind, and no refused/abandoned/expired one of the kind within PREP.refileMs.
 */
export function prepFileDecision ({ on = true, kind, rec = null, rejects = {}, now = Date.now(), P = PREP } = {}) {
  if (!on) return { file: false, why: 'off' }
  if (!PREP_KINDS.includes(kind)) return { file: false, why: 'kind' }
  if (!prepWorthy(rejects)) return { file: false, why: 'not_worthy' }
  const mine = requestsOf(rec).filter(r => r.requester?.kind === kind)
  if (mine.some(r => LIVE.includes(r.state))) return { file: false, why: 'live' }
  if (mine.some(r => r.state !== 'handed' && TERMINAL.includes(r.state) && now - (Number(r.at) || 0) < P.refileMs)) return { file: false, why: 'recent' }
  return { file: true, why: 'ok' }
}
/** A new request -> the request. Pure. */
export function siteRequest ({ kind, n = 1, by = '?', rejects = {}, seq = 1, now = Date.now(), P = PREP } = {}) {
  const top = Object.fromEntries(Object.entries(rejects ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6))
  return { id: `SP${seq}`, requester: { plot: kind, kind, n, by }, state: 'filed', filedAt: now, expiresAt: now + P.expireMs, rejects: top, plot: null, zone: null, cursor: 0, verifyFails: 0, retires: 0, handFails: 0, why: null, at: now }
}
/** The record with a request appended (a fresh record when there is none) -> the record. Pure. */
export function withRequest (cur, req, home) {
  const base = cur?.blueprint === SITEPREP_BLUEPRINT ? cur : { v: 1, blueprint: SITEPREP_BLUEPRINT, plot: SITEPREP_PLOT, home, requests: [], seq: 0, cells: [], structure_complete: true }
  return { ...base, seq: Math.max(Number(base.seq) || 0, Number(String(req.id).slice(2)) || 0), requests: [...requestsOf(base), req] }
}
/** The next request number -> int. Pure. */
export const nextSeq = rec => (Number(rec?.seq) || requestsOf(rec).length) + 1

/**
 * THE STATE TABLE -> the request after `ev` ({ type, ... }) | the same request (an event its state does not take). Pure. Every live
 * state has a terminal: filed -> refused | expired; prepping -> abandoned | expired (and back to filed, bounded by verifyMax/retireMax);
 * prepared -> handed | expired | abandoned (and back to filed once, bounded).
 *   chosen      filed -> prepping (ev.plot, ev.zone)
 *   pending     filed -> filed (ev.cursor: the search goes on next visit)
 *   refused     filed -> refused (ev.why)
 *   verified    prepping -> prepared
 *   verify_fail prepping -> filed (re-graded on the world as it is) | abandoned (verifyMax spent)
 *   retire      prepping -> filed (another project met the plot; the cursor moves on) | abandoned (retireMax spent)
 *   handed      prepared -> handed (ev.inst)
 *   hand_fail   prepared -> prepared (handFails + 1) | filed (handFailsMax: one re-prep, counted as a failed verify) | abandoned
 *   expire      filed | prepping | prepared -> expired
 */
export function prepStep (req, ev = {}, now = Date.now(), P = PREP) {
  if (!req || TERMINAL.includes(req.state)) return req
  const at = { at: now }
  const back = (field, max, why) => ((Number(req[field]) || 0) + 1 > max
    ? { ...req, ...at, state: 'abandoned', why, [field]: (Number(req[field]) || 0) + 1 }
    : { ...req, ...at, state: 'filed', why, plot: null, zone: null, cursor: (Number(req.cursor) || 0) + 1, [field]: (Number(req[field]) || 0) + 1 })
  switch (ev.type) {
    case 'expire': return { ...req, ...at, state: 'expired', why: ev.why ?? 'expired' }
    case 'chosen': return req.state === 'filed' ? { ...req, ...at, state: 'prepping', plot: ev.plot, zone: ev.zone, why: null } : req
    case 'pending': return req.state === 'filed' ? { ...req, ...at, cursor: Number(ev.cursor) || 0, why: ev.why ?? 'pending' } : req
    case 'refused': return req.state === 'filed' ? { ...req, ...at, state: 'refused', why: ev.why ?? 'refused' } : req
    case 'verified': return req.state === 'prepping' ? { ...req, ...at, state: 'prepared', readyAt: now, why: null } : req
    case 'verify_fail': return req.state === 'prepping' ? back('verifyFails', P.verifyMax, `verify:${ev.why ?? '?'}`) : req
    case 'retire': return req.state === 'prepping' ? back('retires', P.retireMax, `retire:${ev.why ?? '?'}`) : req
    case 'handed': return req.state === 'prepared' ? { ...req, ...at, state: 'handed', inst: ev.inst ?? null, why: null } : req
    case 'hand_fail': {
      if (req.state !== 'prepared') return req
      const n = (Number(req.handFails) || 0) + 1
      if (n < P.handFailsMax) return { ...req, ...at, handFails: n, why: `hand:${ev.why ?? '?'}` }
      return back('verifyFails', P.verifyMax, `hand:${ev.why ?? '?'}`)
    }
    default: return req
  }
}
/** Is a live request past its time? -> an `expire` event | null. Pure. A revisit never extends either clock (Codex). */
export function prepExpire (req, now = Date.now(), P = PREP) {
  if (!req || !LIVE.includes(req.state)) return null
  if (req.state === 'prepared' && now - (Number(req.readyAt) || 0) >= P.readyMs) return { type: 'expire', why: 'unclaimed' }
  if (req.state !== 'prepared' && now >= (Number(req.expiresAt) || 0)) return { type: 'expire', why: 'expired' }
  return null
}
/** The record with one request replaced by `next` (by id) -> the record. Pure. */
export const withStep = (rec, next) => ({ ...rec, requests: requestsOf(rec).map(r => (r.id === next.id ? next : r)) })

// ---- the reservation ---------------------------------------------------------------------------------------------------------------
/** THE ZONE of a plot (its graded box: the plot + the blend, widened by PREP.gap -- the margin the instance's own zone will hold). Pure. */
export function prepZoneOf (plotBox, { id, kind, P = PREP } = {}) {
  const m = P.blend + P.gap
  return { box: [plotBox[0] - m, -64, plotBox[1] - m, plotBox[2] + m, 320, plotBox[3] + m], why: `siteprep:${id}:${kind}`, for: kind, id }
}
/**
 * THE ZONES THAT HOLD NOW -> [zone]: every prepping or prepared request's, less `except` (the ONE request id a caller may ignore: the
 * pinned claim of that prepared request, and the keeper's own grading and verifying of it -- never an ordinary search of the kind:
 * Claude review r1 BLOCKER 1). Pure.
 */
export const prepZones = (rec, except = null) => requestsOf(rec).filter(r => (r.state === 'prepping' || r.state === 'prepared') && r.zone?.box && r.id !== except).map(r => r.zone)
/** The record as a RESERVATION (projectHeads: the land plan's pattern -- zones, no cells) -> a record. Pure. */
export const prepReservation = (rec, except = null) => ({ plot: SITEPREP_PLOT, blueprint: SITEPREP_BLUEPRINT, zones: prepZones(rec, except), cells: [], structure_complete: true })
/** Does a box [x0, z0, x1, z1] meet any zone's x/z box? Pure. */
export const boxMeetsAny = (b, zones = []) => zones.some(z => { const q = z?.box; return Array.isArray(q) && b[0] <= q[3] && b[2] >= q[0] && b[1] <= q[5] && b[3] >= q[2] })

// ---- the candidates ----------------------------------------------------------------------------------------------------------------
const k2 = (x, z) => `${x},${z}`
const spiral = r => { const out = [[0, 0]]; for (let d = 1; d <= r; d++) for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === d) out.push([dx, dz]); return out }
const MIN_B = { tower: 5, shrine: 7 }
/**
 * THE REQUESTER'S OWN CANDIDATES, with the bases prep may try -> [{ spot, cx, cz, seed, slot?, pair?, why, B, B0, dx, dz, corner, g }].
 * Pure. The spots are exactly the requester's (sinks.mjs siteSink: towerCandidates / the free shrineSlots) in its order; each is
 * tried at its own base and up to `P.smaller` smaller ones (a design's base is pinned: towerDesign/shrineDesign `pinB`), shifted at
 * most `P.offsets` columns. Never a new domain.
 */
export function prepCandidates ({ kind, home, pool = '', n = 1, wall = null, zig = null, rec = null, avail = {}, torch = false, campfire = false, P = PREP } = {}) {
  let spots = []
  if (kind === 'tower') {
    const seed0 = sinkSeed('tower', pool, home, n)
    const d0 = towerDesign(seed0, { avail, torch, campfire })
    spots = towerCandidates(wall, home, d0.g.B, seed0).map(c => ({ ...c, seed: seed0 }))
  } else if (kind === 'shrine') {
    if (!Array.isArray(zig?.box)) return []
    const used = new Set(instancesOf(rec).map(i => i.slot).filter(Boolean))
    spots = shrineSlots(zig, 13, sinkSeed('shrine', pool, home, 0)).filter(s => !used.has(s.slot)).map(s => ({ cx: s.cx, cz: s.cz, why: s.slot, slot: s.slot, pair: s.pair, seed: sinkSeed('shrine', pool, home, 1000 + s.pair) }))
  } else return []
  const out = []
  spots.forEach((c, spot) => {
    const face0 = faceToward(c.cx, c.cz, home)
    const design = B => (kind === 'tower' ? towerDesign(c.seed, { avail, face0, torch, campfire, pinB: B }) : shrineDesign(c.seed, { avail, face0, torch, campfire, pinB: B }))
    const B0 = design(null).g.B
    const Bs = []
    for (let B = B0, i = 0; B >= MIN_B[kind] && i <= P.smaller; B -= 2, i++) { const g = design(B).g; if (g.B === B && !Bs.includes(B)) Bs.push(B) }
    for (const B of Bs) {
      const g = design(B).g
      for (const [dx, dz] of spiral(P.offsets)) {
        const corner = { x: c.cx + dx - (B - 1) / 2, z: c.cz + dz - (B - 1) / 2 }
        out.push({ spot, cx: c.cx + dx, cz: c.cz + dz, seed: c.seed, ...(c.slot ? { slot: c.slot, pair: c.pair } : {}), why: c.why, B, B0, dx, dz, corner, g })
      }
    }
  })
  return out
}
/** The candidate's pinned square (base + apron + pad) and its graded box (+ blend) -> { pin: [x0, z0, x1, z1], box }. Pure. */
export function prepBoxes (cand, P = PREP) {
  const a = SITE_LIM.apron + P.pad
  const pin = [cand.corner.x - a, cand.corner.z - a, cand.corner.x + cand.B - 1 + a, cand.corner.z + cand.B - 1 + a]
  return { pin, box: [pin[0] - P.blend, pin[1] - P.blend, pin[2] + P.blend, pin[3] + P.blend] }
}
/**
 * THE CHEAP SCREEN of a candidate -> { ok, why, L, fill, cut, wet, cost } | { ok: false, why, cls }. Pure over `ground(x, z)` (sinks.mjs
 * groundAt's answers, memoised by the caller) and `wetCol(x, z)` (tidy.mjs waterColumn: { bed, surface, depth } | null) and `still(x,
 * y, z)` (a water cell that is a source). Every pinned column: any reservation (`guard`) is hard; a liquid column is the last resort
 * (still, at most P.waterDepth over a bed); a tree, a built block, an unread cell are hard. The level L: the least fill + 2 x cut with
 * every column within P.colMax; the plot within P.cutMax / P.fillMax.
 */
export function prepEstimate (cand, { ground, wetCol = () => null, still = () => false, guard = () => null, hy = 70, P = PREP } = {}) {
  const { pin } = prepBoxes(cand, P)
  for (let x = pin[0] - 1; x <= pin[2] + 1; x++) for (let z = pin[1] - 1; z <= pin[3] + 1; z++) {
    const why = guard(x, z, hy - SITE_LIM.scanDown, hy + SITE_LIM.scanUp)
    if (why) return { ok: false, why: `reserved:${String(why).slice(0, 40)}`, cls: 'hard' }
  }
  const ys = []
  let wet = 0, deep = 0
  for (let x = pin[0]; x <= pin[2]; x++) for (let z = pin[1]; z <= pin[3]; z++) {
    const g = ground(x, z)
    if (g?.why === 'liquid') {
      const w = wetCol(x, z)
      if (!w || w.depth > P.waterDepth) return { ok: false, why: 'water_deep', cls: 'hard' }
      for (let y = w.bed + 1; y <= w.surface; y++) if (!still(x, y, z)) return { ok: false, why: 'water_flowing', cls: 'hard' }
      wet++; deep = Math.max(deep, w.depth)
      ys.push(w.bed)
      continue
    }
    if (!g || g.why || !Number.isFinite(g.y)) return { ok: false, why: `col_${g?.why ?? 'unknown'}`, cls: 'hard' }
    ys.push(g.y)
  }
  if (wet > P.waterCols) return { ok: false, why: 'water_wide', cls: 'hard' }
  const lo = Math.min(...ys), hi = Math.max(...ys)
  let best = null
  for (let L = hi; L >= lo; L--) {
    let fill = 0, cut = 0, bad = false
    for (const y of ys) { const d = L - y; if (Math.abs(d) > P.colMax) { bad = true; break } if (d > 0) fill += d; else cut -= d }
    if (bad || cut > P.cutMax || fill > P.fillMax) continue
    const cost = fill + 2 * cut
    if (!best || cost < best.cost) best = { L, fill, cut, cost }
  }
  if (!best) return { ok: false, why: 'earth_over', cls: 'earth' }
  return { ok: true, why: 'ok', ...best, wet, deep }
}
/** A candidate's tier -> one of TIERS. Pure. `same` is the requester's first spot with a feasible dry estimate. */
export const tierOf = (c, sameSpot) => (c.est?.wet > 0 ? 'water' : c.spot === sameSpot ? (c.B === c.B0 ? 'same' : 'smaller') : 'other_dry')
/**
 * THE RANKED CANDIDATES -> [cand + { est, tier }]. Pure. Feasible estimates only; by tier (same, smaller, other_dry, water), then the
 * earthwork (fill + 2 x cut; water: the fewest wet columns, the shallowest, then the earthwork), then the requester's order.
 */
export function prepRank (cands = [], estOf, P = PREP) {
  const ok = []
  for (let i = 0; i < cands.length && i < P.estimateMax; i++) { const est = estOf(cands[i]); if (est.ok) ok.push({ ...cands[i], est, ord: i }) }
  const sameSpot = ok.filter(c => !c.est.wet).reduce((m, c) => Math.min(m, c.spot), Infinity)
  const tr = c => TIERS.indexOf(tierOf(c, sameSpot))
  return ok.map(c => ({ ...c, tier: tierOf(c, sameSpot) })).sort((a, b) => tr(a) - tr(b) || (a.est.wet - b.est.wet) || (a.est.deep - b.est.deep) || a.est.cost - b.est.cost || a.ord - b.ord)
}

// ---- the grading and its guards ---------------------------------------------------------------------------------------------------
/**
 * THE PREP'S EARTHWORK for one ranked candidate -> { ok, why, work: { cut, fill, seal, dam, leaves }, counts, L } . Pure. terrace.mjs
 * gradeTerraces over the graded box with every pinned column at L (`pin`): the 1-Lipschitz ramp round it, cave seals <= 3, the 11-01
 * water rule (dams before a cut beside water), `avoid` (every refusal; the tidy's own open work among them: never on another stage's
 * cells), the farm guard. A pin the solve cannot hold fails the candidate (`pin_*`); the plot's totals stay within P.cutMax / fillMax.
 */
export function prepGrade (read, cand, { home, avoid = () => null, cells = new Set(), farm = () => false, water = 'owner-1101', P = PREP } = {}) {
  const { pin, box } = prepBoxes(cand, P)
  const L = cand.est.L
  // the base and its ground stair exactly at L; the apron within a step of it (the requester takes L-1..L+1 there); the pad ring
  // round the apron free (the grading's own ramp: the requester asks only that it be dry)
  const pins = new Map()
  const stair = new Set(cand.g ? groundStairCols(cand.g, cand.corner).map(([x, z]) => k2(x, z)) : [])
  const A = SITE_LIM.apron
  for (let x = cand.corner.x - A; x <= cand.corner.x + cand.B - 1 + A; x++) for (let z = cand.corner.z - A; z <= cand.corner.z + cand.B - 1 + A; z++) {
    const inBase = x >= cand.corner.x && x < cand.corner.x + cand.B && z >= cand.corner.z && z < cand.corner.z + cand.B
    pins.set(k2(x, z), inBase || stair.has(k2(x, z)) ? L : [L - 1, L + 1])
  }
  const T = { ...TERRACE, maxCut: P.colMax, maxFill: P.colMax }
  const gr = gradeTerraces(read, box, { home, avoid, cells, levels: [], farm, water, pin: pins, T })
  if (!gr.pins?.ok) return { ok: false, why: `pin_${String(gr.pins?.bad?.[0] ?? '?').split(':').pop()}`, skipped: gr.skipped }
  const work = { cut: gr.cut, fill: gr.fill, seal: gr.seal, dam: gr.dam, leaves: gr.clearLeaves }
  const counts = { cut: gr.cut.length, fill: gr.fill.length, seal: gr.seal.length, dam: gr.dam.length }
  if (counts.cut > P.cutMax) return { ok: false, why: 'cut_over' }
  if (counts.fill + counts.seal + counts.dam > P.fillMax) return { ok: false, why: 'fill_over' }
  if (!counts.cut && !counts.fill && !counts.seal) return { ok: false, why: 'nothing_to_do' }
  return { ok: true, why: 'ok', work, counts, L, box, pin }
}
/** The world after the work (cuts and leaves air, fills, seals and dams solid) -> a read. Pure. */
export const prepAfter = (read, work) => tidyOverlay(read, { cut: work.cut, clear: work.leaves ?? [], cells: [...work.fill, ...work.seal, ...work.dam] }, 'cobblestone')
/**
 * NEVER WORSE (Codex review r1 BLOCKER 4) -> { ok, why, before, after }. Pure. terrace.mjs terraceWalk over the box spanning the
 * town edge (`from`) AND the graded box, + P.walkPad, before and after the work: the baseline must be non-empty (a walk that starts
 * nowhere proves nothing), every column walked to-and-back before is walked to-and-back after (the set, not the count), and the
 * stuck-prone columns do not rise.
 */
export function prepWalkOk (read, after, box, { home, from = [], dy = 16, P = PREP } = {}) {
  const xs = [box[0], box[2], ...from.map(f => f[0])], zs = [box[1], box[3], ...from.map(f => f[1])]
  const W = [Math.min(...xs) - P.walkPad, Math.min(...zs) - P.walkPad, Math.max(...xs) + P.walkPad, Math.max(...zs) + P.walkPad]
  const w0 = terraceWalk(read, W, home, from, { dy })
  if (!w0.back) return { ok: false, why: 'walk_unproven', before: w0 }
  const w1 = terraceWalk(after, W, home, from, { dy })
  for (const k of w0.backSet) if (!w1.backSet.has(k)) return { ok: false, why: 'walk_lost', detail: k, before: w0, after: w1 }
  if (w1.traps > w0.traps) return { ok: false, why: 'walk_traps', before: w0, after: w1 }
  return { ok: true, why: 'ok', before: w0, after: w1 }
}
/**
 * CHOOSE THE PLOT -> { ok: true, cand, grade } | { ok: false, why: 'pending', cursor, tried } | { ok: false, why: 'refused', top, tried }.
 * Pure but for the callbacks. From `cursor` in the ranked list: grade (prepGrade), the walk (prepWalkOk), then the REQUESTER'S OWN
 * acceptance on the after-world (`accept(afterRead, cand) -> { ok, why }`: siteSink pinned to the candidate). At most P.proofs a
 * call; the rest is `pending` (the search goes on next visit: a spent allowance is never "no dry land").
 */
export function prepChoose (read, ranked = [], { cursor = 0, home, from = [], avoid, cells, farm, water, accept = () => ({ ok: false, why: 'no_accept' }), P = PREP } = {}) {
  const tried = {}, skips = {}
  let proofs = 0, i = cursor
  for (; i < ranked.length; i++) {
    if (proofs >= P.proofs) return { ok: false, why: 'pending', cursor: i, tried, skips }
    const c = ranked[i]
    proofs++
    const gr = prepGrade(read, c, { home, avoid, cells, farm, water, P })
    if (!gr.ok) { tried[gr.why] = (tried[gr.why] ?? 0) + 1; for (const [k, v] of Object.entries(gr.skipped ?? {})) if (!/^col_|walk_kept|water_edge/.test(k)) skips[k] = (skips[k] ?? 0) + v; continue }
    const after = prepAfter(read, gr.work)
    const wk = prepWalkOk(read, after, gr.box, { home, from, P })
    if (!wk.ok) { tried[wk.why] = (tried[wk.why] ?? 0) + 1; continue }
    const ac = accept(after, c) ?? { ok: false, why: 'no_accept' }
    if (!ac.ok) { tried[`accept_${ac.why}`] = (tried[`accept_${ac.why}`] ?? 0) + 1; continue }
    return { ok: true, why: 'ok', cand: c, grade: gr, walk: { before: wk.before.back, after: wk.after.back }, cursor: i, tried }
  }
  const top = Object.entries(tried).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (ranked.length ? 'exhausted' : 'no_candidate')
  return { ok: false, why: 'refused', top, cursor: i, tried, skips }
}
/** The plot a chosen candidate makes (the request's `plot`). Pure. */
export function plotOf (ch) {
  const c = ch.cand
  return { cx: c.cx, cz: c.cz, B: c.B, seed: c.seed, ...(c.slot ? { slot: c.slot, pair: c.pair } : {}), corner: [c.corner.x, c.corner.z], L: ch.grade.L, box: ch.grade.pin, graded: ch.grade.box, tier: c.tier,
    earth: { ...ch.grade.counts, water: c.est.wet } }
}

// ---- the work on the keeper's tidy record ---------------------------------------------------------------------------------------
const segL = (id, k) => `${id}-L${String(k).padStart(2, '0')}`
/**
 * THE PREP ON THE TIDY RECORD -> the new record. Pure. Appended to the HEAD tidy record as a new generation (the storehouse floor
 * fix's pattern; the stage's own cells stay): dams first (`<id>-D`), the fills in height layers bottom first (`<id>-Lkk`, each
 * waiting on the one below), the seals (`<id>-S`, each with its `opener`). Every cell carries `prep: id`; a column's buried fills
 * are `core` (cobblestone first: the sink), its top fill `earth` (dirt first: it greens). The cuts (`prep: id`) and the head-room
 * leaves join the record's cut and clear lists. The record reads open; its radius covers the plot. `rec` null: a fresh tidy record.
 */
export function withPrep (rec, req, work, { home, now = Date.now() } = {}) {
  const id = req.id
  const base = rec ?? { v: 1, blueprint: TIDY_BLUEPRINT, plot: TIDY_PLOT, home: { x: home.x, y: home.y, z: home.z }, r: TIDY.r, cells: [], clear: [], cut: [], replant: [], segments: [], zones: [], skipped: {}, bom: { earth: 0 }, builders_max: TIDY_BUILDERS, structure_complete: false, sitedAt: now }
  const have = new Set((base.cells ?? []).map(c => c.at.join(',')))
  const top = new Map()
  for (const f of work.fill) { const k = k2(f.at[0], f.at[2]); top.set(k, Math.max(top.get(k) ?? -Infinity, f.at[1])) }
  const ys = [...new Set(work.fill.map(f => f.at[1]))].sort((a, b) => a - b)
  const cells = [], segs = []
  const dams = work.dam.filter(d => !have.has(d.at.join(',')))
  if (dams.length) { segs.push({ seg: `${id}-D`, deps: [] }); for (const d of dams) cells.push({ at: d.at, role: 'core', seg: `${id}-D`, dam: true, prep: id }) }
  ys.forEach((y, k) => {
    const mine = work.fill.filter(f => f.at[1] === y && !have.has(f.at.join(',')))
    if (!mine.length) return
    segs.push({ seg: segL(id, k), deps: k > 0 && segs.some(s => s.seg === segL(id, k - 1)) ? [segL(id, k - 1)] : [] })
    for (const f of mine) cells.push({ at: f.at, role: f.at[1] < top.get(k2(f.at[0], f.at[2])) ? 'core' : 'earth', seg: segL(id, k), prep: id })
  })
  const seals = work.seal.filter(s => !have.has(s.at.join(',')) && !cells.some(c => c.at.join(',') === s.at.join(',')))
  if (seals.length) { segs.push({ seg: `${id}-S`, deps: [] }); for (const s of seals) cells.push({ at: s.at, role: 'core', seg: `${id}-S`, opener: s.opener, prep: id }) }
  const cutK = new Set((base.cut ?? []).map(c => c.at.join(',')))
  const cut = work.cut.filter(c => !cutK.has(c.at.join(','))).map(c => ({ at: c.at, kind: 'tidy', name: c.name, prep: id }))
  const clrK = new Set((base.clear ?? []).map(c => c.at.join(',')))
  const clear = (work.leaves ?? []).filter(c => !clrK.has(c.at.join(','))).map(c => ({ ...c, prep: id }))
  const xs = [...work.fill, ...work.cut, ...work.seal, ...work.dam].map(c => Math.max(Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z)))
  return {
    ...base, cells: [...cells, ...(base.cells ?? [])], segments: [...segs, ...(base.segments ?? [])], cut: [...(base.cut ?? []), ...cut],
    clear: [...(base.clear ?? []), ...clear].sort((a, b) => a.at[1] - b.at[1]), r: Math.max(Number(base.r) || TIDY.r, ...xs.map(d => d + 2)),
    structure_complete: false, state: 'open', prepAt: now, prep: { ...(base.prep ?? {}), [id]: { at: now, cells: cells.length, cut: cut.length } },
  }
}
/** A request's open work on the tidy record -> { cells, cuts, clears } (`done(cell)` the visit's done test; a cut open while it
 *  stands; a clear open while it holds its block). Pure. */
export function prepOpen (rec, id, read, done = () => false) {
  const cells = (rec?.cells ?? []).filter(c => c.prep === id && !c.prev && !done(c))
  const cuts = (rec?.cut ?? []).filter(c => c.prep === id && cutStanding(read, c))
  const clears = (rec?.clear ?? []).filter(c => c.prep === id && cutStanding(read, c))
  return { cells, cuts, clears, n: cells.length + cuts.length + clears.length }
}
/**
 * THE PREP'S CUTS IN LAYERS (Baritone #404/#728: a cutter that takes a column to the bottom first digs itself a shaft; Codex review r1
 * BLOCKER 5): the highest layer across the plot first, each layer nearest-neighbour from `start` -> the cuts. No cut column is ever
 * more than one layer below its cut neighbours mid-way. Pure.
 */
export function prepCutOrder (cuts = [], start = [0, 0]) {
  const ys = [...new Set(cuts.map(c => c.at[1]))].sort((a, b) => b - a)
  const out = []
  let [px, pz] = start
  for (const y of ys) {
    const left = cuts.filter(c => c.at[1] === y)
    while (left.length) {
      let bi = 0, bd = Infinity
      for (let i = 0; i < left.length; i++) { const d = Math.abs(left[i].at[0] - px) + Math.abs(left[i].at[2] - pz); if (d < bd) { bd = d; bi = i } }
      const c = left.splice(bi, 1)[0]
      out.push(c); px = c.at[0]; pz = c.at[2]
    }
  }
  return out
}
/**
 * RETIRE A DEAD REQUEST'S WORK (Claude + Codex review r1 BLOCKER 3) -> the tidy record without it | null (nothing of it open). Pure.
 * Its cuts still standing and its fills not laid leave the record -- except what closes a column a dug cut opened: a seal whose
 * opener is dug, a dam beside a dug cut (caves and water stay closed). Laid cells stay (the tripwire judges them on the head).
 */
export function retirePrep (rec, id, read, done = () => false) {
  if (!rec) return null
  const dug = new Set((rec.cut ?? []).filter(c => c.prep === id && !cutStanding(read, c)).map(c => c.at.join(',')))
  const near = at => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => dug.has(`${at[0] + dx},${at[1]},${at[2] + dz}`))
  const keep = c => c.prep !== id || c.prev || done(c) || (c.opener && dug.has(c.opener.join(','))) || (c.dam && near(c.at))
  const cells = (rec.cells ?? []).filter(keep)
  const cut = (rec.cut ?? []).filter(c => c.prep !== id || !cutStanding(read, c))
  const clear = (rec.clear ?? []).filter(c => c.prep !== id || !cutStanding(read, c))
  if (cells.length === (rec.cells ?? []).length && cut.length === (rec.cut ?? []).length && clear.length === (rec.clear ?? []).length) return null
  const used = new Set(cells.map(c => c.seg))
  const segments = (rec.segments ?? []).filter(s => !String(s.seg).startsWith(`${id}-`) || used.has(s.seg)).map(s => ({ ...s, deps: (s.deps ?? []).filter(d => !String(d).startsWith(`${id}-`) || used.has(d)) }))
  return { ...rec, cells, cut, clear, segments, prepRetired: { ...(rec.prepRetired ?? {}), [id]: true } }
}

// ---- the hand-over ---------------------------------------------------------------------------------------------------------------
/** VERIFY -> 'wait' (work open) | 'verified' | 'verify_fail'. Pure: `open` the request's open work count; `acc` the requester's
 *  acceptance on the REAL world at the plot. No waiver completes a prep: only the requester's own proof (Codex review). */
export const prepVerifyDecision = ({ open = 0, acc = null } = {}) => (open > 0 ? 'wait' : acc?.ok ? 'verified' : 'verify_fail')
/** The prepared request a requester kind claims now -> the request | null. Pure. */
export const prepClaimFor = (rec, kind) => requestsOf(rec).find(r => r.state === 'prepared' && r.requester?.kind === kind && r.plot) ?? null
/** The `ctx.prep` the requester's siteSink takes for a request -> { id, cx, cz, B, seed, slot?, pair? }. Pure (the plot's SEED: the
 *  instance number may have moved on -- Claude review r1 note). */
export const prepPin = req => (req?.plot ? { id: req.id, cx: req.plot.cx, cz: req.plot.cz, B: req.plot.B, seed: req.plot.seed, ...(req.plot.slot ? { slot: req.plot.slot, pair: req.plot.pair } : {}) } : null)
/** Is the request already handed in the requester's record (an instance tagged with its id: the claim's second write lost)? Pure. */
export const prepHandedIn = (sinkRec, id) => instancesOf(sinkRec).find(i => i.prep === id) ?? null

/**
 * A FINISHED ZIGGURAT'S SUCCESSOR -> the sink plot to order | null. Pure. The monument complete, the first stone sink (shrines first:
 * they belong to the ziggurat) that is on and wanted (`sinkNext`) and has no open instance. With no sink on (the fleet today), null:
 * siteprep alone gives board-b nothing (the design's section 5).
 */
export function successorDue (states = [], order = ['shrine', 'tower', 'road']) {
  const st = p => states.find(s => s?.plot === p) ?? null
  if (!st('monument')?.complete) return null
  for (const k of order) { const s = st(k); if (s && s.sinkNext && !s.sinkOpen) return k }
  return null
}

/** The `_siteprep` row's detail. Pure. */
export function prepRowDetail (f = {}) {
  return Object.entries({ op: f.op, id: f.id, kind: f.kind, state: f.state, tier: f.tier, B: f.B, cut: f.cut, fill: f.fill, seal: f.seal, dam: f.dam, water: f.water, cursor: f.cursor, n: f.n, cell: f.cell, why: f.why, gen: f.gen })
    .filter(([, v]) => v != null).map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : v).replace(/\s+/g, '_').slice(0, k === 'why' ? 120 : 48)}`).join(' ')
}
/** A memo of sinks.mjs groundAt over a read (the cheap screen's columns overlap heavily) -> (x, z) -> answer. Pure. */
export function groundMemo (read, hy) {
  const m = new Map()
  return (x, z) => { const k = k2(x, z); if (!m.has(k)) m.set(k, groundAt(read, x, z, hy + SITE_LIM.scanUp, hy - SITE_LIM.scanDown)); return m.get(k) }
}
/** A memo of tidy.mjs waterColumn (the last resort's bed and depth). Pure. */
export function wetMemo (read, hy, P = PREP) {
  const m = new Map()
  return (x, z) => { const k = k2(x, z); if (!m.has(k)) m.set(k, waterColumn(read, x, z, { yHi: hy + SITE_LIM.scanUp, yLo: hy - SITE_LIM.scanDown, depth: P.waterDepth })); return m.get(k) }
}
/** A still water cell: water whose `level` property reads 0 (a source). Unknown props: not still (the last resort refuses). Pure. */
export const stillWater = b => !!b && String(b.name ?? '') === 'water' && Number(b.props?.level ?? b.level ?? NaN) === 0

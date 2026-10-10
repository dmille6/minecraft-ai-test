// CHEST PRUNING (stocktarget-01; owner 10-10 via the operator: "when a bot opens a town chest, it takes over-target surplus
// stacks out and sends them down the junk well, bounded per visit, never below target, and never protected items.
// Chests then drain on their own"). Design: docs/reports/stocktargets-design-2026-10-08.md section 3.5.
//
// A deterministic town order (never the model's): at town, with a usable well and room in the bag, the journal shows a
// town container whose fresh (1 h) count holds full stacks of a group the town holds MORE than its target of (the
// available floor less one stack is still at or above target). The skill (skills.mjs pruneTown) takes at most
// PRUNE_MAX_STACKS full stacks under confirmed TAKE claims, closes with the post-transfer count, and throws exactly what it
// took down the well. Pure here: the pick and the order.

import { groupOf, targetOf, isToolGroup, namesOf } from './stocktarget.mjs'
import { countOf, FLOOR_TTL_MS } from './cobblecap.mjs'

export const PRUNE_MAX_STACKS = 4
export const PRUNE_STACK = 64
/** 10 min (STOCK_PRUNE_COOLDOWN_MS overrides it for the Paper sandbox driver only). */
export const PRUNE_COOLDOWN_MS = Number(process.env.STOCK_PRUNE_COOLDOWN_MS) > 0 ? Number(process.env.STOCK_PRUNE_COOLDOWN_MS) : 10 * 60 * 1000
export const PRUNE_BACKOFF_MS = 30 * 60 * 1000
/** The bag must keep this many empty slots after the take. */
export const PRUNE_FREE_AFTER = 1

/**
 * WHICH CONTAINER, AND HOW MANY FULL STACKS OF WHICH GROUPS -> { k, takes: [{ group, stacks }], stacks } or null. Pure.
 *   obs      the fold's counts { k: { n, at, v, m, lo } }
 *   keys     the town's container keys (a covered scan)
 *   avail    group -> the town's AVAILABLE floor (fresh counts, the smaller of ties, less live takes and draws)
 *   free     empty bag slots now
 * A container counts only with a v2 count captured within the floor's hour; a group only if bulk (never a tool) and the
 * town keeps >= its target after every stack taken. The container offering the most stacks wins (then the key, stable).
 */
export function prunePick ({ obs = {}, keys = [], avail = {}, free = 0, now = Date.now(), max = PRUNE_MAX_STACKS, accept = null } = {}) {
  const room = Math.min(max, Math.max(0, free - PRUNE_FREE_AFTER))
  if (room <= 0) return null
  let best = null
  for (const k of [...new Set(keys)].sort()) {
    const o = obs[k]
    if (!o || !(Number(o.v) >= 2) || !Number.isFinite(o.at) || now - o.at >= FLOOR_TTL_MS) continue
    const src = o.lo ?? o
    const takes = []
    let left = room
    // ONLY WHAT THE WELL WILL THROW FROM THIS BAG (Claude code r2 P2-2; `accept` = pruneAccepted over the bot's bag), judged
    // WHILE the budget fills (Codex code r3 P2: judged after, a rejected group starved every later one): a stack the keeps
    // would leave in the bag is never walked for (the open container judges again, by name); listed junk always goes
    const accepted = []
    for (const g of Object.keys(src.m ?? {}).sort()) {
      if (left <= 0) break
      if (isToolGroup(g)) continue
      // the well's JUNK LIST (pseudo-group `junk`, target 0): any of its stacks, partial ones too -- nothing to keep
      const c = countOf(src, g) ?? 0
      let n = g === 'junk' ? Math.min(left, c > 0 ? Math.max(1, Math.floor(c / PRUNE_STACK)) : 0)
        : Math.min(Math.floor(c / PRUNE_STACK), Math.floor(((Number(avail[g]) || 0) - targetOf(g)) / PRUNE_STACK), left)
      if (accept && g !== 'junk' && n > 0) {
        let ok = 0
        for (let i = 0; i < n; i++) {
          const trial = [...accepted, { group: g, name: namesOf(g)[0], count: PRUNE_STACK }]
          let got = []
          try { got = accept(trial) } catch { got = [] }
          if (got.length !== trial.length) break   // pruneAccepted judges each take after the ones before: the new one was refused
          accepted.push(trial.at(-1)); ok++
        }
        n = ok
      }
      if (n > 0) { takes.push({ group: g, stacks: n }); left -= n }
    }
    const total = takes.reduce((t, x) => t + x.stacks, 0)
    if (total > 0 && (!best || total > best.stacks)) best = { k, takes, stacks: total }
  }
  return best
}

/**
 * THE FULL STACKS TO TAKE AT THE OPEN CONTAINER -> [{ name, count, group }] (count = PRUNE_STACK each). Pure over the
 * window's container items. Only names of the picked groups, only FULL stacks (a full stack cannot merge, so the bag
 * gains exactly what the server moved), at most `stacks` per group.
 */
export function pruneTakes (containerItems = [], takes = [], { isJunk = () => false } = {}) {
  const out = []
  for (const { group, stacks } of takes) {
    const names = new Set(namesOf(group))
    let n = 0
    for (const it of containerItems) {
      if (n >= stacks) break
      if (group === 'junk') { if (it?.name && isJunk(it.name) && !groupOf(it.name) && (it.count ?? 0) > 0) { out.push({ name: it.name, count: it.count, group }); n++ } continue }
      if (it?.name && names.has(it.name) && (it.count ?? 0) === PRUNE_STACK && groupOf(it.name) === group) { out.push({ name: it.name, count: PRUNE_STACK, group }); n++ }
    }
  }
  return out
}

/**
 * WHAT THE WELL WILL TAKE OF A PRUNE (Claude code r2 P2-2) -> the subset of `takes`, in order, that the well's OWN rule
 * would throw from the bag holding them. Pure. `thrown(items)` -> the stacks the well would throw from `items` (well.mjs
 * disposePlan's stacks). A take is kept only when it raises what the well throws of its name by its WHOLE count: the bag
 * then ends with what it had. A take the keeps, the 64 pillar blocks, the cobble reserve or a hold would leave in the bag
 * is never taken -- it would only fill the bag (the canary's primary is bag slots).
 */
export function pruneAccepted (bag = [], takes = [], thrown = () => []) {
  const SLOT0 = 1000   // the takes as stacks the bag does not hold yet (well rules read Number.isInteger(slot))
  const base = (Array.isArray(bag) ? bag : []).filter(it => it?.name && (Number(it.count) || 0) > 0)
  const of = (stacks, name) => (Array.isArray(stacks) ? stacks : []).reduce((t, s) => t + (s?.name === name ? (Number(s.count) || 0) : 0), 0)
  const out = []
  for (const tk of (Array.isArray(takes) ? takes : [])) {
    if (!tk?.name || !((Number(tk.count) || 0) > 0)) continue
    const before = [...base, ...out.map((o, i) => ({ name: o.name, count: o.count, slot: SLOT0 + i }))]
    const after = [...before, { name: tk.name, count: tk.count, slot: SLOT0 + out.length }]
    let gain
    try { gain = of(thrown(after), tk.name) - of(thrown(before), tk.name) } catch { break }   // an unreadable rule takes nothing more
    if (gain >= tk.count) out.push(tk)
  }
  return out
}

const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * THE ORDER -> { order, state }. Pure; cognitive.mjs supplies the readings.
 *   atTown, freeSlots, wellUsable   cheap, first
 *   pick      prunePick(...) for this bot -- lazy, at most once per cooldown
 *   state     { lastIssuedAt, backoffUntil }
 */
export function pruneOrder ({ now = 0, atTown = false, freeSlots = 0, wellUsable = false, pick = null, state = {} } = {}) {
  const s = { ...state }
  if (!atTown || freeSlots < PRUNE_FREE_AFTER + 1) return { order: null, state: s }
  if (now - (s.lastIssuedAt ?? -Infinity) < PRUNE_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return { order: null, state: s }
  if (!lazy(wellUsable)) return { order: null, state: s }   // the well's scan only after the cheap gates (Claude code r1 P3)
  s.lastIssuedAt = now                                 // the cooldown is charged for the look, not only for the order
  const p = lazy(pick)
  if (!p) return { order: null, state: s }
  return { order: { skill: 'prune_town', args: {}, why: `the town holds more than its target of ${p.takes.map(t => t.group).join(', ')}; ${p.stacks} full stack(s) go from the chest at ${p.k} down the junk well` }, state: s }
}

/** After the order ran -> the new state: a failure backs off; success or a skip costs only the cooldown. */
export function pruneOutcome (status, now = 0, state = {}) {
  const s = { ...state }
  if (status === 'failed') s.backoffUntil = now + PRUNE_BACKOFF_MS
  return s
}

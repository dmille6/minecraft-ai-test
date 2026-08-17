/**
 * board-visit.mjs -- the act of going to the board.
 *
 * board.mjs holds the town's rules; this file is the trip. Kept separate
 * because the rules are the experiment's independent variable and must stay
 * testable without a world, a bot, or a filesystem.
 *
 * THE PROXIMITY GATE IS THE TREATMENT. A bot may only read or file within
 * BOARD_RADIUS of the lectern, so every belief that crosses between bots costs
 * a walk, arrives late, and was chosen. Remove the gate and this arm is the
 * hive with extra steps; remove the lectern from the world and the board is
 * simply dead, which is intended -- it is part of the world's physics, not a
 * service that happens to have coordinates.
 */
import { Board, claimId, freshnessCredit, quorumState } from './board.mjs'
import { config } from './config.mjs'
import { log, logEvent } from './logger.mjs'

/** Euclidean distance ignoring nothing -- the walk is vertical too. */
export function withinBoard(pos, board = config.world, radius = null) {
  if (!pos) return false
  const r = radius ?? board.boardRadius
  const dx = pos.x - board.boardX, dy = pos.y - board.boardY, dz = pos.z - board.boardZ
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= r
}

/**
 * Which of a bot's private beliefs are worth filing.
 *
 * Only beliefs backed by the bot's OWN failures, and only ones it has not
 * filed before. Filing everything each visit would let one bot's repeated
 * trips look like a growing consensus, which the board's dedup already blocks
 * -- but doing it here as well keeps the ledger honest about intent, not just
 * about effect.
 */
export function pendingReports(lessons, filed = new Set()) {
  const out = []
  for (const [k, e] of Object.entries(lessons?.data?.avoid ?? {})) {
    if ((e.fails ?? 0) < 1) continue
    const id = claimId('avoid', k)
    if (filed.has(id)) continue
    // The dominant failure class IS the claim's type; typed quorum needs it.
    const cls = Object.entries(e.classes ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
    out.push({ id, kind: 'avoid', tier: 'rule', subject: k, failClass: cls,
               observed_at: e.since ?? e.last ?? Date.now(), where: e.where ?? null })
  }
  return out
}

/**
 * Merge an adopted claim into private memory, PRESERVING PROVENANCE.
 *
 * `reporters` is the field the whole hypothesis turns on: a bot blocked by its
 * own four failures learned something, while a bot blocked by a claim it read
 * off a lectern is carrying a belief it never tested. logger.mjs derives
 * `memory.inherited` from exactly this, so the board arm gets the same
 * inherited-belief measurement the hive arm already has, for free.
 */
export function adoptInto(lessons, claim, self) {
  const reporters = (claim.reports ?? []).map(r => r.reporter).filter(n => n !== self)
  if (!reporters.length) return false            // nothing here this bot did not already know
  const k = claim.subject
  const e = lessons.data.avoid[k] ??= { skill: k.split(':')[0], args: {}, fails: 0, classes: {} }
  const before = e.fails ?? 0
  // Adoption grants the claim's WEIGHT, not its raw failure count: the board
  // says "two bots hit this", and that is what the gate should weigh. Copying
  // every reporter's tally would let a well-travelled claim outvote first-hand
  // experience.
  e.fails = Math.max(before, reporters.length)
  e.reporters = [...new Set([...(e.reporters ?? []), ...reporters])]
  e.since ??= Date.now()
  e.last = Date.now()
  e.adopted_from_board = true
  lessons.dirty = true
  return e.fails > before || true
}

/** Open the town board for this world. One board per arm, named for the ledger. */
export function openBoard(fs, id = config.memory.pool) {
  return new Board(`${config.log.stateDir}/board-${id}.json`, fs, id)
}

/**
 * A whole visit: file what is pending, take what has quorum.
 *
 * Returns the counts the evidence gate needs (`filed`, `adopted`). A visit
 * that changed nothing returns zeroes and is correctly recorded as a no-op --
 * the board arm must not be able to claim value for a walk that accomplished
 * nothing, or "visits the board often" becomes a way to look productive.
 */
export function doVisit({ board, lessons, self, pos, now = Date.now(), filed = new Set() }) {
  const events = []
  let nFiled = 0, nAdopted = 0, credit = 0

  for (const r of pendingReports(lessons, filed)) {
    const distance = r.where
      ? Math.hypot(r.where.x - config.world.boardX, r.where.z - config.world.boardZ) : 0
    const ev = board.post({ ...r, reporter: self, distance, now })
    filed.add(r.id)
    nFiled++
    const claim = board.data.claims[r.id]
    const mine = claim?.reports?.find(x => x.reporter === self)
    const myCredit = mine ? freshnessCredit(mine, claim, now) : 0
    credit += myCredit
    // carried_ms IS the treatment: how long this knowledge sat in a pocket
    // before it reached the town. The hive pays zero here by construction.
    events.push({ ...ev, credit: myCredit, distance,
                  carried_ms: mine ? Math.max(0, (mine.posted_at ?? now) - (mine.observed_at ?? now)) : 0 })
  }

  for (const claim of board.readable(now)) {
    if (adoptInto(lessons, claim, self)) {
      nAdopted++
      events.push({ event: 'read', claim: claim.id, state: quorumState(claim),
                    reporters: claim.reports.length,
                    // how stale the claim was when this bot took it on
                    carried_ms: Math.max(0, now - (claim.posted_at ?? now)),
                    distance: claim.distance ?? 0 })
    }
  }

  const expired = board.sweep(now)
  for (const id of expired) events.push({ event: 'expire', claim: id, state: 'expired' })

  board.save()
  lessons.save?.()

  for (const ev of events) {
    logEvent({ kind: `board_${ev.event}`, status: 'success',
               detail: `${ev.claim} -> ${ev.state} (${ev.reporters ?? 0} reporters)`,
               snapshot: { bot: { name: self }, game: {} },
               board: { id: board.boardId, event: ev.event, claim: ev.claim,
                        state: ev.state, reporters: ev.reporters ?? 0,
                        credit: ev.credit ?? 0, carried_ms: ev.carried_ms ?? 0,
                        distance: ev.distance ?? 0 } })
  }
  log('info', 'board visit', { filed: nFiled, adopted: nAdopted, credit })
  return { filed: nFiled, adopted: nAdopted, credit: Math.round(credit * 100) / 100, events }
}

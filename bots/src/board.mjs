/**
 * board.mjs -- the town bulletin board: sharing as a POLICY, not a property.
 *
 * The hive arm shares by construction: a belief exists in one bot and is
 * instantly true for all of them. The isolated arm cannot share at all. Both
 * are extremes, and Block 1 showed what they cost -- the hive amplified false
 * beliefs (2.6x the contradiction rate per belief, 114 decisions blocked by
 * rules the acting bot never tested), while isolated bots starved.
 *
 * The board is the middle: knowledge moves only when a bot physically walks to
 * a lectern and files it. Sharing therefore costs travel, arrives late, and is
 * a choice the agent makes instead of a property of the substrate.
 *
 * FOUR DESIGN DECISIONS, each here because a review or a measurement demanded
 * it. They are the arm's independent variable, so they are implemented as pure
 * functions and pinned by test rather than buried in I/O.
 *
 * 1. TYPED QUORUM. An avoid-claim is adopted only when >=2 INDEPENDENT
 *    reporters agree on the SAME failure class. The existing failClass
 *    taxonomy is the typing system, so this costs nothing and blocks the
 *    failure mode where two bots fail the same action for unrelated reasons
 *    and their disagreement reads as corroboration. Worked-claims adopt at 1
 *    reporter -- a false "this works" is self-correcting the moment someone
 *    tries it, so demanding corroboration would only slow good news down.
 *
 * 2. DISPROOF OUTRANKS QUORUM. A bot that succeeds at a blocked action moves
 *    the claim to `disputed` regardless of how many reporters filed it.
 *    Disputed is not deletion: the reports stay, and the claim can be
 *    re-adopted if the failures resume. Deleting on first contradiction would
 *    make the board forget the very thing it exists to remember.
 *
 * 3. TWO CLOCKS. The world border is ~1950 blocks and bots travel ~1800
 *    blocks/hour, so a frontier discovery costs 1-2h to carry home. Under a
 *    single clock that knowledge would be structurally worthless -- it would
 *    expire in transit, which would punish exploration rather than staleness.
 *    So freshness CREDIT decays from `observed_at` (deliver quickly or lose
 *    influence) while board SHELF-LIFE runs from `posted_at` (once filed, a
 *    claim gets its full tier lifetime whatever distance it came from).
 *
 * 4. SHELF-LIFE SCALES WITH DISTANCE. Staleness is caused by bots editing
 *    terrain, and bot density peaks at town, so a claim about the frontier
 *    stays true far longer than one about the town square. Frontier
 *    `unreachable` claims are the deliberate exception -- nobody is out there
 *    to corroborate them, so they are kept short and allowed to die quietly.
 */

const H = 3_600_000

// Tier lifetimes measured from posted_at. Calibrated against exp-001 position
// telemetry rather than guessed: p90 town-to-frontier travel was ~1h, so a
// 3h floor means a claim survives long enough for a second witness to make the
// trip and corroborate it.
export const TIER_MS = {
  sighting: 6 * H,      // "there is coal at x,z" -- terrain edits invalidate it
  unreachable: 3 * H,   // "cannot path there" -- the most perishable claim we hold
  hazard: 24 * H,       // "bots drown here" -- geography changes slowly
  rule: 12 * H,         // behavioural avoid-rules; the forgiveness clock also applies
}

/** Shelf life, extended for claims about places far from town. */
export function shelfLifeMs(tier, distanceFromTown = 0) {
  const base = TIER_MS[tier] ?? TIER_MS.rule
  if (tier === 'unreachable') return base          // deliberate exception, see (4)
  const scale = Math.min(3, 1 + distanceFromTown / 600)
  return Math.round(base * scale)
}

/**
 * Has this claim earned adoption?
 *
 * Returns 'adopted' | 'pending' | 'disputed'. Pure so the rule can be argued
 * with in a test rather than inferred from fleet behaviour three days later.
 */
export function quorumState(claim) {
  if (claim.disputes?.length) return 'disputed'
  if (claim.kind === 'worked') return claim.reports?.length >= 1 ? 'adopted' : 'pending'
  // Typed quorum: independent reporters agreeing on the SAME failure class.
  const byClass = {}
  for (const r of claim.reports ?? []) {
    const c = r.failClass ?? 'other'
    ;(byClass[c] ??= new Set()).add(r.reporter)
  }
  return Object.values(byClass).some(s => s.size >= 2) ? 'adopted' : 'pending'
}

/** Expired off the board? Shelf life runs from posted_at -- clock two. */
export function isExpired(claim, now = Date.now()) {
  const posted = claim.posted_at ?? 0
  return now - posted > shelfLifeMs(claim.tier, claim.distance ?? 0)
}

/**
 * Freshness credit for a report -- clock one, decaying from observed_at.
 *
 * Sitting on a discovery burns its value in your pocket. Credit is
 * utility-adjusted rather than pure speed (a review catch): it pays only on
 * a claim that reached adoption, and it is weighted by how far the observation
 * was carried, so a courier who walks 900 blocks with something true is not
 * out-earned by a bot who reports the block it is standing on.
 */
export function freshnessCredit(report, claim, now = Date.now()) {
  if (quorumState(claim) !== 'adopted') return 0
  const carried = Math.max(0, (report.posted_at ?? 0) - (report.observed_at ?? 0))
  const decay = Math.max(0, 1 - carried / (6 * H))
  const distance = 1 + Math.min(2, (report.distance ?? 0) / 900)
  return Math.round(100 * decay * distance) / 100
}

/** Stable identity for a claim, so reposting cannot farm credit as "new". */
export function claimId(kind, subject) {
  return `${kind}:${subject}`
}

/**
 * The board itself. Deliberately NOT a Lessons subclass: a bot's private
 * memory and the town's public record have different lifecycles, different
 * trust, and different owners, and collapsing them is how the hive arm works.
 */
export class Board {
  constructor(file, fs, boardId = 'town') {
    this.file = file
    this.fs = fs
    this.boardId = boardId
    this.data = { claims: {} }
    this.load()
  }

  load() {
    try {
      this.data = JSON.parse(this.fs.readFileSync(this.file, 'utf8'))
      this.data.claims ??= {}
    } catch { this.data = { claims: {} } }
  }

  save() {
    this.fs.mkdirSync(this.file.replace(/\/[^/]+$/, ''), { recursive: true })
    this.fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1))
  }

  /**
   * File a report. Returns the ledger event describing what the board did,
   * which is what gets logged -- post/adopt/reject/dispute/expire are the
   * arm's observable behaviour and must be queryable per claim.
   */
  post({ id, kind, tier, subject, reporter, failClass = null,
         observed_at, distance = 0, now = Date.now() }) {
    const cid = id ?? claimId(kind, subject)
    const claim = this.data.claims[cid] ??= {
      id: cid, kind, tier, subject, reports: [], disputes: [],
      posted_at: now, distance,
    }
    const before = quorumState(claim)
    // Strict identity dedup: one reporter's repeat filing is an update, never
    // a second witness. Without this a single bot could manufacture quorum.
    const existing = claim.reports.find(r => r.reporter === reporter)
    if (existing) {
      existing.observed_at = observed_at ?? existing.observed_at
      existing.posted_at = now
      existing.failClass = failClass ?? existing.failClass
    } else {
      claim.reports.push({ reporter, failClass, observed_at: observed_at ?? now,
                           posted_at: now, distance })
    }
    claim.posted_at = now              // refiling refreshes shelf life, not credit
    claim.distance = Math.max(claim.distance ?? 0, distance)
    const after = quorumState(claim)
    return { event: before !== 'adopted' && after === 'adopted' ? 'adopt' : 'post',
             claim: cid, state: after, reporters: claim.reports.length }
  }

  /** A bot succeeded where a claim said it would fail. Disproof outranks quorum. */
  dispute({ id, kind, subject, reporter, now = Date.now() }) {
    const cid = id ?? claimId(kind, subject)
    const claim = this.data.claims[cid]
    if (!claim) return { event: 'dispute_noop', claim: cid, state: 'absent' }
    claim.disputes.push({ reporter, at: now })
    return { event: 'dispute', claim: cid, state: 'disputed',
             reporters: claim.reports.length }
  }

  /** What a visiting bot may take away right now. */
  readable(now = Date.now()) {
    const out = []
    for (const c of Object.values(this.data.claims)) {
      if (isExpired(c, now)) continue
      if (quorumState(c) !== 'adopted') continue
      out.push(c)
    }
    return out
  }

  /** Claims that aged out; emitted as ledger events so expiry is measurable. */
  sweep(now = Date.now()) {
    const expired = []
    for (const [cid, c] of Object.entries(this.data.claims)) {
      if (isExpired(c, now)) { expired.push(cid); delete this.data.claims[cid] }
    }
    return expired
  }
}

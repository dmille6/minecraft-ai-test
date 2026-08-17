// THE BOARD'S RULES ARE THE ARM'S INDEPENDENT VARIABLE.
//
// Everything the board arm claims rests on four decisions -- typed quorum,
// disproof outranking quorum, two clocks, and distance-scaled shelf life. If
// any of them silently misbehaves, Block 2 measures something other than what
// the pre-registration says it measures, and no amount of downstream analysis
// would reveal it. So they are pure functions, and this file argues with them.
import assert from 'node:assert'
import { Board, quorumState, isExpired, shelfLifeMs, freshnessCredit, claimId, TIER_MS }
  from '../src/board.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const H = 3_600_000
const claim = (over = {}) => ({ id: 'x', kind: 'avoid', tier: 'rule', subject: 'gather:oak',
                                reports: [], disputes: [], posted_at: 0, distance: 0, ...over })
const rep = (reporter, failClass, over = {}) =>
  ({ reporter, failClass, observed_at: 0, posted_at: 0, distance: 0, ...over })

// ---- 1. typed quorum -------------------------------------------------------

t('one reporter is not quorum for an avoid-claim', () => {
  assert.equal(quorumState(claim({ reports: [rep('A', 'noPath')] })), 'pending')
})

t('two reporters agreeing on the SAME failure class reach quorum', () => {
  assert.equal(quorumState(claim({ reports: [rep('A', 'noPath'), rep('B', 'noPath')] })), 'adopted')
})

t('two reporters with DIFFERENT failure classes do NOT reach quorum', () => {
  // The failure this rule exists to prevent: two bots failing the same action
  // for unrelated reasons, whose disagreement would otherwise read as
  // corroboration and put a false rule on the board.
  assert.equal(quorumState(claim({ reports: [rep('A', 'noPath'), rep('B', 'inventory')] })),
               'pending')
})

t('one bot filing twice is NOT two witnesses', () => {
  const b = new Board('/tmp/x', memfs())
  b.post({ kind: 'avoid', tier: 'rule', subject: 's', reporter: 'A', failClass: 'noPath' })
  const r = b.post({ kind: 'avoid', tier: 'rule', subject: 's', reporter: 'A', failClass: 'noPath' })
  assert.equal(r.state, 'pending', 'a single bot must not be able to manufacture quorum')
  assert.equal(r.reporters, 1)
})

t('a worked-claim adopts on a single reporter', () => {
  // Good news is self-correcting: anyone who tries it and fails disputes it.
  assert.equal(quorumState(claim({ kind: 'worked', reports: [rep('A', null)] })), 'adopted')
})

// ---- 2. disproof outranks quorum ------------------------------------------

t('a dispute overrides any number of reporters', () => {
  const c = claim({ reports: [rep('A', 'noPath'), rep('B', 'noPath'), rep('C', 'noPath')],
                    disputes: [{ reporter: 'D', at: 1 }] })
  assert.equal(quorumState(c), 'disputed')
})

t('disputing keeps the reports rather than deleting the claim', () => {
  const b = new Board('/tmp/x', memfs())
  b.post({ kind: 'avoid', tier: 'rule', subject: 's', reporter: 'A', failClass: 'noPath' })
  b.post({ kind: 'avoid', tier: 'rule', subject: 's', reporter: 'B', failClass: 'noPath' })
  const r = b.dispute({ kind: 'avoid', subject: 's', reporter: 'C' })
  assert.equal(r.state, 'disputed')
  assert.equal(r.reporters, 2, 'the evidence must survive the dispute, or the board forgets')
})

t('disputing a claim the board never had is a no-op, not a crash', () => {
  const b = new Board('/tmp/x', memfs())
  assert.equal(b.dispute({ kind: 'avoid', subject: 'ghost', reporter: 'A' }).state, 'absent')
})

// ---- 3. two clocks ---------------------------------------------------------

t('shelf life runs from posted_at, so a slow carry still gets full life', () => {
  // Observed 5h ago, filed just now: under a single clock this would already be
  // stale, which would punish exploration instead of staleness.
  const c = claim({ tier: 'sighting', posted_at: 10 * H })
  assert.equal(isExpired(c, 10 * H + 1000), false)
  assert.equal(isExpired(c, 10 * H + TIER_MS.sighting + 1000), true)
})

t('credit decays from observed_at, so sitting on news burns its value', () => {
  const c = claim({ reports: [rep('A', 'noPath'), rep('B', 'noPath')] })
  const fresh = freshnessCredit(rep('A', 'noPath', { observed_at: 0, posted_at: 0 }), c)
  const stale = freshnessCredit(rep('A', 'noPath', { observed_at: 0, posted_at: 5 * H }), c)
  assert.ok(fresh > stale, `carrying it for 5h must cost influence (${fresh} vs ${stale})`)
})

t('credit pays only on claims that actually reached quorum', () => {
  // Goodhart guard: the reward is being first with something TRUE, not first.
  const pending = claim({ reports: [rep('A', 'noPath')] })
  assert.equal(freshnessCredit(rep('A', 'noPath'), pending), 0)
})

t('a long carry of something true still earns more than a doorstep report', () => {
  const c = claim({ reports: [rep('A', 'noPath'), rep('B', 'noPath')] })
  const courier = freshnessCredit(rep('A', 'noPath', { posted_at: H, distance: 900 }), c)
  const local = freshnessCredit(rep('A', 'noPath', { posted_at: H, distance: 0 }), c)
  assert.ok(courier > local, 'or nobody ever explores')
})

// ---- 4. distance-scaled shelf life ----------------------------------------

t('a frontier sighting outlives a town sighting', () => {
  assert.ok(shelfLifeMs('sighting', 1200) > shelfLifeMs('sighting', 0),
    'terrain churn is highest where bots are densest, which is town')
})

t('unreachable claims are the deliberate exception and do NOT scale', () => {
  // Nobody is out on the frontier to corroborate them, so they die quietly.
  assert.equal(shelfLifeMs('unreachable', 1500), shelfLifeMs('unreachable', 0))
})

t('scaling is capped so nothing becomes effectively permanent', () => {
  assert.ok(shelfLifeMs('hazard', 99999) <= 3 * TIER_MS.hazard)
})

// ---- the board as a whole --------------------------------------------------

t('readable() returns adopted, unexpired claims only', () => {
  const b = new Board('/tmp/x', memfs())
  b.post({ kind: 'avoid', tier: 'rule', subject: 'adopted', reporter: 'A', failClass: 'n', now: 0 })
  b.post({ kind: 'avoid', tier: 'rule', subject: 'adopted', reporter: 'B', failClass: 'n', now: 0 })
  b.post({ kind: 'avoid', tier: 'rule', subject: 'pending', reporter: 'A', failClass: 'n', now: 0 })
  const ids = b.readable(1000).map(c => c.id)
  assert.deepEqual(ids, [claimId('avoid', 'adopted')])
})

t('sweep() removes aged-out claims and names them for the ledger', () => {
  const b = new Board('/tmp/x', memfs())
  b.post({ kind: 'avoid', tier: 'unreachable', subject: 'old', reporter: 'A', failClass: 'n', now: 0 })
  const gone = b.sweep(TIER_MS.unreachable + 1000)
  assert.deepEqual(gone, [claimId('avoid', 'old')])
  assert.equal(b.readable(TIER_MS.unreachable + 1000).length, 0)
})

t('posting reports the ledger event, and adoption is announced exactly once', () => {
  const b = new Board('/tmp/x', memfs())
  assert.equal(b.post({ kind: 'avoid', tier: 'rule', subject: 's', reporter: 'A', failClass: 'n' }).event, 'post')
  assert.equal(b.post({ kind: 'avoid', tier: 'rule', subject: 's', reporter: 'B', failClass: 'n' }).event, 'adopt')
  assert.equal(b.post({ kind: 'avoid', tier: 'rule', subject: 's', reporter: 'C', failClass: 'n' }).event, 'post',
    'a third witness is corroboration, not a second adoption event')
})

function memfs() {
  const files = {}
  return {
    readFileSync: f => { if (!(f in files)) throw new Error('ENOENT'); return files[f] },
    writeFileSync: (f, d) => { files[f] = d },
    mkdirSync: () => {},
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

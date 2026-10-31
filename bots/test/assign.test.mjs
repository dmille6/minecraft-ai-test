// B5 (cooperation tier): the HOST assigner (scripts/overseer/assign.mjs) -- the validator's rules, the deterministic arms, the
// cadence bucket, and THE PARITY TEST: the host's BUILD eligibility is shop.mjs's own buildOrder on host facts, so a bot the host
// calls eligible gets the build_shop order when it reaches town with no bot-local state (and one it calls ineligible does not).
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LOG_LEVEL = 'error'
import assert from 'node:assert/strict'
import test from 'node:test'
const A = await import('../../scripts/overseer/assign.mjs')
const { buildOrder, SHOP_BAG_SLOTS_MIN } = await import('../src/shop.mjs')

const NOW = 1_800_000_000_000
const bot = (name, over = {}) => ({ bot: name, at_town: false, dist: 100, hp: 20, free_slots: 20, flags: [], seen_at: NOW - 1000, affinity: {}, ...over })
const project = (over = {}) => ({ plot: 'shop', record_gen: 3, record: { plot: 'shop', gen: 3 }, complete: false, slots_free: true, planned: true, ...over })
const snap = (roster, over = {}) => ({ gen: 10, roster, project: project(), refused: {}, ...over })
const caps = { BUILD: 2, leased_max: 3 }

test('PARITY: host eligibility == buildOrder at town on the same facts (both directions, every host fact)', () => {
  const cases = [
    [bot('A'), project(), true], [bot('B', { hp: 10 }), project(), false], [bot('C', { free_slots: SHOP_BAG_SLOTS_MIN - 1 }), project(), false],
    [bot('D'), project({ complete: true }), false], [bot('E'), project({ slots_free: false }), false], [bot('F'), project({ planned: false }), false],
    [bot('G'), project({ record: null, record_gen: null }), true],
  ]
  for (const [b, p, want] of cases) {
    const host = A.hostBuildEligible(b, p, { buildOrder, now: NOW })
    const atTown = buildOrder({ on: true, shared: true, atTown: true, holds: false, now: NOW, state: {}, record: p.record, complete: p.complete,
      slotsFree: p.slots_free, health: b.hp, freeSlots: b.free_slots, planned: p.planned }).order?.skill === 'build_shop'
    assert.equal(host, atTown, `${b.bot}: host ${host} vs bot ${atTown}`)
    assert.equal(host, want, b.bot)
  }
  // facts only the host can fail on: a stale position, a flag, an unknown bag
  assert.equal(A.hostBuildEligible(bot('S', { seen_at: NOW - 11 * 60000 }), project(), { buildOrder, now: NOW }), false)
  assert.equal(A.hostBuildEligible(bot('T', { flags: ['entombed'] }), project(), { buildOrder, now: NOW }), false)
  assert.equal(A.hostBuildEligible(bot('U', { free_slots: undefined }), project(), { buildOrder, now: NOW }), false)
})

test('eligibleOf: a bot that refused BUILD in the last 30 min is not offered it; after 30 min it is', () => {
  const s = snap([bot('A'), bot('B')], { refused: { A: { BUILD: NOW - 29 * 60000 } } })
  assert.deepEqual(A.eligibleOf(s, { buildOrder, now: NOW }), { A: [], B: ['BUILD'] })
  assert.deepEqual(A.eligibleOf(s, { buildOrder, now: NOW + 2 * 60000 }), { A: ['BUILD'], B: ['BUILD'] })
})

test('VALIDATOR: a clean reply passes; each rule drops or rejects with its own reason', () => {
  const s = snap([bot('A'), bot('B'), bot('C'), bot('D')])
  const el = { A: ['BUILD'], B: ['BUILD'], C: ['BUILD'], D: [] }
  const v = r => A.validate(r, { snapshot: s, eligible: el, caps, nowGen: 10 })
  const L = (b, o = {}) => ({ bot: b, job: 'BUILD', ttl_min: 30, reason: 'build_progress', ...o })
  assert.deepEqual(v({ gen: 10, leases: [L('A'), L('B')] }).leases.map(l => l.bot), ['A', 'B'])
  assert.equal(v(null).invalid, 'not_object'); assert.equal(v({ leases: [] }).invalid, 'gen_missing')
  assert.equal(v({ gen: 11, leases: [] }).invalid, 'gen_future'); assert.equal(v({ gen: 7, leases: [] }).invalid, 'gen_stale')
  assert.equal(v({ gen: 8, leases: [] }).invalid, null, 'two ticks old is acceptable')
  assert.equal(A.validate({ gen: 9, leases: [] }, { snapshot: s, eligible: el, caps, nowGen: 10, emptySince: 9 }).invalid, 'gen_superseded')
  assert.equal(A.validate({ gen: 9, leases: [] }, { snapshot: s, eligible: el, caps, nowGen: 10, recordGenChangedSince: 10 }).invalid, 'gen_superseded')
  assert.equal(v({ gen: 10, abstain: true, why: 'no_change' }).abstain, true)
  assert.equal(v({ gen: 10, abstain: true, why: 'because' }).invalid, 'abstain_why')
  const drops = v({ gen: 10, leases: [L('Z'), L('A', { job: 'MINE' }), L('A', { ttl_min: 45 }), L('A', { reason: 'vibes' }), L('D'), L('A'), L('A'), L('B'), L('C')] }).dropped.map(d => d.why)
  assert.deepEqual(drops, ['unknown_bot', 'unknown_job', 'ttl', 'reason', 'ineligible', 'second_lease', 'cap'])
  // at least one FREE bot: a 2-bot town can lease only one
  const two = snap([bot('A'), bot('B')])
  assert.deepEqual(A.validate({ gen: 10, leases: [L('A'), L('B')] }, { snapshot: two, eligible: { A: ['BUILD'], B: ['BUILD'] }, caps, nowGen: 10 }).dropped.map(d => d.why), ['no_free_bot'])
})

test('GREEDY: at town first, then nearest, then bag room; RANDOM is seeded and only picks eligible; ORACLE picks the soonest arrival', () => {
  const s = snap([bot('A', { dist: 50 }), bot('B', { dist: 20 }), bot('C', { at_town: true, dist: 300 }), bot('D', { dist: 5 })])
  const el = { A: ['BUILD'], B: ['BUILD'], C: ['BUILD'], D: [] }
  assert.deepEqual(A.greedyReply(s, el, caps).leases.map(l => l.bot), ['C', 'B'])
  const r1 = A.randomReply(s, el, caps, A.rng(5)).leases.map(l => l.bot), r2 = A.randomReply(s, el, caps, A.rng(5)).leases.map(l => l.bot)
  assert.deepEqual(r1, r2); assert.ok(r1.every(b => b !== 'D'))
  const o = A.oracleReply(s, el, caps, { A: 60000, B: 40 * 60000, D: 1000 })
  assert.deepEqual(o.leases.map(l => l.bot), ['C', 'A'])
  assert.ok(o.leases.every(l => l.ttl_min >= 5 && l.ttl_min <= 30))
  for (const r of [A.greedyReply(s, el, caps), r1.length ? A.randomReply(s, el, caps, A.rng(5)) : null, o].filter(Boolean)) assert.equal(A.validate(r, { snapshot: s, eligible: el, caps, nowGen: 10 }).dropped.length, 0, 'every deterministic arm passes the validator')
})

test('REVALIDATE keeps the original expiry and drops expired or ineligible leases; rolesDoc binds every lease', () => {
  const acc = [{ bot: 'A', job: 'BUILD', expires_at: NOW + 60000 }, { bot: 'B', job: 'BUILD', expires_at: NOW - 1 }, { bot: 'C', job: 'BUILD', expires_at: NOW + 1 }]
  assert.deepEqual(A.revalidate(acc, { eligible: { A: ['BUILD'], B: ['BUILD'], C: [] }, now: NOW }).map(l => l.bot), ['A'])
  const d = A.rolesDoc({ leases: [{ bot: 'A', job: 'BUILD', ttl_min: 30, reason: 'build_progress' }], gen: 4, now: NOW, world: 'w', home: '0_70_0', arm: 'greedy', project: { plot: 'shop', record_gen: 3 }, snapshotGen: 10, prior: { A: NOW + 5 } })
  assert.equal(d.leases[0].expires_at, NOW + 5, 'a re-issue never extends'); assert.equal(d.leases[0].record_gen, 3); assert.equal(d.v, 1)
})

test('BUCKET: one call per 30 min, an event may spend a held token early (never under 10 min), at most 2 held', () => {
  let b; let r
  r = A.bucketStep(undefined, { now: NOW, day: 'd' }); assert.equal(r.call, true); b = r.bucket
  r = A.bucketStep(b, { now: NOW + 5 * 60000, day: 'd', event: true }); assert.equal(r.call, false, 'no token, and under 10 min')
  r = A.bucketStep(r.bucket, { now: NOW + 31 * 60000, day: 'd' }); assert.equal(r.call, true); b = r.bucket
  r = A.bucketStep(b, { now: NOW + 3 * 3600000, day: 'd' }); assert.equal(r.call, true); assert.ok(r.bucket.tokens <= 1, 'held tokens are capped at 2')
  r = A.bucketStep(r.bucket, { now: NOW + 3 * 3600000 + 11 * 60000, day: 'd', event: true }); assert.equal(r.call, true, 'an event spends the held token')
})

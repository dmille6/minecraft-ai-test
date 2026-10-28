// plinth-02.1 (10-17, the hotfix after plinth-02's direct rollout): the plinth's safety fixes, behaviour through the pure
// functions (the chain through the real build_well / build_plinth is in well.test.mjs "PLINTH-02.1"):
//   - a town whose records are one bot's (isolated scope) plans no plinth (townRecordsShared, plinthWant shared);
//   - a finished plinth is replanned only on EVIDENCE about its cap (completeLost / capRefusalNext / plinthCapLoss);
//   - no plinth order from a mine below the town (plinthOrder dy);
//   - a none is replanned only on a no-site record NEWER than it;
//   - the replaced well site's pit is carried (carryPrev extra);
//   - the cap itself lies within the town well scan's reach (plinthCandidate envelope).
// Mutants assert their anchor is present and unique.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const P = await import('../src/plinth.mjs')
const W = await import('../src/well.mjs')
const TD = await import('../src/towndeposit.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`)
  }
}
const PP = new URL('../src/plinth.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${file.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const NOW = 1_800_000_000_000
const CAP = { x: 10, y: 70, z: 10 }
const complete = { v: P.PLINTH_VERSION, state: 'complete', id: 'r1', world: 'w1', at: NOW - 9e6, doneAt: NOW - 8e6, plan: { cap: CAP, steps: [] } }

await t('townRecordsShared: the fleet as configured 10-17 -- 12 shared towns yes, the 20 isolated bots no (scope isolated, or a pool named for the bot)', () => {
  for (const [scope, p] of [['board', 'board-a'], ['shared', 'hive-c'], ['checkpoint', 'placebo-d']]) for (const b of ['Alpha', 'Echo']) assert.equal(P.townRecordsShared({ scope, pool: p, name: `${p}-${b}` }), true, p)
  for (const p of ['a', 'b', 'c', 'd']) for (const b of ['Alpha', 'Echo']) assert.equal(P.townRecordsShared({ scope: 'isolated', pool: `self-isolated-${p}-${b}`, name: `isolated-${p}-${b}` }), false)
  assert.equal(P.townRecordsShared({ scope: 'checkpoint', pool: 'self-isolated-a-Alpha', name: 'isolated-a-Alpha' }), false, 'a pool named for the bot, whatever the scope')
})
await t('plinthWant: an unshared town wants nothing at all, whatever its records say; positive control shared', () => {
  for (const args of [{ noSite: { at: NOW, world: 'w1' } }, { rec: { ...complete, state: 'plan' } }, { rec: { ...complete, state: 'void' } }]) {
    assert.notEqual(P.plinthWant({ world: 'w1', now: NOW, ...args }).want, null, 'positive control')
    assert.deepEqual(P.plinthWant({ world: 'w1', now: NOW, ...args, shared: false }), { want: null, why: 'unshared' })
  }
})
await t('MUTANT: the unshared guard removed -> an isolated bot plans', async () => {
  await withMutant(PP, "  if (!shared) return { want: null, why: 'unshared' }\n", '', async m => {
    assert.equal(m.plinthWant({ world: 'w1', now: NOW, noSite: { at: NOW, world: 'w1' }, shared: false }).want, 'plan', 'mutant inert')
  })
})
await t('plinthWant none: held 2 h; then only a no-site record NEWER than the none, or a void, replans', () => {
  const none = { v: P.PLINTH_VERSION, state: 'none', world: 'w1', at: NOW - P.PLINTH_NONE_BACKOFF_MS - 1 }
  assert.equal(P.plinthWant({ rec: none, world: 'w1', now: NOW, noSite: { at: none.at - 1, world: 'w1' } }).want, null)
  assert.equal(P.plinthWant({ rec: none, world: 'w1', now: NOW, noSite: { at: none.at + 1, world: 'w1' } }).want, 'plan')
  assert.equal(P.plinthWant({ rec: { ...none, at: NOW - 5 }, world: 'w1', now: NOW, noSite: { at: NOW, world: 'w1' } }).want, null, 'held')
  assert.equal(P.plinthWant({ rec: { ...none, trigger: 'void' }, world: 'w1', now: NOW }).want, 'plan')
})
await t('completeLost and plinthWant on a complete record: no evidence -> plinth-02\'s rule; structural/persisted -> replan; transient -> held', () => {
  assert.deepEqual(P.completeLost({ rec: complete, noSite: { at: NOW } }), { lost: true, why: 'no_evidence' })
  assert.equal(P.completeLost({ rec: complete, noSite: { at: NOW, lost: { cap: { x: 1, y: 2, z: 3 }, cls: 'transient' } } }).lost, true, 'evidence about another cap is none')
  assert.deepEqual(P.completeLost({ rec: complete, noSite: { at: NOW, lost: { cap: CAP, cls: 'structural' } } }), { lost: true, why: 'structural' })
  assert.deepEqual(P.completeLost({ rec: complete, noSite: { at: NOW, lost: { cap: CAP, cls: 'persisted' } } }), { lost: true, why: 'persisted' })
  assert.deepEqual(P.completeLost({ rec: complete, noSite: { at: NOW, lost: { cap: CAP, cls: 'transient' } } }), { lost: false, why: 'complete_held' })
  const ns = cls => ({ at: NOW - 10, world: 'w1', lost: { cap: CAP, cls } })
  assert.equal(P.plinthWant({ rec: complete, world: 'w1', now: NOW, noSite: ns('structural') }).evidence, 'structural')
  assert.equal(P.plinthWant({ rec: complete, world: 'w1', now: NOW, noSite: ns('transient') }).want, null)
  assert.equal(P.plinthWant({ rec: complete, world: 'w1', now: NOW, noSite: { at: NOW - 10, world: 'w1' } }).want, 'plan', 'no evidence: plinth-02 rows')
})
await t('capRefusalNext: structural lost once confirmed 10 min on; transient held, lost after 6 h AND 3 sightings at 30- and 70-min cadences; one episode per class', () => {
  const s1 = P.capRefusalNext({ cls: 'structural', now: NOW })
  assert.equal(s1.verdict, 'hold'); assert.equal(P.capRefusalNext({ prev: s1.note, cls: 'structural', now: NOW + 5 * 60e3 }).verdict, 'hold')
  assert.equal(P.capRefusalNext({ prev: s1.note, cls: 'structural', now: NOW + P.PLINTH_STRUCT_CONFIRM_MS }).verdict, 'lost')
  const a = P.capRefusalNext({ cls: 'transient', why: 'chest within 3', now: NOW })
  assert.equal(a.verdict, 'hold'); assert.equal(a.note.transient.n, 1)
  for (const cadence of [30, 70]) {
    let note = a.note, v = null, m = 0
    while (m < 6 * 60) { m += cadence; v = P.capRefusalNext({ prev: note, cls: 'transient', now: NOW + m * 60e3 }); note = v.note }
    assert.equal(v.verdict, 'lost', `cadence ${cadence}`); assert.equal(v.cls, 'persisted')
  }
  const once = P.capRefusalNext({ prev: { transient: { since: NOW, at: NOW, n: 1 } }, cls: 'transient', now: NOW + 7 * 3600e3 })
  assert.equal(once.verdict, 'hold', 'two sightings 7 h apart')
  let n = a.note
  for (let m = 30; m <= 6 * 60; m += 30) n = P.capRefusalNext({ prev: n, cls: m % 90 === 0 ? 'structural' : 'transient', now: NOW + m * 60e3 }).note
  assert.equal(n.transient.since, NOW, 'interleaved ghost sightings do not restart the chest\'s episode')
  assert.equal(P.capRefusalNext({ prev: { transient: { since: NOW + 1e9, at: NOW + 1e9, n: 5 } }, cls: 'transient', now: NOW }).note.transient.since, NOW, 'a note from the future is no history')
})
const shellWorld = (extra = {}) => {
  const cells = new Map(P.plinthShell(CAP).map(c => [`${c.x},${c.y},${c.z}`, 'cobblestone']))
  cells.set(`${CAP.x},${CAP.y},${CAP.z}`, 'dirt')
  for (const [k, v] of Object.entries(extra)) cells.set(k, v)
  const G = CAP.y - 4
  return (x, y, z) => {
    const v = cells.get(`${x},${y},${z}`) ?? (y > G ? 'air' : y === G ? 'grass_block' : 'dirt')
    if (v === 'unloaded') return null
    if (typeof v === 'object') return v
    return v === 'air' ? { name: 'air', boundingBox: 'empty', shapes: [], props: null } : { name: v, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 1.5, props: null }
  }
}
await t('plinthCapLoss: an intact shell is transient whatever stands near it; a wall gone or the floor gone is structural; unread is never evidence; a BUILT well with its stands blocked is transient, its wall gone structural', () => {
  const k = (dx, dy, dz) => `${CAP.x + dx},${CAP.y + dy},${CAP.z + dz}`
  assert.equal(W.wellSiteRefusal(shellWorld(), CAP, null), null, 'positive control')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(2, 0, 0)]: 'chest' }), CAP), 'transient')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(0, 1, 0)]: 'cobblestone' }), CAP), 'transient')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(1, 0, 0)]: 'air' }), CAP), 'structural')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(0, -2, 0)]: 'air', [k(0, -3, 0)]: 'air' }), CAP), 'structural')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(1, 0, 0)]: 'unloaded' }), CAP), 'transient')
  const top = { name: 'oak_trapdoor', boundingBox: 'block', shapes: [[0, 0.8125, 0, 1, 1, 1]], props: { half: 'top', facing: 'north', open: false } }
  const bot = { name: 'oak_trapdoor', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.1875, 1]], props: { half: 'bottom', facing: 'north', open: false } }
  const built = extra => shellWorld({ [k(0, 0, 0)]: top, [k(0, -1, 0)]: bot, ...extra })
  assert.equal(W.wellStage(built(), CAP), 'built')
  const blocked = {}; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) blocked[k(dx, 1, dz)] = 'cobblestone'
  assert.match(W.wellBreach(built(blocked), CAP, 'north') ?? '', /stand/, 'positive control: a breach by the well\'s own rule')
  assert.equal(P.plinthCapLoss(built(blocked), CAP), 'transient')
  assert.equal(P.plinthCapLoss(built({ [k(1, 0, 0)]: 'air' }), CAP), 'structural')
})
await t('plinthOrder: within PLINTH_ORDER_DY (= the town zone\'s TOWN_V) of home -> an order; 13 below or no position -> none', () => {
  assert.equal(P.PLINTH_ORDER_DY, TD.TOWN_V)
  const o = dy => P.plinthOrder({ now: NOW, distHome: 3, dy, want: { want: 'plan' }, lease: { free: true } }).order?.skill ?? null
  assert.equal(o(0), 'build_plinth'); assert.equal(o(-12), 'build_plinth'); assert.equal(o(-13), null); assert.equal(o(Infinity), null)
})
await t('MUTANT: the vertical bound removed -> a bot 26 below home gets the order', async () => {
  await withMutant(PP, '  if (!(Math.abs(Number(dy)) <= PLINTH_ORDER_DY)) return none()\n', '', async m => {
    assert.equal(m.plinthOrder({ now: NOW, distHome: 3, dy: -26, want: { want: 'plan' }, lease: { free: true } }).order?.skill, 'build_plinth', 'mutant inert')
  })
})
await t('carryPrev extra: the replaced well site is carried while it could trap a body, let go when it could not', () => {
  const pit = { x: 30, y: 64, z: 30 }, fresh = { x: 20, y: 64, z: 20 }
  assert.deepEqual(P.carryPrev(null, c => c.x === pit.x, { x: 1, y: 1, z: 1 }, [pit, fresh]).map(c => [c.x, c.y, c.z]), [[30, 64, 30]])
  assert.deepEqual(P.carryPrev(null, () => true, pit, [pit]), [], 'never the new plan\'s own cap')
})
await t('THE CAP WITHIN THE WELL SCAN (envelope): isolated-c\'s real geometry -- home 355,73,147, cap 342,70,138: rim 15.94, cap 16.09 -> refused; a cap at 15.2 kept', () => {
  const home = { x: 355, y: 73, z: 147 }
  const d = c => Math.hypot(c.x - home.x, c.y - home.y, c.z - home.z)
  assert.ok(d({ x: 342, y: 71, z: 138 }) <= 16 && d({ x: 342, y: 70, z: 138 }) > 16, 'the fleet case: rim inside, cap outside')
  const read = (x, y, z) => (y > 69 ? { name: 'air', boundingBox: 'empty', shapes: [], props: null } : { name: 'dirt', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 0.5, props: null })
  assert.equal(P.plinthCandidate(read, { home, x: 342, z: 138, t: 69, k: 1 }).why, 'envelope')
  const ok = P.plinthCandidate(read, { home, x: 361, z: 133, t: 69, k: 4 })
  assert.notEqual(ok.why, 'envelope', JSON.stringify(ok).slice(0, 120))
})
await t('MUTANT: the cap envelope removed -> the 16.09 cap is a candidate', async () => {
  await withMutant(PP, "  if (townDistance(home, cap) > ADOPT_RADIUS) return { why: 'envelope' }\n", '', async m => {
    const read = (x, y, z) => (y > 69 ? { name: 'air', boundingBox: 'empty', shapes: [], props: null } : { name: 'dirt', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 0.5, props: null })
    assert.notEqual(m.plinthCandidate(read, { home: { x: 355, y: 73, z: 147 }, x: 342, z: 138, t: 69, k: 1 }).why, 'envelope', 'mutant inert')
  })
})
await t('the licence row and its single writer', () => {
  assert.match(P.plinth021ModeDetail({ shared: true, worldId: 'w' }), /^phase=mode v=1 shared=1 lost=evidence dy=12 env=cap w=w$/)
  const idx = readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')   // installFeatures (test/features-wired)
  assert.equal(idx.split("kind: 'plinth021_mode'").length, 2)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log(failed.map(n => `  - ${n}`).join('\n')); process.exit(1) }

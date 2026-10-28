// plinthfirst-01 (OWNER 10-16 ~12:05Z "every new junk well self-built? -> yes"): every NEW junk well is a raised one; the
// natural-site search is skipped; a sealed natural well keeps being used until it breaks; nothing is torn down.
//
// Behaviour only, through the exported pure functions (the chain through the real build_well, with a fake town, is in
// well.test.mjs "PLINTH-FIRST"). Folded in from both r1 design reviews, as plinth-02's own defects:
//   - a town whose records are one bot's (isolated scope) never plans a plinth (townRecordsShared);
//   - a finished plinth is replanned only on EVIDENCE about its cap (completeLost / capRefusalNext / plinthCapLoss);
//   - the plinth order is never given from a mine below the town (plinthOrder dy);
//   - the replaced well site's pit is carried as a watched column (carryPrev extra).
// Mutants assert their anchor is present and unique (withMutant, as climb-escape.test.mjs).
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
const NAT = { x: 20, y: 64, z: 20 }
const complete = { v: P.PLINTH_VERSION, state: 'complete', id: 'r1', world: 'w1', at: NOW - 9e6, doneAt: NOW - 8e6, plan: { cap: CAP, steps: [] } }

// ---- the switch -------------------------------------------------------------------------------------------------------
await t('plinthFirstOn: on by default for a shared town; off in an isolated scope, for a pool named for the bot, with PLINTH_FIRST=0, and while the record is none', () => {
  assert.equal(P.PLINTH_FIRST, true)
  assert.equal(P.plinthFirstOn({ scope: 'board', pool: 'board-a', name: 'board-a-Alpha', env: {} }), true)
  assert.equal(P.plinthFirstOn({ scope: 'shared', pool: 'hive-a', name: 'hive-a-Echo', env: { PLINTH_FIRST: '1' } }), true)
  assert.equal(P.plinthFirstOn({ scope: 'isolated', pool: 'self-isolated-a-Alpha', name: 'isolated-a-Alpha', env: {} }), false)
  assert.equal(P.plinthFirstOn({ scope: 'checkpoint', pool: 'self-isolated-a-Alpha', name: 'isolated-a-Alpha', env: {} }), false, 'the pool is the bot\'s own whatever the scope says')
  assert.equal(P.plinthFirstOn({ scope: 'board', pool: 'board-a', name: 'board-a-Alpha', env: { PLINTH_FIRST: '0' } }), false)
  assert.equal(P.plinthFirstOn({ scope: 'board', pool: 'board-a', name: 'board-a-Alpha', env: {}, recState: 'none', recAt: NOW - 60e3, now: NOW }), false, 'a planner that found nothing hands the town back to the natural search')
  assert.equal(P.plinthFirstOn({ scope: 'board', pool: 'board-a', name: 'board-a-Alpha', env: {}, recState: 'complete' }), true)
})
await t('townRecordsShared: the fleet\'s 16 pools as configured 10-17 (12 shared towns, 20 isolated bots)', () => {
  for (const p of ['board-a', 'hive-c', 'placebo-d']) for (const b of ['Alpha', 'Echo']) assert.equal(P.townRecordsShared({ scope: p.startsWith('hive') ? 'shared' : p.startsWith('board') ? 'board' : 'checkpoint', pool: p, name: `${p}-${b}` }), true, p)
  for (const p of ['a', 'd']) for (const b of ['Alpha', 'Echo']) assert.equal(P.townRecordsShared({ scope: 'isolated', pool: `self-isolated-${p}-${b}`, name: `isolated-${p}-${b}` }), false)
  assert.equal(P.townRecordsShared({}), true, 'nothing known: the shared default (the scheduler\'s other guards still apply)')
})

// ---- the search and the site rule --------------------------------------------------------------------------------------
await t('plinthFirstSearch: the exhausted shape siteAnswer needs, no column counted, and the natural answer as a read-only shadow', () => {
  const s = P.plinthFirstSearch({ site: NAT, why: null, exhausted: false })
  assert.equal(s.site, null); assert.equal(s.exhausted, true); assert.equal(s.why, P.PLINTH_FIRST_WHY)
  assert.equal(W.tallyText(s.tally), 'cols:0,plinth_first:1')
  assert.equal(s.shadow, '20,64,20')
  assert.equal(P.plinthFirstSearch({ site: null, exhausted: true }).shadow, 'none')
  const u = P.plinthFirstSearch({ site: null, exhausted: false, why: 'unknown cell at 1,2,3' })
  assert.equal(u.exhausted, false, 'an unread cell is a deferral, never the town\'s no-site record (Codex r1 P2-5)'); assert.equal(u.shadow, 'unknown'); assert.equal(u.why, 'unknown cell at 1,2,3')
})
await t('areaLoaded: every chunk the ADOPT_RADIUS square touches is sampled; one unsent chunk -> false', () => {
  const home = { x: 100, y: 64, z: 100 }
  const all = () => ({ name: 'stone' })
  assert.equal(P.areaLoaded(all, home), true)
  for (const [x, z] of [[116, 116], [84, 100], [100, 92]]) assert.equal(P.areaLoaded((a, b, c) => (a === x && c === z ? null : { name: 'stone' }), home), false, `${x},${z}`)
  const chunkGone = (cx, cz) => (a, b, c) => (Math.floor(a / 16) === cx && Math.floor(c / 16) === cz ? null : { name: 'stone' })
  for (let cx = 5; cx <= 7; cx++) for (let cz = 5; cz <= 7; cz++) assert.equal(P.areaLoaded(chunkGone(cx, cz), home), false, `chunk ${cx},${cz}`)
  assert.equal(P.areaLoaded(chunkGone(4, 6), home), true, 'a chunk outside the square does not matter')
})
await t('plinthFirstRefusal: off -> nothing refused; the plan cap is buildable; a natural FRESH site is refused; a started natural pit is finished; a cap the town replanned away from is refused', () => {
  assert.equal(P.plinthFirstRefusal({ on: false, site: NAT, stage: 'fresh' }), null, 'positive control: plinth-02 builds it')
  assert.equal(P.plinthFirstRefusal({ on: true, site: NAT, stage: 'fresh' }), P.PLINTH_FIRST_NATURAL)
  assert.equal(P.plinthFirstRefusal({ on: true, site: CAP, planCap: CAP, stage: 'covered' }), null)
  assert.equal(P.plinthFirstRefusal({ on: true, site: CAP, planCap: CAP, stage: 'fresh' }), null, 'the plan cap whatever its stage')
  for (const st of ['half_dug', 'dug', 'floored', 'covered', 'covered_floored']) assert.equal(P.plinthFirstRefusal({ on: true, site: NAT, stage: st }), null, st)
  for (const st of ['fresh', 'invalid', 'built', null, undefined]) assert.equal(P.plinthFirstRefusal({ on: true, site: NAT, stage: st }), P.PLINTH_FIRST_NATURAL, String(st))
  assert.equal(P.plinthFirstRefusal({ on: true, site: CAP, planCap: { x: 1, y: 1, z: 1 }, oldCaps: [CAP], stage: 'covered' }), P.PLINTH_FIRST_OLD)
})
await t('naturalPitPending: only a natural started pit that passes the site rule holds the plinth back', () => {
  assert.equal(P.naturalPitPending({ on: true, site: NAT, stage: 'dug', refusal: null }), true)
  assert.equal(P.naturalPitPending({ on: true, site: NAT, stage: 'fresh', refusal: null }), false)
  assert.equal(P.naturalPitPending({ on: true, site: NAT, stage: 'dug', refusal: 'wall is air' }), false, 'a pit the rule refuses is carried, not finished')
  assert.equal(P.naturalPitPending({ on: true, site: CAP, planCap: CAP, stage: 'covered', refusal: null }), false, 'the plinth\'s own cap is not a natural pit')
  assert.equal(P.naturalPitPending({ on: false, site: NAT, stage: 'dug', refusal: null }), false)
})

// ---- plinthWant ------------------------------------------------------------------------------------------------------
await t('plinthWant UNDER PLINTH-FIRST: no usable well and no record -> plan, with no no-site record needed (positive control: plinth-02 waits for one)', () => {
  assert.equal(P.plinthWant({ world: 'w1', now: NOW }).want, null, 'plinth-02: no trigger')
  const w = P.plinthWant({ world: 'w1', now: NOW, first: true })
  assert.equal(w.want, 'plan'); assert.equal(w.why, 'plinth_first')
  assert.equal(P.plinthWant({ world: 'w1', now: NOW, first: true, wellUsable: true }).want, null, 'a sealed well (natural or raised) is used, never replaced')
  assert.equal(P.plinthWant({ world: 'w1', now: NOW, first: true, naturalPit: () => true }).why, 'natural_pit', 'a natural pit being finished: never two wells')
  assert.deepEqual(P.plinthWant({ world: 'w1', now: NOW, first: true, loaded: () => false }), { want: null, why: 'unloaded' }, 'no well SEEN over unsent ground is no evidence of no well')
  assert.equal(P.plinthWant({ world: 'w1', now: NOW, first: true, naturalPit: true, noSite: { at: NOW, world: 'w1' } }).want, null)
  assert.equal(P.plinthWant({ world: 'w1', now: NOW, noSite: { at: NOW, world: 'w1' } }).want, 'plan', 'plinth-02\'s own trigger unchanged')
})
await t('plinthWant: a none record is held 2 h; inside plinth-first\'s 24 h none window (first=false) only a NEWER no-site record or a void replans; once plinth-first is in force again (first=true) its own trigger replans (Claude r1 P2-1, r2 P3-1, r3 P2-1)', () => {
  const none = { v: P.PLINTH_VERSION, state: 'none', world: 'w1', at: NOW - P.PLINTH_NONE_BACKOFF_MS - 1 }
  assert.equal(P.plinthWant({ rec: none, world: 'w1', now: NOW, first: false }).want, null, 'the window: the natural search has the town')
  assert.equal(P.plinthWant({ rec: none, world: 'w1', now: NOW, first: false, noSite: { at: NOW - 5, world: 'w1' } }).want, 'plan', 'the natural search exhausted again')
  assert.equal(P.plinthWant({ rec: { ...none, at: NOW - 5 }, world: 'w1', now: NOW, first: true, noSite: { at: NOW - 5, world: 'w1' } }).want, null, 'held')
  assert.equal(P.plinthWant({ rec: none, world: 'w1', now: NOW, noSite: { at: none.at - 1, world: 'w1' } }).want, null, 'the no-site record that started the failed plan is not a new trigger')
  assert.equal(P.plinthWant({ rec: { ...none, trigger: 'void' }, world: 'w1', now: NOW }).want, 'plan', 'a void\'s obligation still replans')
  assert.equal(P.plinthWant({ rec: none, world: 'w1', now: NOW, first: true }).want, 'plan', 'plinth-first in force again: no usable well is the trigger')
  assert.equal(P.plinthWant({ rec: none, world: 'w1', now: NOW, first: true, naturalPit: true }).want, null, '...unless a natural pit is being finished')
})
await t('plinthFirstOn and the none window: the natural search has the town for 24 h after a failed plan, then plinth-first is tried again; the POLICY (and the minimum raise) is unchanged throughout (Codex r3 P2-2)', () => {
  const who = { scope: 'board', pool: 'board-a', name: 'board-a-Alpha', env: {} }
  assert.equal(P.plinthFirstOn({ ...who, recState: 'none', recAt: NOW - 5, now: NOW }), false)
  assert.equal(P.plinthFirstOn({ ...who, recState: 'none', recAt: NOW - P.PLINTH_FIRST_NONE_WINDOW_MS + 1, now: NOW }), false)
  assert.equal(P.plinthFirstOn({ ...who, recState: 'none', recAt: NOW - P.PLINTH_FIRST_NONE_WINDOW_MS, now: NOW }), true)
  assert.equal(P.plinthFirstOn({ ...who, recState: 'none', recAt: null, now: NOW }), false, 'an unreadable age keeps the safe fallback')
  assert.equal(P.plinthFirstPolicy(who), true, 'the policy holds through the window: a replan out of none is still raised')
  assert.equal(P.plinthFirstPolicy({ ...who, env: { PLINTH_FIRST: '0' } }), false)
  assert.equal(P.plinthFirstPolicy({ scope: 'isolated', pool: 'self-isolated-a-Alpha', name: 'isolated-a-Alpha' }), false)
})
await t('plinthWant: an unshared town wants nothing at all, whatever its records say (Codex + Claude r1 P1)', () => {
  for (const args of [{ first: true }, { noSite: { at: NOW, world: 'w1' } }, { rec: { ...complete, state: 'plan' } }, { rec: { ...complete, state: 'void' } }]) {
    assert.notEqual(P.plinthWant({ world: 'w1', now: NOW, ...args }).want, null, `positive control ${JSON.stringify(Object.keys(args))}`)
    assert.deepEqual(P.plinthWant({ world: 'w1', now: NOW, ...args, shared: false }), { want: null, why: 'unshared' })
  }
})
await t('MUTANT: the unshared guard removed -> an isolated bot plans a plinth', async () => {
  await withMutant(PP, "  if (!shared) return { want: null, why: 'unshared' }\n", '', async m => {
    assert.equal(m.plinthWant({ world: 'w1', now: NOW, noSite: { at: NOW, world: 'w1' }, shared: false }).want, 'plan', 'mutant inert')
  })
})

await t('MUTANT: the loaded guard removed -> a bot that has not been sent the well\'s chunk plans a second well', async () => {
  await withMutant(PP, '  const firstHere = () => first && !pitNow() && lz(loaded) === true\n', '  const firstHere = () => first && !pitNow()\n', async m => {
    assert.equal(m.plinthWant({ world: 'w1', now: NOW, first: true, loaded: () => false }).want, 'plan', 'mutant inert')
  })
})
await t('MUTANT: plinthFirstSearch treats an unread cell as exhausted -> the town\'s no-site record over unloaded ground', async () => {
  await withMutant(PP, "  if (shadow && !shadow.site && !shadow.exhausted) return { site: null, why: shadow.why ?? 'unknown cell near home', exhausted: false, tally: shadow.tally ?? null, shadow: 'unknown' }\n", '', async m => {
    assert.equal(m.plinthFirstSearch({ site: null, exhausted: false, why: 'unknown' }).exhausted, true, 'mutant inert')
  })
})

// ---- a finished plinth: replanned only on evidence --------------------------------------------------------------------
await t('completeLost: no evidence about the cap -> plinth-02\'s rule (lost); structural or persisted -> lost; transient -> held', () => {
  assert.deepEqual(P.completeLost({ rec: complete, noSite: { at: NOW, world: 'w1' } }), { lost: true, why: 'no_evidence' })
  assert.equal(P.completeLost({ rec: complete, noSite: { at: NOW, lost: { cap: { x: 1, y: 2, z: 3 }, cls: 'transient' } } }).lost, true, 'evidence about ANOTHER cap is no evidence about this one')
  assert.deepEqual(P.completeLost({ rec: complete, noSite: { at: NOW, lost: { cap: CAP, cls: 'structural' } } }), { lost: true, why: 'structural' })
  assert.deepEqual(P.completeLost({ rec: complete, noSite: { at: NOW, lost: { cap: CAP, cls: 'persisted' } } }), { lost: true, why: 'persisted' })
  assert.deepEqual(P.completeLost({ rec: complete, noSite: { at: NOW, lost: { cap: CAP, cls: 'transient' } } }), { lost: false, why: 'complete_held' })
})
await t('plinthWant on a complete record: a newer no-site record with structural evidence replans; transient evidence does not; an older record never', () => {
  const ns = lost => ({ at: NOW - 10, world: 'w1', ...(lost ? { lost: { cap: CAP, cls: lost } } : {}) })
  assert.equal(P.plinthWant({ rec: complete, world: 'w1', now: NOW, noSite: ns('structural'), first: true }).want, 'plan')
  assert.equal(P.plinthWant({ rec: complete, world: 'w1', now: NOW, noSite: ns('transient'), first: true }).want, null)
  assert.equal(P.plinthWant({ rec: complete, world: 'w1', now: NOW, noSite: ns(null) }).want, 'plan', 'plinth-02 rows (no evidence): plinth-02\'s rule')
  assert.equal(P.plinthWant({ rec: complete, world: 'w1', now: NOW, noSite: { ...ns('structural'), at: complete.doneAt - 1 } }).want, null)
  assert.equal(P.plinthWant({ rec: complete, world: 'w1', now: NOW, first: true }).want, null, 'a complete plinth awaiting its well wants nothing more')
})
await t('capRefusalNext: structural is lost once CONFIRMED (seen again 10 min on, Claude r2 P2-1); transient is held and counted from its first sighting; lost once 6 h old AND seen 3 times -- at a 30-min cadence AND at a sparse 70-min one (Codex r2 P2-1); one episode PER CLASS (Claude r3 P3-1)', () => {
  const s1 = P.capRefusalNext({ cls: 'structural', why: 'wall is air', now: NOW })
  assert.equal(s1.verdict, 'hold', 'one sighting of a missing wall may be a ghost cell')
  assert.equal(P.capRefusalNext({ prev: s1.note, cls: 'structural', now: NOW + 5 * 60e3 }).verdict, 'hold', 'too soon')
  assert.equal(P.capRefusalNext({ prev: s1.note, cls: 'structural', now: NOW + P.PLINTH_STRUCT_CONFIRM_MS }).verdict, 'lost')
  assert.equal(P.capRefusalNext({ prev: { transient: { since: NOW - 9e6, at: NOW - 60e3, n: 30 } }, cls: 'structural', now: NOW }).verdict, 'hold', 'transient history is not structural confirmation')
  const a = P.capRefusalNext({ cls: 'transient', why: 'chest within 3', now: NOW })
  assert.equal(a.verdict, 'hold'); assert.equal(a.note.transient.since, NOW); assert.equal(a.note.transient.n, 1)
  const b = P.capRefusalNext({ prev: a.note, cls: 'transient', why: 'chest within 3', now: NOW + 30 * 60e3 })
  assert.equal(b.verdict, 'hold'); assert.equal(b.note.transient.since, NOW, 'the first sighting kept'); assert.equal(b.note.transient.n, 2)
  for (const cadence of [30, 70]) {
    let note = a.note, v = null, m = 0
    while (m < 6 * 60) { m += cadence; v = P.capRefusalNext({ prev: note, cls: 'transient', now: NOW + m * 60e3 }); note = v.note }
    assert.equal(v.verdict, 'lost', `cadence ${cadence} min`); assert.equal(v.cls, 'persisted', 'never a dead end: a cap kept refused for good is replaced')
  }
  const once = P.capRefusalNext({ prev: { transient: { since: NOW, at: NOW, n: 1 } }, cls: 'transient', now: NOW + 7 * 3600e3 })
  assert.equal(once.verdict, 'hold', 'two sightings 7 h apart are not a persisting refusal'); assert.equal(once.note.transient.n, 2)
  assert.equal(P.capRefusalNext({ prev: once.note, cls: 'transient', now: NOW + 7.5 * 3600e3 }).verdict, 'lost', 'the third sighting, still never recovered')
  assert.equal(P.capRefusalNext({ prev: { transient: { since: NOW + 1e9, at: NOW + 1e9, n: 5 } }, cls: 'transient', now: NOW }).note.transient.since, NOW, 'a note from the future is no history')
  // a ghost wall seen by one bot between the chest's sightings: neither clock restarts the other
  let n = a.note
  for (let m = 30; m <= 6 * 60; m += 30) {
    n = P.capRefusalNext({ prev: n, cls: m % 90 === 0 ? 'structural' : 'transient', now: NOW + m * 60e3 }).note
  }
  assert.equal(n.transient.since, NOW, 'the chest\'s episode survived the ghost sightings')
  assert.equal(P.capRefusalNext({ prev: n, cls: 'transient', now: NOW + 6.1 * 3600e3 }).verdict, 'lost')
})
// a k=3 plinth on flat ground, as P.plinthShell builds it, cap covered with dirt
const shellWorld = (extra = {}) => {
  const cells = new Map(P.plinthShell(CAP).map(c => [`${c.x},${c.y},${c.z}`, 'cobblestone']))
  cells.set(`${CAP.x},${CAP.y},${CAP.z}`, 'dirt')
  for (const [k, v] of Object.entries(extra)) cells.set(k, v)
  const G = CAP.y - 4
  return (x, y, z) => {
    const n = cells.get(`${x},${y},${z}`) ?? (y > G ? 'air' : y === G ? 'grass_block' : 'dirt')
    if (n === 'unloaded') return null
    return n === 'air' ? { name: 'air', boundingBox: 'empty', shapes: [], props: null } : { name: n, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 1.5, props: null }
  }
}
await t('plinthCapLoss: an intact shell is transient whatever stands near it; a wall gone, the floor gone or a column filled is structural; an unread cell is never evidence', () => {
  const k = (dx, dy, dz) => `${CAP.x + dx},${CAP.y + dy},${CAP.z + dz}`
  assert.equal(W.wellSiteRefusal(shellWorld(), CAP, null), null, 'positive control: the intact plinth passes the oracle')
  assert.equal(P.plinthCapLoss(shellWorld(), CAP), 'transient')
  assert.match(W.wellSiteRefusal(shellWorld({ [k(2, 0, 0)]: 'chest' }), CAP, null), /chest within 3/, 'a chest put beside it refuses the site')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(2, 0, 0)]: 'chest' }), CAP), 'transient')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(0, 1, 0)]: 'cobblestone' }), CAP), 'transient', 'a block on top: not open above')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(1, 0, 0)]: 'air' }), CAP), 'structural', 'a wall dug out')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(0, -2, 0)]: 'air', [k(0, -3, 0)]: 'air' }), CAP), 'structural', 'the floor gone')
  assert.equal(P.plinthCapLoss(shellWorld({ [k(1, 0, 0)]: 'unloaded' }), CAP), 'transient', 'unknown is not evidence')
  // a BUILT well: a blocked stand is removable (transient); a wall gone is structural
  const trap = (half, facing = 'north') => ({ name: 'oak_trapdoor', props: { half, facing, open: false } })
  const builtWorld = extra => { const r = shellWorld(extra); return (x, y, z) => (x === CAP.x && z === CAP.z && y === CAP.y ? { ...trap('top'), boundingBox: 'block', shapes: [[0, 0.8125, 0, 1, 1, 1]] } : x === CAP.x && z === CAP.z && y === CAP.y - 1 ? { ...trap('bottom'), boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.1875, 1]] } : r(x, y, z)) }
  assert.equal(W.wellStage(builtWorld(), CAP), 'built', 'the fixture is a built well')
  const blocked = {}; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) blocked[k(dx, 1, dz)] = 'cobblestone'
  assert.match(W.wellBreach(builtWorld(blocked), CAP, 'north') ?? '', /stand/, 'positive control: every stand blocked is a breach')
  assert.equal(P.plinthCapLoss(builtWorld(blocked), CAP), 'transient')
  assert.equal(P.plinthCapLoss(builtWorld({ [k(1, 0, 0)]: 'air' }), CAP), 'structural')
})

// ---- a plinth-first plan is a RAISED plan ----------------------------------------------------------------------------
const flat = (x, y, z) => (y > 63 ? { name: 'air', boundingBox: 'empty', shapes: [], props: null } : { name: y === 63 ? 'grass_block' : 'dirt', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 0.6, props: null })
await t('PLINTH_FIRST_MIN_RAISE: on intact ground plinth-02\'s planner takes k=0 with NOTHING placed (the natural cell); from k=2 every one of the 8 sealing walls is a placed block', () => {
  const home = { x: 0, y: 64, z: 0 }
  const base = P.planPlinth({ read: flat, home })
  assert.ok(base.plan, 'positive control: plinth-02 plans here'); assert.equal(base.plan.k, 0); assert.equal(base.plan.cost, 0, 'nothing self-built: the natural cell')
  const nat = W.canonicalWellSite({ home, read: flat }).site
  assert.deepEqual(base.plan.cap, nat, 'the same cell the natural search takes')
  const pf = P.planPlinth({ read: flat, home, minK: P.PLINTH_FIRST_MIN_RAISE })
  assert.ok(pf.plan, pf.why); assert.ok(pf.plan.k >= 2, `k=${pf.plan.k}`)
  const placed = new Set(pf.plan.steps.filter(st => st.op === 'place').map(st => st.c.join(',')))
  const c = pf.plan.cap
  for (const dy of [0, -1]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) assert.ok(placed.has(`${c.x + dx},${c.y + dy},${c.z + dz}`), `wall ${dx},${dy},${dz} placed`)
  assert.ok(pf.plan.cost >= 32)
})
await t('MUTANT: the minimum raise ignored -> the plinth-first plan is the bare natural cell again', async () => {
  await withMutant(PP, '    for (let k = Math.max(0, Math.min(PLINTH_MAX_RAISE, Number(minK) || 0)); k <= PLINTH_MAX_RAISE; k++) {\n', '    for (let k = 0; k <= PLINTH_MAX_RAISE; k++) {\n', async m => {
    assert.equal(m.planPlinth({ read: flat, home: { x: 0, y: 64, z: 0 }, minK: 2 }).plan.k, 0, 'mutant inert')
  })
})

await t('plinthFirstMinK, THE RAISE LADDER (Claude r4 P2-1): the policy plans from k=2; a none written at k>=2 followed by the natural search\'s own exhaustion drops the floor to 0; the bare natural cell (cost 0) is never a plan under the policy; off the policy, plinth-02\'s planner', () => {
  const none = { state: 'none', at: NOW - 3600e3, minK: 2 }
  assert.deepEqual(P.plinthFirstMinK({ policy: false }), { minK: 0, bare: true })
  assert.deepEqual(P.plinthFirstMinK({ policy: true }), { minK: 2, bare: false })
  assert.deepEqual(P.plinthFirstMinK({ policy: true, recState: 'none', rec: none, noSite: { at: NOW } }), { minK: 0, bare: false })
  assert.deepEqual(P.plinthFirstMinK({ policy: true, recState: 'none', rec: none, noSite: { at: NOW, tally: 'cols:0,plinth_first:1' } }), { minK: 2, bare: false }, 'the policy\'s own no-site record is no exhaustion of the natural search (Claude rebase P3-1)')
  assert.deepEqual(P.plinthFirstMinK({ policy: true, recState: 'none', rec: none, noSite: { at: none.at - 1 } }), { minK: 2, bare: false }, 'the no-site record that led to the failed plan is not the natural search exhausting since')
  assert.deepEqual(P.plinthFirstMinK({ policy: true, recState: 'none', rec: { ...none, minK: 0 }, noSite: { at: NOW } }), { minK: 2, bare: false }, 'a none from a floor-0 plan starts the ladder again at 2')
  assert.deepEqual(P.plinthFirstMinK({ policy: true, recState: 'complete', rec: none, noSite: { at: NOW } }), { minK: 2, bare: false })
  // on intact ground the ladder's floor 0 still places blocks: k=1 (the 8 walls at g), never the bare cell
  const low = P.planPlinth({ read: flat, home: { x: 0, y: 64, z: 0 }, minK: 0, bare: false })
  assert.ok(low.plan, low.why); assert.ok(low.plan.cost > 0, `cost ${low.plan.cost}`); assert.ok(low.plan.k >= 1, `k=${low.plan.k}`)
  assert.ok(low.plan.steps.some(st => st.op === 'place'), 'a placement in the plan')
  // CODEX r5 P2: one leaf on the natural cell's column -- a clear costs 0.5, so `cost > 0` admitted a plan of ONE clear and no block
  const nat = W.canonicalWellSite({ home: { x: 0, y: 64, z: 0 }, read: flat }).site
  const leafy = (x, y, z) => (x === nat.x && z === nat.z && y === nat.y + 1 ? { name: 'oak_leaves', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 0.2, props: null } : flat(x, y, z))
  const base = P.planPlinth({ read: leafy, home: { x: 0, y: 64, z: 0 }, minK: 0 })
  assert.equal(base.plan?.fills ?? base.plan?.steps.filter(st => st.op === 'place').length, 0, 'positive control: plinth-02 plans the leaf clear alone here')
  const pf = P.planPlinth({ read: leafy, home: { x: 0, y: 64, z: 0 }, minK: 0, bare: false })
  assert.ok(pf.plan?.steps.some(st => st.op === 'place'), `under the policy a plan places blocks: ${JSON.stringify(pf.plan?.steps?.slice(0, 2))}`)
})
await t('MUTANT: the bare guard removed -> the floor-0 plan under the policy is the bare natural cell', async () => {
  await withMutant(PP, '      if (c.cap && (bare || c.fills.length > 0)) { cands.push({ ...c, order: i }); any = true } else if (!first) first = c.cap ? \'bare\' : c.why\n',
    '      if (c.cap) { cands.push({ ...c, order: i }); any = true } else if (!first) first = c.why\n', async m => {
      assert.equal(m.planPlinth({ read: flat, home: { x: 0, y: 64, z: 0 }, minK: 0, bare: false }).plan.cost, 0, 'mutant inert')
    })
})

await t('MUTANT (Codex r5 P2): the guard on cost instead of placements -> a one-leaf-clear plan with no block is admitted under the policy', async () => {
  await withMutant(PP, '      if (c.cap && (bare || c.fills.length > 0)) { cands.push({ ...c, order: i }); any = true } else if (!first) first = c.cap ? \'bare\' : c.why\n',
    '      if (c.cap && (bare || c.cost > 0)) { cands.push({ ...c, order: i }); any = true } else if (!first) first = c.cap ? \'bare\' : c.why\n', async m => {
      const home = { x: 0, y: 64, z: 0 }, nat = W.canonicalWellSite({ home, read: flat }).site
      const leafy = (x, y, z) => (x === nat.x && z === nat.z && y === nat.y + 1 ? { name: 'oak_leaves', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 0.2, props: null } : flat(x, y, z))
      const r = m.planPlinth({ read: leafy, home, minK: 0, bare: false })
      assert.equal(r.plan.steps.some(st => st.op === 'place'), false, 'mutant inert')
    })
})

// ---- the plinth order: never from a mine -----------------------------------------------------------------------------
await t('plinthOrder: at town within PLINTH_ORDER_DY of home -> an order; 13 below (a mine) or no position -> none (Claude r1 P2-2); the bound is the town zone\'s', () => {
  assert.equal(P.PLINTH_ORDER_DY, TD.TOWN_V, 'the town deposit\'s vertical bound')
  const o = dy => P.plinthOrder({ now: NOW, distHome: 3, dy, want: { want: 'plan' }, lease: { free: true } }).order?.skill ?? null
  assert.equal(o(0), 'build_plinth'); assert.equal(o(-12), 'build_plinth'); assert.equal(o(12), 'build_plinth')
  assert.equal(o(-13), null); assert.equal(o(-26), null); assert.equal(o(Infinity), null)
})
await t('MUTANT: the vertical bound removed -> a bot 26 below home gets the order', async () => {
  await withMutant(PP, '  if (!(Math.abs(Number(dy)) <= PLINTH_ORDER_DY)) return none()\n', '', async m => {
    assert.equal(m.plinthOrder({ now: NOW, distHome: 3, dy: -26, want: { want: 'plan' }, lease: { free: true } }).order?.skill, 'build_plinth', 'mutant inert')
  })
})

// ---- the replaced site's pit is watched ------------------------------------------------------------------------------
await t('carryPrev extra: the replaced well site is carried while it could trap a body (a dug pit), let go when it could not (a fresh site)', () => {
  const pit = { x: 30, y: 64, z: 30 }
  const prev = P.carryPrev(null, c => (c.x === pit.x ? true : false), { x: 1, y: 1, z: 1 }, [pit, NAT])
  assert.deepEqual(prev.map(c => [c.x, c.y, c.z]), [[30, 64, 30]])
  assert.deepEqual(P.carryPrev(null, () => true, null, []), [], 'nothing extra, nothing carried')
  assert.deepEqual(P.carryPrev(null, () => true, pit, [pit]), [], 'never the new plan\'s own cap')
})

// ---- the licence row --------------------------------------------------------------------------------------------------
await t('the licence row names the mode, the shared verdict and the world, inside 300', () => {
  const d = P.plinthFirstModeDetail({ on: true, shared: true, worldId: '-1909043226:-504800724' })
  assert.match(d, /^phase=mode v=1 policy=1 shared=1 minraise=2 lost=evidence dy=12 w=-1909043226:-504800724$/)
  assert.match(P.plinthFirstModeDetail({ on: false, shared: false }), / policy=0 shared=0 /)
  const idx = readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  assert.equal(idx.split("kind: 'plinthfirst_mode'").length, 2, 'written once, in features.mjs installFeatures (index.mjs\'s spawn handler calls it: test/features-wired)')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log(failed.map(n => `  - ${n}`).join('\n')); process.exit(1) }

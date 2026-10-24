// TOWNPLAN-01, THE FILES: generation files created with link(), an acceptance walk over their CONTENTS (never the reader's
// clock), explicit release/expiry transitions, two-read observations, the process's own walk continued, and the writer's
// compare-and-swap cycle. Design
// docs/reports/town-plan-2026-10-20.md section 4.1; build spec docs/reports/townplan-found-spec-2026-10-21.md 1.2.
//
// Behaviour first: the interleavings the design names (two writers from one head, the second at max+1; a corrupt highest file
// then a write; a stale writer; an expiry re-walked before and after the clock passes it), each against real files in a
// temporary directory; then every transition rule by a minimal violating generation; then anchored mutants (the anchor
// present and unique, or the mutant is not a kill).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const PS = await import('../src/planstore.mjs')
const PS_PATH = new URL('../src/planstore.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** -> true when `fn` throws (the pinned behaviour broke under the mutant). */
async function killedBy (fn) { try { await fn(); return false } catch { return true } }

const W = '-1909043226:-504800724'
const HOME = { x: 100, y: 70, z: 100 }
const KEY = PS.planKey(HOME)
const dirOf = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-planstore-'))
/** A minimal valid plan body (what a mutate returns): two store cells, one station. */
const body = (extra = {}) => ({
  template: 'ring@1', home: { ...HOME }, s: 69, mode: 'greenfield', orientation: 'E',
  plots: [
    { id: 'core', kind: 'plaza', box: [94, 94, 106, 106], y: 69, state: 'planned', keepout: true },
    { id: 'store', kind: 'storehouse', box: [107, 96, 115, 104], y: 69, state: 'planned', keepout: true,
      cells: [{ at: [109, 70, 98], kind: 'chest', stand: [110, 70, 99], role: null, group: null, state: 'free' },
              { at: [109, 70, 102], kind: 'chest', stand: [110, 70, 101], role: null, group: null, state: 'free' }] },
    { id: 'work', kind: 'workshop', box: [107, 106, 111, 108], y: 69, state: 'planned', keepout: true,
      stations: [{ at: [107, 70, 107], kind: 'crafting_table', stand: [107, 70, 106], state: 'free' }] },
  ],
  paths: [], groups: { v: 1, status: 'greenfield', homes: {}, overflow: [], drain: [], pending: [] }, zones: { n: 0, avoid: 0 },
  ...extra,
})
const cellOf = (plan, at) => plan.plots.flatMap(p => [...(p.cells ?? []), ...(p.stations ?? [])]).find(c => c.at.join() === at.join())
const pub = (dir, mutate, by = 'A', at = 1_000_000) => PS.publishPlan(dir, KEY, W, mutate, { by, now: () => at })
const files = dir => PS.planGens(dir, KEY)
/** Write generation `n` by hand (what a racing or stale writer leaves on disk). */
const handLink = (dir, n, plan) => PS.linkGen(dir, KEY, n, Buffer.from(JSON.stringify(plan)))
const shaOfGen = (dir, n) => PS.shaOf(fs.readFileSync(PS.genFile(dir, KEY, n)))
const genPlan = (dir, n) => JSON.parse(fs.readFileSync(PS.genFile(dir, KEY, n), 'utf8'))
const C1 = [109, 70, 98]

console.log('planstore: the generation files (townplan-01)')

await t('ROOT: the first writer links generation 1 with prev null; the head is it', () => {
  const dir = dirOf()
  const r = pub(dir, cur => (cur ? null : body()))
  assert.equal(r.result, 'accepted'); assert.equal(r.gen, 1)
  const h = PS.planHead(dir, KEY, W)
  assert.ok(h.ok); assert.equal(h.head.gen, 1); assert.equal(h.head.plan.prev, null); assert.equal(h.head.sha, shaOfGen(dir, 1))
  assert.ok(!fs.readdirSync(dir).some(f => /head|\.tmp$/.test(f)), 'no checkpoint and no tmp file left behind')
  // nothing to write -> nothing written
  assert.equal(pub(dir, () => null).result, 'nothing'); assert.deepEqual(files(dir), [1])
})

/** Two writers from ONE head V: A's V+1 is accepted; B's file at V+2 names prev V and is REJECTED; B rebases onto V+1. */
function twoWriters (P) {
  const dir = dirOf()
  P.publishPlan(dir, KEY, W, () => body(), { by: 'A', now: () => 1000 })                         // V = 1
  const V = P.planHead(dir, KEY, W).head
  // A reserves cell 1 (V+1 = 2)
  P.publishPlan(dir, KEY, W, cur => { cellOf(cur, C1).state = 'reserved'; Object.assign(cellOf(cur, C1), { by: 'A', visit: 'va', until: 300_000 }); return cur }, { by: 'A', now: () => 2000 })
  // B, still on V, links max+1 = 3 with prev V, reserving the SAME cell
  const b = JSON.parse(JSON.stringify(V.plan))
  Object.assign(cellOf(b, C1), { state: 'reserved', by: 'B', visit: 'vb', until: 300_000 })
  Object.assign(b, { gen: 3, prev: V.gen, prevSha: V.sha, at: 2500, by: 'B', transitions: [] })
  handLink(dir, 3, b)
  const h = P.planHead(dir, KEY, W)
  return { dir, h }
}
/** The same race over an UNPROTECTED field: A marks the core existing (V+1); B, from V, places the workshop table (V+2, prev V). */
function twoWritersField (P) {
  const dir = dirOf()
  P.publishPlan(dir, KEY, W, () => body(), { by: 'A', now: () => 1000 })
  const V = P.planHead(dir, KEY, W).head
  P.publishPlan(dir, KEY, W, cur => { cur.plots[0].state = 'existing'; return cur }, { by: 'A', now: () => 2000 })
  const b = JSON.parse(JSON.stringify(V.plan))
  b.plots[2].stations[0].seenSince = 2500
  Object.assign(b, { gen: 3, prev: V.gen, prevSha: V.sha, at: 2500, by: 'B', transitions: [] })
  handLink(dir, 3, b)
  return { dir, h: P.planHead(dir, KEY, W, { fresh: true }) }
}
await t('CAS: the same race over an unprotected field -- the stale file is rejected by the chain alone; A\'s change survives', () => {
  const { h } = twoWritersField(PS)
  assert.equal(h.head.gen, 2); assert.equal(h.head.plan.plots[0].state, 'existing')
})
await t('CAS: two writers from one head -- the second, at max+1 with the old prev, is rejected; A\'s claim survives', () => {
  const { dir, h } = twoWriters(PS)
  assert.equal(h.head.gen, 2)
  assert.equal(cellOf(h.head.plan, C1).by, 'A', 'the accepted claim is A\'s')
  assert.ok(h.rejected.some(r => r.gen === 3 && /prev 1 is not the head 2/.test(r.why)))
  // B rebases: its next write reads head 2, sees A's live reservation, and claims the other cell instead (gen 4)
  const r = pub(dir, cur => { const c = cur.plots[1].cells[1]; Object.assign(c, { state: 'reserved', by: 'B', visit: 'vb', until: 300_000 }); return cur }, 'B', 3000)
  assert.equal(r.result, 'accepted'); assert.equal(r.gen, 4)
  const h2 = PS.planHead(dir, KEY, W)
  assert.equal(cellOf(h2.head.plan, C1).by, 'A'); assert.equal(h2.head.plan.plots[1].cells[1].by, 'B')
})

await t('CAS: a number taken between the read and the link -> retried at the next number, on the NEW head (rebase)', () => {
  const dir = dirOf()
  pub(dir, () => body())
  let nested = false, seenGens = []
  const r = PS.publishPlan(dir, KEY, W, cur => {
    seenGens.push(cur.gen)
    if (!nested) { nested = true; pub(dir, c => { c.plots[0].state = 'existing'; return c }, 'A', 1500) }   // another writer slips in gen 2
    cur.plots[2].stations[0].seenSince = 2000
    return cur
  }, { by: 'B', now: () => 2000 })
  assert.equal(r.result, 'accepted'); assert.equal(r.gen, 3)
  assert.deepEqual(seenGens, [1, 2], 'the second try mutated the new head')
  const h = PS.planHead(dir, KEY, W).head
  assert.equal(h.plan.plots[0].state, 'existing', 'the other writer\'s change kept'); assert.equal(h.plan.plots[2].stations[0].seenSince, 2000)
})

await t('P5: a corrupt highest file is skipped; the next write goes to max+1 and is accepted (no freeze)', () => {
  const dir = dirOf()
  pub(dir, () => body())
  fs.writeFileSync(PS.genFile(dir, KEY, 2), '{"v":1,"gen":2,')
  const h = PS.planHead(dir, KEY, W)
  assert.equal(h.head.gen, 1); assert.ok(h.rejected.some(r => r.gen === 2 && r.why === 'unparseable'))
  const r = pub(dir, cur => { cur.plots[0].state = 'existing'; return cur }, 'A', 2000)
  assert.equal(r.result, 'accepted'); assert.equal(r.gen, 3); assert.equal(PS.planHead(dir, KEY, W).head.gen, 3)
  assert.ok(fs.existsSync(PS.genFile(dir, KEY, 2)), 'a rejected file is never deleted')
})

await t('STALE WRITER (a restart with an old head): its file names an old prev and is rejected; its next cycle rebases', () => {
  const dir = dirOf()
  pub(dir, () => body())
  const old = PS.planHead(dir, KEY, W).head
  pub(dir, cur => { cur.plots[0].state = 'existing'; return cur }, 'A', 2000)                       // 2
  const stale = { ...JSON.parse(JSON.stringify(old.plan)), gen: 3, prev: 1, prevSha: old.sha, at: 3000, by: 'S', transitions: [] }
  handLink(dir, 3, stale)
  assert.equal(PS.planHead(dir, KEY, W).head.gen, 2)
  const r = pub(dir, cur => { cur.plots[2].stations[0].seenSince = 4000; return cur }, 'S', 4000)
  assert.equal(r.result, 'accepted'); assert.equal(r.gen, 4)
  assert.equal(PS.planHead(dir, KEY, W).head.plan.plots[0].state, 'existing', 'nothing the stale writer did not see was lost')
})

/** An expiry: gen 2 reserves C1 until T; gen 3 writes it `expired` at T + 30 s (early: rejected); gen 4 at T + 61 s (accepted). */
function expiryFiles (P) {
  const dir = dirOf()
  const T = 500_000
  P.publishPlan(dir, KEY, W, () => body(), { by: 'A', now: () => 1000 })
  P.publishPlan(dir, KEY, W, cur => { Object.assign(cellOf(cur, C1), { state: 'reserved', by: 'A', visit: 'va', until: T }); return cur }, { by: 'A', now: () => 2000 })
  const h2 = P.planHead(dir, KEY, W).head
  const free = (at, gen) => {
    const p = JSON.parse(JSON.stringify(h2.plan))
    const c = cellOf(p, C1); c.state = 'free'; delete c.by; delete c.visit; delete c.until
    return { ...p, gen, prev: 2, prevSha: h2.sha, at, by: 'B', transitions: [{ at: C1, why: 'expired' }] }
  }
  handLink(dir, 3, free(T + 30_000, 3))
  return { dir, T }
}
await t('EXPIRY: judged on the file\'s own `at` -- the same files give the same head before and after the reader\'s clock passes until + 60 s', () => {
  const { dir, T } = expiryFiles(PS)
  const realNow = Date.now
  try {
    Date.now = () => T - 1000
    const before = PS.planHead(dir, KEY, W, { fresh: true })
    Date.now = () => T + 10 * 60_000
    const after = PS.planHead(dir, KEY, W, { fresh: true })
    assert.equal(before.head.gen, 2); assert.equal(after.head.gen, 2)
    assert.deepEqual(before.rejected, after.rejected)
    assert.ok(after.rejected.some(r => r.gen === 3 && /expiry of .* before until \+ margin/.test(r.why)))
  } finally { Date.now = realNow }
  // a correct expiry (at > until + 60 s) is accepted, by any writer, and the cell is free again
  const r = pub(dir, cur => { const c = cellOf(cur, C1); c.state = 'free'; delete c.by; delete c.visit; delete c.until; cur.transitions = [{ at: C1, why: 'expired' }]; return cur }, 'B', T + 61_000)
  assert.equal(r.result, 'accepted'); assert.equal(cellOf(PS.planHead(dir, KEY, W).head.plan, C1).state, 'free')
})

await t('RELEASE: only the holder (same bot and visit) may release a live reservation; a non-holder\'s generation is refused at the writer', () => {
  const dir = dirOf()
  pub(dir, () => body())
  pub(dir, cur => { Object.assign(cellOf(cur, C1), { state: 'reserved', by: 'A', visit: 'va', until: 900_000 }); return cur }, 'A', 2000)
  const rel = by => cur => { const c = cellOf(cur, C1); c.state = 'free'; delete c.by; delete c.visit; delete c.until; cur.transitions = [{ at: C1, why: 'released', by: 'A', visit: 'va' }]; return cur }
  const bad = pub(dir, rel('B'), 'B', 3000)
  assert.equal(bad.result, 'invalid', 'a generation the walk would reject is never written'); assert.deepEqual(files(dir), [1, 2])
  assert.equal(pub(dir, rel('A'), 'A', 3000).result, 'accepted')
})

await t('PLACED: the holder publishes its own placement at once (keeping the intent); another bot only after the expiry AND two reads 10 min apart', () => {
  const dir = dirOf()
  pub(dir, () => body())
  pub(dir, cur => { Object.assign(cellOf(cur, C1), { state: 'reserved', by: 'A', visit: 'va', until: 900_000, role: 'overflow', group: null, intentSet: true }); return cur }, 'A', 2000)
  // the adopting step clears seenSince (a placed cell never carries it: maintainPlan does the same)
  const place = (by, visit) => cur => { Object.assign(cellOf(cur, C1), { state: 'placed', by, visit }); delete cellOf(cur, C1).seenSince; delete cellOf(cur, C1).intentSet; return cur }
  assert.equal(pub(dir, place('B', 'vb'), 'B', 3000).result, 'invalid', 'another bot, before the expiry')
  assert.equal(pub(dir, place('B', 'vb'), 'B', 900_000 + 61_000).result, 'invalid', 'another bot after the expiry, but with ONE read')
  // the first read: seenSince (any writer); the adoption 10 min later
  assert.equal(pub(dir, cur => { cellOf(cur, C1).seenSince = 961_000; return cur }, 'B', 961_000).result, 'accepted')
  assert.equal(pub(dir, place('B', 'vb'), 'B', 961_000 + 5 * 60_000).result, 'invalid', 'only 5 min after the first read')
  assert.equal(pub(dir, place('B', 'vb'), 'B', 961_000 + 10 * 60_000).result, 'accepted')
  assert.equal(cellOf(PS.planHead(dir, KEY, W).head.plan, C1).role, 'overflow', 'the reservation\'s intent survives the observation')
  // ...a placed cell never just becomes free, and its role never changes
  assert.equal(pub(dir, cur => { cellOf(cur, C1).state = 'free'; return cur }, 'A', 2_000_000).result, 'invalid')
  assert.equal(pub(dir, cur => { cellOf(cur, C1).role = 'home'; cellOf(cur, C1).group = 'metal'; return cur }, 'A', 2_000_000).result, 'invalid')
  // the holder's own placement needs no observation
  const d2 = dirOf()
  pub(d2, () => body())
  pub(d2, cur => { Object.assign(cellOf(cur, C1), { state: 'reserved', by: 'A', visit: 'va', until: 900_000, role: 'overflow', group: null, intentSet: true }); return cur }, 'A', 2000)
  assert.equal(pub(d2, place('A', 'va'), 'A', 3000).result, 'accepted')
})

await t('OBSERVATION (Codex/Claude spec r2 P1): a free cell adopted only after two reads 10 min apart; gone only after two empty reads; the intent kept', () => {
  const dir = dirOf()
  pub(dir, () => body())
  const st0 = cur => cur.plots[2].stations[0]
  // a temporary table read once must never become `placed` in one generation
  assert.equal(pub(dir, cur => { st0(cur).state = 'placed'; return cur }, 'B', 5000).result, 'invalid')
  assert.equal(pub(dir, cur => { st0(cur).seenSince = 5000; return cur }, 'B', 5000).result, 'accepted')
  assert.equal(pub(dir, cur => { st0(cur).state = 'placed'; return cur }, 'B', 5000 + 9 * 60_000).result, 'invalid')
  // the read then shows something else: the mark is cleared (any writer) and the clock restarts
  assert.equal(pub(dir, cur => { delete st0(cur).seenSince; return cur }, 'C', 5000 + 9 * 60_000).result, 'accepted')
  assert.equal(pub(dir, cur => { st0(cur).state = 'placed'; return cur }, 'B', 5000 + 30 * 60_000).result, 'invalid', 'no mark, no adoption')
  assert.equal(pub(dir, cur => { st0(cur).seenSince = 40 * 60_000; return cur }, 'B', 40 * 60_000).result, 'accepted')
  assert.equal(pub(dir, cur => { st0(cur).state = 'placed'; delete st0(cur).seenSince; return cur }, 'B', 50 * 60_000).result, 'accepted')
  // GONE: a placed cell read empty twice, 10 min apart, returns to free with a `gone` transition
  assert.equal(pub(dir, cur => { st0(cur).state = 'free'; cur.transitions = [{ at: st0(cur).at, why: 'gone' }]; return cur }, 'B', 60 * 60_000).result, 'invalid', 'no first empty read')
  assert.equal(pub(dir, cur => { st0(cur).missingSince = 60 * 60_000; return cur }, 'B', 60 * 60_000).result, 'accepted')
  assert.equal(pub(dir, cur => { st0(cur).state = 'free'; cur.transitions = [{ at: st0(cur).at, why: 'gone' }]; return cur }, 'B', 65 * 60_000).result, 'invalid', '5 min')
  assert.equal(pub(dir, cur => { st0(cur).state = 'free'; delete st0(cur).missingSince; cur.transitions = [{ at: st0(cur).at, why: 'gone' }]; return cur }, 'B', 70 * 60_000).result, 'accepted')
  assert.equal(st0(PS.planHead(dir, KEY, W).head.plan).state, 'free')
  // a NEW cell may not arrive already placed (that would skip the observation)
  const base = { ...body(), v: 1, gen: 2, prev: 1, prevSha: 'a'.repeat(64), world: W, at: 5000, by: 'A', transitions: [] }
  const nx = JSON.parse(JSON.stringify(base)); nx.gen = 3; nx.prev = 2; nx.plots[2].stations.push({ at: [108, 70, 107], kind: 'furnace', stand: [108, 70, 106], state: 'placed' })
  assert.match(PS.transitionRefusal(base, nx), /arrives placed/)
})

await t('TRANSITION RULES, one minimal violation each (transitionRefusal)', () => {
  const base = { ...body(), v: 1, gen: 2, prev: 1, prevSha: 'a'.repeat(64), world: W, at: 5000, by: 'A', transitions: [] }
  Object.assign(cellOf(base, C1), { state: 'reserved', by: 'A', visit: 'va', until: 9000 })
  const nx = f => { const n = JSON.parse(JSON.stringify(base)); n.gen = 3; n.prev = 2; f(n); return n }
  assert.equal(PS.transitionRefusal(base, nx(() => {})), null, 'an unchanged generation is accepted')
  assert.match(PS.transitionRefusal(base, nx(n => { n.home = { x: 1, y: 2, z: 3 } })), /home changed/)
  assert.match(PS.transitionRefusal(base, nx(n => { n.mode = 'retrofit' })), /mode changed/)
  assert.match(PS.transitionRefusal(base, nx(n => { n.plots = n.plots.filter(p => p.id !== 'work') })), /plot work dropped/)
  assert.match(PS.transitionRefusal(base, nx(n => { cellOf(n, C1).at = [109, 70, 97] })), /geometry changed with cells committed|dropped/)
  assert.match(PS.transitionRefusal(base, nx(n => { n.s = 70 })), /s\/orientation changed/)
  assert.match(PS.transitionRefusal(base, nx(n => { Object.assign(cellOf(n, C1), { by: 'B', visit: 'vb' }) })), /live reservation .* taken/)
  assert.match(PS.transitionRefusal(base, nx(n => { cellOf(n, C1).until = 8000 })), /shortened/)
  assert.match(PS.transitionRefusal(base, nx(n => { n.by = 'B'; cellOf(n, C1).until = 99_000 })), /renewed by a non-holder/)
  assert.match(PS.transitionRefusal(base, nx(n => { const c = cellOf(n, C1); c.state = 'free' })), /dropped without a transition/)
  assert.match(PS.transitionRefusal(base, nx(n => { n.transitions = [{ at: [109, 70, 102], why: 'released' }] })), /transition released on .*, free/)
  // free -> reserved only by the writer, with a live until
  assert.match(PS.transitionRefusal(base, nx(n => { Object.assign(n.plots[1].cells[1], { state: 'reserved', by: 'Z', visit: 'z', until: 99_999 }) })), /not by the writer/)
  assert.equal(PS.transitionRefusal(base, nx(n => { Object.assign(n.plots[1].cells[1], { state: 'reserved', by: 'A', visit: 'v2', until: 99_999 }) })), null)
  // INTENT (Claude/Codex code r1 P2): a reservation may set an intent on a cell with none, never change one; an adoption keeps
  // it exactly; a placed cell never carries seenSince, also not on the adopting step
  const i0 = JSON.parse(JSON.stringify(base)); Object.assign(i0.plots[1].cells[1], { role: 'overflow' })
  const ix = f => { const n = JSON.parse(JSON.stringify(i0)); n.gen = 3; n.prev = 2; f(n); return n }
  assert.match(PS.transitionRefusal(i0, ix(n => { Object.assign(n.plots[1].cells[1], { state: 'reserved', by: 'A', visit: 'v2', until: 99_999, role: 'home', group: 'metal' }) })), /changed its intent/)
  assert.equal(PS.transitionRefusal(base, nx(n => { Object.assign(n.plots[1].cells[1], { state: 'reserved', by: 'A', visit: 'v2', until: 99_999, role: 'home', group: 'metal', intentSet: true }) })), null, 'set from none')
  // THE MARKER (Codex code r3 P2): set exactly when the reservation sets an intent; never on a free/placed cell; never toggled;
  // its end clears what it set and keeps an older intent
  assert.match(PS.transitionRefusal(base, nx(n => { Object.assign(n.plots[1].cells[1], { state: 'reserved', by: 'A', visit: 'v2', until: 99_999, role: 'home', group: 'metal' }) })), /intentSet .* missing/)
  assert.match(PS.transitionRefusal(base, nx(n => { Object.assign(n.plots[1].cells[1], { state: 'reserved', by: 'A', visit: 'v2', until: 99_999, intentSet: true }) })), /without an intent set/)
  assert.match(PS.transitionRefusal(base, nx(n => { n.plots[1].cells[1].intentSet = true })), /intentSet on free/)
  const m0 = JSON.parse(JSON.stringify(base)); Object.assign(cellOf(m0, C1), { role: 'home', group: 'metal', intentSet: true })
  const mx = f => { const n = JSON.parse(JSON.stringify(m0)); n.gen = 3; n.prev = 2; f(n); return n }
  assert.match(PS.transitionRefusal(m0, mx(n => { delete cellOf(n, C1).intentSet })), /toggled/)
  const rel = keep => mx(n => { const c = cellOf(n, C1); c.state = 'free'; delete c.by; delete c.visit; delete c.until; delete c.intentSet; if (!keep) { c.role = null; c.group = null } n.transitions = [{ at: c.at, why: 'released', by: 'A', visit: 'va' }] })
  assert.equal(PS.transitionRefusal(m0, rel(false)), null, 'the set intent cleared at the release')
  assert.match(PS.transitionRefusal(m0, rel(true)), /survived its end/)
  const o0 = JSON.parse(JSON.stringify(base)); Object.assign(cellOf(o0, C1), { role: 'home', group: 'wood' })   // an OLDER intent (no marker)
  const ox = f => { const n = JSON.parse(JSON.stringify(o0)); n.gen = 3; n.prev = 2; f(n); return n }
  const rel2 = keep => ox(n => { const c = cellOf(n, C1); c.state = 'free'; delete c.by; delete c.visit; delete c.until; if (!keep) { c.role = null; c.group = null } n.transitions = [{ at: c.at, why: 'released', by: 'A', visit: 'va' }] })
  assert.equal(PS.transitionRefusal(o0, rel2(true)), null, 'the older intent kept')
  assert.match(PS.transitionRefusal(o0, rel2(false)), /older intent .* lost/)
  const i1 = JSON.parse(JSON.stringify(i0)); i1.plots[1].cells[1].seenSince = 1000
  const iy = f => { const n = JSON.parse(JSON.stringify(i1)); n.gen = 3; n.prev = 2; n.at = 1000 + 11 * 60_000; f(n); return n }
  assert.match(PS.transitionRefusal(i1, iy(n => { const c = n.plots[1].cells[1]; c.state = 'placed'; delete c.seenSince; c.role = 'home'; c.group = 'metal' })), /adoption .* changed its intent/)
  assert.equal(PS.transitionRefusal(i1, iy(n => { const c = n.plots[1].cells[1]; c.state = 'placed'; delete c.seenSince })), null, 'the intent kept: accepted')
  assert.match(PS.transitionRefusal(i1, iy(n => { n.plots[1].cells[1].state = 'placed' })), /seenSince on placed/)
  // a NEW (appended) cell reserved with an intent must carry the marker; without an intent it must not (Claude code r4 P3)
  const app = (extra) => nx(n => { n.plots[1].cells.push({ at: [111, 70, 98], kind: 'chest', stand: [111, 70, 99], role: 'home', group: 'metal', state: 'reserved', by: 'A', visit: 'v', until: 99_999, ...extra }) })
  assert.equal(PS.transitionRefusal(base, app({ intentSet: true })), null)
  assert.match(PS.transitionRefusal(base, app({})), /intentSet .* missing/)
  assert.match(PS.transitionRefusal(base, app({ role: null, group: null, intentSet: true })), /without an intent set/)
  // a NEW cell reserved by the writer must carry a live until
  assert.match(PS.transitionRefusal(base, nx(n => { n.plots[1].cells.push({ at: [111, 70, 98], kind: 'chest', stand: [111, 70, 99], role: null, group: null, state: 'reserved', by: 'A', visit: 'v', until: 10 }) })), /reserved by another \(or already expired\)/)
  // a COMMITTED plot may only APPEND (Codex spec r1 P1): a new store cell is accepted, a moved free one is not
  assert.equal(PS.transitionRefusal(base, nx(n => { n.plots[1].cells.push({ at: [111, 70, 98], kind: 'chest', stand: [111, 70, 99], role: null, group: null, state: 'free' }) })), null)
  assert.match(PS.transitionRefusal(base, nx(n => { n.plots[1].cells[1].at = [109, 70, 103] })), /of committed plot store dropped/)
  assert.match(PS.transitionRefusal(base, nx(n => { n.plots[1].cells[1].stand = [110, 70, 103] })), /of committed plot store changed/)
  assert.match(PS.transitionRefusal(base, nx(n => { n.plots[1].box = [107, 96, 116, 104] })), /geometry changed with cells committed/)
  // ...a FLEX store (annex) may move or drop its FREE cells around what is committed
  const flex = JSON.parse(JSON.stringify(base)); flex.plots[1].kind = 'annex'
  const fx = f => { const n = JSON.parse(JSON.stringify(flex)); n.gen = 3; n.prev = 2; f(n); return n }
  assert.equal(PS.transitionRefusal(flex, fx(n => { n.plots[1].cells[1].at = [109, 70, 103] })), null)
  assert.match(PS.transitionRefusal(flex, fx(n => { n.plots[1].cells = n.plots[1].cells.slice(1) })), /dropped/, 'never the reserved one')
  // no cell may stand on a committed cell's stand (an appended cell walling off the reservation)
  assert.match(PS.transitionRefusal(base, nx(n => { n.plots[1].cells.push({ at: [110, 70, 99], kind: 'chest', stand: [111, 70, 99], role: null, group: null, state: 'free' }) })), /stands on the stand of/)
  // an UNCOMMITTED plot may be re-fitted (its geometry changes): the work plot has nothing reserved or placed
  assert.equal(PS.transitionRefusal(base, nx(n => { n.plots[2].stations[0].at = [108, 70, 107]; n.plots[2].box = [108, 106, 112, 108] })), null)
  // retrofit groups: allocated stays allocated; a home keeps its containers
  const rb = { ...base, groups: { v: 1, status: 'allocated', homes: { metal: ['1,2,3'] }, overflow: [], drain: [], pending: [] } }
  const rn = f => { const n = JSON.parse(JSON.stringify(rb)); f(n); return n }
  assert.match(PS.transitionRefusal(rb, rn(n => { n.groups.status = 'waiting' })), /de-allocated/)
  assert.match(PS.transitionRefusal(rb, rn(n => { n.groups.homes.metal = [] })), /home metal lost/)
  assert.equal(PS.transitionRefusal(rb, rn(n => { n.groups.homes.fuel = ['4,5,6'] })), null)
})

await t('WORLDS: a file of another world is ABSENT (skipped, not rejected) -- a reseeded world gets its own root', () => {
  const dir = dirOf()
  pub(dir, () => body())                                                                           // world W, gen 1
  const r = PS.publishPlan(dir, KEY, 'other:world', cur => (cur ? null : body({ s: 64 })), { by: 'A', now: () => 2000 })
  assert.equal(r.result, 'accepted'); assert.equal(r.gen, 2)
  assert.equal(PS.planHead(dir, KEY, W).head.gen, 1); assert.equal(PS.planHead(dir, KEY, 'other:world').head.gen, 2)
  assert.deepEqual(PS.planHead(dir, KEY, W).absent, [2])
})

/** A walk this process continues, then a LOWER number it never saw appears (a file 3 linked after 4 was read). */
function lateLower (P) {
  const dir = dirOf()
  P.publishPlan(dir, KEY, W, () => body(), { by: 'A', now: () => 1000 })                           // 1
  P.publishPlan(dir, KEY, W, cur => { cur.plots[0].state = 'existing'; return cur }, { by: 'A', now: () => 2000 })   // 2
  const h2 = P.planHead(dir, KEY, W).head
  const mk = (gen, prev, sha, f) => { const p = JSON.parse(JSON.stringify(h2.plan)); f(p); return { ...p, gen, prev, prevSha: sha, at: 3000, by: 'X', transitions: [] } }
  // 4 names prev 2 and is read first (accepted in this process's walk) ...
  handLink(dir, 4, mk(4, 2, h2.sha, p => { p.plots[2].stations[0].seenSince = 3000 }))
  const seen = P.planHead(dir, KEY, W)
  // ... then 3 (prev 2) lands: the full walk accepts 3 and REJECTS 4
  handLink(dir, 3, mk(3, 2, h2.sha, p => { p.plots[0].keepout = false }))
  return { dir, seen, after: P.planHead(dir, KEY, W), full: P.planHead(dir, KEY, W, { fresh: true }) }
}
await t('CONTINUATION (Codex spec r2 P2, replacing the checkpoint): a reader continues its own walk, and walks again from the root when a lower number it never saw appears', () => {
  const dir = dirOf()
  pub(dir, () => body())
  PS.planHead(dir, KEY, W)
  pub(dir, cur => { cur.plots[0].state = 'existing'; return cur }, 'A', 2000)
  const h = PS.planHead(dir, KEY, W)
  assert.match(h.from, /^continued:/); assert.equal(h.head.gen, 2); assert.deepEqual(h.accepted, [1, 2])
  const { seen, after, full } = lateLower(PS)
  assert.equal(seen.head.gen, 4)
  assert.equal(full.head.gen, 3)
  assert.equal(after.head.gen, full.head.gen, 'the continued walk equals the full walk'); assert.equal(after.from, 'root')
})

await t('UNREADABLE: a directory that cannot be read is ok:false, never "no plan" (a writer must not write a second root)', () => {
  const dir = dirOf()
  pub(dir, () => body())
  fs.chmodSync(dir, 0o000)
  try {
    if (process.getuid?.() === 0) return   // root reads anything: nothing to prove
    const h = PS.planHead(dir, KEY, W)
    assert.equal(h.ok, false); assert.equal(h.head, null)
    assert.equal(pub(dir, cur => (cur ? null : body())).result, 'error')
  } finally { fs.chmodSync(dir, 0o700) }
})

console.log('planstore: anchored mutants')
async function withMutantsAll (p, pairs, fn) {
  let src = readFileSync(p, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: accepting a file that does not chain to the head (prev AND prevSha unchecked) loses A\'s claim', async () => {
  // prev and prevSha guard the same thing twice (a matching sha implies the generation): only both removed is a hole
  const k = await withMutantsAll(PS_PATH, [["if (plan.prev !== head.gen) { rejected.push", "if (false) { rejected.push"],
                                            ["if (plan.prevSha !== head.sha) { rejected.push", "if (false) { rejected.push"]], async P => killedBy(() => {
    // a reservation is ALSO protected by the transition rule (defence in depth); an unprotected field is not
    const { h } = twoWritersField(P)
    assert.equal(h.head.plan.plots[0].state, 'existing', 'A\'s change survives')
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: an expiry not judged against until + margin', async () => {
  const k = await withMutant(PS_PATH, "if (t.why === 'expired' && !late(c)) return", "if (false) return", async P => killedBy(() => {
    const { dir } = expiryFiles(P)
    assert.equal(P.planHead(dir, KEY, W, { fresh: true }).head.gen, 2)
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: a placed cell written gone without the two empty reads', async () => {
  const k = await withMutant(PS_PATH, "if (!observed(c, 'missingSince')) return", "if (false) return", async P => killedBy(() => {
    const prev = { ...body(), v: 1, gen: 1, prev: null, prevSha: null, world: W, at: 1, by: 'A', transitions: [] }
    Object.assign(cellOf(prev, C1), { state: 'placed', by: 'A', visit: 'v', role: 'overflow', missingSince: 1000 })
    const next = JSON.parse(JSON.stringify(prev)); next.gen = 2; next.prev = 1; next.at = 1000 + 60_000
    Object.assign(cellOf(next, C1), { state: 'free' }); delete cellOf(next, C1).missingSince; next.transitions = [{ at: C1, why: 'gone' }]
    assert.ok(P.transitionRefusal(prev, next), 'one minute after the first empty read: refused')
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MARKS (Claude spec r3 P2): set only to the writer\'s own at; never changed while set; a non-holder may not mark a live reservation; a pending mark pins the cell', () => {
  const base = { ...body(), v: 1, gen: 2, prev: 1, prevSha: 'a'.repeat(64), world: W, at: 5000, by: 'A', transitions: [] }
  Object.assign(cellOf(base, C1), { state: 'reserved', by: 'A', visit: 'va', until: 9000 })
  const nx = (by, at, f) => { const n = JSON.parse(JSON.stringify(base)); n.gen = 3; n.prev = 2; n.by = by; n.at = at; f(n); return n }
  const C2 = [109, 70, 102]
  assert.equal(PS.transitionRefusal(base, nx('B', 6000, n => { cellOf(n, C2).seenSince = 6000 })), null)
  assert.match(PS.transitionRefusal(base, nx('B', 6000, n => { cellOf(n, C2).seenSince = 1 })), /backdated/)
  assert.match(PS.transitionRefusal(base, nx('B', 6000, n => { cellOf(n, C1).seenSince = 6000 })), /live reservation .* by a non-holder/)
  assert.equal(PS.transitionRefusal(base, nx('A', 6000, n => { cellOf(n, C1).seenSince = 6000 })), null, 'the holder may')
  assert.equal(PS.transitionRefusal(base, nx('B', 9000 + 61_000, n => { cellOf(n, C1).seenSince = 9000 + 61_000 })), null, 'anyone after the expiry')
  const marked = JSON.parse(JSON.stringify(base)); cellOf(marked, C2).seenSince = 5000
  const mx = (f, at = 6000) => { const n = JSON.parse(JSON.stringify(marked)); n.gen = 3; n.prev = 2; n.by = 'B'; n.at = at; f(n); return n }
  assert.match(PS.transitionRefusal(marked, mx(n => { cellOf(n, C2).seenSince = 6000 })), /changed while set/)
  assert.equal(PS.transitionRefusal(marked, mx(n => { delete cellOf(n, C2).seenSince })), null, 'cleared by a contrary read')
  // pinned: the store plot is committed by C1's reservation; a FLEX store with only a marked free cell may not drop it
  const flex = JSON.parse(JSON.stringify(base)); flex.plots[1].kind = 'annex'; Object.assign(cellOf(flex, C1), { state: 'free' }); delete cellOf(flex, C1).by; delete cellOf(flex, C1).visit; delete cellOf(flex, C1).until
  cellOf(flex, C2).seenSince = 5000
  const fx = f => { const n = JSON.parse(JSON.stringify(flex)); n.gen = 3; n.prev = 2; n.by = 'B'; n.at = 6000; f(n); return n }
  assert.match(PS.transitionRefusal(flex, fx(n => { n.plots[1].cells = n.plots[1].cells.filter(c => c.at.join() !== C2.join()) })), /dropped/)
  assert.equal(PS.transitionRefusal(flex, fx(n => { n.plots[1].cells = n.plots[1].cells.filter(c => c.at.join() !== C1.join()) })), null, 'an unmarked free cell of a flex store may go')
})
await t('MUTANT KILLED: a backdated mark accepted (a one-read adoption by the back door)', async () => {
  const k = await withMutant(PS_PATH, "if (b !== null && b !== Number(next.at)) return", "if (false) return", async P => killedBy(() => {
    const prev = { ...body(), v: 1, gen: 1, prev: null, prevSha: null, world: W, at: 1, by: 'A', transitions: [] }
    const next = JSON.parse(JSON.stringify(prev)); next.gen = 2; next.prev = 1; next.at = 50 * 60_000
    next.plots[2].stations[0].seenSince = 1
    assert.ok(P.transitionRefusal(prev, next))
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: a non-holder marking a live reservation', async () => {
  const k = await withMutant(PS_PATH, "&& next.by !== c.by) return `${mark} on live reservation", "&& false) return `${mark} on live reservation", async P => killedBy(() => {
    const prev = { ...body(), v: 1, gen: 1, prev: null, prevSha: null, world: W, at: 1, by: 'A', transitions: [] }
    Object.assign(cellOf(prev, C1), { state: 'reserved', by: 'A', visit: 'va', until: 9000 })
    const next = JSON.parse(JSON.stringify(prev)); next.gen = 2; next.prev = 1; next.at = 6000; next.by = 'B'
    cellOf(next, C1).seenSince = 6000
    assert.ok(P.transitionRefusal(prev, next))
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: a continued walk that ignores a late lower number keeps a rejected head', async () => {
  const k = await withMutant(PS_PATH, 'gens.every(g => g > lastWalked || prior.set.has(g))', 'true', async P => killedBy(() => {
    const { after, full } = lateLower(P)
    assert.equal(after.head.gen, full.head.gen)
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: an adoption that changes the cell\'s intent (Claude/Codex code r1 P2)', async () => {
  const mk = P => {
    const prev = { ...body(), v: 1, gen: 2, prev: 1, prevSha: 'a'.repeat(64), world: W, at: 1000, by: 'A', transitions: [] }
    Object.assign(prev.plots[1].cells[1], { role: 'overflow', seenSince: 1000 })
    const next = JSON.parse(JSON.stringify(prev)); next.gen = 3; next.prev = 2; next.at = 1000 + 11 * 60_000
    const c = next.plots[1].cells[1]; c.state = 'placed'; delete c.seenSince; c.role = 'home'; c.group = 'metal'
    return P.transitionRefusal(prev, next)
  }
  assert.match(mk(PS), /changed its intent/, 'the unmutated walk refuses it')
  const k = await withMutant(PS_PATH, "    if (n.state === 'placed' && !sameIntent(c, n)) return `adoption of ${k} changed its intent`\n", '', async P => killedBy(() => {
    assert.ok(mk(P))
  }))
  assert.ok(k, 'the mutant survived')
})
await t('MUTANT KILLED: an adoption without the two-read delay', async () => {
  const k = await withMutant(PS_PATH, 'const observed = (c, mark) => Number.isFinite(c?.[mark]) && Number(next.at) >= Number(c[mark]) + OBSERVE_MS', 'const observed = (c, mark) => true', async P => killedBy(() => {
    const dir = dirOf()
    P.publishPlan(dir, KEY, W, () => body(), { by: 'A', now: () => 1000 })
    const r = P.publishPlan(dir, KEY, W, cur => { cur.plots[2].stations[0].state = 'placed'; return cur }, { by: 'B', now: () => 5000 })
    assert.equal(r.result, 'invalid')
  }))
  assert.ok(k, 'the mutant survived')
})
/** A writer whose generation is accepted and IMMEDIATELY extended by another writer (before its re-walk). */
function extendedAtOnce (P) {
  const dir = dirOf()
  P.publishPlan(dir, KEY, W, () => body(), { by: 'A', now: () => 1000 })
  let calls = 0
  const r = P.publishPlan(dir, KEY, W, cur => { calls++; cur.plots[0].state = 'existing'; return cur }, {
    by: 'B', now: () => 2000,
    onLinked: () => P.publishPlan(dir, KEY, W, c => { c.plots[2].stations[0].seenSince = 2100; return c }, { by: 'C', now: () => 2100 }) })
  return { dir, r, calls }
}
await t('CAS (Codex spec r1 P2): accepted and immediately extended by another writer -> success, never re-applied', () => {
  const { dir, r, calls } = extendedAtOnce(PS)
  assert.equal(r.result, 'accepted'); assert.equal(r.gen, 2); assert.equal(calls, 1, 'the change was applied once')
  assert.deepEqual(PS.planGens(dir, KEY), [1, 2, 3])
  assert.equal(PS.planHead(dir, KEY, W).head.gen, 3)
})
await t('MUTANT KILLED: success judged as "still the head" re-applies an accepted change', async () => {
  const k = await withMutant(PS_PATH, 'if (after.ok && after.accepted.includes(n)) return', 'if (after.ok && after.head?.gen === n) return', async P => killedBy(() => {
    const { r, calls } = extendedAtOnce(P)
    assert.equal(r.gen, 2); assert.equal(calls, 1)
  }))
  assert.ok(k, 'the mutant survived')
})

console.log(`\nplanstore: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

// YARDUSE-01 (OWNER 11-04 "we built a large area outside the town to put excess materials ... doesnt seem to be used, why?"):
// the bays' clutter is the yard upkeep's (yard.mjs bayClutter), the well leaves the yard's share in the bag while the yard can take
// it (yardWellKeep / yardDeferOk; well.mjs cobbleWellStacks' reserve; disposePlan's cobbleReserve), and a sink's or the
// groundskeeper's bill draws cobblestone from the piles before the chests (yardDrawPlan; skills.mjs yardDrawFor).
// Behaviour: the LIVE showcase case rebuilt on the fake server (three bays full, five leaves on bay 3's top layer), cleared by the
// real visit runner, then stocked; the order's reading of the yard through skills.mjs shopDamaged; the well's plan over a real
// bag. STRUCTURAL source assertions only for the wiring (comments stripped, anchored, each killed by a one-character mutant).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { B, R, server, bot, plan, project } = await import('./helpers/buildfake.mjs')
const Y = await import('../src/yard.mjs')
const W = await import('../src/well.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const YARD_PATH = new URL('../src/yard.mjs', import.meta.url)

const BP = B.loadBlueprint(Y.YARD_BLUEPRINT)
const SITE = B.siteBlueprint(server().read, plan(), BP, { tries: 2, plot: Y.YARD_PLOT, earth: Y.YARD_EARTH })
const SLOTS = Y.pileSlots(SITE.record, BP)
let BUILT = null
const built = async () => {
  if (!BUILT) {
    const srv = server(), { p } = project(SITE.record)
    const e = bot(srv, 'A', { inv: { cobblestone: 600, torch: 8 } })
    const r = await R.runVisit({ ...p('A'), palette: BP.palette }, e, { maxSteps: 3000 })
    assert.strictEqual(r.stop, 'complete')
    BUILT = new Map(srv.cells)
  }
  const srv = server(Object.fromEntries(BUILT)), { p } = project(SITE.record)
  return { srv, p }
}
// THE LIVE CASE (showcase 11-04, RCON read): bays 0-2 full of cobblestone (bay 2 one dirt), bay 3 empty but for five spruce leaves
// on its top layer (an overhanging tree)
const liveYard = async () => {
  const w = await built()
  for (const b of SLOTS.slice(0, 3)) for (const s of b.slots) w.srv.set(s, 'cobblestone')
  w.srv.set(SLOTS[2].slots[40], 'dirt')
  const top = SLOTS[3].slots.filter(s => s[1] === SITE.record.s + Y.YARD_H)
  for (const s of top.slice(0, 5)) w.srv.set(s, 'spruce_leaves')
  return w
}

console.log('THE BAYS\' CLUTTER (the live showcase case: 76 slots locked by five leaves)')
await t('the live case: bay 3 is never given to a name (foreign leaves), the room is 0, the aisle-only upkeep finds nothing: no work', async () => {
  const { srv } = await liveYard()
  const st = Y.bayStates(SLOTS, srv.read)
  assert.strictEqual(st[3].foreign, 5); assert.strictEqual(st[3].name, null)
  assert.strictEqual(Y.yardRoomFor(st, 'cobblestone'), 0, 'no room: three bays full (one slot a dirt), bay 3 foreign')
  assert.deepStrictEqual(Y.yardClutter(SITE.record, srv.read), [], 'the aisles are clean: the old upkeep has nothing to do')
  assert.strictEqual(Y.yardWork({ held: { cobblestone: 563 }, slots: 34, states: st }).kind, null, 'the old plan: no work at all -- never offered')
})
await t('bayClutter lists the five leaves (highest first) and the dirt; never stock, never a torch or a chest', async () => {
  const { srv } = await liveYard()
  srv.set(SLOTS[3].slots[0], 'torch'); srv.set(SLOTS[3].slots[1], 'chest'); srv.set(SLOTS[3].slots[2], 'cobbled_deepslate')
  const cl = Y.bayClutter(SLOTS, srv.read)
  assert.deepStrictEqual(cl.map(c => c.name).sort(), ['dirt', 'spruce_leaves', 'spruce_leaves', 'spruce_leaves', 'spruce_leaves', 'spruce_leaves'])
  for (let i = 1; i < cl.length; i++) assert.ok(cl[i].at[1] <= cl[i - 1].at[1], 'highest first')
  assert.ok(cl.every(c => c.kind === 'tidy'), 'the yard visit\'s own dig kind (the tripwire: a pile slot dug as the yard\'s tidy)')
  assert.strictEqual(Y.bayClutter(SLOTS, () => null).length, 0, 'an unread slot is skipped')
})
await t('the plan: a bay blocked by clutter with the surplus short of room is an upkeep FIRST (urgent for a pressed bag)', async () => {
  const { srv } = await liveYard()
  const st = Y.bayStates(SLOTS, srv.read), bc = Y.bayClutter(SLOTS, srv.read)
  const w = Y.yardWork({ held: { cobblestone: 563 }, slots: 34, states: st, bayClutter: bc })
  assert.strictEqual(w.kind, 'upkeep'); assert.strictEqual(w.first, true); assert.strictEqual(w.urgent, true)
  assert.strictEqual(Y.yardWork({ held: { cobblestone: 100 }, slots: 20, states: st, bayClutter: bc }).urgent, false, 'no surplus: not urgent')
  // room for a whole stack: the stock goes first, the clutter waits
  const empty = Y.bayStates(SLOTS, () => ({ name: 'air' }))
  assert.strictEqual(Y.yardWork({ held: { cobblestone: 563 }, slots: 34, states: empty, bayClutter: bc }).kind, 'stock')
})
await t('THE RUNNER clears the clutter (6 digs) and bay 3 then takes a whole stack: 64 placed', async () => {
  const { srv, p } = await liveYard()
  const cl = Y.bayClutter(SLOTS, srv.read)
  const bare = { ...SITE.record, cells: [], segments: [], clear: [], replant: [] }
  const r = await R.runVisit({ ...p('A'), record: bare, palette: BP.palette, tidy: cl, clearMax: Y.YARD_CLEAR_MAX }, bot(srv, 'A', { inv: {} }), { maxSteps: 400 })
  assert.strictEqual(r.cleared, 6, JSON.stringify({ stop: r.stop, why: r.why }))
  const st = Y.bayStates(SLOTS, srv.read)
  assert.strictEqual(st[3].foreign, 0); assert.strictEqual(Y.yardRoomFor(st, 'cobblestone'), 77)
  const w = Y.yardWork({ held: { cobblestone: 563 }, slots: 34, states: st, bayClutter: Y.bayClutter(SLOTS, srv.read) })
  assert.strictEqual(w.kind, 'stock'); assert.strictEqual(w.place.cobblestone, Y.YARD_VISIT_MAX)
  const pc = Y.pileCells(st, w.place)
  const r2 = await R.runVisit({ ...p('A'), record: { ...bare, cells: pc.cells, segments: [{ seg: 'pile', layer: 0, deps: [] }] }, palette: { ...BP.palette, ...pc.palette } }, bot(srv, 'A', { inv: { cobblestone: 563 } }), { maxSteps: 3000 })
  assert.strictEqual(r2.placed, 64, JSON.stringify({ stop: r2.stop, why: r2.why }))
})
await t('MUTANT KILLED: a bayClutter that skips the top layer (the aisle rule\'s +1/+2 reach) leaves bay 3 locked', async () => {
  await withMutant(YARD_PATH, "      if (YARD_BULK.includes(n) || KEEP_IN_AISLE.test(n)) continue", "      if (YARD_BULK.includes(n) || KEEP_IN_AISLE.test(n) || s[1] > Math.min(...slots.map(q => q[1])) + 1) continue", async M => {
    const { srv } = await liveYard()
    assert.ok(!M.bayClutter(SLOTS, srv.read).some(c => c.name === 'spruce_leaves'))
  })
})

console.log('THE YARD BEFORE THE WELL (well.mjs cobbleWellStacks reserve; yard.mjs yardWellKeep / yardDeferOk)')
const bag = counts => counts.map((c, i) => ({ name: 'cobblestone', count: c, slot: 9 + i }))
const cobOf = plan => plan.stacks.filter(s => s.name === 'cobblestone').reduce((t, s) => t + s.count, 0)
await t('a full bag at the cap with the yard\'s room: the well leaves the yard\'s share (128 + 64) and throws the rest', () => {
  const items = bag([64, 64, 64, 64, 64, 64, 64, 64, 50])   // 562
  const keep = Y.yardWellKeep({ room: 76, deferOk: true })
  assert.strictEqual(keep, Y.YARD_BAG_KEEP_COBBLE + Y.YARD_VISIT_MAX)
  const before = cobOf(W.disposePlan(items, { cobbleAtCap: true }))
  const after = cobOf(W.disposePlan(items, { cobbleAtCap: true, cobbleReserve: keep }))
  assert.strictEqual(before, 562 - 64, 'as before: all but the 64')
  assert.ok(562 - after >= keep, `the bag keeps ${562 - after} >= ${keep}`)
  assert.ok(after > 0, 'the rest still goes: the yard takes one visit\'s worth, never the whole bag')
  // and what is kept is exactly a stock visit for the yard (bag surplus >= YARD_VISIT_MAX over the yard's keep)
  const left = 562 - after
  assert.ok(Y.bagSurplus({ cobblestone: left }).cobblestone >= Y.YARD_VISIT_MAX)
})
await t('no room (or a room too small), a resting yard, or an unanswered deferral: the well exactly as before', () => {
  assert.strictEqual(Y.yardWellKeep({ room: 0, deferOk: true }), 0)
  assert.strictEqual(Y.yardWellKeep({ room: Y.YARD_WELL_MIN - 1, deferOk: true }), 0)
  assert.strictEqual(Y.yardWellKeep({ on: false, room: 76, deferOk: true }), 0)
  assert.strictEqual(Y.yardWellKeep({ room: 76, deferOk: false }), 0)
  const items = bag([64, 64, 64, 64, 64, 64, 64, 64, 50])
  assert.deepStrictEqual(W.disposePlan(items, { cobbleAtCap: true, cobbleReserve: 0 }).stacks, W.disposePlan(items, { cobbleAtCap: true }).stacks, 'a reserve below 64 is the 64')
})
await t('THE DEFERRAL IS BOUNDED: kept once; unanswered for 30 min the next well visit throws; a stock visit since answers it', () => {
  const now = 10_000_000
  assert.strictEqual(Y.yardDeferOk({ now }), true, 'never deferred')
  assert.strictEqual(Y.yardDeferOk({ deferAt: now - 60_000, now }), false, 'deferred a minute ago, no stock since: the well throws')
  assert.strictEqual(Y.yardDeferred({ deferAt: now - 60_000, now }), true, '...and the yard stock is urgent for this bot')
  assert.strictEqual(Y.yardDeferOk({ deferAt: now - 60_000, stockAt: now - 1_000, now }), true, 'stocked since: may defer again')
  assert.strictEqual(Y.yardDeferOk({ deferAt: now - Y.YARD_DEFER_MS, now }), true, 'expired')
  const st = Y.bayStates(SLOTS, () => ({ name: 'air' }))
  assert.strictEqual(Y.yardWork({ held: { cobblestone: 150 }, slots: 20, states: st }).kind, null, 'a partial stack, not pressed: no trip')
  const w = Y.yardWork({ held: { cobblestone: 150 }, slots: 20, states: st, deferred: true })
  assert.strictEqual(w.kind, 'stock'); assert.strictEqual(w.urgent, true, 'what the well left goes first (the picker\'s repair tier)')
})
await t('MUTANT KILLED: a cobbleWellStacks that ignores the reserve throws the yard\'s share', async () => {
  await withMutant(new URL('../src/well.mjs', import.meta.url), '    if (left - it.count < keep) break', '    if (left - it.count < COBBLE_WELL_RESERVE) break', async M => {
    const items = bag([64, 64, 64, 64, 64, 64, 64, 64, 50])
    assert.strictEqual(cobOf(M.disposePlan(items, { cobbleAtCap: true, cobbleReserve: 192 })), 562 - 64)
  })
})

console.log('THE CONSUMERS DRAW FROM THE YARD (yard.mjs yardDrawPlan)')
await t('a bill the bag cannot cover draws the yard\'s cobblestone first, bounded by the yard, the bag, the visit and a pickaxe', () => {
  const base = { need: 90, held: { cobblestone: 227 }, freeSlots: 6, pick: true, left: 150_000 }
  assert.strictEqual(Y.yardDrawPlan(base), Y.YARD_VISIT_MAX)
  assert.strictEqual(Y.yardDrawPlan({ ...base, need: 30 }), 30)
  assert.strictEqual(Y.yardDrawPlan({ ...base, held: { cobblestone: 20 } }), 20)
  assert.strictEqual(Y.yardDrawPlan({ ...base, freeSlots: 0 }), 0, 'no room in the bag')
  assert.strictEqual(Y.yardDrawPlan({ ...base, pick: false }), 0, 'a cobblestone dug by hand drops nothing')
  assert.strictEqual(Y.yardDrawPlan({ ...base, left: 60_000 }), 0, 'not enough of the visit left for the walk')
  assert.strictEqual(Y.yardDrawPlan({ ...base, need: Y.YARD_DRAW_MIN - 1 }), 0, 'a handful: the chests')
  assert.strictEqual(Y.yardDrawPlan({ ...base, on: false }), 0, 'YARD_DRAW=off')
  assert.strictEqual(Y.yardDrawPlan({ ...base, held: {} }), 0, 'an empty yard')
})
await t('A DRAW digs the pile tops back with the real runner (the refill\'s path): 40 dug, highest first', async () => {
  const { srv, p } = await liveYard()
  const st = Y.bayStates(SLOTS, srv.read)
  const n = Y.yardDrawPlan({ need: 40, held: Y.yardHeld(st), freeSlots: 10, pick: true, left: 150_000 })
  const digs = Y.refillDigs(st, { cobblestone: n })
  assert.strictEqual(digs.length, 40)
  const r = await R.runVisit({ ...p('A'), record: { ...SITE.record, cells: [], segments: [], clear: [], replant: [] }, palette: BP.palette, tidy: digs, clearMax: 64 }, bot(srv, 'A', { inv: {} }), { maxSteps: 400 })
  assert.strictEqual(r.cleared, 40, JSON.stringify({ stop: r.stop, why: r.why }))
  assert.strictEqual(Y.yardHeld(Y.bayStates(SLOTS, srv.read)).cobblestone, 227 - 40)
})
await t('the switches: YARD_BEFORE_WELL / YARD_DRAW on unless set off', () => {
  assert.strictEqual(Y.yardFlag({}, 'YARD_DRAW'), true); assert.strictEqual(Y.yardFlag({ YARD_DRAW: 'off' }, 'YARD_DRAW'), false)
  assert.strictEqual(Y.yardFlag({ YARD_BEFORE_WELL: '0' }, 'YARD_BEFORE_WELL'), false)
  assert.ok(/before_well=1 draw=1$/.test(Y.yardModeDetail(true)))
})

console.log('THE ORDER READS IT (skills.mjs shopDamaged over the live case)')
const SKM = await import('../src/skills.mjs')
const yardBot = (srv, stacks) => {
  const items = stacks.map((c, i) => ({ name: 'cobblestone', count: c, slot: 9 + i }))
  return { username: 'A', blockAt: v => { const b = srv.read(v.x, v.y, v.z); return b ? { name: b.name, boundingBox: b.boundingBox } : null }, inventory: { items: () => items } }
}
const done = { ...SITE.record, structure_complete: true }
await t('the live case with a full bag: the yard reads NOT complete (its bay upkeep is offered); clean and full: complete', async () => {
  const { srv } = await liveYard()
  assert.strictEqual(SKM.shopDamaged(yardBot(srv, [64, 64, 64, 64, 64, 64, 64, 64, 51]), done), true)
  for (const s of SLOTS[3].slots) srv.set(s, 'cobblestone'); srv.set(SLOTS[2].slots[40], 'cobblestone')
  assert.strictEqual(SKM.shopDamaged(yardBot(srv, [64, 64, 64, 64, 64, 64, 64, 64, 51]), done), false, 'a full clean yard: nothing to do (the well)')
})
await t('MUTANT KILLED: without bayClutter in yardWorkNow the live case reads complete (the 26 h the yard stood unused)', async () => {
  await withMutant(new URL('../src/skills.mjs', import.meta.url), 'bayClutter: yardClearHeld(bot, now) ? [] : bayClutter(bays, read), deferred', 'bayClutter: [], deferred', async M => {
    const { srv } = await liveYard()
    assert.strictEqual(M.shopDamaged(yardBot(srv, [64, 64, 64, 64, 64, 64, 64, 64, 51]), done), false)
    assert.strictEqual(SKM.shopDamaged(yardBot(srv, [64, 64, 64, 64, 64, 64, 64, 64, 51]), done), true)
  })
})
await t('a deferral the well made makes this bot\'s partial surplus urgent work (the order offers the yard)', async () => {
  const { srv } = await built()
  // a fresh bot each reading (shopDamaged caches its answer on the bot for 60 s)
  const b = (o = {}) => Object.assign(yardBot(srv, [64, 64, 20]), o)
  assert.strictEqual(SKM.shopDamaged(b(), done), false, 'a partial stack: no trip')
  assert.strictEqual(SKM.shopDamaged(b({ yardDeferAt: Date.now() - 1_000 }), done), true)
  assert.strictEqual(SKM.shopDamaged(b({ yardDeferAt: Date.now() - 1_000, yardStockAt: Date.now() }), done), false, 'answered')
})

console.log('THE WIRING (skills.mjs, structural)')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const WIRES = [
  /const stacks = cobbleWellStacks\(items, \{ reserve: wellCobbleReserveNow\(bot\) \}\)\n\s*if \(!stacks\.length\) return 'none'/,
  /const plan = disposePlan\(bagNow, \{ maxStacks, swords: out\.swordsAllowed, cobbleAtCap: out\.cap === 'at_cap', stock: out\.stock, keep: listedOnly \? keep : null, cobbleReserve \}\)/,
  /if \(out\.cap === 'at_cap' && !yardDeferredNow\(bot\) && wellKeptForYard\(bagNow, cobbleReserve\)\) \{ bot\.yardDeferAt = Date\.now\(\); out\.yardKept = cobbleReserve \}/,
  /cobbleAtCap: cobbleWellCap\(bot\) === 'at_cap', stock: pruneStockOpts\(bot, pruned\), cobbleReserve: wellCobbleReserveNow\(bot\) \}\)/,
  /if \(\(need\.cobblestone \?\? 0\) > 0 && workableSeg\(rec, read, palette, segFree\)\) \{\n\s*const got = await yardDrawFor\(ctx, need\.cobblestone, signal, t0 \+ budget - ZIG_VISIT_TAIL_MS\)/,
  /if \(\(need\.cobblestone \?\? 0\) > 0 && workableSeg\(visitRec, read, palette, tidySegOk, waivedK, \{ skipOpenDeps: GROUNDS\.on \}\)\) \{\n\s*const got = await yardDrawFor\(ctx, need\.cobblestone, signal, t0 \+ budget - ZIG_VISIT_TAIL_MS\)/,
  /if \(nPlaced > 0\) bot\.yardStockAt = Date\.now\(\)/,
  /\(p\.plot === YARD_PLOT && !!yw\?\.first\)/,
]
await t('the well reads the yard\'s reserve where it plans and where it throws; the deferral is stamped; a stock answers it; sinks and the tidy draw from the yard; a blocked bay goes first', () => {
  for (const re of WIRES) { assert.ok(re.test(SK), String(re).slice(0, 70)); assert.strictEqual(SK.split(SK.match(re)[0]).length, 2, `unique: ${String(re).slice(0, 50)}`) }
  // the draw is before the chests' withdraw in each consumer
  for (const fn of ['async function buildSink (', 'async function buildTidy (']) {
    const i = SK.indexOf(fn), j = SK.indexOf('async function', i + 10)
    const body = SK.slice(i, j)
    assert.ok(body.indexOf('await yardDrawFor(') > 0 && body.indexOf('await yardDrawFor(') < body.indexOf('await matsWithdraw(ctx, need,'), fn)
  }
  // every at-cap disposal plan reads the yard's reserve (no caller left on the bare 64)
  const plans = SK.match(/disposePlan\([^\n]*cobbleAtCap[^\n]*/g)
  assert.ok(plans.length >= 5 && plans.every(l => /cobbleReserve/.test(l)), plans.filter(l => !/cobbleReserve/.test(l)).join('\n'))
})
await t('MUTANTS KILLED: each wiring check fails on its line one character off', () => {
  for (const re of WIRES) { const m = SK.match(re)[0]; assert.ok(!re.test(SK.replace(m, m.replace(/[A-Za-z]/, '#')))) }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

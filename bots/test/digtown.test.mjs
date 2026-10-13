// The `_dig_town` instrument (digtown.mjs) and the town box (townground.mjs). TELEMETRY ONLY: these tests check what
// the rows SAY, that the wrapper is invisible to every caller of bot.dig, and that it is wired where the bot runs.
//
// The fake bot mirrors mineflayer 4.37.1 where it matters: dig(block, forceLook, digFace) is an async function whose
// promise resolves when the bot's own timer finishes (it writes air locally -- that never reaches _client) or rejects
// with "Digging aborted"; the server's word arrives as raw `block_change` / `multi_block_change` packets on _client.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const T = await import('../src/townground.mjs')
const D = await import('../src/digtown.mjs')
const { townDigClass, inTownBox, TOWN_GROUND_HALF, TOWN_GROUND_DEPTH } = T
const { digPurpose, digOutcome, multiBlockCells, attachDigTown, CONFIRM_GRACE_MS } = D

const HOME = { x: 355, y: 73, z: 147 }
const SRC = new URL('../src/digtown.mjs', import.meta.url)
const INDEX = new URL('../src/index.mjs', import.meta.url)
const TUNNEL = new URL('../src/oretunnel.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---- the box and the class -------------------------------------------------------------------------------------------
test('CLASS: terrain inside the square half-width 16, from home.y - 12 up, is ground; edges, vegetation, furniture are not', () => {
  const at = (dx, dy, dz) => ({ x: HOME.x + dx, y: HOME.y + dy, z: HOME.z + dz })
  assert.equal(townDigClass(at(0, -2, 0), 'stone_bricks', HOME), 'ground', 'the town platform')
  assert.equal(townDigClass(at(16, 0, -16), 'dirt', HOME), 'ground', 'a corner of the square (a circle of 16 would miss it)')
  assert.equal(townDigClass(at(17, 0, 0), 'dirt', HOME), 'free')
  assert.equal(townDigClass(at(0, 0, -17), 'dirt', HOME), 'free')
  assert.equal(townDigClass(at(3, -TOWN_GROUND_DEPTH, 3), 'stone', HOME), 'ground', 'the deepest protected layer')
  assert.equal(townDigClass(at(3, -TOWN_GROUND_DEPTH - 1, 3), 'stone', HOME), 'free', 'below the band: mine may dig (the full-depth 12 rules stay)')
  assert.equal(townDigClass(at(3, 40, 3), 'cobblestone', HOME), 'ground', 'a pillar above town is town ground')
  for (const n of ['iron_ore', 'deepslate_iron_ore', 'grass_block', 'sand', 'gravel', 'cobbled_deepslate', 'tuff', 'granite'])
    assert.equal(townDigClass(at(5, 0, 5), n, HOME), 'ground', n)
  for (const n of ['oak_log', 'oak_leaves', 'oak_sapling', 'short_grass', 'chest', 'crafting_table', 'furnace', 'red_bed', 'torch', 'oak_trapdoor', 'composter', 'lectern', 'oak_planks', 'water'])
    assert.equal(townDigClass(at(5, 0, 5), n, HOME), 'free', n)
  assert.equal(townDigClass(at(0, 0, 0), 'dirt', null), 'free', 'unknown home: the zone is OFF (fails open, by name)')
  assert.equal(townDigClass(at(0, 0, 0), 'dirt', { x: NaN, y: 1, z: 1 }), 'free')
  assert.equal(inTownBox(at(TOWN_GROUND_HALF + 4, 0, 0), HOME, { margin: 4 }), true)
  assert.equal(inTownBox(at(TOWN_GROUND_HALF + 5, 0, 0), HOME, { margin: 4 }), false)
  assert.equal(townDigClass({ x: HOME.x + 16.9, y: HOME.y, z: HOME.z }, 'dirt', HOME), 'ground', 'cells are floored')
})

// ---- purpose ----------------------------------------------------------------------------------------------------------
test('PURPOSE: scope > pathfinder (its profile tag, else transit) > a reflex holding the body > the skill', () => {
  assert.deepEqual(digPurpose({ scope: { purpose: 'transit', by: 'goto' }, skill: 'mine', args: { y: 12 } }), { purpose: 'transit', by: 'goto' }, 'goto inside mine: its own digs are transit (Codex code r1 P2)')
  assert.deepEqual(digPurpose({ scope: { purpose: 'transit', by: 'goto' }, skill: 'mine', reflex: 'escape' }), { purpose: 'survival', by: 'reflex:escape' }, 'a reflex digging during goto is survival, not transit')
  assert.deepEqual(digPurpose({ scope: { purpose: 'transit', by: 'goto' }, pathfinderMining: true, movementsPurpose: 'target:ore_tunnel' }), { purpose: 'target', by: 'ore_tunnel' }, 'the tunnel tag beats an outer scope')
  assert.deepEqual(digPurpose({ pathfinderMining: true, movementsPurpose: 'target:ore_tunnel', skill: 'gather', args: { block: 'iron_ore' } }), { purpose: 'target', by: 'ore_tunnel' },
    'the tunnel excavation is a target dig although the pathfinder makes it (Codex r3 P1)')
  assert.deepEqual(digPurpose({ pathfinderMining: true, skill: 'gather', args: { block: 'dirt' } }), { purpose: 'transit', by: 'gather:dirt' }, 'gather\'s dig-approach walk')
  assert.deepEqual(digPurpose({ pathfinderMining: true, skill: 'goto' }), { purpose: 'transit', by: 'goto' })
  assert.deepEqual(digPurpose({ skill: 'gather', args: { block: 'dirt' }, reflex: 'escape' }), { purpose: 'survival', by: 'reflex:escape' }, 'a reflex flag beats the running skill')
  assert.deepEqual(digPurpose({ skill: 'gather', holder: 'entombed' }), { purpose: 'survival', by: 'holder:entombed' })
  assert.deepEqual(digPurpose({ skill: 'gather', args: { block: 'dirt' }, holder: 'gather' }), { purpose: 'target', by: 'gather:dirt' })
  assert.deepEqual(digPurpose({ skill: 'mine', args: { y: 12 } }), { purpose: 'target', by: 'mine:y12' })
  assert.deepEqual(digPurpose({ skill: 'wear_out' }), { purpose: 'other', by: 'wear_out' })
  assert.deepEqual(digPurpose({}), { purpose: 'other', by: 'idle' })
})

// ---- outcome ----------------------------------------------------------------------------------------------------------
test('OUTCOME: the server\'s word decides; a resolved promise alone is not proof', () => {
  const g = CONFIRM_GRACE_MS
  assert.equal(digOutcome({ settledAt: null }), 'pending')
  assert.equal(digOutcome({ settledAt: 0, after: { t: 900, same: false }, now: 900 }), 'confirmed')
  assert.equal(digOutcome({ settledAt: 0, after: { t: 9_800, same: false }, now: 9_800 }), 'confirmed', 'a slow break inside 10 s (digsync2-01)')
  assert.equal(digOutcome({ settledAt: 0, after: { t: g + 1, same: false }, now: g + 1 }), 'unconfirmed')
  assert.equal(digOutcome({ settledAt: 0, before: true, after: { t: 10, same: false }, now: 10 }), 'foreign', 'the server broke it before our finish: someone else')
  assert.equal(digOutcome({ settledAt: 0, after: { t: 500, same: true }, now: 500 }), 'rejected')
  assert.equal(digOutcome({ settledAt: 0, now: g - 1 }), 'pending')
  assert.equal(digOutcome({ settledAt: 0, now: g }), 'unconfirmed', 'Paper sends nothing for a refused dig')
  assert.equal(digOutcome({ settledAt: 0, error: new Error('Digging aborted') }), 'aborted')
  assert.equal(digOutcome({ settledAt: 0, error: new Error('Digging aborted'), died: true }), 'death')
  assert.equal(digOutcome({ settledAt: 0, error: new Error('dig exceeded 60000ms') }), 'error')
  assert.equal(digOutcome({ settledAt: null, t0: 0, now: 119_999 }), 'pending')
  assert.equal(digOutcome({ settledAt: null, t0: 0, now: 120_000 }), 'hung', 'a dig that never settles is released, not held for ever')
})

test('MULTI BLOCK: cells decoded exactly as mineflayer 4.37.1 decodes 1.21 single-long records (positive control)', () => {
  const rec = (state, x, y, z) => state * 4096 + (x << 8) + (z << 4) + y
  const cells = multiBlockCells({ chunkCoordinates: { x: 22, y: 4, z: -10 }, records: [rec(0, 3, 9, 15), rec(1, 0, 0, 0), BigInt(rec(27000, 15, 15, 15))] })
  assert.deepEqual(cells[0], { x: 22 * 16 + 3, y: 4 * 16 + 9, z: -10 * 16 + 15, state: 0 })
  assert.deepEqual(cells[1], { x: 352, y: 64, z: -160, state: 1 })
  assert.deepEqual(cells[2], { x: 367, y: 79, z: -145, state: 27000 })
  // mineflayer's own decode of the same record (blocks.js:369-389), as a cross-check
  const r = rec(5, 7, 2, 11)
  assert.deepEqual(multiBlockCells({ chunkCoordinates: { x: 1, y: 2, z: 3 }, records: [r] })[0], { x: 16 + ((r >> 8) & 15), y: 32 + (r & 15), z: 48 + ((r >> 4) & 15), state: r >> 12 })
  assert.deepEqual(multiBlockCells({}), [])
})

// ---- the wrapper ------------------------------------------------------------------------------------------------------
function fakeBot ({ home = HOME } = {}) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.calls = []
  bot.ctl = []
  // mineflayer's dig: async, resolves on the bot's own timer or rejects on stopDigging
  bot.dig = async function (block, forceLook, digFace) {
    bot.calls.push([block, forceLook, digFace])
    block.name = 'air'                         // mineflayer writes air into its own world model; capture must precede it
    return new Promise((resolve, reject) => bot.ctl.push({ resolve, reject }))
  }
  bot.pathfinder = { isMining: () => false, movements: {} }
  bot.home = home
  return bot
}
const blk = (x, y, z, name = 'dirt', stateId = 10) => ({ name, stateId, position: { x, y, z } })
const tick = () => new Promise(r => setImmediate(r))
function attach (bot, ctx = {}, opts = {}) {
  const rows = [], sums = []
  let t = 1_000
  const clock = { now: () => t, set: v => { t = v } }
  const h = attachDigTown(bot, { home: bot.home, context: () => ctx, emitDig: r => rows.push(r), emitSummary: r => sums.push(r), timers: false, now: clock.now, ...opts })
  return { h, rows, sums, clock }
}

test('SCOPE: the scope follows the async chain -- nested, thrown, and two OVERLAPPING gotos (one abandoned) never see each other (Claude code r1 P1)', async () => {
  const bot = {}
  await D.withDigScope(bot, { purpose: 'transit', by: 'goto' }, async () => {
    assert.equal(D.currentDigScope().by, 'goto')
    await D.withDigScope(bot, { purpose: 'x', by: 'inner' }, async () => { await tick(); assert.equal(D.currentDigScope().by, 'inner') })
    assert.equal(D.currentDigScope().by, 'goto')
  })
  assert.equal(D.currentDigScope(), null)
  await assert.rejects(D.withDigScope(bot, { purpose: 'p' }, async () => { throw new Error('x') }))
  assert.equal(D.currentDigScope(), null)
  // G1 is abandoned (never resolves); G2 starts; a skill dig outside both reads no scope; G2's dig reads G2's
  let releaseG1
  const g1 = D.withDigScope(bot, { purpose: 'transit', by: 'g1' }, () => new Promise(r => { releaseG1 = r }))
  const seen = []
  await D.withDigScope(bot, { purpose: 'transit', by: 'g2' }, async () => { await tick(); seen.push(D.currentDigScope()?.by) })
  seen.push(D.currentDigScope()?.by ?? null)
  releaseG1(); await g1
  seen.push(D.currentDigScope()?.by ?? null)
  assert.deepEqual(seen, ['g2', null, null])
  // a reflex tick wrapped with digScoped is survival all the way down its awaits
  const tickFn = D.digScoped({ purpose: 'survival', by: 'reflex' }, async () => { await tick(); return D.currentDigScope() })
  assert.equal((await tickFn()).purpose, 'survival')
  assert.equal(D.currentDigScope(), null)
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(src, /async function goto \(ctx, args, signal\) \{ return withDigScope\(ctx\?\.bot, \{ purpose: 'transit', by: 'goto' \}, \(\) => gotoLegs\(ctx, args, signal\)\) \}/, 'goto wraps its legs in the transit scope')
})

test('WRAPPER: invisible -- same arguments, the original promise object, rejections unchanged', async () => {
  const bot = fakeBot()
  const sentinel = Promise.resolve('x')
  const orig = async () => 'never'
  bot.dig = function (...a) { bot.calls.push(a); return sentinel }
  attach(bot)
  const b = blk(355, 70, 147)
  const face = { x: 0, y: 1, z: 0 }
  assert.equal(bot.dig(b, true, face), sentinel, 'the caller gets the ORIGINAL promise (identity)')
  assert.deepEqual(bot.calls[0], [b, true, face], 'every argument passed through')
  assert.equal(typeof orig, 'function')
  const bot2 = fakeBot(); attach(bot2)
  const e = Object.assign(new Error('Digging aborted'), { aborted: true })
  const p = bot2.dig(blk(1, 1, 1)); bot2.ctl[0].reject(e)
  await assert.rejects(p, err => err === e && err.aborted === true, 'the same error object, its fields intact')
  // a second install is a no-op (one wrapper per bot)
  assert.equal(attachDigTown(bot2, { home: HOME, emitDig () {}, emitSummary () {} }), null)
})

test('WRAPPER: the block is captured SYNCHRONOUSLY before the original dig runs (the fake mutates the block; a later capture would read it)', async () => {
  const bot = fakeBot(); const { rows, clock } = attach(bot, { skill: 'gather', args: { block: 'dirt' } })
  const p = bot.dig(blk(360, 72, 150, 'dirt', 10))
  bot.ctl[0].resolve(); await p; await tick()
  clock.set(1_500); bot._client.emit('block_change', { location: { x: 360, y: 72, z: 150 }, type: 0 })
  assert.equal(rows.length, 1)
  assert.match(rows[0].detail, /^pos=360,72,150 block=dirt class=ground purpose=target by=gather:dirt outcome=confirmed dt=\d+/)
  assert.equal(rows[0].args.outcome, 'confirmed')
})

test('WRAPPER: foreign, rejected, unconfirmed, aborted, death -- and free digs are counted, not rowed', async () => {
  const bot = fakeBot(); const { h, rows, sums, clock } = attach(bot, { skill: 'gather', args: { block: 'dirt' } })
  // foreign: the server says air BEFORE our finish
  const p1 = bot.dig(blk(356, 70, 147)); bot._client.emit('block_change', { location: { x: 356, y: 70, z: 147 }, type: 0 })
  bot.ctl[0].resolve(); await p1; await tick()
  // rejected: the server re-sends the same state after our finish
  const p2 = bot.dig(blk(357, 70, 147, 'dirt', 10)); bot.ctl[1].resolve(); await p2; await tick()
  bot._client.emit('block_change', { location: { x: 357, y: 70, z: 147 }, type: 10 })
  // unconfirmed: silence past the grace
  const p3 = bot.dig(blk(358, 70, 147)); bot.ctl[2].resolve(); await p3; await tick()
  // aborted
  const p4 = bot.dig(blk(359, 70, 147)); bot.ctl[3].reject(new Error('Digging aborted')); await p4.catch(() => {}); await tick()
  // death
  const p5 = bot.dig(blk(360, 70, 147)); bot.emit('death'); bot.ctl[4].reject(new Error('Digging aborted')); await p5.catch(() => {}); await tick()
  // free: far outside the box -- counted in the summary only
  const p6 = bot.dig(blk(0, 70, 0)); bot.ctl[5].resolve(); await p6; await tick()
  bot._client.emit('block_change', { location: { x: 0, y: 70, z: 0 }, type: 0 })
  clock.set(1_000 + CONFIRM_GRACE_MS + 10)
  h.flush()
  const by = Object.fromEntries(rows.map(r => [r.args.x, r.args.outcome]))
  assert.deepEqual(by, { 356: 'foreign', 357: 'rejected', 358: 'unconfirmed', 359: 'aborted', 360: 'death' })
  assert.equal(rows.length, 5, 'the free dig far away has no row')
  assert.equal(sums.length, 1)
  assert.equal(sums[0].args.all, 6, 'every dig is counted, the free one included')
  assert.equal(sums[0].args.o_confirmed, 1)
  assert.equal(sums[0].args.z_zone_ground_target_foreign, 1)
  assert.match(sums[0].detail, /^w=\d+s all=6 conf=1 unconf=1 foreign=1 rej=1 abort=1 death=1 err=0 hung=0 pend=0 ovf=0 ierr=0 \| /)
})

test('WRAPPER: the server word arrives in a multi_block_change too', async () => {
  const bot = fakeBot(); const { rows } = attach(bot, { skill: 'mine', args: { y: 20 } })
  const p = bot.dig(blk(354, 66, 146)); bot.ctl[0].resolve(); await p; await tick()
  const rec = (0 * 4096) + ((354 & 15) << 8) + ((146 & 15) << 4) + (66 & 15)
  bot._client.emit('multi_block_change', { chunkCoordinates: { x: 354 >> 4, y: 66 >> 4, z: 146 >> 4 }, records: [rec] })
  assert.equal(rows[0].args.outcome, 'confirmed'); assert.equal(rows[0].args.purpose, 'target'); assert.equal(rows[0].args.by, 'mine:y20')
})

test('WRAPPER: TWO BOTS ON ONE CELL -- both may read confirmed (attempt attribution; the read dedupes)', async () => {
  const a = fakeBot(), b = fakeBot()
  const A = attach(a, { skill: 'gather', args: { block: 'dirt' } }), B = attach(b, { skill: 'gather', args: { block: 'dirt' } })
  const pa = a.dig(blk(350, 71, 140)), pb = b.dig(blk(350, 71, 140))
  a.ctl[0].resolve(); b.ctl[0].resolve(); await pa; await pb; await tick()
  for (const bot of [a, b]) bot._client.emit('block_change', { location: { x: 350, y: 71, z: 140 }, type: 0 })
  assert.equal(A.rows[0].args.outcome, 'confirmed'); assert.equal(B.rows[0].args.outcome, 'confirmed')
  // the other order: b's word arrives before b finishes -> b reads foreign
  const c = fakeBot(), d = fakeBot()
  const C = attach(c, { skill: 'gather' }), Dd = attach(d, { skill: 'gather' })
  const pc = c.dig(blk(351, 71, 140)), pd = d.dig(blk(351, 71, 140))
  c.ctl[0].resolve(); await pc; await tick()
  for (const bot of [c, d]) bot._client.emit('block_change', { location: { x: 351, y: 71, z: 140 }, type: 0 })
  d.ctl[0].resolve(); await pd; await tick()
  assert.equal(C.rows[0].args.outcome, 'confirmed'); assert.equal(Dd.rows[0].args.outcome, 'foreign', 'the server said air before d finished: someone else broke it')
})

test('WRAPPER: the ore tunnel\'s pathfinder dig is target:ore_tunnel; a plain pathfinder dig is transit', async () => {
  const bot = fakeBot(); const { rows } = attach(bot, { skill: 'gather', args: { block: 'iron_ore' } })
  bot.pathfinder = { isMining: () => true, movements: { digPurpose: 'target:ore_tunnel' } }
  const p = bot.dig(blk(352, 65, 150, 'stone')); bot.ctl[0].resolve(); await p; await tick()
  bot._client.emit('block_change', { location: { x: 352, y: 65, z: 150 }, type: 0 })
  bot.pathfinder = { isMining: () => true, movements: {} }
  const q = bot.dig(blk(353, 65, 150, 'stone')); bot.ctl[1].resolve(); await q; await tick()
  bot._client.emit('block_change', { location: { x: 353, y: 65, z: 150 }, type: 0 })
  assert.deepEqual(rows.map(r => [r.args.purpose, r.args.by]), [['target', 'ore_tunnel'], ['transit', 'gather:iron_ore']])
})

test('WRAPPER: a throwing context or a broken pathfinder never stops the dig; after final nothing is written', async () => {
  const bot = fakeBot()
  const rows = [], sums = []
  const h = attachDigTown(bot, { home: HOME, context: () => { throw new Error('boom') }, emitDig: r => rows.push(r), emitSummary: r => sums.push(r), timers: false })
  bot.pathfinder = { get isMining () { throw new Error('nope') } }
  const p = bot.dig(blk(355, 70, 147)); assert.equal(bot.calls.length, 1, 'the dig ran')
  bot.ctl[0].resolve(); await p; await tick()
  h.final()
  assert.equal(sums.length, 1); assert.ok(sums[0].args.ierr >= 1, 'the instrument counts its own errors'); assert.equal(sums[0].args.o_pending, 1, 'a dig still waiting at shutdown is pending')
  const q = bot.dig(blk(355, 71, 147)); assert.equal(bot.calls.length, 2); bot.ctl[1].resolve(); await q; await tick()
  bot._client.emit('block_change', { location: { x: 355, y: 71, z: 147 }, type: 0 })
  h.flush()
  assert.equal(rows.length, 1, 'after final: no new row') ; assert.equal(sums.length, 1, 'and no new summary')
})

// ---- mutants ----------------------------------------------------------------------------------------------------------
test('MUTANT KILLED: a wrapper that returns a NEW promise breaks caller identity', async () => {
  await withMutant(SRC, '    return promise\n  }\n  wrapped.__digtown = true', '    return promise.then(x => x)\n  }\n  wrapped.__digtown = true', async mod => {
    const bot = fakeBot(); const sentinel = Promise.resolve(1); bot.dig = () => sentinel
    mod.attachDigTown(bot, { home: HOME, emitDig () {}, emitSummary () {}, timers: false })
    assert.notEqual(bot.dig(blk(1, 1, 1)), sentinel, 'the mutant is caught by the identity assertion above')
  })
})

test('MUTANT KILLED: capturing AFTER the original call reads the mutated block (and loses the town-ground row)', async () => {
  const src = readFileSync(SRC, 'utf8')
  const A1 = '      rec = closed ? null : capture(block)\n', A2 = '    const promise = orig.call(this, block, ...rest)\n'
  for (const a of [A1, A2]) { assert.ok(src.includes(a), 'anchor present'); assert.equal(src.split(a).length, 2, 'anchor unique') }
  const body = src.replace(A1, '      rec = null\n').replace(A2, A2 + '    try { rec = closed ? null : capture(block); if (rec) { sum.all++; const list = pending.get(rec.k) ?? []; list.push(rec); pending.set(rec.k, list); npending++ } } catch { rec = null }\n').replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-late.mjs`, import.meta.url)
  writeFileSync(out, body)
  try {
    const mod = await import(out.href)
    const bot = fakeBot(); const rows = []
    mod.attachDigTown(bot, { home: HOME, context: () => ({ skill: 'gather' }), emitDig: r => rows.push(r), emitSummary () {}, timers: false })
    const p = bot.dig(blk(360, 72, 150)); bot.ctl[0].resolve(); await p; await tick()
    bot._client.emit('block_change', { location: { x: 360, y: 72, z: 150 }, type: 0 })
    assert.equal(rows.length, 0, 'the late capture saw air (class free): no row -- the synchronous-capture test above kills this mutant')
  } finally { try { unlinkSync(out) } catch {} }
})

test('MUTANT KILLED: without the profile tag the tunnel\'s excavation reads as transit', async () => {
  await withMutant(SRC, "    if (typeof movementsPurpose === 'string' && movementsPurpose.includes(':')) {", '    if (false) {', async mod => {
    assert.deepEqual(mod.digPurpose({ pathfinderMining: true, movementsPurpose: 'target:ore_tunnel', skill: 'gather' }), { purpose: 'transit', by: 'gather' })
  })
})

test('MUTANT KILLED: a word before our finish counted as confirmation would credit another bot\'s break', async () => {
  await withMutant(SRC, "  if (before) return 'foreign'\n", '', async mod => {
    assert.equal(mod.digOutcome({ settledAt: 0, before: true, after: { t: 10, same: false }, now: 10 }), 'confirmed')
  })
})

// ---- wiring (structural: the instrument must be attached where the bot runs) -----------------------------------------
test('WIRED: index.mjs attaches the instrument with home from config, the runner context, and finalises it on a stop', () => {
  const src = strip(readFileSync(INDEX, 'utf8'))
  assert.match(src, /import \{ attachDigTown \} from '\.\/digtown\.mjs'/)
  assert.match(src, /attachDigTown\(bot, \{\s*home: configuredHome\(config\.world\),/)
  const rf = strip(readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
  assert.match(rf, /const timer = setInterval\(digScoped\(\{ purpose: 'survival', by: 'reflex' \}, async \(\) => \{/, 'the reflex tick runs in the survival scope')
  assert.match(src, /kind: 'dig_town', status: 'success'/)
  assert.match(src, /kind: 'dig_town_sum', status: 'success'/)
  assert.match(src, /try \{ digTownFinal\?\.\(\) \} catch \{\}\s*closeLogs\(\)/, 'the final summary is written BEFORE the logs close')
  const t = strip(readFileSync(TUNNEL, 'utf8'))
  assert.match(t, /m\.digPurpose = 'target:ore_tunnel'\s*return m/, 'the tunnel profile carries its tag')
})

test('MUTANT KILLED: the wiring assertion fails when the final call is gone', async () => {
  const src = readFileSync(INDEX, 'utf8')
  const old = '    try { digTownFinal?.() } catch {}\n'
  assert.ok(src.includes(old) && src.split(old).length === 2, 'anchor present and unique')
  const mutated = strip(src.replace(old, ''))
  assert.doesNotMatch(mutated, /try \{ digTownFinal\?\.\(\) \} catch \{\}\s*closeLogs\(\)/)
})

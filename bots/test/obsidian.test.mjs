// OBSIDIAN-01: THE DEEP MINER'S CAST (bots/src/deepmine.mjs obsidian section; bots/src/bucket.mjs fillWater / scoopLava /
// pourInto; bots/src/skills.mjs deepObs*). Behaviour over a synthetic deep layer: a lava lake at y -55 under cave air, the
// miner's tunnel at feet -53, a basin dug behind the shore. The refusal chain (no diamond pickaxe / no bucket / no water / no
// lava site / the wrong level) always ends in an ordinary diamond trip, never a wait; a failed pour never leaves lava loose.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
const { Vec3 } = createRequire(import.meta.url)('vec3')
const M = await import('../src/deepmine.mjs')
const B = await import('../src/bucket.mjs')
const K = await import('../src/bankable.mjs')

// ---- the synthetic world -------------------------------------------------------------------------------------------------
const ROCK = { name: 'deepslate', boundingBox: 'block', full: true }
const AIR = { name: 'air', boundingBox: 'empty', full: false }
const CAVE = { name: 'cave_air', boundingBox: 'empty', full: false }
const LAVA = (level = 0) => ({ name: 'lava', boundingBox: 'empty', full: false, level })
const WATER = (level = 0) => ({ name: 'water', boundingBox: 'empty', full: false, level })
const OBS = { name: 'obsidian', boundingBox: 'block', full: true }
/** The lake: lava sources x 10..14, z -2..2 at y -55, cave air over it (y -54..-52); a tunnel from (0,-53,0) to (5,-53,0). */
function world (edit = {}) {
  const m = new Map()
  const set = (c, b) => m.set(c.join(','), b)
  for (let x = 10; x <= 14; x++) for (let z = -2; z <= 2; z++) { set([x, -55, z], LAVA(0)); for (let y = -54; y <= -52; y++) set([x, y, z], CAVE) }
  for (let x = 0; x <= 5; x++) { set([x, -53, 0], AIR); set([x, -52, 0], AIR) }
  for (const [k, v] of Object.entries(edit)) m.set(k, v)
  const read = (x, y, z) => (m.has(`${x},${y},${z}`) ? m.get(`${x},${y},${z}`) : (y < -64 ? null : ROCK))
  return { read, set, m }
}
const LQ = [10, -55, 0]
const site = M.siteCells(LQ, 0)   // S -> lake along +x

test('siteCells: S two over the lake surface and one back; the basin under P2 (H) and P3 (W)', () => {
  assert.deepEqual(site.S, [9, -53, 0]); assert.deepEqual(site.C, [10, -53, 0]); assert.deepEqual(site.C1, [10, -54, 0])
  assert.deepEqual([site.P1, site.P2, site.P3], [[8, -53, 0], [7, -53, 0], [6, -53, 0]])
  assert.deepEqual(site.H, [7, -54, 0]); assert.deepEqual(site.W, [6, -54, 0]); assert.deepEqual(site.under1, [8, -54, 0])
})

test('siteWhy: the lake with a dry shore and rock behind it is a site; each broken condition names itself', () => {
  assert.equal(M.siteWhy(world().read, site), null)
  const why = edit => M.siteWhy(world(edit).read, site)
  assert.equal(why({ '10,-55,0': LAVA(3) }), 'no_source', 'flowing lava is not a source')
  assert.equal(why({ '10,-54,0': ROCK }), 'no_cave', 'the ray from S needs the cave cells')
  assert.equal(why({ '9,-54,0': LAVA(0) }), 'shore')
  assert.equal(why({ '7,-52,1': WATER(0) }), 'tunnel_wet', 'water beside the tunnel row')
  assert.equal(why({ '7,-53,0': LAVA(2) }), 'tunnel_wet', 'lava IN a tunnel cell (its box is empty: isOpen alone would pass it)')
  assert.equal(why({ '7,-55,0': AIR }), 'basin_floor')
  assert.equal(why({ '6,-54,1': CAVE }), 'basin_wall')
  assert.equal(why({ '5,-54,0': LAVA(0) }), 'basin_wall', 'beyond W')
  assert.equal(why({ '7,-54,0': { name: 'cobblestone', boundingBox: 'block', full: true } }), 'basin_not_rock', 'never a placed block')
  assert.equal(M.siteWhy((x, y, z) => (x === 6 && y === -54 ? null : world().read(x, y, z)), site), 'unknown')
  assert.equal(M.siteWhy(world().read, site, { inZone: c => c[0] === 7 }), 'zone')
  assert.equal(M.siteWhy(world().read, site, { kind: 'water' }), 'no_source', 'a lava lake is not a water site')
})

test('approachLegs: across onto S\'s line, then along the bearing through P3..P1 into S; never from another level or too close', () => {
  const legs = M.approachLegs([0, -53, 3], site)
  assert.deepEqual(legs, [{ start: [0, -53, 3], b: 3, len: 3 }, { start: [0, -53, 0], b: 0, len: 9 }])
  assert.deepEqual(M.approachLegs([2, -53, 0], site), [{ start: [2, -53, 0], b: 0, len: 7 }], 'no leg of length 0')
  assert.equal(M.approachLegs([7, -53, 0], site), null, 'the basin row must be on the last leg')
  assert.equal(M.approachLegs([0, -50, 0], site), null, 'another level')
  assert.equal(M.approachLegs([0, -53, 40], site), null, 'past OBS_APPROACH_MAX')
})

test('findSites: the lake from the tunnel, cheapest first; skip removes a failed lake cell; nothing round a dry tunnel', () => {
  const w = world()
  const sites = M.findSites(w.read, [0, -53, 0], { r: 16 })
  assert.ok(sites.length >= 1)
  assert.deepEqual(sites[0].lq, LQ)
  assert.equal(sites[0].cost, 9)
  const again = M.findSites(w.read, [0, -53, 0], { r: 16, skip: new Set(['10,-55,0']) })
  assert.ok(again.every(s => s.lq.join(',') !== '10,-55,0'))
  assert.deepEqual(M.findSites(world({}).read, [0, -53, 0], { r: 6 }), [], 'positive control above: the same world finds it with r 16')
})

test('castNext: one bucket in turn through a whole cycle -- basin, water, lava, the pour, water back, dig, pickup, again', () => {
  const kit = (o = {}) => ({ buckets: 0, water: 0, lava: 0, ...o })
  const seq = [
    [{ H: ROCK, W: ROCK, kit: kit({ water: 1 }) }, 'basin'],
    [{ H: AIR, W: AIR, kit: kit({ water: 1 }) }, 'water'],
    [{ H: WATER(1), W: WATER(0), kit: kit({ buckets: 1 }) }, 'lava'],
    [{ H: WATER(1), W: WATER(0), kit: kit({ lava: 1 }) }, 'pour_lava'],
    [{ H: OBS, W: WATER(0), kit: kit({ buckets: 1 }) }, 'scoop_water'],
    [{ H: OBS, W: AIR, kit: kit({ water: 1 }) }, 'dig'],
    [{ H: AIR, W: AIR, kit: kit({ water: 1 }), justDug: true }, 'pickup'],
    [{ H: AIR, W: AIR, kit: kit({ water: 1 }) }, 'water'],
  ]
  for (const [s, want] of seq) assert.equal(M.castNext(s), want, JSON.stringify(s))
  // the lava landed in W's water instead: W is the obsidian, dug as well
  assert.equal(M.castNext({ H: AIR, W: OBS, kit: kit({ buckets: 1 }) }), 'dig')
  // the stops: never a lava bucket without water ready, never loose lava in the basin
  assert.equal(M.castNext({ H: AIR, W: AIR, kit: kit({ lava: 1 }) }), 'stop:holding_lava_no_water')
  assert.equal(M.castNext({ H: ROCK, W: ROCK, kit: kit({ lava: 1 }) }), 'stop:basin_closed_holding_lava')
  assert.equal(M.castNext({ H: LAVA(0), W: WATER(0), kit: kit({ buckets: 1 }) }), 'stop:loose_lava')
  assert.equal(M.castNext({ H: AIR, W: AIR, kit: kit() }), 'stop:no_water')
  assert.equal(M.castNext({ H: AIR, W: WATER(0), kit: kit() }), 'stop:no_empty_bucket')
})

test('THE REFUSAL CHAIN: every missing piece is a different job (an ordinary diamond trip), never a wait', () => {
  const kit = (o = {}) => ({ pickUses: 1500, buckets: 1, water: 0, lava: 0, obsidian: 0, seal: 64, ...o })
  const want = o => M.obsidianWant({ on: true, target: 'diamond', town: 0, kit: kit(), ...o })
  assert.deepEqual(want({}), { want: 4, skip: null })
  assert.equal(want({ on: false }).skip, 'off')
  assert.equal(want({ target: 'iron' }).skip, 'iron_trip')
  assert.equal(want({ town: null }).skip, 'town_unknown', 'the need is never guessed')
  assert.equal(want({ town: 4 }).skip, 'stocked')
  assert.equal(want({ town: 2, kit: kit({ obsidian: 2 }) }).skip, 'stocked', 'the bag counts too')
  assert.equal(want({ kit: kit({ pickUses: 0 }) }).skip, 'no_diamond_pickaxe')
  assert.equal(want({ kit: kit({ buckets: 0 }) }).skip, 'no_bucket')
  assert.equal(want({ kit: kit({ seal: 2 }) }).skip, 'seal_blocks')
  assert.deepEqual(want({ town: 1, kit: kit({ buckets: 0, water: 1 }) }), { want: 3, skip: null })
  // a refusal leaves no sub-goal: the gate is idle (the work's ore and branches run) and the trip's return is unchanged
  assert.equal(M.castGate({ obs: null, kit: kit(), feet: [0, -53, 0] }), 'idle')
  const t = { target: 'diamond', startedAt: Date.now(), calls: 1 }
  assert.equal(M.returnWhy(t, { kit: { free: 20, uses: 500, ironUses: 200, lowUses: 300, seal: 64, diamonds: 0 } }), null)
  // with a sub-goal: the gate walks the same chain at depth
  const o = (x = {}) => ({ want: 4, got0: 0, fails: 0, cycles: 0, ...x })
  assert.equal(M.castGate({ obs: o(), kit: kit({ water: 1 }), feet: [0, -48, 0] }), 'deepen')
  assert.equal(M.castGate({ obs: o({ deepens: 3 }), kit: kit({ water: 1 }), feet: [0, -48, 0] }), 'off:level_-48')
  assert.equal(M.castGate({ obs: o(), kit: kit({ water: 1 }), feet: [0, -53, 0] }), 'seek:lava')
  assert.equal(M.castGate({ obs: o(), kit: kit(), feet: [0, -53, 0] }), 'seek:water', 'no water: a water lake fills the bucket first')
  assert.equal(M.castGate({ obs: o(), kit: kit({ buckets: 0 }), feet: [0, -53, 0] }), 'off:no_bucket')
  assert.equal(M.castGate({ obs: o({ seeks: 3 }), kit: kit({ water: 1 }), feet: [0, -53, 0] }), 'off:no_lava_site', 'no lava site: off after three looks')
  assert.equal(M.castGate({ obs: o({ fails: 3 }), kit: kit({ water: 1 }), feet: [0, -53, 0] }), 'off:fails')
  assert.equal(M.castGate({ obs: o({ fails: 3, site: site }), kit: kit({ lava: 1 }), feet: [0, -53, 0] }), 'cast', 'never off while holding lava: the step returns it first')
  assert.equal(M.castGate({ obs: o(), kit: kit({ obsidian: 4 }), feet: [0, -53, 0] }), 'done:goal')
  assert.equal(M.castGate({ obs: o({ fails: 5, site: site }), kit: kit({ lava: 1 }), feet: [0, -53, 0] }), 'off:lava_held', 'but never a whole trip of failed pours while holding it')
  assert.equal(M.castGate({ obs: o(), kit: kit({ water: 1, seal: 4 }), feet: [0, -53, 0] }), 'off:seal_blocks', 'blocks for the seals and the fill first')
  assert.equal(M.castGate({ obs: o({ off: 'x' }), kit: kit(), feet: [0, -53, 0] }), 'idle')
})

test('returnWhy: a finished cast that made obsidian goes home to bank it; one that made none does not', () => {
  const k = { free: 20, uses: 500, ironUses: 200, lowUses: 300, seal: 64, diamonds: 0 }
  const t = obs => ({ target: 'diamond', startedAt: Date.now(), calls: 1, obs })
  assert.equal(M.returnWhy(t({ done: true, got: 2 }), { kit: k }), 'obsidian')
  assert.equal(M.returnWhy(t({ done: false, got: 2 }), { kit: k }), null)
  assert.equal(M.returnWhy(t({ off: 'fails', got: 0 }), { kit: k }), null)
})

test('looseLava: lava in the basin or the tunnel after a pour is sealed; the lake beyond S and the body are not', () => {
  const w = world({ '7,-54,0': LAVA(0), '7,-53,0': LAVA(2), '6,-54,0': WATER(0) })
  const body = [site.P1, [8, -52, 0]]
  const cells = M.looseLava(w.read, site, body).map(c => c.join(','))
  assert.ok(cells.includes('7,-54,0') && cells.includes('7,-53,0'))
  assert.ok(!cells.some(c => c.startsWith('10,') || c.startsWith('11,')), 'the lake is the lake')
  assert.deepEqual(M.looseLava(world().read, site, body), [], 'positive control: a dry site has none')
  assert.ok(!M.looseLava(world({ '8,-53,0': LAVA(0) }).read, site, body).some(c => c.join(',') === '8,-53,0'), 'never the bot\'s own cell')
})

test('spillState: lava left at the feet\'s level or above is the tunnel (go home now); below it the basin; none is clear', () => {
  assert.equal(M.spillState([], -53), 'clear')
  assert.equal(M.spillState([[7, -54, 0]], -53), 'basin')
  assert.equal(M.spillState([[7, -54, 0], [10, -53, 0]], -53), 'tunnel')
  // the lava put back toward the lake landing in C (beside S at the feet's level) is loose (Codex r1 B2)
  const cells = M.looseLava(world({ '10,-53,0': LAVA(0) }).read, site, [site.S, [9, -52, 0]]).map(c => c.join(','))
  assert.ok(cells.includes('10,-53,0'))
  assert.equal(M.spillState(M.looseLava(world({ '10,-53,0': LAVA(0) }).read, site, []), site.f), 'tunnel')
})

test('spilledWater: water at the tunnel\'s level after the water pour; none while it stays in the basin', () => {
  assert.deepEqual(M.spilledWater(world({ '6,-54,0': WATER(0), '7,-54,0': WATER(1) }).read, site), [])
  assert.deepEqual(M.spilledWater(world({ '7,-53,0': WATER(1) }).read, site), [[7, -53, 0]])
})

test('waterFill: an infinite source (two source neighbours) with a dry stand; never a lone source; never in a zone', () => {
  const m = new Map()
  const at = (x, y, z) => m.get(`${x},${y},${z}`)
  const read = (x, y, z) => at(x, y, z) ?? (y <= 63 ? ROCK : AIR)
  for (const x of [5, 6, 7]) m.set(`${x},63,0`, WATER(0))
  const r = M.waterFill(read, [0, 64, 0], { r: 10, dy: 3 })
  assert.ok(r, 'found')
  assert.deepEqual(r.at, [6, 63, 0], 'the middle of the channel is the only cell with two source neighbours')
  assert.equal(M.waterFill(read, [0, 64, 0], { r: 10, dy: 3, inZone: c => c[0] >= 5 }), null)
  m.delete('5,63,0'); m.delete('7,63,0')
  assert.equal(M.waterFill(read, [0, 64, 0], { r: 10, dy: 3 }), null, 'a lone source would be taken from the world')
})

test('obsKit: the diamond pickaxe\'s uses, buckets by kind, obsidian, seal blocks', () => {
  const k = M.obsKit([{ name: 'diamond_pickaxe', count: 1, maxDurability: 1561, durabilityUsed: 61 }, { name: 'bucket', count: 1 }, { name: 'water_bucket', count: 1 },
    { name: 'obsidian', count: 2 }, { name: 'cobblestone', count: 40 }, { name: 'iron_pickaxe', count: 1, maxDurability: 250, durabilityUsed: 0 }])
  assert.deepEqual(k, { pickUses: 1500, buckets: 1, water: 1, lava: 0, obsidian: 2, seal: 40 })
})

test('the obsidian is banked: DEPOSIT_ALWAYS takes it (it was "not_wanted" junk before)', () => {
  const r = K.bankableInventory([{ name: 'obsidian', count: 3 }], { wants: K.DEPOSIT_ALWAYS })
  assert.equal(r.detail.obsidian, 3)
  assert.equal(K.bankableInventory([{ name: 'obsidian', count: 3 }], { wants: [] }).excluded.obsidian, 'not_wanted', 'positive control: the list is what banks it')
})

// ---- bucket.mjs: the cast's own uses ---------------------------------------------------------------------------------------
test('castPourRefusal: lava only below the feet and never the floor; never the body; water into the basin is a pour', () => {
  const feet = { x: 8, y: -53, z: 0 }
  const at = (x, y, z, b = AIR) => ({ ...b, position: new Vec3(x, y, z) })
  const r = (item, t) => B.castPourRefusal({ item, has: true, target: t, distance: 2, feet })
  assert.equal(r('lava_bucket', at(7, -54, 0)), null, 'H: one out, one down')
  assert.equal(r('lava_bucket', at(7, -54, 0, WATER(1))), null, 'into the flowing water the basin holds')
  assert.equal(r('water_bucket', at(6, -54, 0)), null, 'W')
  assert.match(r('lava_bucket', at(7, -53, 0)), /below my feet/)
  assert.match(r('lava_bucket', at(8, -54, 0)), /my floor/)
  assert.match(r('water_bucket', at(8, -52, 0)), /my own cell/)
  assert.match(r('lava_bucket', at(7, -54, 0, ROCK)), /not free/)
  assert.match(B.castPourRefusal({ item: 'milk_bucket', has: true, target: at(7, -54, 0), distance: 2, feet }), /not a pour item/)
})

test('fillRefusal and lavaScoopRefusal: an infinite water source only; a lava SOURCE only, one at a time', () => {
  const src = WATER(0), w = { ...src, metadata: 0 }
  assert.equal(B.fillRefusal({ hasEmptyBucket: true, target: w, cardinals: [w, w], distance: 2 }), null)
  assert.match(B.fillRefusal({ hasEmptyBucket: true, target: w, cardinals: [w], distance: 2 }), /infinite/)
  assert.match(B.fillRefusal({ hasEmptyBucket: true, target: { name: 'water', metadata: 3 }, cardinals: [w, w], distance: 2 }), /flowing/)
  assert.equal(B.lavaScoopRefusal({ hasEmptyBucket: true, target: { name: 'lava', metadata: 0 }, distance: 3.3 }), null)
  assert.match(B.lavaScoopRefusal({ hasEmptyBucket: true, target: { name: 'lava', metadata: 2 }, distance: 3.3 }), /flowing/)
  assert.match(B.lavaScoopRefusal({ hasEmptyBucket: true, holdsLava: true, target: { name: 'lava', metadata: 0 }, distance: 3.3 }), /already/)
  assert.match(B.lavaScoopRefusal({ hasEmptyBucket: true, target: { name: 'lava', metadata: 0 }, distance: 5 }), /reach/)
  // the model's own verb is unchanged: it still refuses lava
  assert.match(B.scoopRefusal({ hasEmptyBucket: true, target: { name: 'lava', metadata: 0 }, distance: 2 }), /refusing to scoop lava/)
})

/** A fake bot for the bucket uses: lookAt as mineflayer's (point.minus), the world a map, the held bucket swapped by use. */
function fakeBot ({ held = 'lava_bucket', onUse = () => {} } = {}) {
  const st = { held, uses: 0, world: new Map() }
  return {
    st,
    entity: { position: new Vec3(8.5, -53, 0.5) },
    inventory: { items: () => [{ name: st.held, count: 1 }] },
    get heldItem () { return { name: st.held } },
    equip: async () => {},
    lookAt: async p => { p.minus(new Vec3(0, 0, 0)) },
    activateItem: () => { st.uses++; onUse(st) },
    blockAt: p => { const k = `${p.x},${p.y},${p.z}`; return st.world.has(k) ? { ...st.world.get(k), position: p } : { ...AIR, position: p } },
    pathfinder: { setGoal: () => {} },
  }
}
const sleep = async () => {}

test('pourInto STOPS at the first use that empties the bucket: a lava that landed elsewhere is never followed by a second aim', async () => {
  // the first aim puts the lava in the TUNNEL (7,-53,0), not H: the read says no obsidian
  const bot = fakeBot({ onUse: st => { if (st.held === 'lava_bucket') { st.held = 'bucket'; st.world.set('7,-53,0', LAVA(0)) } } })
  const r = await B.pourInto(bot, new Vec3(7, -54, 0), 'lava_bucket', () => bot.blockAt(new Vec3(7, -54, 0)).name === 'obsidian', { sleep })
  assert.deepEqual([r.ok, r.emptied, r.aims], [false, true, 1])
  assert.equal(bot.st.uses, 1)
  // the right landing: obsidian read back
  const good = fakeBot({ onUse: st => { st.held = 'bucket'; st.world.set('7,-54,0', OBS) } })
  const g = await B.pourInto(good, new Vec3(7, -54, 0), 'lava_bucket', () => good.blockAt(new Vec3(7, -54, 0)).name === 'obsidian', { sleep })
  assert.deepEqual([g.ok, g.emptied], [true, true])
  // a refused cell is never used at all
  const nope = fakeBot()
  const n = await B.pourInto(nope, new Vec3(7, -53, 0), 'lava_bucket', () => true, { sleep })
  assert.equal(n.ok, false); assert.equal(nope.st.uses, 0); assert.match(n.why, /below my feet/)
})

test('scoopLava and fillWater: verified by the item counts (one full more, one empty fewer)', async () => {
  const bot = fakeBot({ held: 'bucket', onUse: st => { st.held = 'lava_bucket' } })
  bot.st.world.set('9,-55,0', { name: 'lava', metadata: 0, boundingBox: 'empty' })
  const r = await B.scoopLava(bot, new Vec3(9, -55, 0), { sleep })
  assert.equal(r.ok, true, JSON.stringify(r))
  const w = fakeBot({ held: 'bucket', onUse: st => { st.held = 'water_bucket' } })
  for (const x of [8, 9, 10]) w.st.world.set(`${x},-54,0`, { name: 'water', metadata: 0, boundingBox: 'empty' })
  assert.equal((await B.fillWater(w, new Vec3(9, -54, 0), { sleep })).ok, true)
  const lone = fakeBot({ held: 'bucket', onUse: st => { st.held = 'water_bucket' } })
  lone.st.world.set('9,-54,0', { name: 'water', metadata: 0, boundingBox: 'empty' })
  const l = await B.fillWater(lone, new Vec3(9, -54, 0), { sleep })
  assert.equal(l.ok, false); assert.equal(lone.st.uses, 0, 'a lone source is never taken')
})

// ---- mutants (anchor present and unique) -----------------------------------------------------------------------------------
async function withMutant (rel, old, neu, fn) {
  const path = new URL(rel, import.meta.url)
  const src = readFileSync(path, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${old.slice(0, 70)}`)
  const out = new URL(`./_mutant-obs-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

test('MUTANT: without the stop at the first emptying use, the misplaced lava is followed by more aims and reads as never poured', async () => {
  await withMutant('../src/bucket.mjs', "    if (emptied) return { ok: good, why: good ? null : 'emptied and the read is not the cast', aims, emptied }\n", '', async X => {
    const bot = fakeBot({ onUse: st => { if (st.held === 'lava_bucket') { st.held = 'bucket'; st.world.set('7,-53,0', LAVA(0)) } } })
    const r = await X.pourInto(bot, new Vec3(7, -54, 0), 'lava_bucket', () => false, { sleep })
    assert.equal(r.emptied, false, 'the mutant hides the emptying the caller must seal after')
  })
})

test('MUTANT: lava allowed at the feet\'s level -> a pour beside the body passes', async () => {
  await withMutant('../src/bucket.mjs', "    if (t.y >= feet.y) return 'lava only below my feet'\n", '', async X => {
    const feet = { x: 8, y: -53, z: 0 }
    assert.equal(X.castPourRefusal({ item: 'lava_bucket', has: true, target: { ...AIR, position: new Vec3(7, -53, 0) }, distance: 1, feet }), null)
  })
})

test('MUTANT: a flowing lava target accepted by the scoop rule', async () => {
  await withMutant('../src/bucket.mjs', "  if (target.metadata !== 0) return 'flowing lava cannot fill a bucket'\n", '', async X => {
    assert.equal(X.lavaScoopRefusal({ hasEmptyBucket: true, target: { name: 'lava', metadata: 2 }, distance: 3 }), null)
  })
})

test('MUTANT: the basin wall check removed -> a basin open to a cave is a site (the water would leave it)', async () => {
  await withMutant('../src/deepmine.mjs', "    for (const w of lat(c)) if (!fullDry(r(w))) return 'basin_wall'\n", '', async X => {
    assert.equal(X.siteWhy(world({ '6,-54,1': CAVE }).read, X.siteCells(LQ, 0)), null)
  })
})

test('MUTANT: castNext without the water-ready rule takes lava with nothing to cast it on', async () => {
  await withMutant('../src/deepmine.mjs', "  if ((kit.lava ?? 0) > 0) return isSourceOf(W, 'water') ? 'pour_lava' : 'stop:holding_lava_no_water'\n", "  if ((kit.lava ?? 0) > 0) return 'pour_lava'\n", async X => {
    assert.equal(X.castNext({ H: AIR, W: AIR, kit: { lava: 1 } }), 'pour_lava')
  })
})

test('MUTANT: the gate ends the cast while lava is in the bag', async () => {
  await withMutant('../src/deepmine.mjs', "  if ((obs.fails ?? 0) >= OBS_FAILS_MAX && !lava) return 'off:fails'\n", "  if ((obs.fails ?? 0) >= OBS_FAILS_MAX) return 'off:fails'\n", async X => {
    assert.equal(X.castGate({ obs: { want: 4, got0: 0, fails: 3, site: {} }, kit: { lava: 1 }, feet: [0, -53, 0] }), 'off:fails')
  })
})

// ---- the wiring (structural: the executor is skills.mjs, which needs the bot's env to import) ------------------------------
const SK = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
test('wiring: the work phase runs the cast first and falls through to the ore when it is not running', () => {
  const line = "if (trip.obs && !trip.obs.done && !trip.obs.off) { const r = await deepObsStep(ctx, trip, signal, deadline); if (r) return r }"
  assert.equal(SK.split(line).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const work = SK.indexOf("if (trip.phase === 'work') {")
  assert.ok(work > 0 && SK.indexOf(line) > work && SK.indexOf(line) < SK.indexOf('const kinds = deepWorkKinds(trip, y)'))
})
test('wiring: the sub-goal is taken only through obsidianWant at a trip\'s start', () => {
  const take = 'bot.deepTrip.obs = { want: w.want, got0: ok.obsidian, got: 0, fails: 0, cycles: 0, skip: [] }'
  assert.equal(SK.split(take).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.equal(SK.split('bot.deepTrip.obs =').length, 2, 'one place sets it')
  assert.ok(/const w = deepObsWant\(\{ target, kit: ok, town: OBSIDIAN\.on \? deepObsTown\(bot\) : null \}\)\n\s*if \(w\.want > 0\) \{\n\s*bot\.deepTrip\.obs =/.test(SK))
})
test('wiring: every pour is read back (contain: seal, read again) and an open spill ends the cast and turns the trip home', () => {
  const fn = /\nasync function deepObsStep \([\s\S]*?\n\}\n/.exec(SK)?.[0] ?? ''
  assert.ok(fn.length > 1000)
  const a = fn.indexOf("const r = await obsPourInto(bot, new Vec3(at[0], at[1], at[2]), lava ? 'lava_bucket' : 'water_bucket', accept)")
  const b = fn.indexOf('const c = await deepObsContain(bot, o, signal, trip, { water: !lava })')
  const c = fn.indexOf("if (c.state !== 'clear') o.spill = c.state")
  assert.ok(a > 0 && b > a && c > b, 'pour -> contain -> escalate')
  const home = "trip.phase = 'return'; trip.returnWhy = 'obs_spill'"
  assert.equal(fn.split(home).length, 3, 'the spill turns the trip home from the loop and from end()')
  const con = /\nasync function deepObsContain \([\s\S]*?\n\}\n/.exec(SK)?.[0] ?? ''
  assert.ok(con.indexOf('await deepObsSeal(') > 0 && con.indexOf('const left = deepLooseLava(') > con.indexOf('await deepObsSeal('), 'sealed, then read again')
  // end() on a spill returns a RESULT (the work phase returns it: no ore work this call beside open lava -- Codex r2)
  assert.ok(/if \(o\.spill\) \{ trip\.phase = 'return'; trip\.returnWhy = 'obs_spill';[^\n]*return \{ status: 'failed'/.test(fn), 'end() returns a result on a spill, never null')
  const back = /\nasync function deepObsLavaBack \([\s\S]*?\n\}\n/.exec(SK)?.[0] ?? ''
  assert.ok(back.includes('await deepObsContain(bot, o, signal'), 'the lava put back is read back too (Codex r1 B2)')
})

// COPPERRUN-02 (OWNER 11-06 ~01:25Z "bots should MINE copper"): the SITED copper hall's owed copper keeps the copper run asked, and
// with no exposed ore in reach the run sends a TRIP to the nearest known copper find (the atlas), whose gather may TUNNEL to copper
// (oretunnel.mjs tunnelKindsFor `copper`, that call only). bots/src/copperhall.mjs hallCopperOwed / copperTripTarget / copperTripTried /
// copperRunOrder; skills.mjs copperAsk / hallSitedCopperNow / copperTripVisit; oretunnel.mjs tunnelKindsFor. Behaviour first; the
// wiring the behaviour cannot reach is asserted on comment-stripped source; mutants assert their anchors are present and unique.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const H = await import('../src/copperhall.mjs')
const T = await import('../src/oretunnel.mjs')
const HALL_PATH = new URL('../src/copperhall.mjs', import.meta.url)
const TUN_PATH = new URL('../src/oretunnel.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// THE LIVE HALL (showcase g22, 11-06): 33 copper cells, none placed; the town 138 ingots + 3 blocks, 0 cut, 0 raw
const cells = [
  ...Array.from({ length: 33 }, (_, i) => ({ at: [-20, 67, 21 + i], role: 'copper', seg: i < 30 ? 'copper-trim' : 'copper-lintel' })),
  { at: [-21, 62, 21], role: 'fill', seg: 'earth' }, { at: [-21, 63, 21], role: 'base', seg: 'pad' },
]
const REC = { plot: 'hall', structure_complete: false, cells }
const air = () => ({ name: 'air' })
const FINDS = [
  { kind: 'copper_ore', x: 19, y: 58, z: -64 },      // 66.8 from home: the nearest in band
  { kind: 'copper_ore', x: 37, y: 60, z: -59 },      // 69.6
  { kind: 'copper_ore', x: 10, y: 60, z: 20 },       // 22: inside the town's 64 (never a trip)
  { kind: 'iron_ore', x: 5, y: 60, z: -65 },         // not copper
  { kind: 'copper_ore', x: 300, y: 60, z: 0 },       // past COPPER_TRIP_MAX
  { kind: 'deepslate_copper_ore', x: 90, y: 10, z: 0 },
]
const HOME = { x: 0, z: 0 }
const BASE = { now: 1e12, on: true, waiting: true, held: 0, freeSlots: 20, tripPick: true, site: { ok: true, hit: null }, state: {} }

await t('hallCopperOwed: copper cells the world does not show as cut copper are owed; weathered/waxed count placed; unloaded is owed', () => {
  assert.equal(H.hallCopperOwed(REC, air), 33)
  // control: every copper cell placed -> 0; other roles never count
  assert.equal(H.hallCopperOwed(REC, () => ({ name: 'cut_copper' })), 0)
  const mixed = (x, y, z) => (z < 31 ? { name: 'weathered_cut_copper' } : z < 33 ? { name: 'waxed_exposed_cut_copper' } : z === 33 ? null : { name: 'stone_bricks' })
  assert.equal(H.hallCopperOwed(REC, mixed), 33 - 12 + 0)   // z 21..32 placed (12); z 33 unloaded owed; the rest wrong block
  assert.equal(H.hallCopperOwed({ ...REC, structure_complete: true }, air), 0)
  assert.equal(H.hallCopperOwed(null, air), null)
})

await t('the sited hall\'s gate is hallOpening with needed = the owed cells: the live town is short (138 of 427)', () => {
  const g = H.hallOpening({ ingots: 138, cut: 0, reserve: 512, needed: H.hallCopperOwed(REC, air) })
  assert.equal(g.open, false)
  assert.equal(g.need, 103 + 9 * 36)
  assert.deepEqual(H.copperShort({ ...g, raw: 0 }), { short: 289, need: 427, have: 138 })
  // control: with the cells placed but 1, the bill is one batch
  assert.equal(H.hallOpening({ ingots: 139, cut: 0, reserve: 512, needed: 1 }).open, true)
})

await t('copperTripTarget: the nearest copper find 64..160 from home, out of every zone, not one backed off', () => {
  const a = H.copperTripTarget(FINDS, { home: HOME })
  assert.deepEqual(a.at, [19, 58, -64])
  assert.equal(a.block, 'copper_ore')
  assert.equal(a.key, '19,58,-64')
  // a zone over the nearest -> the next
  assert.deepEqual(H.copperTripTarget(FINDS, { home: HOME, inZone: (x) => x === 19 }).at, [37, 60, -59])
  // backed off until later -> the next; expired -> the nearest again
  assert.deepEqual(H.copperTripTarget(FINDS, { home: HOME, now: 10, tried: { '19,58,-64': 11 } }).at, [37, 60, -59])
  assert.deepEqual(H.copperTripTarget(FINDS, { home: HOME, now: 12, tried: { '19,58,-64': 11 } }).at, [19, 58, -64])
  // deepslate copper is a target too; nothing in band -> null; a throwing zone test excludes (fail closed)
  assert.equal(H.copperTripTarget([FINDS[5]], { home: HOME }).block, 'deepslate_copper_ore')
  assert.equal(H.copperTripTarget([FINDS[2], FINDS[3], FINDS[4]], { home: HOME }), null)
  assert.equal(H.copperTripTarget(FINDS, { home: HOME, inZone: () => { throw new Error('x') } }), null)
  assert.equal(H.copperTripTarget(FINDS, { home: null }), null)
})

await t('copperTripTried: an empty trip backs its target off; a trip that gained copper keeps it open; expired keys drop', () => {
  assert.deepEqual(H.copperTripTried({}, 'k', 0, 100, 50), { k: 150 })
  assert.deepEqual(H.copperTripTried({}, 'k', 7, 100, 50), {})
  assert.deepEqual(H.copperTripTried({ old: 99, live: 200 }, null, 0, 100, 50), { live: 200 })
})

await t('copperRunOrder: no exposed ore in reach -> a TRIP to the known find (build_shop copperTrip), charged like a run', () => {
  const gate = { open: false, need: 427, have: 138, raw: 0, sited: true }
  const trip = H.copperTripTarget(FINDS, { home: HOME })
  const r = H.copperRunOrder({ ...BASE, gate, ore: null, tripOn: true, trip: () => trip })
  assert.equal(r.skip, null)
  assert.equal(r.order.skill, 'build_shop')
  assert.deepEqual(r.order.args, { copperTrip: true, at: [19, 58, -64], block: 'copper_ore', key: '19,58,-64' })
  assert.equal(r.state.lastIssuedAt, BASE.now)
  // the next ask within the cooldown issues nothing
  assert.equal(H.copperRunOrder({ ...BASE, gate, ore: null, tripOn: true, trip: () => trip, state: r.state }).skip, 'cooldown')
  // the base exactly with the trip off or no target: no_ore
  assert.equal(H.copperRunOrder({ ...BASE, gate, ore: null, tripOn: false, trip: () => trip }).skip, 'no_ore')
  assert.equal(H.copperRunOrder({ ...BASE, gate, ore: null, tripOn: true, trip: () => null }).skip, 'no_ore')
  // exposed ore in reach still gathers it, and the trip is never read
  let read = 0
  const g = H.copperRunOrder({ ...BASE, gate, ore: { block: 'copper_ore', dist: 9, at: '1,2,3' }, tripOn: true, trip: () => { read++; return trip } })
  assert.equal(g.order.skill, 'gather')
  assert.equal(read, 0)
  // stocked town: no trip either
  assert.equal(H.copperRunOrder({ ...BASE, gate: { ...gate, have: 427 }, ore: null, tripOn: true, trip: () => trip }).skip, 'stocked')
})

await t('tunnelKindsFor: copper tunnels ONLY on the trip\'s call (copper opt); iron/coal/diamond unchanged; the kind lists agree', () => {
  assert.equal(T.tunnelKindsFor('copper_ore'), null)
  assert.equal(T.tunnelKindsFor('deepslate_copper_ore', { copper: false }), null)
  assert.deepEqual(T.tunnelKindsFor('copper_ore', { copper: true }), { kinds: T.COPPER_TUNNEL_KINDS, label: 'copper' })
  assert.deepEqual(T.tunnelKindsFor('deepslate_copper_ore', { copper: true }).label, 'copper')
  assert.equal(T.tunnelKindsFor('iron_ore', { copper: true }).label, 'iron')
  assert.equal(T.tunnelKindsFor('diamond_ore', { copper: true }), null)
  assert.deepEqual([...T.COPPER_TUNNEL_KINDS], [...H.COPPER_KINDS])
})

await t('THE CHAIN on the live state: the sited hall short -> a trip -> its gather tunnels to the copper it is sent for', () => {
  const owed = H.hallCopperOwed(REC, air)
  const gate = { ...H.hallOpening({ ingots: 138, cut: 0, reserve: 512, needed: owed }), raw: 0 }
  const r = H.copperRunOrder({ ...BASE, gate, ore: null, tripOn: true, trip: () => H.copperTripTarget(FINDS, { home: HOME, now: BASE.now }) })
  assert.equal(r.order?.args?.copperTrip, true)
  assert.ok(T.tunnelKindsFor(r.order.args.block, { copper: true }), 'the trip\'s block tunnels with the flag the visit sets')
})

await t('WIRING (source, comments stripped): copperAsk asks the sited hall and the trip; build_shop runs the trip; gather passes copper', () => {
  const src = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/const waiting = \(\) => \{ if \(hallWaitingNow\(\)\) return true; sited = hallSitedCopperNow\(bot\); return !!sited\?\.waiting \}/.test(src))
  assert.ok(src.includes('tripOn: COPPERRUN2.trip, trip: () => copperTripNow(bot, now) })'))
  assert.ok(src.includes('if (args?.copperTrip === true) return copperTripVisit(ctx, args, signal)'))
  assert.ok(src.includes("const tk = tunnelKindsFor(viaSource ?? blockName, { diamond: bot.deepTunnelKinds === true }) ?? (bot.copperTunnelKinds === true ? tunnelKindsFor(viaSource ?? blockName, { copper: true }) : null)"))
  assert.ok(src.includes('const ironStrict = tunnelKindsFor(blockName, { copper: bot.copperTunnelKinds === true }) != null'))
  // the flag is set only around the trip's gather and always reset
  const sets = src.split('bot.copperTunnelKinds = true').length - 1
  assert.equal(sets, 1)
  assert.ok(/bot\.copperTunnelKinds = true\n\s+try \{ g = await gather\(ctx, \{ block, count: COPPER_RUN_COUNT, maxDistance: COPPER_TRIP_GATHER_R \}, signal\) \} catch \(e\) \{[^\n]*\} finally \{ bot\.copperTunnelKinds = false \}/.test(src))
  // the trip's own row kind, and the mode row says the switches
  assert.ok(src.includes("logEvent({ kind: 'copper_trip', status"))
  assert.ok(H.copperRunModeDetail(true, true, { sited: true, trip: false }).includes('sited=1 trip=0 trip_r=64-160'))
})

await t('MUTANT: hallCopperOwed counting every copper cell (no world read) is killed', async () => {
  await withMutant(HALL_PATH, '    if (!b || !isCutCopper(b.name)) n++\n', '    n++\n', async M => {
    assert.notEqual(M.hallCopperOwed(REC, () => ({ name: 'cut_copper' })), 0)
  })
})
await t('MUTANT: the trip target without the zone test is killed', async () => {
  await withMutant(HALL_PATH, '    if (z) continue\n', '\n', async M => {
    assert.deepEqual(M.copperTripTarget(FINDS, { home: HOME, inZone: (x) => x === 19 }).at, [19, 58, -64])
  })
})
await t('MUTANT: the trip target ignoring the back-off is killed', async () => {
  await withMutant(HALL_PATH, '    if ((Number(tried?.[key]) || 0) > now) continue\n', '\n', async M => {
    assert.deepEqual(M.copperTripTarget(FINDS, { home: HOME, now: 10, tried: { '19,58,-64': 11 } }).at, [19, 58, -64])
  })
})
await t('MUTANT: no trip branch (the base) is killed', async () => {
  await withMutant(HALL_PATH, '    const t = tripOn ? lazy(trip) : null\n', '    const t = null\n', async M => {
    const r = M.copperRunOrder({ ...BASE, gate: { open: false, need: 427, have: 138, raw: 0 }, ore: null, tripOn: true, trip: () => H.copperTripTarget(FINDS, { home: HOME }) })
    assert.equal(r.skip, 'no_ore')
  })
})
await t('MUTANT: an empty trip never backed off is killed', async () => {
  await withMutant(HALL_PATH, '  if (key && !(Number(gained) > 0)) out[key] = now + ms\n', '\n', async M => {
    assert.deepEqual(M.copperTripTried({}, 'k', 0, 100, 50), {})
  })
})
await t('MUTANT: copper never tunnelling (the base oretunnel) is killed', async () => {
  await withMutant(TUN_PATH, "  if (copper && COPPER_TUNNEL_KINDS.includes(name)) return { kinds: COPPER_TUNNEL_KINDS, label: 'copper' }\n", '\n', async M => {
    assert.equal(M.tunnelKindsFor('copper_ore', { copper: true }), null)
  })
})
await t('MUTANT: copper tunnelling without the trip\'s flag is killed', async () => {
  await withMutant(TUN_PATH, '  if (copper && COPPER_TUNNEL_KINDS.includes(name))', '  if (COPPER_TUNNEL_KINDS.includes(name))', async M => {
    assert.notEqual(M.tunnelKindsFor('copper_ore'), null)
  })
})

console.log(`\ncopperrun02: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

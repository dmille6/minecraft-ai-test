// ZONESITE-01SHOW (LIVE showcase 11-15 09:11Z: the sixth tower, T6, was sited wholly inside the protected village zone
// village-taiga-6_1 and its floor's 27 cobblestone laid before the tripwire stopped the town, S6 H3 zone 27).
// Behaviour: (1) sinks.mjs zoneReason -- a zone box that holds a column always refuses, a protected zone ({ id, box }: no `why`)
// too -- through the REAL siting (siteSink on the fake flat world); (2) buildbot.mjs clickZone / cellZone -- the builder's own
// click judged by the zone guard's own decision -- and the adapter's `send` / `placeClosed` on a fake client; (3) the REAL visit
// runner (buildrun.mjs runVisit): a closed cell is never walked to, never clicked, named once, and the visit builds the rest;
// (4) sinks.mjs zonedInstance / dropInstance -- an open instance in a zone is retired and the record is what it was before it.
// Anchored mutants (each anchor present and unique) for every rule a test leans on; STRUCTURAL source assertions only for the
// skills.mjs wiring (comments stripped, executable lines).
import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, HOME, k3, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')
const S = await import('../src/sinks.mjs')
const SH = await import('../src/shop.mjs')
const BB = await import('../src/buildbot.mjs')
const PZ = await import('../src/protectzone.mjs')
const SRC = f => new URL(`../src/${f}`, import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
/** A mutant of one src file (its anchor present and unique), imported from the test directory. */
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(SRC(file), 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-zonesite-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// the showcase's own zone, as /var/lib/mcai/_pool-showcase/protected-zones.json holds it
const VILLAGE = { id: 'village-taiga-6_1', kind: 'village', label: 'the taiga village at 103,-7', box: [49, -64, -59, 157, 90, 45], floor_y: 54 }
const PLAN_ZONES = [{ id: VILLAGE.id, box: VILLAGE.box }]                      // townplan.mjs parseZones: { id, box }, no `why`
const GUARD_ZONES = PZ.parseZones({ version: 1, zones: [VILLAGE] }).zones       // protectzone.mjs parseZones: the guard's list
assert.strictEqual(GUARD_ZONES.length, 1, 'the guard reads the zone')

console.log('THE SITING GUARD (sinks.mjs zoneReason)')
await t('LIVE 11-15: T6\'s columns (x 51..60, z -29..-23, y 65..76) are refused by the village zone, which carries no `why`', () => {
  for (const [x, z] of [[55, -26], [51, -29], [60, -23]]) assert.strictEqual(S.zoneReason(PLAN_ZONES, x, z, 65, 76), 'zone:village-taiga-6_1', `${x},${z}`)
})
await t('POSITIVE CONTROL: T3\'s easternmost column (x 48), one short of the zone, is free; so is a column over the zone\'s top', () => {
  assert.strictEqual(S.zoneReason(PLAN_ZONES, 48, -12, 63, 78), null)
  assert.strictEqual(S.zoneReason(PLAN_ZONES, 55, -26, 91, 99), null, 'y 91..99 is above the box (y1 90)')
  assert.strictEqual(S.zoneReason([], 55, -26, 65, 76), null); assert.strictEqual(S.zoneReason(null, 55, -26, 65, 76), null)
})
await t('a record\'s zone still answers with its own `why`; the first box that holds the column wins; a malformed box is no zone', () => {
  const rec = { box: [36, -64, -20, 52, 320, -4], why: 'project:tower:T3' }
  assert.strictEqual(S.zoneReason([rec, ...PLAN_ZONES], 50, -10, 60, 70), 'project:tower:T3')
  assert.strictEqual(S.zoneReason([...PLAN_ZONES, rec], 50, -10, 60, 70), 'zone:village-taiga-6_1')
  assert.strictEqual(S.zoneReason([{ box: [0, 0, 9, 9] }, { box: null }, {}], 5, 5, 0, 9), null)
  assert.strictEqual(S.zoneReason([{ box: [0, 0, 0, 9, 9, 9] }], 5, 5, 0, 9), 'zone:protected', 'a box with neither a why nor an id still refuses')
})
const AVAIL = { andesite: 400, diorite: 400, granite: 300, stone_bricks: 200, mossy_cobblestone: 200 }
const siteTower = (M, zones, more = {}) => M.siteSink(server().read, { kind: 'tower', n: 1, id: 'T1', home: HOME, pool: 'test', avail: AVAIL, torch: true, stood: [],
  guard: (x, z, y0, y1) => M.zoneReason(zones, x, z, y0, y1), ...more })
const EVERYWHERE = [{ id: 'village-all', box: [-80, -64, -80, 80, 320, 80] }]
const EAST = [{ id: 'village-east', box: [1, -64, -80, 80, 320, 80] }]
await t('THE REAL SITING: with a protected zone over every candidate the tower is NOT sited; with none it is (the control)', () => {
  const open = siteTower(S, [])
  assert.strictEqual(open.ok, true, JSON.stringify(open.tried)); assert.ok(open.inst.cells.length > 50)
  const shut = siteTower(S, EVERYWHERE)
  assert.strictEqual(shut.ok, false, 'no site inside a protected zone'); assert.ok(Object.keys(shut.rejects ?? {}).length > 0, 'the refusal is tallied')
})
await t('...and with the zone over the east half it is sited in the west half: not one cell, and no column of its box, in the zone', () => {
  const r = siteTower(S, EAST)
  assert.strictEqual(r.ok, true, JSON.stringify(r.tried))
  assert.ok(r.inst.cells.every(c => c.at[0] < 1), 'every cell west of x 1')
  assert.ok(r.meta.box[2] < 1, `the box ends west of the zone (${r.meta.box})`)
})
await t('MUTANT (sinks.mjs zoneReason reads `why` as the old guard did): the tower IS sited inside the zone -- the live failure, reproduced', async () => {
  await withMutant('sinks.mjs', "return String(q.why ?? `zone:${q.id ?? 'protected'}`)", 'return q.why ?? null', async M => {
    assert.strictEqual(M.zoneReason(PLAN_ZONES, 55, -26, 65, 76), null, 'a hit with no reason')
    const r = siteTower(M, EVERYWHERE)
    assert.strictEqual(r.ok, true, 'the mutant sites it'); assert.ok(r.inst.cells.every(c => Math.abs(c.at[0]) <= 80), 'inside the zone')
  })
})
await t('MUTANT (zoneReason forgets the y range): a column over the zone\'s top is refused (the control above fails for that reason)', async () => {
  await withMutant('sinks.mjs', 'z <= b[5] && y1 >= b[1] && y0 <= b[4]) return String', 'z <= b[5]) return String', async M => {
    assert.strictEqual(M.zoneReason(PLAN_ZONES, 55, -26, 91, 99), 'zone:village-taiga-6_1')
  })
})

console.log('THE BUILDER\'S CLICK (buildbot.mjs clickZone / cellZone)')
await t('LIVE 11-15: the 27 floor cells (x 56..60, y 65..66, z -28..-23) are closed to a build\'s placement; x 48 is not', () => {
  for (const c of [[58, 65, -24], [60, 65, -28], [56, 66, -23], [57, 66, -27]]) assert.strictEqual(BB.cellZone(GUARD_ZONES, c), VILLAGE.id, k3(c))
  assert.strictEqual(BB.cellZone(GUARD_ZONES, [48, 65, -24]), null)
  assert.strictEqual(BB.cellZone([], [58, 65, -24]), null); assert.strictEqual(BB.cellZone(null, [58, 65, -24]), null)
})
await t('a click is judged on its three cells: the reference, the destination, the cell above it -- any one in the zone refuses', () => {
  assert.strictEqual(BB.clickZone(GUARD_ZONES, [58, 64, -25], [0, 1, 0]), VILLAGE.id, 'all three inside')
  assert.strictEqual(BB.clickZone(GUARD_ZONES, [49, 65, 0], [-1, 0, 0]), VILLAGE.id, 'the reference inside, the destination outside')
  assert.strictEqual(BB.clickZone(GUARD_ZONES, [48, 65, 0], [1, 0, 0]), VILLAGE.id, 'the reference outside, the destination inside')
  assert.strictEqual(BB.clickZone(GUARD_ZONES, [47, 65, 0], [1, 0, 0]), null, 'POSITIVE CONTROL: all three outside')
  assert.strictEqual(BB.clickZone(GUARD_ZONES, [48, 91, 0], [1, 0, 0]), null, 'above the box')
  assert.strictEqual(BB.clickZone(GUARD_ZONES, [49, 89, 0], [0, 1, 0]), VILLAGE.id, 'the top layer of the box')
})
await t('it IS the guard\'s decision: over a grid round the zone\'s edge and floor, cellZone agrees with protectzone.mjs zoneDecision', () => {
  let n = 0, shut = 0
  for (const x of [47, 48, 49, 50]) for (const y of [52, 53, 54, 55, 89, 90, 91]) for (const z of [-60, -59, 0, 45, 46]) {
    for (const feet of [null, { x: 60, y: 40, z: 0 }, { x: 0, y: 70, z: 0 }]) {
      const want = [[x, y, z, 'dest'], [x, y + 1, z, 'above']].map(([a, b, c, role]) => PZ.zoneDecision({ zones: GUARD_ZONES, op: 'place', cell: { x: a, y: b, z: c }, purpose: 'target', feet, role })).find(Boolean)
      assert.strictEqual(BB.cellZone(GUARD_ZONES, [x, y, z], feet), want ? VILLAGE.id : null, `${x},${y},${z} feet ${JSON.stringify(feet)}`)
      n++; if (want) shut++
    }
  }
  assert.ok(shut > 50 && n - shut > 50, `both answers are exercised (${shut} closed of ${n})`)
})
await t('the deep exemption is the guard\'s own: under the zone\'s floor, a bot whose feet are under it too may place; a bot above may not', () => {
  assert.strictEqual(BB.cellZone(GUARD_ZONES, [60, 40, 0], { x: 60, y: 40, z: 1 }), null)
  assert.strictEqual(BB.cellZone(GUARD_ZONES, [60, 40, 0], { x: 0, y: 70, z: 0 }), VILLAGE.id)
  assert.strictEqual(BB.cellZone(GUARD_ZONES, [60, 40, 0], null), VILLAGE.id, 'no feet: no exemption (the record\'s check)')
})
await t('MUTANT (clickZone skips the reference): a click AGAINST a zone block from outside is sent', async () => {
  await withMutant('buildbot.mjs', "  for (const [cell, role] of [[ref, 'ref'], [dest, 'dest'], [{ x: dest.x, y: dest.y + 1, z: dest.z }, 'above']]) {", "  for (const [cell, role] of [[dest, 'dest'], [{ x: dest.x, y: dest.y + 1, z: dest.z }, 'above']]) {", async M => {
    assert.strictEqual(M.clickZone(GUARD_ZONES, [49, 65, 0], [-1, 0, 0]), null)
  })
})

const fakeClient = () => { const c = new EventEmitter(); c.sent = []; c.write = (name, d) => { c.sent.push([name, d]) }; return c }
const fakeBot = (client, zones) => Object.assign(new EventEmitter(), { _client: client, entity: { position: { x: 40, y: 66, z: -25 }, pitch: 0, yaw: 0, onGround: true }, blockAt: () => null,
  inventory: { items: () => [] }, players: {}, ...(zones === undefined ? {} : { protectZones: zones }) })
const effects = (M, zones) => { const c = fakeClient(), logs = [], e = M.botBuildEffects(fakeBot(c, zones), { log: (k, d) => logs.push([k, d]) }); return { c, e, logs, places: () => c.sent.filter(([n]) => n === 'block_place') } }
await t('THE ADAPTER (botBuildEffects.send): a click into the zone writes NO packet and answers false; one row says so', () => {
  const { e, places, logs } = effects(BB, () => GUARD_ZONES)
  try {
    assert.strictEqual(e.send([58, 64, -25], [0, 1, 0], 7), false)
    assert.strictEqual(places().length, 0, 'nothing reached the server')
    assert.deepStrictEqual(logs.map(([k, d]) => [k, d.op, d.cell]), [['_build', 'click_zoned', [58, 65, -25]]])
    assert.ok(/village-taiga-6_1/.test(logs[0][1].why))
    assert.strictEqual(e.placeClosed([58, 65, -25]), VILLAGE.id); assert.strictEqual(e.placeClosed([40, 65, -25]), null)
  } finally { e.close() }
})
await t('POSITIVE CONTROL: the same click outside the zone is written (one block_place, its sequence) and answers true', () => {
  const { e, places } = effects(BB, () => GUARD_ZONES)
  try {
    assert.strictEqual(e.send([40, 64, -25], [0, 1, 0], 8), true)
    assert.strictEqual(places().length, 1); assert.strictEqual(places()[0][1].sequence, 8)
  } finally { e.close() }
})
await t('a zone list that cannot be read refuses (nothing sent); a bot with no zone reader at all (no guard installed) clicks as before', () => {
  const bad = effects(BB, () => { throw new Error('unreadable') })
  try { assert.strictEqual(bad.e.send([40, 64, -25], [0, 1, 0], 9), false); assert.strictEqual(bad.places().length, 0); assert.strictEqual(bad.e.placeClosed([40, 65, -25]), 'zones_unread') } finally { bad.e.close() }
  const none = effects(BB, undefined)
  try { assert.strictEqual(none.e.send([58, 64, -25], [0, 1, 0], 10), true); assert.strictEqual(none.places().length, 1); assert.strictEqual(none.e.placeClosed([58, 65, -25]), null) } finally { none.e.close() }
})
await t('MUTANT (the adapter\'s send no longer asks): the packet into the zone is written (the test above fails for that reason)', async () => {
  await withMutant('buildbot.mjs', "      if (z) { try { log('_build', { op: 'click_zoned'", "      if (false) { try { log('_build', { op: 'click_zoned'", async M => {
    const { e, places } = effects(M, () => GUARD_ZONES)
    try { assert.strictEqual(e.send([58, 64, -25], [0, 1, 0], 7), true); assert.strictEqual(places().length, 1) } finally { e.close() }
  })
})

console.log('THE VISIT (buildrun.mjs runVisit on the fake server)')
const PAD = SITE.record.cells.filter(c => c.seg === 'pad')
const SHUT = PAD[30].at
async function visit (M, { placeClosed = null, sendFalse = null, maxSteps = 400 } = {}) {
  const srv = server(), pr = project(SITE.record)
  const h = PJ.recordHead(pr.dir, pr.key)
  const e = bot(srv, 'A')
  const walks = [], sends = [], waited = [], seqOf = new Map()
  const w0 = e.walkTo; e.walkTo = async (s, o) => { walks.push(s.slice()); return w0(s, o) }
  const s0 = e.send
  e.send = (support, face, seq, aim) => {
    const target = support.map((v, i) => v + face[i])
    if (sendFalse?.(target)) { seqOf.set(seq, k3(target)); return false }
    sends.push(k3(target)); return s0(support, face, seq, aim)
  }
  const a0 = e.waitAck; e.waitAck = (seq, ms) => { waited.push(seq); return a0(seq, ms) }
  if (placeClosed) e.placeClosed = placeClosed
  const r = await M.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps })
  return { r, srv, walks, sends, waited, seqOf, logs: e.logs, pr }
}
const closedAt = c => (k3(c) === k3(SHUT) ? VILLAGE.id : null)
await t('POSITIVE CONTROL: with no zone the pad cell is built like every other', async () => {
  const { r, srv, sends } = await visit(R)
  assert.strictEqual(srv.read(...SHUT).name === 'air', false, 'the cell holds its block'); assert.ok(sends.includes(k3(SHUT))); assert.ok(r.placed > 20, `placed ${r.placed}`)
  assert.strictEqual(r.zonedPlace, undefined)
})
await t('a cell the zone guard closes is never clicked and never built; it is named ONCE; the visit builds the rest', async () => {
  const { r, srv, sends, logs } = await visit(R, { placeClosed: closedAt })
  assert.strictEqual(srv.read(...SHUT).name, 'air', 'nothing stands in the closed cell')
  assert.ok(!sends.includes(k3(SHUT)), 'no click was sent for it')
  assert.ok(r.zonedPlace >= 1, `counted (${r.zonedPlace})`); assert.ok(r.placed > 20, `the rest is built (${r.placed})`)
  const rows = logs.filter(([k, d]) => k === '_build' && d.op === 'place_zoned')
  assert.strictEqual(rows.length, 1, 'one row a visit'); assert.deepStrictEqual(rows[0][1].cell, SHUT); assert.ok(/village-taiga-6_1/.test(rows[0][1].why))
  assert.ok(!PAD.filter(c => k3(c.at) !== k3(SHUT)).some(c => srv.read(...c.at).name === 'air'), 'every other pad cell stands')
})
await t('...and no walk is spent on it: the visit with the closed cell walks no more than the visit without it', async () => {
  const a = await visit(R), b = await visit(R, { placeClosed: closedAt })
  assert.ok(b.walks.length <= a.walks.length, `${b.walks.length} walks with the closed cell, ${a.walks.length} without`)
})
await t('MUTANT (buildrun.mjs click no longer asks before the walk): the closed cell is clicked and built', async () => {
  await withMutant('buildrun.mjs', "      if (z) {\n        out.zonedPlace = (out.zonedPlace ?? 0) + 1", "      if (false) {\n        out.zonedPlace = (out.zonedPlace ?? 0) + 1", async M => {
    const { srv, sends } = await visit(M, { placeClosed: closedAt })
    assert.ok(sends.includes(k3(SHUT))); assert.notStrictEqual(srv.read(...SHUT).name, 'air')
  })
})
await t('THE BACKSTOP: a send the adapter refuses (false) books no click -- no acknowledgement is waited for, the cell stays empty, the rest is built', async () => {
  const { r, srv, waited, seqOf } = await visit(R, { sendFalse: tgt => k3(tgt) === k3(SHUT) })
  assert.ok(seqOf.size >= 1, 'the refused send happened')
  assert.strictEqual(srv.read(...SHUT).name, 'air')
  assert.ok(![...seqOf.keys()].some(q => waited.includes(q)), 'nothing waited on a click that was never sent')
  assert.ok(r.placed > 20, `the rest is built (${r.placed})`)
})
await t('MUTANT (the click ignores the adapter\'s false): it waits for an acknowledgement that cannot come', async () => {
  await withMutant('buildrun.mjs', "        if (e.send(here.support, here.face, seq, here.aim ?? null) === false) { cancel(); return 'zoned' }", '        e.send(here.support, here.face, seq, here.aim ?? null)', async M => {
    const { waited, seqOf } = await visit(M, { sendFalse: tgt => k3(tgt) === k3(SHUT), maxSteps: 60 })
    assert.ok([...seqOf.keys()].some(q => waited.includes(q)), 'the mutant waits on the unsent click')
  })
})

console.log('THE RECORD (sinks.mjs zonedInstance / dropInstance)')
const t1 = siteTower(S, [])
const rec1 = S.completeInstance(S.appendInstance(null, { kind: 'tower', home: HOME, inst: t1.inst, meta: { ...t1.meta, sitedBy: 'A' }, now: 1000 }), 2000)
const t2 = S.siteSink(server().read, { kind: 'tower', n: 2, id: 'T2', home: HOME, pool: 'test', avail: AVAIL, torch: true, stood: [], rec: rec1,
  guard: (x, z, y0, y1) => S.zoneReason(SH.recordZones([rec1]), x, z, y0, y1) })
assert.ok(t1.ok && t2.ok && rec1.structure_complete, 'two towers on the flat world')
const rec2 = S.appendInstance(rec1, { kind: 'tower', home: HOME, inst: t2.inst, meta: { ...t2.meta, sitedBy: 'B' }, now: 3000 })
const t2x = Math.min(...t2.inst.cells.map(c => c.at[0])), t2X = Math.max(...t2.inst.cells.map(c => c.at[0]))
const inT2 = at => (S.instanceCells(rec2, 'T2').some(c => k3(c.at) === k3(at)) ? VILLAGE.id : null)
await t('the fixture is the live shape: T1 stands, T2 is open, their cells are apart (segments T1-..., T2-...)', () => {
  assert.strictEqual(rec2.structure_complete, false); assert.strictEqual(S.instancesOf(rec2).length, 2)
  assert.strictEqual(S.instanceCells(rec2, 'T1').length, t1.inst.cells.length); assert.strictEqual(S.instanceCells(rec2, 'T2').length, t2.inst.cells.length)
  assert.strictEqual(rec2.cells.length, t1.inst.cells.length + t2.inst.cells.length)
  assert.ok(t2x <= t2X)
})
await t('zonedInstance: the OPEN instance with cells the guard closes is named, with how many; none closed: null', () => {
  const z = S.zonedInstance(rec2, inT2)
  assert.deepStrictEqual([z.id, z.zone, z.n, z.cells], ['T2', VILLAGE.id, t2.inst.cells.length, t2.inst.cells.length]); assert.ok(Array.isArray(z.first))
  const part = S.zonedInstance(rec2, at => (at[0] === t2X ? 'edge' : null))
  assert.ok(part.n > 0 && part.n < part.cells, `one column of it is enough (${part.n} of ${part.cells})`)
  assert.strictEqual(S.zonedInstance(rec2, () => null), null)
})
await t('a STANDING instance is never retired, whatever the zones say; nor is anything when the zones cannot be asked', () => {
  assert.strictEqual(S.zonedInstance(rec1, () => VILLAGE.id), null, 'T1 stands: the record is complete')
  assert.strictEqual(S.zonedInstance(rec2, at => (S.instanceCells(rec2, 'T1').some(c => k3(c.at) === k3(at)) ? 'z' : null)), null, 'only the newest instance is asked')
  assert.strictEqual(S.zonedInstance(rec2, () => { throw new Error('zones unread') }), null)
  assert.strictEqual(S.zonedInstance(null, () => 'z'), null)
})
await t('dropInstance is appendInstance undone: the record is what it was with T1 standing (cells, segments, palette, zones, bill, state)', () => {
  const back = S.dropInstance(rec2, 'T2')
  for (const k of ['instances', 'cells', 'segments', 'palette', 'zones', 'clear', 'replant', 'bom', 'structure_complete', 'state', 'completeAt', 'blueprint', 'plot', 'kind', 'home'])
    assert.deepStrictEqual(back[k], rec1[k], k)
  assert.strictEqual(S.sinkOpen(back), false, 'no open instance: the gate may site the next')
  assert.strictEqual(S.zonedInstance(back, () => VILLAGE.id), null)
  assert.strictEqual(rec2.cells.length, t1.inst.cells.length + t2.inst.cells.length, 'the input record is untouched')
})
await t('it retires only the newest, open instance: not T1 under an open T2, not a standing one, not an id the record does not hold', () => {
  assert.strictEqual(S.dropInstance(rec2, 'T1'), null); assert.strictEqual(S.dropInstance(rec1, 'T1'), null)
  assert.strictEqual(S.dropInstance(rec2, 'T9'), null); assert.strictEqual(S.dropInstance(null, 'T2'), null)
})
await t('the next siting after the retirement is refused the zone and lands outside it (the remedy is reachable: retire, then site again)', () => {
  const back = S.dropInstance(rec2, 'T2')
  const zone = [{ id: VILLAGE.id, box: [t2.meta.box[0] - 3, -64, t2.meta.box[1] - 3, t2.meta.box[2] + 3, 320, t2.meta.box[3] + 3] }]
  const again = S.siteSink(server().read, { kind: 'tower', n: 2, id: 'T2', home: HOME, pool: 'test', avail: AVAIL, torch: true, stood: [], rec: back,
    guard: (x, z, y0, y1) => S.zoneReason([...zone, ...SH.recordZones([back])], x, z, y0, y1) })
  assert.strictEqual(again.ok, true, JSON.stringify(again.tried))
  assert.ok(again.inst.cells.every(c => S.zoneReason(zone, c.at[0], c.at[2], c.at[1], c.at[1]) == null), 'not one cell in the zone')
  assert.notDeepStrictEqual(again.meta.box, t2.meta.box)
})
await t('MUTANT (dropInstance keeps the cells): the record still holds the retired tower\'s cells', async () => {
  await withMutant('sinks.mjs', "    ...cur, instances: rest, cells: (cur.cells ?? []).filter(c => !String(c?.seg ?? '').startsWith(pre)),", '    ...cur, instances: rest, cells: (cur.cells ?? []),', async M => {
    assert.strictEqual(M.dropInstance(rec2, 'T2').cells.length, rec2.cells.length)
  })
})
await t('MUTANT (dropInstance takes any id): a standing tower under an open one is "retired"', async () => {
  await withMutant('sinks.mjs', '!last || String(last.id) !== String(id) || last.completeAt) return null', '!last || last.completeAt) return null', async M => {
    assert.notStrictEqual(M.dropInstance(rec2, 'T1'), null)
  })
})
await t('MUTANT (zonedInstance asks a complete record): a standing tower in a zone would be retired', async () => {
  await withMutant('sinks.mjs', "  if (!rec || rec.structure_complete) return null\n  const ins = instancesOf(rec), last = ins[ins.length - 1]\n  if (!last?.id || last.completeAt) return null", "  if (!rec) return null\n  const ins = instancesOf(rec), last = ins[ins.length - 1]\n  if (!last?.id) return null", async M => {
    assert.notStrictEqual(M.zonedInstance(rec1, () => VILLAGE.id), null)
  })
})

console.log('THE WIRING (skills.mjs, structural: comments stripped, executable lines)')
const SK = strip(readFileSync(SRC('skills.mjs'), 'utf8'))
await t('sinkGuardFor answers a zone hit through zoneReason; the old `find(...)?.why ?? null` over the y range is gone', () => {
  assert.ok(SK.includes('  return (x, z, y0, y1) => res.column(x, z, y0, y1) ?? zoneReason(zs, x, z, y0, y1)\n'))
  assert.ok(!SK.includes('z <= b[5] && y1 >= b[1] && y0 <= b[4] })?.why ?? null)'))
})
await t('buildSink retires a zoned tower or shrine BEFORE the decor work, the gate and the visit; an unwritten retirement ends zone_closed', () => {
  const a = SK.indexOf('async function buildSink (ctx, args, signal, proj) {'), b = SK.indexOf('\nasync function ', a + 10)
  const body = SK.slice(a, b)
  const retire = body.indexOf("    const zi = zonedInstance(rec0, closedAt)"), decor = body.indexOf("  if (kind === 'decor') {"), gate = body.indexOf('sinkNextGate('), run = body.indexOf('runVisit(')
  assert.ok(retire > 0 && decor > retire && gate > retire && run > retire, `${retire} ${decor} ${gate} ${run}`)
  assert.ok(body.includes("  if (rec0 && (kind === 'tower' || kind === 'shrine')) {"))
  assert.ok(body.includes("return z2 ? dropInstance(cur, z2.id) : null"), 'decided again on the record in force, inside the publish')
  assert.ok(body.includes("if (rec0 && zonedInstance(rec0, closedAt)) return out('no_effect', 'zone_closed',"))
  assert.ok(body.includes("    const closedAt = at => cellZone(bot.protectZones?.() ?? [], at)"))
})
await t('the order waits on zone_closed (shop.mjs WAIT_STOPS): the refusal has a remedy and is not asked every decision', () => {
  assert.ok(Object.hasOwn(SH.WAIT_STOPS, 'zone_closed') && SH.WAIT_STOPS.zone_closed > 0)
})

console.log(`\nzonesite: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

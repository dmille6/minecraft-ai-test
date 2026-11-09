// PLANAHEAD-01 (OWNER 11-09 "do 1,2,3": plan the town ahead): the plan-time reach check (planahead.mjs planReach: the town's own walk,
// buildsite.mjs walkFrom / stepFor and buildrun.mjs digStand, worked to a fixed point in a pessimistic planned world), the record's tag,
// the plan waiver (a tag AND a live miss), the helpers' supply, the building stand claims and the planned world a building is proven in.
// Design docs/reports/planahead-design-2026-11-09.md. Behaviour over fake reads; every refusal has its positive control; mutants anchored.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const PA = await import('../src/planahead.mjs')
const B = await import('../src/buildsite.mjs')
const PA_PATH = new URL('../src/planahead.mjs', import.meta.url)
const BS_PATH = new URL('../src/buildsite.mjs', import.meta.url)
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/").replace("new URL('.', import.meta.url)", "new URL('../src/', import.meta.url)"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** BOTH WAYS: the scenario passes on the real module and fails (an assertion) on the mutant. */
async function killedBy (path, real, old, neu, scenario) {
  await scenario(real)
  let why = null
  await withMutant(path, old, neu, async M => { try { await scenario(M) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

const G = 69
const HOME = { x: 0, y: G + 1, z: 0 }
const box = n => mcData.blocksByName[n]?.boundingBox ?? 'block'
/** A fake world: stone below G, grass at G, air above; `cells` "x,y,z" -> name; unknown beyond +-40. */
function world (cells = {}) {
  return (x, y, z) => {
    if (Math.abs(x) > 40 || Math.abs(z) > 40 || y < G - 20 || y > G + 30) return null
    const n = cells[`${x},${y},${z}`] ?? (y < G ? 'stone' : y === G ? 'grass_block' : 'air')
    return { name: n, boundingBox: box(n) }
  }
}
const CTX = { home: HOME, stood: [], walkR: 36 }
/** A sealed stone room around (cx, cz): walls 2..4 out from the centre, G+1..G+6, a stone lid; the inside is air at G+1.. */
function sealed (cx, cz, cells = {}) {
  for (let x = cx - 4; x <= cx + 4; x++) for (let z = cz - 4; z <= cz + 4; z++) {
    const d = Math.max(Math.abs(x - cx), Math.abs(z - cz))
    for (let y = G + 1; y <= G + 7; y++) if (d >= 2 || y === G + 7) cells[`${x},${y},${z}`] = 'stone'
  }
  return cells
}

console.log('THE PLAN-TIME CHECK (planReach)')
await t('open ground: every fill and cut is reached -> proven, nothing tagged; a stack two high is reached in order (the fixed point)', () => {
  const r = PA.planReach(world({ '10,70,10': 'dirt' }), [{ at: [12, 70, 12], role: 'earth' }, { at: [12, 71, 12], role: 'earth' }, { at: [13, 70, 12], role: 'core' }], [[10, 70, 10]], CTX)
  assert.strictEqual(r.state, 'proven')
  assert.deepStrictEqual(r.pu, [])
  assert.deepStrictEqual(r.open, { fills: 3, cuts: 1 })
})
await t('a fill and a cut inside a sealed room no stand reaches are tagged; the same cells on open ground are not (positive control)', () => {
  const read = world({ ...sealed(20, 20), '20,70,21': 'dirt' })
  const r = PA.planReach(read, [{ at: [20, 70, 20], role: 'earth' }, { at: [5, 70, 5], role: 'earth' }], [[20, 70, 21]], CTX)
  assert.strictEqual(r.state, 'proven')
  assert.deepStrictEqual(r.pu.sort(), ['20,70,20', '20,70,21'])
})
await t('the order matters and is found: a cut that opens the room makes its fill reachable (cut first, then the fill)', () => {
  // a 1-wide doorway through the room's wall (x 16..18, y 70..71, z 20) is three cuts deep: once it is dug the fill inside has a stand
  const read = world(sealed(20, 20))
  const r = PA.planReach(read, [{ at: [20, 70, 20], role: 'earth' }], [[16, 70, 20], [16, 71, 20], [17, 70, 20], [17, 71, 20], [18, 70, 20], [18, 71, 20]], CTX)
  assert.strictEqual(r.state, 'proven')
  assert.deepStrictEqual(r.pu, [])
})
await t('the planned world only takes stands away: a planned obstacle ring round a fill tags it; without the ring it is reached', async () => {
  const ring = new Set()
  for (let x = 25; x <= 35; x++) for (let z = 25; z <= 35; z++) { const d = Math.max(Math.abs(x - 30), Math.abs(z - 30)); if (d >= 1 && d <= 5) for (let y = G + 1; y <= G + 3; y++) ring.add(`${x},${y},${z}`) }
  const fills = [{ at: [30, 70, 30], role: 'earth' }]
  assert.deepStrictEqual(PA.planReach(world(), fills, [], CTX).pu, [])
  // the mutant that lets the planned obstacles be floors is caught (the walk would step on top of the ring)
  await killedBy(PA_PATH, PA, '    const block = new Set(pBlock)\n', '    const block = new Set()\n', M => {
    assert.deepStrictEqual(M.planReach(world(), fills, [], { ...CTX, planned: { block: ring, noFloor: new Set() } }).pu, ['30,70,30'])
  })
})
await t('an unfinished search proves nothing: out of passes -> unchecked with NO tags (fail open)', async () => {
  const read = world(sealed(20, 20))
  // the cut-then-fill order needs a second pass; with one pass allowed the search is unfinished
  await killedBy(PA_PATH, PA, "    if (passes >= maxPasses) return { state: 'unchecked', open, pu: [], passes, checked, why: 'passes' }", "    if (passes >= maxPasses) return { state: 'proven', open, pu: [...F.map(f => kOf(f.at)), ...C.map(kOf)], passes, checked }", M => {
    const r = M.planReach(read, [{ at: [20, 70, 20], role: 'earth' }, { at: [20, 71, 20], role: 'earth' }], [[16, 70, 20], [16, 71, 20], [17, 70, 20], [17, 71, 20], [18, 70, 20], [18, 71, 20]], { ...CTX, passes: 1 })
    assert.strictEqual(r.state, 'unchecked')
    assert.deepStrictEqual(r.pu, [])
  })
  const late = PA.planReach(read, [{ at: [20, 70, 20], role: 'earth' }], [], { ...CTX, deadline: () => true })
  assert.strictEqual(late.state, 'unchecked'); assert.deepStrictEqual(late.pu, [])
})
await t('planReachAsync gives the same answer cooperatively and stops on its budget', async () => {
  const read = world({ ...sealed(20, 20), '20,70,21': 'dirt' })
  const r = await PA.planReachAsync(read, [{ at: [20, 70, 20], role: 'earth' }], [[20, 70, 21]], CTX)
  assert.strictEqual(r.state, 'proven'); assert.strictEqual(r.pu.length, 2); assert.ok(Number.isFinite(r.ms))
  const b = await PA.planReachAsync(read, [{ at: [20, 70, 20], role: 'earth' }], [], CTX, { budgetMs: -1 })
  assert.strictEqual(b.state, 'unchecked')
})

console.log('THE TAG, THE PLAN WAIVER, THE SUPPLY')
await t('reachTag: a proven 5% is believed; over 15% is suspect and tags nothing; unchecked tags nothing', async () => {
  const ok = PA.reachTag({ state: 'proven', open: { fills: 95, cuts: 5 }, pu: ['1,2,3', '4,5,6', '7,8,9', '1,1,1', '2,2,2'] })
  assert.strictEqual(ok.state, 'proven'); assert.strictEqual(ok.pu.length, 5)
  await killedBy(PA_PATH, PA, '  if (state === \'proven\' && open > 0 && pu.length / open > suspect) state = \'suspect\'', '  if (false) state = \'suspect\'', M => {
    const sus = M.reachTag({ state: 'proven', open: { fills: 10, cuts: 0 }, pu: ['1,2,3', '4,5,6'] })
    assert.strictEqual(sus.state, 'suspect'); assert.deepStrictEqual(sus.pu, []); assert.strictEqual(M.puKeys({ reach: sus }).size, 0)
  })
  assert.deepStrictEqual(PA.reachTag({ state: 'unchecked', pu: ['1,2,3'] }).pu, [])
})
const REC = { cells: [{ at: [1, 70, 1], role: 'earth' }, { at: [2, 70, 2], role: 'core', opener: [2, 71, 2] }, { at: [3, 70, 3], role: 'earth' }, { at: [4, 70, 4], role: 'earth' }], clear: [], waived: {} }
const tagged = (rec, pu) => ({ ...rec, reach: PA.reachTag({ state: 'proven', open: { fills: 40, cuts: 0 }, pu }) })
await t('puWaiveDue: only a TAGGED cell the visit ALSO missed; never an opener fill, never one waived; a plan tag alone waives nothing', async () => {
  const rec = tagged(REC, ['1,70,1', '2,70,2', '4,70,4'])
  await killedBy(PA_PATH, PA, '    if (!pu.has(k) || !waivable.has(k)', '    if (!waivable.has(k)', M => {
    assert.deepStrictEqual(M.puWaiveDue(rec, ['1,70,1', '2,70,2', '3,70,3'], { P: { ...M.PA, share: 1 } }).map(d => d.k), ['1,70,1'])
  })
  assert.deepStrictEqual(PA.puWaiveDue(rec, []), [], 'no live miss: nothing')
  assert.deepStrictEqual(PA.puWaiveDue({ ...rec, waived: { '1,70,1': {} } }, ['1,70,1', '4,70,4'], { P: { ...PA.PA, share: 1 } }).map(d => d.k), ['4,70,4'])
  assert.deepStrictEqual(PA.puWaiveDue(REC, ['1,70,1']), [], 'an untagged record: nothing')
  assert.deepStrictEqual(PA.puWaiveDue({ ...tagged(REC, ['8,69,8']), cut: [{ at: [8, 69, 8] }] }, ['8,69,8'], { P: { ...PA.PA, share: 1 } }), [], 'a tagged CUT is never waived (no done rule reads it)')
  assert.strictEqual(PA.puWaiveDue(rec, ['1,70,1'])[0].why, 'plan_unreach')
})
await t('puWaiveDue shares the stage\'s waiver room (a quarter of cells + clears, less what is waived and what this visit waives)', () => {
  const rec = tagged(REC, ['1,70,1', '3,70,3', '4,70,4'])   // 4 cells: room ceil(1) = 1
  assert.strictEqual(PA.puWaiveDue(rec, ['1,70,1', '3,70,3', '4,70,4']).length, 1)
  assert.strictEqual(PA.puWaiveDue(rec, ['1,70,1', '3,70,3'], { already: [{ k: '9,9,9' }] }).length, 0)
})
await t('puSupply: a helper\'s view drops exactly the tagged cells, cuts and clears; an untagged record is unchanged', () => {
  const rec = tagged({ ...REC, cut: [{ at: [5, 70, 5] }, { at: [6, 70, 6] }] }, ['1,70,1', '6,70,6'])
  const v = PA.puSupply(rec)
  assert.deepStrictEqual(v.cells.map(c => c.at.join(',')), ['2,70,2', '3,70,3', '4,70,4'])
  assert.deepStrictEqual(v.cut.map(c => c.at.join(',')), ['5,70,5'])
  assert.strictEqual(PA.puSupply(REC), REC)
  assert.strictEqual(PA.supplyOf(rec, ['1,70,1', '2,70,2']), '2/1')
})

console.log('THE STAND CLAIMS')
const HALL = { plot: 'townhall', structure_complete: false, cells: [{ at: [30, 71, 30], role: 'wall', stand: [28, 70, 30] }, { at: [31, 71, 30], role: 'wall', stand: [29, 70, 30] }], waived: { '31,71,30': {} } }
await t('standClaims: an open building\'s proof stands (feet, head, floor); a waived cell\'s stand and a complete building claim nothing', () => {
  const c = PA.standClaims([HALL])
  assert.deepStrictEqual([...c.feet.keys()].sort(), ['28,70,30', '28,71,30'])
  assert.deepStrictEqual([...c.floor.keys()], ['28,69,30'])
  assert.strictEqual(PA.standClaims([{ ...HALL, structure_complete: true }]).feet.size, 0)
  assert.strictEqual(PA.standClaims([{ ...HALL, plot: 'tidy' }]).feet.size, 0, 'a soft plot claims nothing')
})
await t('standRetire: a tidy fill on a claimed stand and a cut of its floor LEAVE the record (never left open to wait on); others stay', async () => {
  const tidy = { plot: 'tidy', cells: [{ at: [28, 70, 30], role: 'earth', seg: 'T-1' }, { at: [10, 70, 10], role: 'earth', seg: 'T-2' }], cut: [{ at: [28, 69, 30] }, { at: [11, 69, 11] }], clear: [], segments: [{ seg: 'T-1' }, { seg: 'T-2' }], replant: [{ cell: [28, 70, 30] }] }
  const c = PA.standClaims([HALL])
  await killedBy(PA_PATH, PA, '  const digGone = q => okAt(q?.at) && claims.floor.has(kOf(q.at))', '  const digGone = q => false', M => {
    const nx = M.standRetire(tidy, c)
    assert.deepStrictEqual(nx.cells.map(q => q.at.join(',')), ['10,70,10'])
    assert.deepStrictEqual(nx.cut.map(q => q.at.join(',')), ['11,69,11'])
    assert.deepStrictEqual(nx.segments.map(s => s.seg), ['T-2'])
    assert.deepStrictEqual(nx.standClaimed, { townhall: 2 })
    assert.strictEqual(nx.replant.length, 1, 'a replant owed stays')
  })
  assert.strictEqual(PA.standRetire({ ...tidy, cells: [tidy.cells[1]], cut: [tidy.cut[1]] }, c), null, 'nothing on a stand: no new generation')
  // THE CHAIN (CLAUDE.md: two guards composing into a dead end): the retired stage has no open entry on the claim -- nothing to wait on
  const after = PA.standRetire(tidy, c)
  const open = [...after.cells, ...after.cut].filter(q => c.feet.has(q.at.join(',')) || c.floor.has(q.at.join(',')))
  assert.strictEqual(open.length, 0)
})
await t('standConflicts: a candidate\'s solid cell or fill on a claimed stand, or a clear of its floor, conflicts; a light does not', () => {
  const c = PA.standClaims([HALL])
  assert.deepStrictEqual(PA.standConflicts({ fill: [], clear: [] }, [{ at: [28, 71, 30], role: 'wall' }], c)?.kind, 'feet')
  assert.strictEqual(PA.standConflicts({ fill: [], clear: [] }, [{ at: [28, 71, 30], role: 'light' }], c), null)
  assert.strictEqual(PA.standConflicts({ fill: [[28, 70, 30]], clear: [] }, [], c)?.kind, 'feet')
  assert.strictEqual(PA.standConflicts({ fill: [], clear: [{ at: [28, 69, 30] }] }, [], c)?.kind, 'floor')
  assert.strictEqual(PA.standConflicts({ fill: [], clear: [] }, [{ at: [5, 71, 5], role: 'wall' }], c), null)
})
await t('plannedWorld: other open hard records\' unfinished solid cells block and their standing clears are no floor; soft, complete, self, done and lights add nothing', () => {
  const done = (r, c) => c.at[0] === 41
  const recs = [
    { plot: 'tower', cells: [{ at: [40, 70, 40], role: 'T1-core' }, { at: [41, 70, 40], role: 'T1-core' }, { at: [42, 70, 40], role: 'T3-light' }], clear: [{ at: [43, 69, 40] }], fill: [[44, 70, 40], [41, 69, 40]] },
    { plot: 'tidy', cells: [{ at: [50, 70, 50], role: 'earth' }] },
    { plot: 'hall', structure_complete: true, cells: [{ at: [60, 70, 60], role: 'wall' }] },
    { plot: 'cottage1', cells: [{ at: [70, 70, 70], role: 'wall' }] },
  ]
  const w = PA.plannedWorld(recs, { self: 'cottage1', done })
  assert.deepStrictEqual([...w.block].sort(), ['40,70,40', '44,70,40'])
  assert.deepStrictEqual([...w.noFloor], ['43,69,40'])
})

console.log('A BUILDING PROVEN IN THE PLANNED TOWN (buildsite.mjs proveSite / siteBlueprint)')
const plan = () => ({ v: 1, template: 'ring@1', gen: 3, prev: 2, home: HOME, s: G, mode: 'retrofit', at: 1, world: 'w',
  plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], y: G, state: 'existing', keepout: false }, { id: 'pavilion', kind: 'pavilion', sector: 'E', state: 'planned' }],
  paths: [], groups: {}, transitions: [] })
const BP = B.loadBlueprint('workshop@1')
const flat = (x, y, z) => (Math.abs(x) > 60 || Math.abs(z) > 60 || y < G - 20 || y > G + 30 ? null : y < G ? { name: 'stone', boundingBox: 'block' } : y === G ? { name: 'grass_block', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
const FLAT = B.siteBlueprint(flat, plan(), BP, { tries: 3 })
await t('positive control: the workshop sites on flat ground; a planned wall round the whole town walk fails its proof (no stand left)', async () => {
  assert.ok(FLAT.ok, `the flat site: ${FLAT.why}`)
  const site = { anchor: { x: FLAT.record.anchor[0], z: FLAT.record.anchor[1] }, orient: FLAT.record.orient, s: FLAT.record.s, fill: [], clear: [] }
  assert.strictEqual(B.proveSite(flat, HOME, BP, site).ok, true)
  // every walkable cell beyond the plaza is a planned obstacle: no stand reaches the pad
  const block = new Set()
  for (let x = -48; x <= 48; x++) for (let z = -48; z <= 48; z++) if (Math.max(Math.abs(x), Math.abs(z)) > 8) block.add(`${x},${G + 1},${z}`)
  await killedBy(BS_PATH, B, '  const pBlock = planned?.block instanceof Set ? planned.block : null,', '  const pBlock = null,', M => {
    assert.strictEqual(M.proveSite(flat, HOME, BP, site, { planned: { block, noFloor: new Set() } }).ok, false)
  })
})
await t('siteBlueprint: a candidate the stand check refuses is not proven (stand_claimed) and the search moves on; none refused -> the same site', async () => {
  const all = B.siteBlueprint(flat, plan(), BP, { tries: 3, standCheck: () => ({ plot: 'townhall', at: [0, 0, 0], kind: 'feet' }) })
  assert.strictEqual(all.ok, false)
  assert.ok(all.sectors.some(r => r.proofFails?.stand_claimed > 0), JSON.stringify(all.sectors.map(r => r.proofFails)))
  const first = `${FLAT.record.anchor}|${FLAT.record.orient}`
  const moved = B.siteBlueprint(flat, plan(), BP, { tries: 3, standCheck: site => (`${site.anchor.x},${site.anchor.z}|${site.orient}` === first ? { plot: 'townhall', at: [0, 0, 0], kind: 'feet' } : null) })
  assert.ok(moved.ok, 'the next candidate is proven')
  assert.notStrictEqual(`${moved.record.anchor}|${moved.record.orient}`, first)
  assert.deepStrictEqual(B.siteBlueprint(flat, plan(), BP, { tries: 3, standCheck: () => null }).record.anchor, FLAT.record.anchor)
})

console.log('THE WIRING (skills.mjs; structural: a cut line fails)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const WIRES = [
  'body\\.reach = await tidyReachTag\\(bot, body, home, stood, signal\\)',
  "puWaiveDue\\(rec, \\(r\\.deferred \\?\\? \\[\\]\\)\\.map\\(d => d\\?\\.k \\?\\? d\\), \\{ already: waive1 \\}\\)",
  "puWaiveDue\\(rw, left, \\{ already: due0 \\}\\)",
  "if \\(PLANAHEAD_ON && GROUNDS\\.on && role === 'helper'\\) visitRec = puSupply\\(visitRec\\)",
  'standRetire\\(cur, sc\\)',
  'plot: TOWNHALL_PLOT, \\.\\.\\.paSiteCtx\\(prd, TOWNHALL_PLOT\\)',
  'plot: COTTAGE_PLOT, \\.\\.\\.paSiteCtx\\(prd, COTTAGE_PLOT\\)',
  'plot: ENCHANT_PLOT, \\.\\.\\.paSiteCtx\\(planReader\\(bot\\), ENCHANT_PLOT\\)',
]
const wired = s => { for (const re of WIRES) { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) } }
await t('the stage publish tags reach, both waivers take the plan tag, helpers get the supply, the stands retire, three sitings plan ahead; a cut line fails', () => {
  wired(SK)
  const cut = 'if (PLANAHEAD_ON && GROUNDS.on && role === \'helper\') visitRec = puSupply(visitRec)'
  assert.ok(SK.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wired(SK.replace(cut, '')), assert.AssertionError)
  // the tag is set BEFORE the record is published (the publish reads `body`)
  const tagAt = SK.search(/body\.reach = await tidyReachTag/), pubAt = SK.slice(tagAt).search(/const pub = publishRecord\(dir, key, cur => \(fresh\(cur\)/)
  assert.ok(tagAt > 0 && pubAt > 0 && pubAt < 4000, `tag ${tagAt}, then the stage publish ${pubAt} chars on`)
})

console.log('THE SWITCH')
await t('PLANAHEAD=off|0|false|no is off; unset is on', () => {
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(PA.planaheadOn({ PLANAHEAD: v }), false)
  assert.strictEqual(PA.planaheadOn({}), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

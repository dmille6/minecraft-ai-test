// STANDREPLAY (bots/scripts/standreplay-offline.mjs; stepclass-01 / civicvisit-01show): the acceptance check for stuck cells -- the
// bots' own stand search (buildsite.mjs walkFrom + stepFor + stepRefusal) over a block dump. Its CORE (replayStands, replayLines,
// visitRule) on a tiny synthetic dump BUILT HERE (scripts/host/townplan_blockdump.py's shape, read by buildsite-offline.mjs
// dumpReader): one cell a class and a fix, the two live landmarks' shape before (CIVICVISIT=off) and after, the output's exact lines.
// Anchored mutants of the script (each anchor present and unique).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dumpReader } from '../scripts/buildsite-offline.mjs'
const SR = await import('../scripts/standreplay-offline.mjs')
const SCRIPT = new URL('../scripts/standreplay-offline.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** A mutant of the script (its anchor present and unique), imported from the test directory (its imports pointed back). */
async function withMutant (old, neu, fn) {
  const src = readFileSync(SCRIPT, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-standreplay-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../scripts/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const kills = async (old, neu, scenario) => {
  await scenario(SR)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

// ---- the dump: 81 x 81 columns round home, y 60..80; stone to 68, grass at 69, air above; then the scene's blocks -------------------
const G = 69, HOME = { x: 0, y: G + 1, z: 0 }
const BOX = [-40, -40, 40, 40], Y = [60, 80], PALETTE = ['?', 'air', 'stone', 'grass_block', 'water']
function dumpOf (blocks = {}) {
  const nx = BOX[2] - BOX[0] + 1, nz = BOX[3] - BOX[1] + 1, ny = Y[1] - Y[0] + 1
  const cells = new Uint8Array(nx * nz * ny)
  for (let y = Y[0]; y <= Y[1]; y++) for (let z = BOX[1]; z <= BOX[3]; z++) for (let x = BOX[0]; x <= BOX[2]; x++) {
    const name = blocks[`${x},${y},${z}`] ?? (y < G ? 'stone' : y === G ? 'grass_block' : 'air')
    cells[((y - Y[0]) * nz + (z - BOX[1])) * nx + (x - BOX[0])] = PALETTE.indexOf(name)
  }
  return { box: BOX, y: Y, palette: PALETTE, bits: 8, cells: Buffer.from(cells).toString('base64'), missing: [] }
}
const SCENE = {}
// a pillar 7 high (a cell on it is out of every ground eye's reach) and an island one block wide in a 13 x 13 pond
for (let y = G + 1; y <= G + 7; y++) SCENE[`-30,${y},10`] = 'stone'
for (let x = -31; x <= -19; x++) for (let z = -31; z <= -19; z++) SCENE[`${x},${G},${z}`] = 'water'
SCENE[`-25,${G},-25`] = 'stone'
const READ = dumpReader(dumpOf(SCENE))
const INPUT = () => ({
  stood: [[1, G + 1, 1], [2, G + 1, 0]],
  projects: {
    // the grounds: visited with stands anywhere (named in --any)
    tidy: { waived: 3, cells: [
      { c: [25, G + 1, 25], visits: 3 },                            // on the ground: a stand
      { c: [5, G, 30], visits: 4 },                                 // already a block: the stuck file is stale
      { c: [20, G + 3, -20], visits: 5 }, { c: [20, G + 4, -20], visits: 5 },   // two in the air, one on the other
      { c: [-30, G + 8, 10], visits: 9 },                           // on the pillar
      { c: [-25, G + 1, -25], visits: 3 },                          // on the island
    ] },
    // a landmark as the showcase holds civicH (no stand spec): two pad cells within 20 of home
    civicH: { blueprint: 'civic@1-Hl', box: [8, 14, 12, 18], walkR: 64, waived: 0, cells: [{ c: [10, G + 1, 16], visits: 7, role: 'floor', seg: 'base' }, { c: [9, G + 1, 15], visits: 7 }] },
    none: { box: [0, 0, 1, 1], cells: [] },
  },
})
const withEnv = (k, v, fn) => { const was = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; try { return fn() } finally { if (was == null) delete process.env[k]; else process.env[k] = was } }
const run = (M, opts = {}) => withEnv('CIVICVISIT', opts.civic ?? null, () => M.replayLines(M.replayStands(READ, HOME, INPUT(), { any: ['tidy'], ...opts }), { ex: opts.ex ?? 3 }))

await t('the dump reads as the scene (the reader is buildsite-offline.mjs\'s own): ground, air, the pillar, the pond, unknown outside', () => {
  assert.deepStrictEqual(READ(0, G, 0), { name: 'grass_block', boundingBox: 'block' }); assert.strictEqual(READ(0, G + 1, 0).boundingBox, 'empty')
  assert.strictEqual(READ(-30, G + 7, 10).name, 'stone'); assert.strictEqual(READ(-20, G, -20).name, 'water'); assert.strictEqual(READ(-25, G, -25).name, 'stone')
  assert.strictEqual(READ(41, G, 0), null); assert.strictEqual(READ(0, 81, 0), null)
})
const AFTER = [
  'project civicH cells=2 box=8,14,12,18 waived=0 domain=record walkR=64',
  'civicH class has_step 2 e.g. 9,70,15 | 10,70,16',
  'civicH fix none_needed 2 e.g. 9,70,15 | 10,70,16',
  'civicH stuck 0 of 2',
  'project tidy cells=6 box=- waived=3 domain=any walkR=48',
  'tidy class stale 1 e.g. 5,69,30',
  'tidy class has_step 1 e.g. 25,70,25',
  'tidy class no_support 2 e.g. 20,72,-20 | 20,73,-20',
  'tidy class no_node 1 e.g. -25,70,-25',
  'tidy class out_of_reach 1 e.g. -30,77,10',
  'tidy fix stale 1 e.g. 5,69,30',
  'tidy fix none_needed 1 e.g. 25,70,25',
  'tidy fix rests_on_stuck 1 e.g. 20,73,-20',
  'tidy fix no_support 1 e.g. 20,72,-20',
  'tidy fix no_walk 1 e.g. -25,70,-25',
  'tidy fix raise_4_10 1 e.g. -30,77,10',
  'tidy stuck 4 of 6',
]
const BEFORE = ['project civicH cells=2 box=8,14,12,18 waived=0 domain=ring walkR=48', 'civicH class out_of_domain 2 e.g. 9,70,15 | 10,70,16', 'civicH fix ring_off 2 e.g. 9,70,15 | 10,70,16', 'civicH stuck 2 of 2']
const whole = M => {
  const lines = run(M)
  assert.match(lines[0], /^standreplay v1 home=0,70,0 mc=1\.21\.8 stood=2 walk48=\d+ walk96=\d+$/)
  const [, near, far] = /walk48=(\d+) walk96=(\d+)/.exec(lines[0]).map(Number)
  assert.ok(near > 5000 && far === near, `POSITIVE CONTROL: the walk covers the dump (${near} stand cells; no more ground beyond 40)`)
  assert.deepStrictEqual(lines.slice(1), AFTER)
}
await t('THE OUTPUT, line for line: a class and a fix for every cell, projects and cells sorted, a project with no cell left out', () => whole(SR))
await t('the same input twice gives the same lines (stable); --ex 0 drops the examples only', () => {
  assert.deepStrictEqual(run(SR), run(SR))
  assert.deepStrictEqual(run(SR, { ex: 0 }).slice(1), AFTER.map(l => l.replace(/ e\.g\. .*$/, '')))
})
const before = M => {
  const lines = run(M, { civic: 'off' })
  assert.deepStrictEqual(lines.slice(1, 5), BEFORE, 'CIVICVISIT=off: the landmark as it was visited (the ring, radius 48): both cells stuck, both freed by the ring alone')
  assert.deepStrictEqual(lines.slice(5), AFTER.slice(4), 'the other project is untouched')
  assert.deepStrictEqual(run(M).slice(1, 5), AFTER.slice(0, 4), 'POSITIVE CONTROL: the switch on, the same cells have their stands')
}
await t('BEFORE AND AFTER civicvisit-01show: with CIVICVISIT=off the landmark\'s cells are `out_of_domain`, fixed by `ring_off`; on, they have stands', () => before(SR))
await t('MUTANT the class asked with stands anywhere: the landmark\'s cells never read out_of_domain', () => kills('const why = stepRefusal(read, home, c.c, nNow, rule.domain, want)', 'const why = stepRefusal(read, home, c.c, nNow, ANY, want)', before))
await t('MUTANT a cell that already holds a block is replayed like any other', () => kills("      if (now && now.boundingBox === 'block') { add(classes, 'stale', c); add(fixes, 'stale', c); continue }\n", '', whole))
await t('MUTANT a cell resting on another stuck cell reads as plain no_support', () => kills("SUP.some(([a, b, d]) => block.has(k3(cx + a, cy + b, cz + d))) ? 'rests_on_stuck' : 'no_support'", "'no_support'", whole))
await t('MUTANT the walkable test dropped: the island reads as enclosed', () => kills("      if (!near) { add(fixes, 'no_walk', c); continue }\n", '', whole))
const rules = M => {
  const R = (plot, P, o) => { const r = M.visitRule(plot, P, o); return [r.name, r.walkR, r.domain ? [r.domain(0, 0), r.domain(20, 26), r.domain(21, 26)] : null] }
  assert.deepStrictEqual(withEnv('CIVICVISIT', null, () => R('civicH', { blueprint: 'civic@1-Hl', box: [8, 14, 12, 18], walkR: 64 })), ['record', 64, [false, true, false]], 'a landmark: its record\'s domain (the box + 8) and walk radius')
  assert.deepStrictEqual(withEnv('CIVICVISIT', 'off', () => R('civicH', { blueprint: 'civic@1-Hl', box: [8, 14, 12, 18], walkR: 64 })), ['ring', 48, null], 'CIVICVISIT=off: as it was visited')
  assert.deepStrictEqual(R('tidy', {}, { any: ['tidy'] }), ['any', 48, [true, true, true]]); assert.deepStrictEqual(R('tidy', { domain: 'any', visitWalkR: 72 }), ['any', 72, [true, true, true]])
  assert.deepStrictEqual(R('wall', {}, { any: ['tidy'], radius: 56 }), ['ring', 56, null], 'a plot nobody names: the workshop ring and --radius')
  assert.deepStrictEqual(R('cottage1', { blueprint: 'cottage@1s', box: [0, 0, 8, 8], walkR: 90 })[0], 'record', 'a cottage: its own visit options (cottage.mjs)')
}
await t('the rule a project is replayed under: the record\'s own visit options, `any` where named, else the ring and --radius', () => rules(SR))
await t('MUTANT the record\'s options never asked: a landmark is replayed under the ring', () => kills("    if (typeof o?.domain === 'function') return {", '    if (false) return {', rules))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

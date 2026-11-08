// STUCKFLEET-02 (bots/src/stuckfleet.mjs orphanWaiveDue; skills.mjs the tidy visit's waiver). LIVE board-c tidy 11-08 (stuck since
// 10:14Z): core 372,66,152 sits over two WAIVED cells of its pit column; the region read has every neighbour open, so no stand can
// place it, and the stage's 12 of 36 waived cells are past gkwork's stall share (9). The fixture is the live record (g69) and the
// region read round its cells. Behaviour, the refusal chain, the controls, anchored mutants.
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/stuckfleet.mjs')
const { stallWaive } = await import('../src/gkwork.mjs')
const SF_PATH = new URL('../src/stuckfleet.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (old, neu, fn) {
  const src = readFileSync(SF_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/stuckfleet02-boardc.json', import.meta.url), 'utf8'))
const OPEN = /^(air|cave_air|short_grass|tall_grass|fern|torch|ladder|snow|[a-z_]+_sapling)$/
const worldRead = (over = {}) => (x, y, z) => { const k = `${x},${y},${z}`; const n = k in over ? over[k] : F.world[k]; return n == null ? null : { name: n, boundingBox: OPEN.test(n) ? 'empty' : 'block' } }
const CELL = '372,66,152'
const deferred = [{ k: CELL, why: 'no_stand', visits: 26 }]

console.log('THE LIVE CASE (board-c g69 + its region read)')
await t('CONTROLS: the stall waiver refuses (share spent 12/36 > 9) and the light waiver has no light -- the live dead end', () => {
  assert.strictEqual(Object.keys(F.record.waived).length, 12)
  assert.deepStrictEqual(stallWaive(F.record, deferred, { stalled: true }), [])
  assert.deepStrictEqual(S.lightWaiveDue(F.record, deferred), [])
  assert.ok('372,64,152' in F.record.waived && '372,65,152' in F.record.waived, 'its support is waived')
  assert.strictEqual(S.hasFace(worldRead(), [372, 66, 152]), false, 'no face to click')
})
await t('orphanWaiveDue: the cell is waived `orphan`; the earth over it keeps its side face (371,67,152 grass) and stays work', () => {
  const out = S.orphanWaiveDue(F.record, deferred, worldRead())
  assert.deepStrictEqual(out.map(o => o.k), [CELL])
  assert.match(out[0].why, /^orphan:below_waived/)
  assert.strictEqual(S.hasFace(worldRead(), [372, 67, 152], k => k === CELL), true)
})
await t('THE CHAIN: after the waiver the stage holds only cells with a face (the next segment is placeable), within half the stage', () => {
  const rec = { ...F.record, waived: { ...F.record.waived, [CELL]: { why: 'orphan' } } }
  const read = worldRead()
  const open = rec.cells.filter(c => !(c.at.join(',') in rec.waived) && read(...c.at)?.boundingBox !== 'block')
  assert.deepStrictEqual(open.map(c => c.at.join(',')), ['372,67,152'])
  assert.ok(open.every(c => S.hasFace(read, c.at, k => k in rec.waived)), 'every open cell can be clicked')
  assert.ok(Object.keys(rec.waived).length <= Math.floor(S.ORPHAN_CEIL * rec.cells.length))
})

console.log('THE REFUSALS')
await t('POSITIVE CONTROL: the same cell over a support NOT waived is never an orphan (an ordinary fill: built from below)', () => {
  const w = { ...F.record.waived }; delete w['372,65,152']
  assert.deepStrictEqual(S.orphanWaiveDue({ ...F.record, waived: w }, deferred, worldRead()), [])
})
await t('Codex r1 BLOCKER: a WAIVED support that holds a block is a face -- never an orphan (a waiver removes nothing)', () => {
  assert.deepStrictEqual(S.orphanWaiveDue(F.record, deferred, worldRead({ '372,65,152': 'cobblestone' })), [])
})
await t('a solid side face: no orphan (a stand may still place it)', () => {
  assert.deepStrictEqual(S.orphanWaiveDue(F.record, deferred, worldRead({ '373,66,152': 'stone' })), [])
})
await t('an UNREAD neighbour counts as solid: never waived on no evidence', () => {
  assert.deepStrictEqual(S.orphanWaiveDue(F.record, deferred, worldRead({ '371,66,152': null })), [])
})
await t('the cell itself not open (built meanwhile), too few visits, a light, or not a record cell: never', () => {
  assert.deepStrictEqual(S.orphanWaiveDue(F.record, deferred, worldRead({ [CELL]: 'dirt' })), [])
  assert.deepStrictEqual(S.orphanWaiveDue(F.record, [{ k: CELL, visits: 1 }], worldRead()), [])
  const lit = { ...F.record, cells: F.record.cells.map(c => (c.at.join(',') === CELL ? { ...c, role: 'light' } : c)) }
  assert.deepStrictEqual(S.orphanWaiveDue(lit, deferred, worldRead()), [])
  assert.deepStrictEqual(S.orphanWaiveDue(F.record, [{ k: '1,2,3', visits: 9 }], worldRead()), [])
})
await t('the ceiling: a stage already half waived waives nothing more; the per-visit bound holds', () => {
  const w = { ...F.record.waived }
  for (const c of F.record.cells) { if (Object.keys(w).length >= 18) break; if (c.at.join(',') !== CELL) w[c.at.join(',')] = { why: 'x' } }
  assert.deepStrictEqual(S.orphanWaiveDue({ ...F.record, waived: w }, deferred, worldRead()), [])
  // a column of 10 orphans: at most ORPHAN_MAX a visit
  const cells = [{ at: [0, 0, 0], role: 'core' }, ...Array.from({ length: 10 }, (_, i) => ({ at: [0, i + 1, 0], role: 'core' })), ...Array.from({ length: 30 }, (_, i) => ({ at: [50, i, 50], role: 'core' }))]
  const out = S.orphanWaiveDue({ cells, waived: { '0,0,0': {} } }, [{ k: '0,1,0', visits: 3 }], () => ({ name: 'air', boundingBox: 'empty' }))
  assert.strictEqual(out.length, S.ORPHAN_MAX)
  assert.deepStrictEqual(out.map(o => o.k), ['0,1,0', '0,2,0', '0,3,0', '0,4,0', '0,5,0', '0,6,0'], 'the orphan and the open column over it')
})
await t('MUTANT: the support test dropped -- the positive control is waived (killed for that reason)', async () => {
  await withMutant('    if (!cells.has(below) || !waived(below) || !isOpen(c.at) || hasFace(read, c.at)) continue\n', '    if (!isOpen(c.at) || hasFace(read, c.at)) continue\n', async M => {
    const w = { ...F.record.waived }; delete w['372,65,152']
    assert.strictEqual(M.orphanWaiveDue({ ...F.record, waived: w }, deferred, worldRead()).length, 1)
  })
})
await t('MUTANT: an unread neighbour read as open -- a cell on no evidence is waived (killed for that reason)', async () => {
  await withMutant("const faceSolid = b => !b || (b.boundingBox === 'block' && !AIRN(nm(b)))", "const faceSolid = b => !!b && (b.boundingBox === 'block' && !AIRN(nm(b)))", async M => {
    assert.strictEqual(M.orphanWaiveDue(F.record, deferred, worldRead({ '371,66,152': null })).length, 1)
  })
})
await t('wired (structural: comments stripped): the tidy visit adds orphanWaiveDue behind STUCKFLEET2, over read2', () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.strictEqual(src.split('const waive = stuckFleet2On() ? [...waive2, ...orphanWaiveDue(rec, r.deferred ?? [], read2).filter(o => !waive2.some(w => w.k === o.k))] : waive2').length, 2)
  assert.strictEqual(S.stuckFleet2On({ STUCKFLEET2: 'off' }), false); assert.strictEqual(S.stuckFleet2On({}), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

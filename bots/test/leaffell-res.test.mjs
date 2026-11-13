// LEAFFELL-01SHOW r2 (Codex r2 BLOCKER): THE TRUNK GUARD'S RESERVATIONS ARE READ STRICTLY (bots/src/skills.mjs reservationFilesStrict;
// buildsite.mjs reservationsStrict / trunkGuard; leaffell.mjs leafFellPlan). The siting's readers answer "none" for a record that is
// absent AND for one that exists and cannot be read (treeFarmCells: an unparseable farm record is an empty farm), so a guard built on
// them let a tree of an unreadable tree farm be felled for a roof leaf it held. Here, over real files in a town directory: an
// unparseable farm record -> nothing felled, the reason named; the same world with a readable record -> the reserved trunk refused as
// reserved, an unreserved trunk felled; the well's files the same way; a mutant. (Its own file: it loads skills.mjs, whose order hooks
// leaffell.test.mjs's order chain must not share.)
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-leafres-logs-'))
process.env.BOT_NAME = 'LeafResBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-leafres-pool-'))
const { withMutant } = await import('./helpers/mutant.mjs')
const { plan } = await import('./helpers/buildfake.mjs')
const B = await import('../src/buildsite.mjs')
const LF = await import('../src/leaffell.mjs')
const SK = await import('../src/skills.mjs')
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const HOME = { x: 0, y: 70, z: 0 }, HK = '0_70_0'
const town = files => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-leafres-town-')); for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(d, n), body); return d }
const farmRec = cells => JSON.stringify({ record: { cells: cells.map(([x, z]) => ({ x, z })) } })
// the tree of leaffell.test.mjs: a spruce rooted at 3,0,0 (logs 3,1..4,0), the unreached leaf at 1,4,0
const LOG = { name: 'spruce_log', boundingBox: 'block' }, LEAF = { name: 'spruce_leaves', boundingBox: 'block', props: { persistent: 'false' } }
const W = { '3,0,0': { name: 'dirt', boundingBox: 'block' }, '3,1,0': LOG, '3,2,0': LOG, '3,3,0': LOG, '3,4,0': LOG, '2,4,0': LEAF, '1,4,0': LEAF }
const read = (x, y, z) => W[`${x},${y},${z}`] ?? { name: 'air', boundingBox: 'empty' }
const CLEAR = [{ at: [1, 4, 0], kind: 'leaves', name: 'spruce_leaves' }]
/** The retrofit's guard as skills.mjs trunkReservations builds it, over one town directory -> { files, sr, pl }. */
function guarded (M, dir) {
  const files = M.reservationFilesStrict(dir, HOME)
  const sr = B.reservationsStrict(plan(), { zonesKnown: true, zones: [], farm: files.farm, wells: files.wells, z0: { ok: true, z0: null } })
  return { files, sr, pl: LF.leafFellPlan(read, CLEAR, [[1, 4, 0]], { closed: B.trunkGuard(sr.res, null, sr.why) }) }
}

console.log('THE FILES, READ STRICTLY')
await t('no record files (and no directory at all): read, empty -- an ABSENT record is no refusal; the unreserved trunk is felled', () => {
  for (const dir of [town({}), path.join(os.tmpdir(), `mcbot-leafres-none-${process.pid}`)]) {
    const g = guarded(SK, dir)
    assert.deepStrictEqual(g.files, { farm: { ok: true, why: null, cells: [] }, wells: { ok: true, why: null, cells: [] } })
    assert.strictEqual(g.pl.ok, true); assert.strictEqual(g.pl.fell.length, 4)
  }
})
await t('CONTROL: a READABLE farm record -- its tree is refused as reserved (the siting\'s word); with the farm elsewhere the same trunk is felled', () => {
  const on = guarded(SK, town({ [`treefarm-${HK}.g2.json`]: farmRec([[3, 0], [5, 0]]) }))
  assert.deepStrictEqual(on.files.farm, { ok: true, why: null, cells: [[3, 0], [5, 0]] })
  assert.strictEqual(on.pl.ok, false); assert.strictEqual(on.pl.blockers[0].why, 'leaf_tree_reserved 3,4,0'); assert.deepStrictEqual(on.pl.fell, [])
  const off = guarded(SK, town({ [`treefarm-${HK}.g2.json`]: farmRec([[40, 40]]) }))
  assert.strictEqual(off.pl.ok, true, 'an unreserved trunk'); assert.strictEqual(off.pl.fell.length, 4)
  // the flat record shape too, and another home's record is not this town's
  assert.deepStrictEqual(SK.reservationFilesStrict(town({ [`treefarm-${HK}.g1.json`]: JSON.stringify({ cells: [{ x: 7, z: 8 }] }) }), HOME).farm.cells, [[7, 8]])
  assert.deepStrictEqual(SK.reservationFilesStrict(town({ 'treefarm-9_70_9.g1.json': '{{{' }), HOME).farm, { ok: true, why: null, cells: [] })
})
await t('THE BLOCKER: the farm\'s record exists and CANNOT BE PARSED -- every trunk is closed, nothing is felled, the row names why (`treefarm_unreadable`)', () => {
  for (const body of ['{"record": {"cells": [{"x": 40', '', 'null', '[1,']) {
    const g = guarded(SK, town({ [`treefarm-${HK}.g3.json`]: body }))
    assert.deepStrictEqual(g.files.farm, { ok: false, why: 'treefarm_unreadable', cells: [] }, JSON.stringify(body))
    assert.deepStrictEqual([g.sr.res, g.sr.why], [null, 'treefarm_unreadable'])
    assert.strictEqual(g.pl.ok, false); assert.deepStrictEqual(g.pl.fell, [], 'nothing felled')
    assert.strictEqual(g.pl.blockers[0].why, 'treefarm_unreadable 3,4,0')
    assert.strictEqual(LF.leafBlockerText(g.pl.blockers[0]), 'treefarm_unreadable:3,4,0 spruce_leaves@1,4,0', 'as the leaf_keep row and the no_site detail carry it')
  }
  // POSITIVE CONTROL: the lenient rule the siting's reader follows would call that farm empty and fell the tree
  const lenient = B.reservations(plan(), { farm: [] })
  assert.strictEqual(LF.leafFellPlan(read, CLEAR, [[1, 4, 0]], { closed: B.trunkGuard(lenient) }).ok, true, 'the defect, shown')
})
await t('a torn NEWEST generation over an older one that parses reads the older record (the lid rule\'s own: skills.mjs treeFarmRecordCells); a directory that cannot be listed is unreadable', () => {
  const g = guarded(SK, town({ [`treefarm-${HK}.g5.json`]: '{"record"', [`treefarm-${HK}.g4.json`]: farmRec([[3, 0]]) }))
  assert.deepStrictEqual(g.files.farm, { ok: true, why: null, cells: [[3, 0]] }); assert.strictEqual(g.pl.blockers[0].why, 'leaf_tree_reserved 3,4,0')
  const eacces = { readdirSync: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e }, readFileSync: fs.readFileSync }
  const f = SK.reservationFilesStrict('/nowhere', HOME, eacces)
  assert.deepStrictEqual([f.farm.why, f.wells.why], ['treefarm_unreadable', 'wells_unreadable'])
})
await t('the junk well\'s files the same way: absent -- nothing; readable -- its site is a reservation; unparseable (the plinth record or the newest site) -- `wells_unreadable`, nothing felled', () => {
  const ok = SK.reservationFilesStrict(town({ [`junkwell-site-${HK}.g2.json`]: JSON.stringify({ x: 3, y: 60, z: 1 }), [`junkwell-site-${HK}.g1.json`]: '{{{' }), HOME)
  assert.deepStrictEqual(ok.wells, { ok: true, why: null, cells: [[3, 60, 1]] }, 'the newest site generation')
  const sr = B.reservationsStrict(plan(), { zonesKnown: true, zones: [], farm: ok.farm, wells: ok.wells, z0: { ok: true, z0: null } })
  assert.strictEqual(LF.leafFellPlan(read, CLEAR, [[1, 4, 0]], { closed: B.trunkGuard(sr.res, null, sr.why) }).blockers[0].why, 'leaf_tree_reserved 3,4,0', 'a trunk within 3 of the well')
  for (const files of [{ [`junkwell-plinth-${HK}.json`]: '{"plan": ' }, { [`junkwell-site-${HK}.g7.json`]: 'nope' }]) {
    const g = guarded(SK, town(files))
    assert.deepStrictEqual(g.files.wells, { ok: false, why: 'wells_unreadable', cells: [] })
    assert.strictEqual(g.pl.blockers[0].why, 'wells_unreadable 3,4,0'); assert.deepStrictEqual(g.pl.fell, [])
  }
})
await t('MUTANT (skills.mjs): an unparseable farm record read as an empty farm (the lenient reader\'s answer) -- its tree is felled (killed for that reason)', async () => {
  await withMutant(SKILLS_URL, "    return bad('treefarm_unreadable')\n  })()\n", "    return { ok: true, why: null, cells: [] }\n  })()\n", async M => {
    const g = guarded(M, town({ [`treefarm-${HK}.g3.json`]: '{"record": {"cells": [{"x": 3' }))
    assert.strictEqual(g.pl.ok, true, 'the mutant fells the tree of a farm it could not read'); assert.strictEqual(g.pl.fell.length, 4)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

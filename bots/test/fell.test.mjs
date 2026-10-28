// FELL-01: a TREE in a project record cell (LIVE 10-27 showcase shop: a spruce in pad cell 25,72,28, trunk 72..76, the pad
// `blocked: 1 open, 0 placeable now` for good) is felled under the segment's lease, its trunk above with it; and no sapling is
// ever planted in a project's columns, while planting keeps a legal cell to go to.
import assert from 'node:assert'
const { R, both, G, k3, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')
const SH = await import('../src/shop.mjs')
const S = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

console.log('FOREIGN KIND AND THE TRUNK (pure)')
await t('foreignKind: scaffold, every log species and leaves are trees, a chest or a station is neither', () => {
  assert.strictEqual(R.foreignKind('dirt'), 'scaffold')
  for (const n of ['spruce_log', 'oak_log', 'dark_oak_log', 'cherry_log', 'mangrove_log', 'spruce_leaves', 'azalea_leaves']) assert.strictEqual(R.foreignKind(n), 'tree', n)
  for (const n of ['chest', 'crafting_table', 'furnace', 'stone_bricks', 'air', null]) assert.strictEqual(R.foreignKind(n), null, String(n))
})
await t('trunkAbove: the contiguous logs above, lowest first; stops at leaves, a kept cell, an unread cell, and TRUNK_MAX', () => {
  const col = { '0,2,0': 'spruce_log', '0,3,0': 'spruce_log', '0,4,0': 'spruce_leaves', '0,5,0': 'spruce_log' }
  const read = (x, y, z) => (y > 50 ? null : { name: col[`${x},${y},${z}`] ?? 'air' })
  assert.deepStrictEqual(R.trunkAbove(read, [0, 1, 0]), [[0, 2, 0], [0, 3, 0]])
  assert.deepStrictEqual(R.trunkAbove(read, [0, 1, 0], { keep: c => c[1] === 3 }), [[0, 2, 0]])
  const tall = (x, y) => (y > 40 ? null : { name: 'oak_log' })
  assert.strictEqual(R.trunkAbove(tall, [0, 0, 0]).length, R.TRUNK_MAX)
  assert.strictEqual(R.trunkAbove(tall, [0, 38, 0]).length, 2, 'an unread cell ends it')
})

console.log('THE VISIT: a spruce in a pad cell')
const pads = () => SITE.record.cells.filter(c => c.seg === 'pad')
const inRec = () => new Set(SITE.record.cells.map(c => k3(c.at)))
// a pad cell with NO record cell above it (the trunk is outside the record: only the felling takes it)
const padCell = () => { const r = inRec(); return pads().find(c => [1, 2, 3, 4, 5, 6].every(i => !r.has(k3([c.at[0], c.at[1] + i, c.at[2]])))) }
// a pad cell under a WALL (the trunk runs through another segment's cells, as the live one did)
const wallPad = () => { const r = inRec(); return pads().find(c => r.has(k3([c.at[0], c.at[1] + 1, c.at[2]]))) }
const tree = async M => {
  const c = padCell(), [x, y, z] = c.at
  const cells = { [k3(c.at)]: 'spruce_log' }
  for (let i = 1; i <= 4; i++) cells[k3([x, y + i, z])] = 'spruce_log'
  cells[k3([x, y + 5, z])] = 'spruce_leaves'
  const srv = server(cells), { p } = project()
  const e = bot(srv, 'A')
  const r = await M.runVisit(p('A'), e, { maxSteps: 4000 })
  assert.notStrictEqual(srv.read(...c.at).name, 'spruce_log', `the pad cell's log is dug (${r.stop} ${r.why})`)
  for (let i = 1; i <= 4; i++) assert.ok(!/_log$/.test(srv.read(x, y + i, z).name), `no trunk log left at +${i} (${r.stop})`)
  assert.strictEqual(r.stop, 'complete', JSON.stringify({ stop: r.stop, why: r.why }))
  const fell = e.logs.find(([k, d]) => k === '_build' && d.op === 'fell')
  assert.ok(fell && fell[1].n === 4, `one fell row, four logs above (${JSON.stringify(fell)})`)
}
await t('the log is dug, the trunk above felled, the leaves in the walls cleared, and the project completes', () => tree(R))
await t('MUTANT trees not foreign (the live bug: blocked forever)', () => both("  if (TREE_CLEAR.test(s)) return 'tree'\n", '', tree))
await t('MUTANT the trunk is not felled', () => both('trunkAbove(rd, f.at, { keep }).map(', '[].map(', tree))
await t('a trunk THROUGH THE WALLS: this segment digs its own cell, the wall segment digs its logs, the project completes', async () => {
  const c = wallPad(), [x, y, z] = c.at
  const cells = { [k3(c.at)]: 'spruce_log' }
  for (let i = 1; i <= 4; i++) cells[k3([x, y + i, z])] = 'spruce_log'
  const srv = server(cells), { p } = project()
  const e = bot(srv, 'A')
  const r = await R.runVisit(p('A'), e, { maxSteps: 4000 })
  for (let i = 0; i <= 4; i++) assert.ok(!/_log$/.test(srv.read(x, y + i, z).name), `no log at +${i}`)
  assert.strictEqual(r.stop, 'complete', JSON.stringify({ stop: r.stop, why: r.why }))
  const fell = e.logs.find(([k, d]) => k === '_build' && d.op === 'fell')
  assert.strictEqual(fell?.[1].n, 0, 'the felling never digs another segment\'s cell')
})
await t('a log the builder cannot dig leaves the cell to its attempts, never an endless loop', async () => {
  const c = padCell()
  const srv = server({ [k3(c.at)]: 'spruce_log' }), { p } = project()
  const e = bot(srv, 'A', { dig: async () => 'refused' })
  const r = await R.runVisit(p('A'), e, { maxSteps: 4000 })
  assert.ok(['blocked', 'attempts_spent'].includes(r.stop), r.stop)
})

await t('a listed clear cell (grass at siting) now holding a log is felled here; a trunk log REPLACED mid-felling is never dug', async () => {
  const c = padCell(), [x, y, z] = c.at
  const rec = { ...SITE.record, clear: [...(SITE.record.clear ?? []), { at: c.at, kind: 'plant', name: 'short_grass' }] }
  const cells = { [k3(c.at)]: 'spruce_log', [k3([x, y + 1, z])]: 'spruce_log', [k3([x, y + 2, z])]: 'spruce_log' }
  const srv = server(cells), { p } = project(rec)
  let digs = 0
  const e = bot(srv, 'A', { dig: async (at, expect) => {
    if (expect && srv.read(...at)?.name !== expect) return 'refused'
    srv.set(at, 'air')
    if (++digs === 2) srv.set([x, y + 2, z], "chest")          // another actor replaces the upper log during the FIRST TRUNK dig (after the snapshot)
    return 'confirmed' } })
  const r = await R.runVisit(p('A'), e, { maxSteps: 4000 })
  assert.notStrictEqual(srv.read(...c.at).name, 'spruce_log', `the listed-but-changed cell is dug (${r.stop})`)
  assert.strictEqual(srv.read(x, y + 2, z).name, 'chest', 'the replacement is never dug')
})

console.log('NO SAPLING IN A PROJECT\'S COLUMNS')
await t('saplingBox is the record\'s x/z box widened by SAPLING_MARGIN; saplingAllowedAt refuses inside, allows outside', () => {
  const box = SH.saplingBox({ cells: [{ at: [10, 70, 20] }, { at: [14, 75, 26] }] })
  assert.deepStrictEqual(box, { x0: 8, z0: 18, x1: 16, z1: 28 })
  assert.strictEqual(SH.saplingAllowedAt(box, 12, 22), false)
  assert.strictEqual(SH.saplingAllowedAt(box, 8, 18), false, 'the margin')
  assert.strictEqual(SH.saplingAllowedAt(box, 7, 22), true)
  assert.strictEqual(SH.saplingAllowedAt(null, 12, 22), true, 'no project: no limit')
  assert.strictEqual(SH.saplingBox({ cells: [] }), null)
  assert.strictEqual(SH.saplingCandidateOk(box, { ref: { position: { x: 12, y: 69, z: 22 } }, face: { x: 0, y: 1, z: 0 } }), false)
  assert.strictEqual(SH.saplingCandidateOk(box, { ref: { position: { x: 16, y: 70, z: 22 } }, face: { x: 1, y: 0, z: 0 } }), true)
})
const flat = (px, pz) => ({ entity: { position: { x: px, y: 64, z: pz, offset: (dx, dy, dz) => ({ x: px + dx, y: 64 + dy, z: pz + dz }) } },
  blockAt: q => ({ name: q.y === 63 ? 'grass_block' : 'air', position: q }) })
await t('plantableSpotNear never offers a cell in the box, and still offers the legal cells next to it (the refusal chain)', () => {
  const b = flat(0, 0)
  b.shopSaplingBox = { x0: -10, z0: -10, x1: 1, z1: 10 }   // the bot stands inside, the box edge one block east
  const s = S.plantableSpotNear(b, 2, 'oak_sapling')
  assert.ok(s, 'a legal cell east of the box is still found from where the bot stands')
  assert.ok(s.x >= 2, `outside the box (${JSON.stringify(s)})`)
  b.shopSaplingBox = { x0: -10, z0: -10, x1: 10, z1: 10 }
  assert.strictEqual(S.plantableSpotNear(b, 2, 'oak_sapling'), null, 'deep inside: nothing here, the next scan happens elsewhere')
  const out = flat(30, 30); out.shopSaplingBox = b.shopSaplingBox
  assert.ok(S.plantableSpotNear(out, 2, 'oak_sapling'), 'away from the project: planting as before')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

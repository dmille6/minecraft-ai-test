// FELLCANOPY-01 (bots/src/fellcanopy.mjs; skills.mjs buildStepwellRun swListCanopy). LIVE showcase ef40871b 11-08: the stepwell read
// "felling: complete; 17 log(s) left" on 221 of 240 visits for 63 h. Region read + offline replay with the live code: 0 of the 17
// standing logs had a dig stand (each wrapped in its spruce's natural leaves); runVisit's clears() skips a clear no stand reaches
// uncounted, so every visit ended `complete`. After listing the canopy the replay felled all 17 in two rounds.
// Here: the pure rules, then THE CHAIN on the fake server (the real runVisit, walkFrom and digStand): the dead end as the positive
// control, the listing, the visits that fell the tree; a placed hedge never listed; anchored mutants.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')
const FC = await import('../src/fellcanopy.mjs')
const SW = await import('../src/stepwell.mjs')
const FC_PATH = new URL('../src/fellcanopy.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withFcMutant (old, neu, fn) {
  const src = readFileSync(FC_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const kOf = a => a.join(',')

// ---- a spruce on the fake server's flat ground: trunk G+1..G+5, rings r2 at G+2 and G+4, r1 at G+3 and G+5, a cap at G+6 --------
const TX = 12, TZ = 12
function spruce ({ persistent = false } = {}) {
  const cells = {}, logs = []
  for (let y = G + 1; y <= G + 5; y++) { cells[kOf([TX, y, TZ])] = 'spruce_log'; logs.push([TX, y, TZ]) }
  for (const [y, r] of [[G + 2, 2], [G + 3, 1], [G + 4, 2], [G + 5, 1]]) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx || dz) cells[kOf([TX + dx, y, TZ + dz])] = 'spruce_leaves'
  }
  cells[kOf([TX, G + 6, TZ])] = 'spruce_leaves'
  const srv = server(cells)
  const plain = srv.read
  // the fake server's blocks carry no properties: leaves read as the world's do (stairRead: `props.persistent`)
  srv.read = (x, y, z) => { const b = plain(x, y, z); return b && /_leaves$/.test(b.name) ? { ...b, props: { persistent: persistent ? 'true' : 'false' } } : b }
  const rec = { ...SITE.record, blueprint: SW.STEPWELL_BLUEPRINT, plot: SW.STEPWELL_PLOT, cells: [], replant: [],
    clear: logs.map(at => ({ at, kind: 'tree', name: 'spruce_log', tree: 0 })),
    zones: [{ box: [-40, G - 20, -40, 40, G + 40, 40], why: 'project:stepwell' }] }
  return { srv, rec, logs }
}
async function fellVisit (srv, rec, mod = R) {
  const pr = project(rec)
  const h = PJ.recordHead(pr.dir, pr.key)
  const e = bot(srv, 'A', { feet: [0, G + 1, 0] })
  // the stepwell felling's own options (skills.mjs buildStepwellRun): its view, its palette, every domain, the replant knobs
  const r = await R.runVisit({ ...pr.p('A'), record: SW.fellView(h.head.rec), recordGen: h.head.gen, palette: SW.FELL_PALETTE, domain: () => true,
    blockLayer: false, clearMax: 60, walkR: 64, replantGoOn: true, replantPerTree: true }, e, { maxSteps: 240 })
  return { r, logs: e.logs, left: SW.fellPending(srv.read, rec) }
}

console.log('THE PURE RULES')
await t('naturalLeaves: a grown leaf (persistent false, as a value or a string) only; a placed one, unread props, a log: never', () => {
  assert.strictEqual(FC.naturalLeaves({ name: 'spruce_leaves', props: { persistent: 'false' } }), true)
  assert.strictEqual(FC.naturalLeaves({ name: 'oak_leaves', getProperties: () => ({ persistent: false }) }), true)
  assert.strictEqual(FC.naturalLeaves({ name: 'spruce_leaves', props: { persistent: 'true' } }), false, 'a placed hedge')
  assert.strictEqual(FC.naturalLeaves({ name: 'spruce_leaves' }), false, 'unread: never listed')
  assert.strictEqual(FC.naturalLeaves({ name: 'spruce_log', props: { persistent: 'false' } }), false)
  assert.strictEqual(FC.naturalLeaves(null), false)
})
await t('fellCanopyDue: only `complete` with logs left and nothing cleared, under the round bound', () => {
  assert.strictEqual(FC.fellCanopyDue({}, { stop: 'complete', left: 17, cleared: 0 }), true, 'the live visit')
  assert.strictEqual(FC.fellCanopyDue({}, { stop: 'complete', left: 17, cleared: 3 }), false, 'it dug something: the next visit goes on')
  assert.strictEqual(FC.fellCanopyDue({}, { stop: 'complete', left: 0 }), false, 'the felling is done')
  assert.strictEqual(FC.fellCanopyDue({}, { stop: 'complete', left: null }), false, 'unread: no proof')
  assert.strictEqual(FC.fellCanopyDue({}, { stop: 'deadline', left: 17 }), false, 'a visit cut short proves nothing')
  assert.strictEqual(FC.fellCanopyDue({ fellCanopy: { rounds: FC.FELLCANOPY_ROUNDS } }, { stop: 'complete', left: 5 }), false, 'rounds spent')
  assert.strictEqual(FC.fellCanopyDue({ fellCanopy: { rounds: FC.FELLCANOPY_ROUNDS - 1 } }, { stop: 'complete', left: 5 }), true)
})
await t('fellCanopy: natural leaves round STANDING logs only; never a record cell, a listed tree/leaves cell, outside the zone, unread', () => {
  const { srv, rec } = spruce()
  const all = FC.fellCanopy(rec, srv.read, { max: 999 })
  assert.ok(all.length > 30, `the rings round the trunk (${all.length})`)
  assert.ok(all.every(e => e.kind === 'leaves' && e.name === 'spruce_leaves' && e.canopy === 1 && e.tree === 0))
  assert.ok(all.every(e => Math.max(Math.abs(e.at[0] - TX), Math.abs(e.at[2] - TZ)) <= FC.FELLCANOPY_R))
  const ring = kOf([TX + 1, G + 2, TZ])
  assert.ok(all.some(e => kOf(e.at) === ring))
  const listed = { ...rec, clear: [...rec.clear, { at: [TX + 1, G + 2, TZ], kind: 'leaves', name: 'spruce_leaves' }] }
  assert.ok(!FC.fellCanopy(listed, srv.read, { max: 999 }).some(e => kOf(e.at) === ring), 'already listed: not again')
  const built = { ...rec, cells: [{ at: [TX + 1, G + 2, TZ], role: 'wall' }] }
  assert.ok(!FC.fellCanopy(built, srv.read, { max: 999 }).some(e => kOf(e.at) === ring), 'a record cell: never')
  const off = { ...rec, zones: [{ box: [-40, G - 20, -40, TX, G + 40, 40] }] }
  assert.ok(FC.fellCanopy(off, srv.read, { max: 999 }).every(e => e.at[0] <= TX), 'outside the reservation: never')
  assert.deepStrictEqual(FC.fellCanopy({ ...rec, zones: [] }, srv.read), [], 'no reservation: nothing')
  assert.deepStrictEqual(FC.fellCanopy(rec, () => null), [], 'unread world: nothing (and no standing log)')
  const felled = { ...rec, clear: rec.clear.slice(0, 1) }   // only the bottom log listed: its rings only (G .. G+3)
  assert.ok(FC.fellCanopy(felled, srv.read, { max: 999 }).every(e => e.at[1] <= G + 1 + FC.FELLCANOPY_UP))
  assert.strictEqual(FC.fellCanopy(rec, srv.read, { max: 5 }).length, 5, 'bounded')
})
await t('fellCanopy: a PLACED hedge round a log is never listed', () => {
  const { srv, rec } = spruce({ persistent: true })
  assert.deepStrictEqual(FC.fellCanopy(rec, srv.read), [])
})
await t('withFellCanopy: appends only new entries, counts the rounds; nothing new -> null', () => {
  const { srv, rec } = spruce()
  const e = FC.fellCanopy(rec, srv.read)
  const g1 = FC.withFellCanopy(rec, e, { now: 5, left: 5 })
  assert.strictEqual(g1.clear.length, rec.clear.length + e.length)
  assert.deepStrictEqual(g1.fellCanopy, { rounds: 1, n: e.length, at: 5, left: 5 })
  assert.strictEqual(FC.withFellCanopy(g1, e), null, 'the same entries again: nothing to publish')
  assert.strictEqual(FC.withFellCanopy(rec, []), null)
  const view = SW.fellView(g1)
  assert.strictEqual(view.clear.filter(c => c.kind === 'leaves').length, e.length, 'the felling\'s view digs them')
})

console.log('THE CHAIN (fake server, the real runVisit)')
await t('POSITIVE CONTROL (the live dead end): the felling visit ends `complete`, nothing cleared, every log standing', async () => {
  const { srv, rec, logs } = spruce()
  const { r, left } = await fellVisit(srv, rec)
  assert.strictEqual(r.stop, 'complete', r.stop + ' ' + r.why)
  assert.strictEqual(r.cleared, 0)
  assert.strictEqual(left, logs.length)
  assert.strictEqual(FC.fellCanopyDue(rec, { stop: r.stop, left, cleared: r.cleared }), true, 'the visit proves the canopy is due')
})
await t('the canopy listed: later visits dig the leaves from outside in and fell every log (the chain closes)', async () => {
  const { srv, rec } = spruce()
  let cur = rec, rounds = 0, visits = 0, leafRows = 0, treeRows = 0
  for (; visits < 12 && SW.fellPending(srv.read, cur) > 0; visits++) {
    const { r, logs, left } = await fellVisit(srv, cur)
    leafRows += logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'leaves').length
    treeRows += logs.filter(([k, d]) => k === '_build' && d.op === 'clear' && d.kind === 'tree').length
    if (FC.fellCanopyDue(cur, { stop: r.stop, left, cleared: r.cleared })) {
      const next = FC.withFellCanopy(cur, FC.fellCanopy(cur, srv.read), { left })
      assert.ok(next, 'a due visit has a canopy to list')
      cur = next; rounds++
    }
  }
  assert.strictEqual(SW.fellPending(srv.read, cur), 0, `every log down (visits ${visits}, rounds ${rounds})`)
  assert.ok(rounds >= 1 && rounds <= FC.FELLCANOPY_ROUNDS, `rounds ${rounds}`)
  assert.ok(leafRows > 0 && treeRows === 5, `rows: leaves ${leafRows}, trees ${treeRows}`)
})
await t('MUTANT: naturalLeaves never true -- nothing is listed and the tree stands for good (killed for that reason)', async () => {
  await withFcMutant("  return p?.persistent === false || p?.persistent === 'false'\n", '  return false\n', async M => {
    const { srv, rec } = spruce()
    assert.deepStrictEqual(M.fellCanopy(rec, srv.read), [])
    const { r, left } = await fellVisit(srv, rec)
    assert.strictEqual(r.stop, 'complete'); assert.strictEqual(left, 5)
    assert.strictEqual(M.withFellCanopy(rec, M.fellCanopy(rec, srv.read)), null, 'the mutant publishes nothing: the dead end stays')
  })
})
await t('MUTANT: the due test ignores `cleared` -- a visit that dug leaves would spend a round (the bound tested)', async () => {
  await withFcMutant("  if (stop !== 'complete' || !(Number(left) > 0) || Number(cleared) > 0) return false\n", "  if (stop !== 'complete' || !(Number(left) > 0)) return false\n", async M => {
    assert.strictEqual(M.fellCanopyDue({}, { stop: 'complete', left: 3, cleared: 4 }), true, 'the mutant spends a round on a visit that progressed')
  })
  assert.strictEqual(FC.fellCanopyDue({}, { stop: 'complete', left: 3, cleared: 4 }), false)
})
await t('wired: the stepwell felling lists the canopy after runVisit, behind FELLCANOPY (structural: strip comments, executable lines)', () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.strictEqual(src.split("const canopy = fellCanopyOn() && fellCanopyDue(rec, { stop: r.stop, left, cleared: r.cleared }) ? swListCanopy(bot, { dir, key, me, rec, left }) : null").length, 2)
  assert.ok(/withFellCanopy\(cur, entries, \{ left \}\)/.test(src))
  assert.ok(/log\(s\) left\$\{canopy \? `; canopy \$\{canopy\}` : ''\}`/.test(src), 'the visit row names the listing')
  assert.strictEqual(FC.fellCanopyOn({ FELLCANOPY: 'off' }), false); assert.strictEqual(FC.fellCanopyOn({}), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

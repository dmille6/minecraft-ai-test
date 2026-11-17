// OVERSEER-01SHOW (scripts/host/overseer-cycle.mjs): one host cycle over a real town directory -- the clean-up record's removals
// become per-bot lists in the town's directory (live) or in scratch (dry, the town's lists removed); a bot's id rows close its jobs
// once; a record's cells and the radius keep jobs off the lists; an unreadable record writes nothing.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const PJ = await import('../src/buildproj.mjs')
const W = await import('../src/worklist.mjs')
const H = await import('../../scripts/host/overseer-cycle.mjs')
const H_PATH = new URL('../../scripts/host/overseer-cycle.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = fs.readFileSync(H_PATH, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-ovh-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, H_PATH)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const HOME = { x: 0, y: 70, z: 0 }, NOW = 1_800_000_000_000
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p))
function town ({ cuts, cells = [] }) {
  const pool = tmp('ovp-')
  PJ.publishRecord(pool, PJ.projKey(HOME, 'tidy'), () => ({ v: 1, plot: 'tidy', cells: [], cut: cuts.map(at => ({ at, kind: 'tidy', name: 'dirt' })), structure_complete: false }))
  PJ.publishRecord(pool, PJ.projKey(HOME, 'cottage2'), () => ({ v: 1, plot: 'cottage2', cells: cells.map(at => ({ at, role: 'wall' })) }))
  return pool
}
const zonesFile = (zones = []) => { const f = path.join(tmp('ovz-'), 'zones.json'); fs.writeFileSync(f, JSON.stringify({ version: 1, zones })); return f }
const input = (pool, o = {}) => ({ now: NOW, home: [0, 70, 0], radius: 128, pool, state: tmp('ovs-'), zones: zonesFile(), live: true, scratch: tmp('ovd-'),
  bots: [{ name: 'Ann', online: true, pos: [-20, 71, 0] }, { name: 'Bo', online: true, pos: [20, 71, 0] }], rows: [], ...o })

const liveScenario = async H => {
  const pool = town({ cuts: [[-20, 72, 0], [-20, 73, 0], [20, 72, 1], [5, 72, 5], [200, 72, 0]], cells: [[5, 72, 5]] })
  H.runCycle(input(pool))
  assert.ok(!JSON.parse(fs.readFileSync(path.join(pool, 'worklist-Bo.json'), 'utf8')).jobs.some(j => j.id === 'r:5,72,5'), 'a record cell is no removal')
  assert.ok(!JSON.parse(fs.readFileSync(path.join(pool, 'worklist-Ann.json'), 'utf8')).jobs.some(j => j.id === 'r:5,72,5'))
}
// r1 C6: stopping is a transition -- the live lists go once, then dry never touches the town
const dryScenario = async H => {
  const pool = town({ cuts: [[-20, 72, 0]] })
  const inp = input(pool)
  H.runCycle(inp)
  assert.ok(fs.existsSync(path.join(pool, 'worklist-Ann.json')), 'live: published')
  const s1 = H.runCycle({ ...inp, live: false, now: NOW + 15 * 60_000 }).summary
  assert.strictEqual(s1.stopped, 2); assert.ok(!fs.readdirSync(pool).some(f => H.LIST_RE.test(f)), 'switched off: the lists go at once')
  fs.writeFileSync(path.join(pool, 'worklist-Zed.json'), '{}')
  const s2 = H.runCycle({ ...inp, live: false, now: NOW + 30 * 60_000 }).summary
  assert.strictEqual(s2.stopped, null); assert.ok(fs.existsSync(path.join(pool, 'worklist-Zed.json')), 'after that dry never deletes from the town')
}
const killed = async (old, neu, sc) => { await sc(H); assert.ok(await withMutant(old, neu, async M => { try { await sc(M); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }), 'the mutant survived') }
await t('LIVE: the record\'s removals become two bots\' lists in the town (nearest bot, the guard and the radius respected); each bot accepts its own', async () => {
  const pool = town({ cuts: [[-20, 72, 0], [-20, 73, 0], [20, 72, 1], [5, 72, 5], [200, 72, 0]], cells: [[5, 72, 5]] })
  const inp = input(pool)
  const { summary } = H.runCycle(inp)
  const ann = JSON.parse(fs.readFileSync(path.join(pool, 'worklist-Ann.json'), 'utf8')), bo = JSON.parse(fs.readFileSync(path.join(pool, 'worklist-Bo.json'), 'utf8'))
  assert.deepStrictEqual(ann.jobs.map(j => j.id), ['r:-20,73,0', 'r:-20,72,0']); assert.deepStrictEqual(bo.jobs.map(j => j.id), ['r:20,72,1'])
  assert.match(summary.row, / record=1 far=1 /)
  assert.ok(W.listCheck(ann, { bot: 'Ann', home: HOME, now: NOW + 60_000 }).ok, 'the bot side accepts the host\'s file')
  assert.strictEqual(W.listCheck(ann, { bot: 'Bo', home: HOME, now: NOW + 60_000 }).why, 'other_bot')
  // the next cycle: Ann's id rows close her pillar, once
  const rows = W.worklistIdRows({ ids: { done: ['r:-20,73,0', 'r:-20,72,0'], gone: [], refused: [], unreachable: [] }, why: {} }, ann.issued).map(d => ({ bot: 'Ann', t: NOW + 5 * 60_000, detail: d }))
  const c2 = H.runCycle({ ...inp, now: NOW + 15 * 60_000, rows })
  assert.strictEqual(c2.summary.reports, 1)
  assert.deepStrictEqual(c2.cycle.book.filter(j => j.state === 'done').map(j => j.id).sort(), ['r:-20,72,0', 'r:-20,73,0'])
  assert.strictEqual(H.runCycle({ ...inp, now: NOW + 30 * 60_000, rows }).summary.reports, 0, 'a row is ingested once')
})
await t('DRY never writes to or deletes from the town; the lists go to scratch', async () => {
  const pool = town({ cuts: [[-20, 72, 0]] })
  fs.writeFileSync(path.join(pool, 'worklist-Ann.json'), '{"x":1}')
  const before = fs.readdirSync(pool).sort()
  const inp = input(pool, { live: false })
  H.runCycle(inp)
  assert.deepStrictEqual(fs.readdirSync(pool).sort(), before); assert.strictEqual(fs.readFileSync(path.join(pool, 'worklist-Ann.json'), 'utf8'), '{"x":1}')
  assert.ok(fs.existsSync(path.join(inp.scratch, 'worklist-Ann.json')))
  assert.ok(fs.existsSync(path.join(inp.state, 'book.dry.json')) && !fs.existsSync(path.join(inp.state, 'book.live.json')), 'a dry book is its own')
  assert.ok(fs.existsSync(path.join(inp.state, 'setaside.json')))
})
await t('C6 LIVE -> DRY: the published lists are removed once, then dry leaves the town alone', () => dryScenario(H))
await t('C4 ZONES: none given, missing, or unreadable -> the cycle throws and writes nothing', async () => {
  const pool = town({ cuts: [[-20, 72, 0]] })
  for (const zones of [null, '/nonexistent/zones.json', (() => { const f = path.join(tmp('ovz-'), 'z.json'); fs.writeFileSync(f, '{bad'); return f })(), (() => { const f = path.join(tmp('ovz-'), 'z.json'); fs.writeFileSync(f, '{}'); return f })()]) {
    const inp = input(pool, { zones })
    assert.throws(() => H.runCycle(inp), /zones/, String(zones))
    assert.ok(!fs.readdirSync(pool).some(f => H.LIST_RE.test(f))); assert.deepStrictEqual(fs.readdirSync(inp.state), [])
  }
  // and a zone in the file keeps its cells off the lists
  const inp = input(pool, { zones: zonesFile([{ id: 'v', box: [-30, -64, -5, -10, 90, 5] }]) })
  H.runCycle(inp)
  assert.ok(!fs.existsSync(path.join(pool, 'worklist-Ann.json')) || JSON.parse(fs.readFileSync(path.join(pool, 'worklist-Ann.json'), 'utf8')).jobs.length === 0)
})
// r6 (Codex A): minute 0 Ann's list holds X; minute 15 a cycle moves X off Ann and CRASHES before rewriting Ann's list; the retry
// at minute 21 must not publish X to Bo while Ann's old list still holds it. X reaches Bo only after Ann's list is rewritten.
const crashScenario = async H => {
  const pool = town({ cuts: [[-20, 72, 0]] })
  const inp = input(pool)
  const X = 'r:-20,72,0', annF = path.join(pool, 'worklist-Ann.json'), boF = path.join(pool, 'worklist-Bo.json')
  const live = now => fs.readdirSync(pool).filter(f => H.LIST_RE.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(pool, f), 'utf8'))).filter(d => now <= d.expires && d.jobs.some(j => j.id === X)).map(d => d.bot)
  H.runCycle(inp)
  assert.deepStrictEqual(live(NOW), ['Ann'])
  const annOld = fs.readFileSync(annF, 'utf8')
  const off = { ...inp, bots: [{ name: 'Ann', online: false, pos: [-20, 71, 0] }, { name: 'Bo', online: true, pos: [20, 71, 0] }] }
  H.runCycle({ ...off, now: NOW + 15 * 60_000 })
  fs.writeFileSync(annF, annOld)   // the crash: Ann's list was never rewritten
  H.runCycle({ ...off, now: NOW + 21 * 60_000 })
  assert.ok(!(fs.existsSync(boF) && JSON.parse(fs.readFileSync(boF, 'utf8')).jobs.some(j => j.id === X)), 'Bo does not get X while Ann\'s list held it at the cycle')
  for (const m of [21, 36]) assert.ok(live(NOW + m * 60_000).length <= 1, `never on two live lists (minute ${m})`)
  H.runCycle({ ...off, now: NOW + 36 * 60_000 })
  assert.deepStrictEqual(live(NOW + 36 * 60_000), ['Bo'], 'after Ann\'s list is gone, X reaches Bo')
}
await t('C-A: a crash between the book and the lists never puts one job on two published lists', () => crashScenario(H))
await t('MUTANT KILLED: the published lists are not read', () => killed('  const onDisk = publishedIds(pubDocs, now)', '  const onDisk = {}', crashScenario))
// r7: STAGED -- the node step publishes nothing itself; its plan (the book first, then the lists) is applied by overseer.py only
// after the child's peak memory is checked
const stageScenario = async H => {
  const pool = town({ cuts: [[-20, 72, 0]] })
  const inp = input(pool, { stage: tmp('ovg-') })
  const { summary } = H.runCycle(inp)
  assert.ok(!fs.readdirSync(pool).some(f => H.LIST_RE.test(f)), 'nothing published by the node step')
  assert.deepStrictEqual(fs.readdirSync(inp.state), [], 'not even the book')
  const plan = JSON.parse(fs.readFileSync(path.join(inp.stage, 'manifest.json'), 'utf8')).plan
  assert.strictEqual(summary.staged, plan.length)
  assert.ok(plan[0].dest.endsWith('book.live.json'), 'the book first'); assert.ok(plan.some(o => o.dest === path.join(pool, 'worklist-Ann.json')))
}
await t('r7: staged -- the node step writes only to its stage, the book first in the plan', () => stageScenario(H))
await t('MUTANT KILLED: the stage is ignored', () => killed('  if (!stage) return { write: writeAtomic,', '  if (true) return { write: writeAtomic,', stageScenario))
await t('AN UNREADABLE RECORD: the cycle throws and writes nothing', async () => {
  const pool = town({ cuts: [[-20, 72, 0]] })
  const k = PJ.projKey(HOME, 'cottage2')
  fs.writeFileSync(path.join(pool, `${k}.g9.json`), '{not json')
  const inp = input(pool)
  assert.throws(() => H.runCycle(inp), /record unreadable/)
  assert.ok(!fs.readdirSync(pool).some(f => H.LIST_RE.test(f))); assert.deepStrictEqual(fs.readdirSync(inp.state), [])
})

await t('MUTANT KILLED: the guard is not read', () => killed('for (const c of h.head?.rec?.cells ?? []) if (Array.isArray(c?.at)) guard.add(c.at.join(\',\'))', '', liveScenario))
await t('MUTANT KILLED: switching off leaves the published lists', () => killed("  if (!st?.published) return null", '  return null', dryScenario))
await t('MUTANT KILLED: the stop is not recorded (dry deletes every cycle)', () => killed('  io.write(f, { ...st, published: false, stoppedAt: now, stoppedRemoved: n })', '', dryScenario))
const zoneScenario = async H => { const pool = town({ cuts: [[-20, 72, 0]] }); assert.throws(() => H.runCycle(input(pool, { zones: '/nonexistent/z.json' })), /zones/) }
await t('MUTANT KILLED: a missing zones file reads as no zones', () => killed("  if (!zdoc || !Array.isArray(zdoc.zones)) throw new Error(`zones unreadable: ${inp.zones}`)", '  if (!zdoc) return { summary: {}, cycle: null }', zoneScenario))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

// WORKLIST-01 (bots/src/worklist.mjs + skills.mjs worklistVisit): a bot works ITS OWN list from the host, in a record and under a
// cut lease of its own, so bots with lists dig at the same time. The list is advice: the file is refused whole when it is not this
// bot's, this home's, fresh; every job is read again. Behaviour: the pure rules, then the REAL runVisit on the fake server
// (test/helpers/buildfake.mjs) -- two bots on two lists both digging while each holds its own lease, and the SAME two on one shared
// record as the control (one digs, the other is kept out). Anchored mutants for every rule.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, HOME, k3, server, bot } = await import('./helpers/buildfake.mjs')
const W = await import('../src/worklist.mjs')
const O = await import('../src/overseer.mjs')
const W_PATH = new URL('../src/worklist.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (old, neu, fn) {
  const src = readFileSync(W_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (scenario, M) => { try { await scenario(M); return false } catch (e) { if (!(e instanceof assert.AssertionError) && !(e instanceof TypeError)) throw e; return true } }
/** BOTH WAYS: the scenario passes on the real module and fails on the mutant. */
const mutant = (name, old, neu, scenario) => t(`MUTANT KILLED: ${name}`, async () => {
  await scenario(W)
  assert.ok(await withMutant(old, neu, M => killedBy(scenario, M)), 'the mutant survived')
})

const NOW = 1_800_000_000_000
const rm = (x, y, z, block = 'dirt', after = []) => ({ id: `r:${x},${y},${z}`, kind: 'remove', at: [x, y, z], block, ...(after.length ? { after } : {}) })
/** A pillar's jobs, top first, each after the one above it. */
const pillar = (x, z, n = 2, block = 'dirt') => Array.from({ length: n }, (_, i) => { const y = G + n - i; return rm(x, y, z, block, i ? [`r:${x},${y + 1},${z}`] : []) })
const DOC = (jobs, o = {}) => ({ v: 1, kind: 'worklist', project: 'tidy', bot: 'A', home: [HOME.x, HOME.y, HOME.z], issued: NOW - 60_000, saved: NOW - 5 * 60_000, expires: NOW + 60 * 60_000, jobs, ...o })
const stand = (cells = {}) => server(cells)
const col = (x, z, n = 2, name = 'dirt') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${x},${G + 1 + i},${z}`, name]))

console.log('THE FILE')
const fileRules = async M => {
  const ck = (d, o = {}) => M.listCheck(d, { bot: 'A', home: HOME, now: NOW, ...o })
  const ok = ck(DOC(pillar(5, 0)))
  assert.strictEqual(ok.ok, true); assert.strictEqual(ok.jobs.length, 2); assert.strictEqual(ok.project, 'tidy'); assert.strictEqual(ok.issued, NOW - 60_000)
  assert.strictEqual(ck(null).why, 'no_file')
  assert.strictEqual(ck(DOC(pillar(5, 0), { v: 2 })).why, 'malformed'); assert.strictEqual(ck(DOC(pillar(5, 0), { kind: 'litter' })).why, 'malformed')
  assert.strictEqual(ck(DOC(pillar(5, 0), { bot: 'B' })).why, 'other_bot')
  assert.strictEqual(ck(DOC(pillar(5, 0), { home: [9, HOME.y, 0] })).why, 'other_home'); assert.strictEqual(ck(DOC(pillar(5, 0), { home: [0, HOME.y + 1, 0] })).why, 'other_home'); assert.strictEqual(ck(DOC(pillar(5, 0), { home: [HOME.x, HOME.y, HOME.z + 1] })).why, 'other_home')
  assert.strictEqual(ck(DOC(pillar(5, 0), { project: 'castle' })).why, 'project')
  assert.strictEqual(ck(DOC(pillar(5, 0), { expires: NOW - 1 })).why, 'expired'); assert.strictEqual(ck(DOC(pillar(5, 0), { expires: NOW })).ok, true)
  assert.strictEqual(ck(DOC(pillar(5, 0), { saved: NOW - M.WORKLIST.maxAgeMs - 1 })).why, 'stale'); assert.strictEqual(ck(DOC(pillar(5, 0), { saved: NOW - M.WORKLIST.maxAgeMs })).ok, true)
  assert.strictEqual(ck(DOC(pillar(5, 0), { saved: NOW + 2 * 60_000 })).why, 'stale'); assert.strictEqual(ck(DOC(pillar(5, 0), { issued: NOW + 2 * 60_000 })).why, 'stale')
  assert.strictEqual(ck(DOC(pillar(5, 0), { saved: 'x' })).why, 'malformed')
  assert.strictEqual(ck(DOC(Array.from({ length: M.WORKLIST.maxJobs + 1 }, (_, i) => rm(i, G + 1, 30)))).why, 'too_many')
  assert.strictEqual(ck(DOC(Array.from({ length: M.WORKLIST.maxJobs }, (_, i) => rm(i, G + 1, 30)))).ok, true)
  for (const bad of [{ id: '', kind: 'remove', at: [1, 2, 3], block: 'dirt' }, { id: 'a', kind: 'smash', at: [1, 2, 3], block: 'dirt' }, { id: 'a', kind: 'remove', at: [1, 2.5, 3], block: 'dirt' }, { id: 'a', kind: 'remove', at: [1, 2, 3] }, { id: 'a b', kind: 'remove', at: [1, 2, 3], block: 'dirt' }, { id: 'a', kind: 'remove', at: [1, 2, 3], block: 'dirt', after: 'b' }]) {
    assert.strictEqual(ck(DOC([rm(5, G + 1, 0), bad])).why, 'malformed', JSON.stringify(bad))
  }
  assert.strictEqual(ck(DOC([rm(5, G + 1, 0), rm(5, G + 1, 0)])).why, 'malformed', 'two jobs with one id')
  assert.strictEqual(ck(DOC([{ id: 'f1', kind: 'fill', at: [1, 2, 3], block: 'dirt' }, { id: 'h1', kind: 'haul', at: [1, 2, 3], item: 'cobblestone', n: 8 }])).ok, true, 'the later kinds are read')
}
await t('this bot\'s, this home\'s, a known project, fresh, bounded, well formed: read; anything else is refused WHOLE', () => fileRules(W))
await mutant('another bot\'s file is worked', "  if (String(doc.bot) !== String(bot)) return no('other_bot')\n", '', fileRules)
await mutant('another home\'s file is worked', "|| doc.home[2] !== Math.floor(home.z)) return no('other_home')", ") return no('other_home')", fileRules)
await mutant('an unknown project\'s file is worked', "  if (!Object.prototype.hasOwnProperty.call(projects, String(doc.project))) return no('project')\n", '', fileRules)
await mutant('an expired file is worked', "  if (now > expires) return no('expired')\n", '', fileRules)
await mutant('an old save is believed', "  if (now - saved > T.maxAgeMs || saved - now > T.skewMs", '  if (saved - now > T.skewMs', fileRules)
await mutant('a save from the future is believed', 'now - saved > T.maxAgeMs || saved - now > T.skewMs || issued - now > T.skewMs', 'now - saved > T.maxAgeMs', fileRules)
await mutant('a list of any length is worked', "  if (doc.jobs.length > T.maxJobs) return no('too_many')\n", '', fileRules)
await mutant('a malformed job is let through', "if (!jobOk(j) || ids.has(j.id)) return no('malformed')", "if (ids.has(j.id)) return no('malformed')", fileRules)
await mutant('two jobs share an id', "if (!jobOk(j) || ids.has(j.id)) return no('malformed')", "if (!jobOk(j)) return no('malformed')", fileRules)

console.log('THE WORK OF A VISIT (every job read again)')
const st = (w, x, y, z) => w.status.get(`r:${x},${y},${z}`)
const workRules = async M => {
  // the positive control: a two-block dirt pillar, listed top first -> two cuts in that order, by the name standing now
  const srv = stand(col(5, 0))
  const w = M.listWork(pillar(5, 0), srv.read)
  assert.deepStrictEqual(w.cuts.map(c => [k3(c.at), c.kind, c.name, c.id]), [[`5,${G + 2},0`, 'tidy', 'dirt', `r:5,${G + 2},0`], [`5,${G + 1},0`, 'tidy', 'dirt', `r:5,${G + 1},0`]])
  // gone: air, or another block than the listed one; dirt that greened is the same block and is dug by the name it has now
  const srv2 = stand({ ...col(5, 0, 1), ...col(8, 0, 1, 'cobblestone'), ...col(11, 0, 1, 'grass_block') })
  const w2 = M.listWork([rm(5, G + 2, 0), rm(8, G + 1, 0, 'dirt'), rm(11, G + 1, 0, 'dirt')], srv2.read)
  assert.strictEqual(st(w2, 5, G + 2, 0), 'gone'); assert.strictEqual(st(w2, 8, G + 1, 0), 'gone')
  assert.deepStrictEqual(w2.cuts.map(c => [c.at[0], c.name]), [[11, 'grass_block']])
  // not the bots' material: never dug, whatever the list says (and the same job with cobblestone IS dug)
  const srv3 = stand({ ...col(5, 0, 1, 'stone'), ...col(8, 0, 1, 'cobblestone'), ...col(11, 0, 1, 'oak_log') })
  const w3 = M.listWork([rm(5, G + 1, 0, 'stone'), rm(8, G + 1, 0, 'cobblestone'), rm(11, G + 1, 0, 'oak_log')], srv3.read)
  assert.strictEqual(st(w3, 5, G + 1, 0), 'not_spoil'); assert.strictEqual(st(w3, 11, G + 1, 0), 'not_spoil'); assert.deepStrictEqual(w3.cuts.map(c => c.at[0]), [8])
  // a record's cell, a protected zone, a building's claim: each refused, each beside the same block taken without it
  const three = stand({ ...col(5, 0, 1), ...col(8, 0, 1), ...col(11, 0, 1), ...col(14, 0, 1) })
  const jobs = [rm(5, G + 1, 0), rm(8, G + 1, 0), rm(11, G + 1, 0), rm(14, G + 1, 0)]
  const w4 = M.listWork(jobs, three.read, { guard: k => k === `5,${G + 1},0`, zone: at => at[0] === 8, claim: at => at[0] === 11 })
  assert.deepStrictEqual([5, 8, 11, 14].map(x => st(w4, x, G + 1, 0)), ['record', 'zone', 'claim', 'cut'])
  assert.strictEqual(M.listWork(jobs, three.read).cuts.length, 4, 'the control: with no guard all four are cut')
  // unread: never a cut (and never "gone")
  const w5 = M.listWork([rm(200, G + 1, 0), rm(5, G + 1, 0)], three.read)
  assert.strictEqual(st(w5, 200, G + 1, 0), 'unread'); assert.strictEqual(w5.cuts.length, 1)
  // blocked: the block under one that STAYS is never dug; under one that is gone, or cut first, it is
  const w6 = M.listWork(pillar(5, 0), srv.read, { guard: k => k === `5,${G + 2},0` })
  assert.strictEqual(st(w6, 5, G + 2, 0), 'record'); assert.strictEqual(st(w6, 5, G + 1, 0), 'blocked'); assert.strictEqual(w6.cuts.length, 0)
  const w7 = M.listWork(pillar(5, 0), stand(col(5, 0, 1)).read)
  assert.strictEqual(st(w7, 5, G + 2, 0), 'gone'); assert.strictEqual(st(w7, 5, G + 1, 0), 'cut')
  const w8 = M.listWork([rm(5, G + 1, 0, 'dirt', ['r:not-on-the-list'])], srv.read)
  assert.strictEqual(w8.cuts.length, 1, 'a job after one the host closed is free')
  // given: this bot passed it over (and what comes after it waits with it); the others go on
  const w9 = M.listWork([...pillar(5, 0), rm(8, G + 1, 0)], three.read.bind(null) && stand({ ...col(5, 0), ...col(8, 0, 1) }).read, { given: id => id === `r:5,${G + 2},0` })
  assert.deepStrictEqual([st(w9, 5, G + 2, 0), st(w9, 5, G + 1, 0), st(w9, 8, G + 1, 0)], ['given', 'blocked', 'cut'])
  // a kind this piece does not work is read and left
  const w10 = M.listWork([{ id: 'f1', kind: 'fill', at: [5, G + 1, 0], block: 'dirt' }, rm(5, G + 1, 0)], srv.read)
  assert.strictEqual(w10.status.get('f1'), 'unsupported'); assert.strictEqual(w10.cuts.length, 1)
}
await t('a listed block is cut only while it stands, is the bots\' material, no record, zone or claim holds it, and nothing stays on it', () => workRules(W))
await mutant('a cell that turned another block is dug', "    if (!(n === j.block || (DIRT.test(n) && DIRT.test(j.block)))) { say('gone'); continue }\n", '', workRules)
await mutant('greened dirt reads gone', "    if (!(n === j.block || (DIRT.test(n) && DIRT.test(j.block)))) { say('gone'); continue }", "    if (n !== j.block) { say('gone'); continue }", workRules)
await mutant('natural stone on a list is dug', "    if (!rule.remove.test(n)) { say('not_spoil'); continue }\n", '', workRules)
await mutant('a record\'s cell is dug', "    if (guard(K(j.at))) { say('record'); continue }\n", '', workRules)
await mutant('a cell in a protected zone is dug', "    if (zone(j.at)) { say('zone'); continue }\n", '', workRules)
await mutant('a cell in a building\'s claim is dug', "    if (claim(j.at)) { say('claim'); continue }\n", '', workRules)
await mutant('an unread cell is a cut', "    if (!b) { say('unread'); continue }\n", "    if (!b) { say('cut'); cuts.push({ at: j.at, kind: 'tidy', name: j.block, id: j.id }); continue }\n", workRules)
await mutant('the block under one that stays is dug', "    if ((j.after ?? []).some(a => status.has(a) && !['cut', 'gone'].includes(status.get(a)))) { say('blocked'); continue }\n", '', workRules)
await mutant('a job after a gone one is blocked', "!['cut', 'gone'].includes(status.get(a))", "!['cut'].includes(status.get(a))", workRules)
await mutant('a job this bot passed over is tried for ever', "    if (given(j.id)) { say('given'); continue }\n", '', workRules)
await mutant('a fill is worked as a removal', "    if (!T.does.includes(j.kind)) { say('unsupported'); continue }\n", '', workRules)

console.log('THE RECORD AND THE REPORT')
const recordAndReport = async M => {
  const chk = M.listCheck(DOC([...pillar(5, 0), { id: 'f1', kind: 'fill', at: [9, G, 0], block: 'dirt' }]), { bot: 'A', home: HOME, now: NOW })
  const b = M.listRecordBody(chk, { home: HOME, bot: 'A', now: NOW })
  assert.strictEqual(b.plot, 'worklist-A'); assert.strictEqual(b.cells.length, 0); assert.strictEqual(b.builders_max, 1); assert.strictEqual(b.structure_complete, false)
  assert.deepStrictEqual(b.listed, [[5, G + 2, 0, 'dirt'], [5, G + 1, 0, 'dirt']]); assert.deepStrictEqual(b.cut.map(c => c.kind), ['tidy', 'tidy'])
  assert.notStrictEqual(M.listRecordBody({ ...chk, issued: chk.issued + 1 }, { home: HOME, bot: 'A' }).sig, b.sig, 'a new file is a new generation')
  assert.strictEqual(M.worklistFile('showcase-Juno'), 'worklist-showcase-Juno.json'); assert.strictEqual(M.worklistFile('a/b c'), 'worklist-a_b_c.json')
  // the report: six jobs, one of each fate
  const jobs = [rm(1, G + 1, 0), rm(2, G + 1, 0), rm(3, G + 1, 0), rm(4, G + 1, 0), rm(5, G + 1, 0), rm(6, G + 1, 0)]
  const status = new Map([[jobs[0].id, 'cut'], [jobs[1].id, 'gone'], [jobs[2].id, 'record'], [jobs[3].id, 'cut'], [jobs[4].id, 'cut'], [jobs[5].id, 'cut']])
  const cuts = [0, 3, 4, 5].map(i => ({ at: jobs[i].at, kind: 'tidy', name: 'dirt', id: jobs[i].id }))
  const rep = M.visitReport({ jobs, status, cuts, standing: c => c.at[0] !== 1, tidied: [`4,${G + 1},0`, `5,${G + 1},0`], waited: new Map([[`5,${G + 1},0`, 'water']]) })
  assert.deepStrictEqual({ n: rep.n, done: rep.done, gone: rep.gone, refused: rep.refused, unreachable: rep.unreachable, left: rep.left }, { n: 6, done: 1, gone: 1, refused: { record: 1, water: 1 }, unreachable: 1, left: 1 })
  assert.deepStrictEqual(rep.ids, { done: [jobs[0].id], gone: [jobs[1].id], refused: [jobs[2].id, jobs[4].id], unreachable: [jobs[3].id] })
  const d = M.worklistDetail({ issued: 77, rep, cleared: 1, stop: 'done' })
  assert.strictEqual(d, `op=visit list=77 n=6 done=1 gone=1 refused=record:1,water:1 unreachable=1 left=1 cleared=1 stop=done ids=r:r:3,${G + 1},0;r:r:5,${G + 1},0;u:r:4,${G + 1},0;g:r:2,${G + 1},0;d:r:1,${G + 1},0`)
  // a long list: the counts whole, the ids while they fit (refusals first), the rest counted; never past the logger's 300
  const many = Array.from({ length: 60 }, (_, i) => rm(-100 - i, G + 1, -100))
  const rep2 = M.visitReport({ jobs: many, status: new Map(many.map((j, i) => [j.id, i < 30 ? 'gone' : 'zone'])), cuts: [] })
  const d2 = M.worklistDetail({ issued: NOW, rep: rep2, stop: 'nothing' })
  assert.ok(d2.length <= 300, String(d2.length)); assert.ok(/ gone=30 refused=zone:30 /.test(d2)); assert.ok(/ ids=r:r:-130,/.test(d2), 'the refused ids come first')
  const shown = d2.split(' ids=')[1].split(' more=')[0].split(';').length
  assert.strictEqual(Number(d2.split(' more=')[1]), 60 - shown); assert.ok(shown >= 5 && shown <= M.WORKLIST.idMax)
  assert.strictEqual(M.worklistDetail({ op: 'refused', issued: 5, why: 'other bot' }), 'op=refused list=5 why=other_bot')
  assert.notStrictEqual(M.reportSig(1, rep), M.reportSig(1, rep2)); assert.strictEqual(M.reportSig(1, rep), M.reportSig(1, rep))
}
await t('the record has no cells and lists every removal; the report counts done / gone / refused by why / unreachable / left with the ids', () => recordAndReport(W))
await mutant('a refusal at the dig reads unreachable', '} else if (waited.has(k)) refuse(j.id, waited.get(k)); else if', '} else if', recordAndReport)
await mutant('a cut never come to reads unreachable', 'else if (tried.has(k)) { out.unreachable++; out.ids.unreachable.push(j.id) } else out.left++', 'else { out.unreachable++; out.ids.unreachable.push(j.id) }', recordAndReport)
await mutant('a block still standing reads done', '    if (!standing(c)) { out.done++; out.ids.done.push(j.id) }', '    if (true) { out.done++; out.ids.done.push(j.id) }', recordAndReport)
await mutant('the row runs past the logger\'s 300', 'if (fit.length >= T.idMax || len + x.length + 1 > T.rowMax) break; ', '', recordAndReport)
await mutant('the record\'s generation does not move with the file', 'sig: `${chk?.issued ?? 0}:${listed.length}`', 'sig: `${listed.length}`', recordAndReport)

console.log('THE VISIT (the real runVisit on the fake server)')
/** One bot's visit to its list in the town's directory `dir`: its own record key, its own slot (worklistVisit's shape). */
function visitP (dir, name, jobs, srv, { key = null, extra = {} } = {}) {
  const chk = W.listCheck(DOC(jobs, { bot: name }), { bot: name, home: HOME, now: NOW })
  assert.ok(chk.ok, chk.why)
  const w = W.listWork(chk.jobs, srv.read)
  const k = key ?? PJ.projKey(HOME, W.worklistPlot(name))
  let rh = PJ.recordHead(dir, k)
  if (!rh.head) { PJ.publishRecord(dir, k, () => W.listRecordBody(chk, { home: HOME, bot: name })); rh = PJ.recordHead(dir, k) }
  const slot = PJ.takeSlot(dir, k, name, key ? 2 : 1)
  assert.ok(slot.ok, 'a slot')
  return { w, chk, p: { dir, key: k, me: name, home: HOME, stood: [], record: rh.head.rec, recordGen: rh.head.gen, palette: {}, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, blockLayer: false, tidyKeepOrder: true, stuckStalledOnly: true, tidy: w.cuts, clearMax: W.WORKLIST.cutsPerVisit, ...(key ? {} : { clearPart: { lease: O.listLease(name) } }), ...extra } }
}
/** A digging bot whose every dig takes `ms` and is stamped with who else held a cut lease at that moment. */
function digger (srv, name, feet, log, dir, keys, ms = 15) {
  return bot(srv, name, { inv: {}, feet, dig: async (c, expect) => {
    if (expect && srv.read(...c)?.name !== expect) return 'refused'
    const others = Object.entries(keys).filter(([who, [k, ln]]) => { if (who === name) return false; const L = PJ.leaseState(dir, k, ln); return !!L && !L.released && L.holdsUntil > Date.now() }).map(([who]) => who)
    log.push({ by: name, cell: k3(c), others })
    await new Promise(r => setTimeout(r, ms))
    srv.set(c, 'air'); return 'confirmed'
  } })
}
await t('ONE BOT works its list: the pillar comes down top first, the row says so, nothing else is touched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'))
  const srv = stand({ ...col(5, 0, 3), ...col(9, 3, 1, 'cobblestone') })
  const log = []
  const v = visitP(dir, 'A', pillar(5, 0, 3), srv)
  const e = digger(srv, 'A', [3, G + 1, 0], log, dir, {})
  const r = await R.runVisit(v.p, e, { maxSteps: 200 })
  assert.strictEqual(r.cleared, 3); assert.deepStrictEqual(log.map(d => d.cell), [`5,${G + 3},0`, `5,${G + 2},0`, `5,${G + 1},0`])
  assert.strictEqual(srv.read(9, G + 1, 3).name, 'cobblestone', 'a block not on the list stands'); assert.strictEqual(srv.read(5, G, 0).name, 'grass_block', 'the ground under it stands')
  const rep = W.visitReport({ jobs: v.chk.jobs, status: v.w.status, cuts: v.w.cuts, standing: c => srv.read(...c.at)?.name === c.name, tidied: r.tidied })
  assert.deepStrictEqual([rep.done, rep.gone, rep.unreachable, rep.left], [3, 0, 0, 0])
  // overseer-01show: the host reads every id's outcome back from the id rows
  const back = W.worklistIdRows(rep, v.chk.issued).map(O.parseIdRow)
  assert.deepStrictEqual(back.flatMap(b => b.ids.done), pillar(5, 0, 3).map(j => j.id)); assert.ok(back.every(b => b.list === v.chk.issued))
  const rows = e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear')
  assert.strictEqual(rows.length, 3); assert.ok(rows.every(([, d]) => d.kind === 'tidy' && d.block === 'dirt'))
})
const twoLists = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'))
  const srv = stand({ ...col(5, 0, 3), ...col(5, 6, 3) })   // two pillars six apart: two bots' neighbouring lists
  const log = []
  const keys = { A: [PJ.projKey(HOME, W.worklistPlot('A')), O.listLease('A')], B: [PJ.projKey(HOME, W.worklistPlot('B')), O.listLease('B')] }
  const a = visitP(dir, 'A', pillar(5, 0, 3), srv), b = visitP(dir, 'B', pillar(5, 6, 3), srv)
  const [ra, rb] = await Promise.all([R.runVisit(a.p, digger(srv, 'A', [3, G + 1, 0], log, dir, keys), { maxSteps: 200 }), R.runVisit(b.p, digger(srv, 'B', [3, G + 1, 6], log, dir, keys), { maxSteps: 200 })])
  return { ra, rb, log, srv }
}
await t('TWO BOTS, TWO LISTS: both dig, and each digs while the OTHER holds its own cut lease (no shared lease keeps one out)', async () => {
  const { ra, rb, log, srv } = await twoLists()
  assert.strictEqual(ra.cleared, 3); assert.strictEqual(rb.cleared, 3)
  for (let y = G + 1; y <= G + 3; y++) { assert.strictEqual(srv.read(5, y, 0).name, 'air'); assert.strictEqual(srv.read(5, y, 6).name, 'air') }
  assert.ok(log.some(d => d.by === 'A' && d.others.includes('B')), 'A dug while B held its lease'); assert.ok(log.some(d => d.by === 'B' && d.others.includes('A')), 'B dug while A held its lease')
})
await t('THE CONTROL: the same two bots and pillars on ONE shared record -- one digs, the other is kept out by the one cut lease', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'))
  const srv = stand({ ...col(5, 0, 3), ...col(5, 6, 3) })
  const log = [], key = PJ.projKey(HOME, 'tidy')
  const a = visitP(dir, 'A', pillar(5, 0, 3), srv, { key }), b = visitP(dir, 'B', pillar(5, 6, 3), srv, { key })
  const [ra, rb] = await Promise.all([R.runVisit(a.p, digger(srv, 'A', [3, G + 1, 0], log, dir, { A: [key, 'seg-clear'], B: [key, 'seg-clear'] }), { maxSteps: 200 }), R.runVisit(b.p, digger(srv, 'B', [3, G + 1, 6], log, dir, { A: [key, 'seg-clear'], B: [key, 'seg-clear'] }), { maxSteps: 200 })])
  assert.strictEqual(ra.cleared + rb.cleared, 3, `one of them dug its pillar, the other nothing (${ra.cleared} + ${rb.cleared})`)
  assert.strictEqual(new Set(log.map(d => d.by)).size, 1)
})
await t('AT THE DIG: a cell a record claimed after the list was read is not dug, and the report names it refused (not unreachable)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'))
  const srv = stand({ ...col(5, 0, 1), ...col(8, 0, 1) })
  const waited = new Map()
  const tidyOk = q => { const why = q.at[0] === 5 ? 'record' : null; if (why) waited.set(k3(q.at), why); return !why }
  const v = visitP(dir, 'A', [rm(5, G + 1, 0), rm(8, G + 1, 0)], srv, { extra: { tidyOk } })
  const r = await R.runVisit(v.p, digger(srv, 'A', [3, G + 1, 0], [], dir, {}), { maxSteps: 200 })
  assert.strictEqual(srv.read(5, G + 1, 0).name, 'dirt'); assert.strictEqual(srv.read(8, G + 1, 0).name, 'air'); assert.strictEqual(r.cleared, 1)
  const rep = W.visitReport({ jobs: v.chk.jobs, status: v.w.status, cuts: v.w.cuts, standing: c => srv.read(...c.at)?.name === c.name, tidied: r.tidied, waited })
  assert.deepStrictEqual([rep.done, rep.refused, rep.unreachable], [1, { record: 1 }, 0])
  assert.deepStrictEqual(rep.why, { [`r:5,${G + 1},0`]: 'record' }, 'the refusal is keyed by the job id')
  const back = W.worklistIdRows(rep, 7).map(O.parseIdRow)
  assert.deepStrictEqual(back[0].why, { [`r:5,${G + 1},0`]: 'record' })
})
await t('THE CHAIN: a job the bot passes over does not stop its list -- the rest is dug, and with every job passed over there is no visit (the shared record\'s turn)', async () => {
  const srv = stand({ ...col(5, 0, 2), ...col(8, 0, 1) })
  const jobs = [...pillar(5, 0, 2), rm(8, G + 1, 0)]
  const some = W.listWork(jobs, srv.read, { given: id => id === `r:5,${G + 2},0` })
  assert.deepStrictEqual(some.cuts.map(c => c.at[0]), [8])
  const none = W.listWork(jobs, srv.read, { given: () => true })
  assert.strictEqual(none.cuts.length, 0)
  const rep = W.visitReport({ jobs, status: none.status, cuts: [] })
  assert.deepStrictEqual(rep.refused, { given: 2, blocked: 1 }, 'the host reads why: its rebalance takes these jobs off the list')
})

console.log('THE WIRING (structural: what behaviour cannot reach from here)')
const strip = s => s.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n')
const SK = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
await t('ONE call site, in buildTidy before the shared record\'s visit, behind the switch; a visit that did not happen falls through', () => {
  assert.strictEqual(SK.split('worklistVisit(').length, 2, 'worklistVisit is called from exactly one place'); assert.strictEqual(SK.split('async function worklistVisit (').length, 2)
  const bt = SK.slice(SK.indexOf('async function buildTidy ('), SK.indexOf('async function buildTidy (') + 3000)
  const call = bt.indexOf('const wl = await worklistVisit(ctx, signal,'), shared = bt.indexOf('const res = await buildTidyVisit(ctx, args, signal)'), gate = bt.indexOf('if (WL_ON && !(Number(ctx.bot.groundsPick?.used) > 0)) {')
  assert.ok(gate > 0 && call > gate && shared > call, 'the gate, then the list, then the shared record')
  assert.ok(bt.includes("if (wl.tried) {"), 'only a visit that happened ends the order')
  assert.ok(SK.includes('const WL_ON = worklistOn()'))
})
await t('the visit: its own key and one slot, the file refused before anything is read of the town, the guard strict and fresh at the dig', () => {
  const v = SK.slice(SK.indexOf('async function worklistVisit ('), SK.indexOf('const LITTER_ON = litterOn()'))
  const one = (needle, what) => assert.strictEqual(v.split(needle).length, 2, what)
  one("  if (!WL_ON || !SHOP.on || !planOn()) return no('off')", 'off: nothing is read')
  one('  const chk = listCheck(doc, { bot: me, home })', 'the file is checked for this bot and this home')
  one("  if (!c.zonesKnown) return no('zones_unknown')", 'no visit while the zones are unread')
  one("  if (!guard) return no('record_unreadable')", 'no visit while a record is unread')
  one('  const plot = worklistPlot(me), key = projKey(home, plot)', 'the bot\'s own record key')
  one('  const slot = takeSlot(dir, key, me, 1)', 'one slot: the list is one bot\'s')
  one("    const why = !g || g.has(k) ? 'record' : zone(q.at) ? 'zone' : claim(q.at) ? 'claim' : !cutSafeNow(rd, q.at, tidyWater()) ? 'water' : otherBodyOnCell(bot, q.at) ? 'body' : roughCutWaits({ at: q.at, read: rd, self: bot.entity?.position ?? null, others: playersSeen(bot) }) ? 'footing' : null", 'every check at the dig')
  one('    const k = q.at.join(\',\'), g = worklistGuardStrict()', 'the guard is read fresh before each dig')
  one('record: rh.head.rec, tidy: w.cuts, tidyKeepOrder: true, recordGen: rh.head.gen, palette: {},', 'the cuts go through the visit\'s own cut path')
  one("    releaseLease(dir, key, `slot${slot.slot}`, me, slotRef.gen)", 'the slot is given back however the visit ends')
  assert.ok(!v.includes('projectHeads()'), 'never the reader that skips an unreadable record')
  const g = SK.slice(SK.indexOf('function worklistGuardStrict ()'), SK.indexOf('async function worklistVisit ('))
  assert.ok(g.includes('const g = bw3GuardStrict()') && g.includes('if (!g) return null') && g.includes('for (const k of markerCellKeys(exMarkers())) g.add(k) } catch { return null }'))
})
await t('overseer-01show wiring: the town switch file before the list, the list lease, the id rows after both rows, one unstick reader in the order chain', () => {
  const v = SK.slice(SK.indexOf('async function worklistVisit ('), SK.indexOf('const LITTER_ON = litterOn()'))
  const one = (hay, needle, what) => assert.strictEqual(hay.split(needle).length, 2, what)
  one(v, "  if (fs.existsSync(path.join(dir, WORKLIST_OFF_FILE))) return no('off_file')", 'the town switch')
  assert.ok(v.indexOf("return no('off_file')") < v.indexOf('fs.readFileSync(path.join(dir, worklistFile(me))'), 'the switch is read before the list')
  one(v, 'tidyOk, clearPart: { lease: wlListLease(me) } },', 'the visit holds the list lease seg-clear-wl<bot>')
  assert.strictEqual(v.split('idRowsOut(rep, chk.issued)').length, 3, 'id rows after the nothing row and after the visit row')
  const CG = strip(fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  one(CG, '    if (!order && this.#wlUnstick()) this.crewForce = true\n    if (MINECREW.on) { if (order) this.crewForce = false;', 'the unstick forces the steer, just before it')
  one(CG, 'worklistUnstickNow(this.bot, { done: id => id === this.wlUnstickDone, now })', 'one order, once')
})
await t('unstickOf: only an accepted file of this bot, only unstick, only once', async () => {
  const ord = { kind: 'unstick', id: 'unstick:A:1', why: 'no_progress 31m' }
  const u = o => W.unstickOf(DOC([], { order: ord, ...o }), { bot: 'A', home: HOME, now: NOW })
  assert.deepStrictEqual(u(), { id: 'unstick:A:1', why: 'no_progress 31m' })
  assert.strictEqual(u({ bot: 'B' }), null, 'another bot\'s file'); assert.strictEqual(u({ expires: NOW - 1 }), null, 'expired')
  assert.strictEqual(u({ order: { ...ord, kind: 'teleport' } }), null); assert.strictEqual(u({ order: null }), null)
  assert.strictEqual(W.unstickOf(DOC([], { order: ord }), { bot: 'A', home: HOME, now: NOW, done: id => id === 'unstick:A:1' }), null, 'once')
  // the overseer's own file for a stalled bot is one this bot accepts
  const d = O.listDoc([], 'A', { home: HOME, now: NOW, order: { bot: 'A', order: 'unstick', why: 'no_progress 31m holding 4' } })
  assert.ok(W.unstickOf(d, { bot: 'A', home: HOME, now: NOW + 60_000 }))
})
await mutant('an expired order is acted on', "  if (!listCheck(doc, { bot, home, now, T }).ok) return null\n", '', async M => {
  assert.strictEqual(M.unstickOf(DOC([], { order: { kind: 'unstick', id: 'u1' }, expires: NOW - 1 }), { bot: 'A', home: HOME, now: NOW }), null)
})
await mutant('an order acted on twice', '|| o.id.length > 80 || done(o.id)) return null', '|| o.id.length > 80) return null', async M => {
  assert.strictEqual(M.unstickOf(DOC([], { order: { kind: 'unstick', id: 'u1' } }), { bot: 'A', home: HOME, now: NOW, done: () => true }), null)
})
await mutant('the refusal\'s reason is not keyed by id', '; out.ids.refused.push(id); out.why[id] = why }', '; out.ids.refused.push(id) }', async M => {
  const rep = M.visitReport({ jobs: [rm(5, G + 1, 0)], status: new Map([[`r:5,${G + 1},0`, 'zone']]) })
  assert.deepStrictEqual(rep.why, { [`r:5,${G + 1},0`]: 'zone' })
})
await t('the switch: WORKLIST=off|0|false|no reads off; unset reads on', () => {
  assert.strictEqual(W.worklistOn({}), true); for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.strictEqual(W.worklistOn({ WORKLIST: v }), false, v)
  assert.strictEqual(W.worklistOn({ WORKLIST: 'on' }), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

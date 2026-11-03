// REQUESTS-01 (requests.mjs + showchat.mjs `_request` lines + features.mjs installRequests): the town's requests board.
//
// Behaviour under test:
//   - the record reader: REAL showcase details (11-01..03) -> the events (gate wait / ok, copper run issued, copper deposits,
//     kit search took / none, the kit craft); everything else -> nothing;
//   - the project request: ONE per (project, item) town-wide across processes (the town file); the shortfall read from the
//     town's BEST view (a bot whose index sees less copper never flaps it); refreshes only on a real move and 30 min apart;
//     producing / fill only while open; met with its time; a request no gate refreshes for 6 h expires;
//   - the kit request: a took search + its craft within 120 s = filled from that chest; a late craft is nothing; none = unfilled;
//   - the 11-01..03 replay (bots/test/fixtures/requests-showcase-1101-1103.jsonl, 415 real rows, thinned): 1 open, 4 updates,
//     4 bag fills, 1 met after 2,363 min; 51 kit fills;
//   - the chat lines read naturally, are safe for the output filter, and parse as no command;
//   - install: on -> mode row + tap; off / a fleet pool -> mode row on=0 and nothing tapped; wired in installFeatures.
// Mutants (anchors asserted present and unique) prove the best view, the open-only producing rule and the kit window live.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-requests-logs-'))
process.env.BOT_NAME = 'showcase-Alpha'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-requests-pool-'))

const R_URL = new URL('../src/requests.mjs', import.meta.url)
const R = await import(R_URL.href)
const SC = await import('../src/showchat.mjs')
const { addressed } = await import('../src/commands.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
async function withMutant (url, pairs, fn) {
  let src = fs.readFileSync(url, 'utf8')
  for (const [old, neu] of pairs) {
    assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 80))}`)
    src = src.replace(old, neu)
  }
  const f = path.join(path.dirname(new URL(url).pathname), `_mutant-requests-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(f, src)
  try { return await fn(await import(f)) } finally { fs.unlinkSync(f) }
}

const rec = (name, detail, status = 'success', bot = 'showcase-Gale', ts = '2026-11-03T12:00:00.000Z') => ({ '@timestamp': ts, bot: { name: bot }, skill: { name, status, detail } })
// real details (11-02 / 11-03 showcase skill logs)
const GATE_WAIT = 'on=1 plot=hall blueprint=hall@1 builders=2 cut_needed=33 open=0 ingots=106 cut=22 need=211 containers=9 stale=0 why=copper_wait'
const GATE_PARTIAL = 'on=1 plot=hall blueprint=hall@1 builders=2 cut_needed=33 open=0 ingots=3 cut=0 need=427 containers=8 stale=0 why=copper_wait'
const GATE_OK = 'on=1 plot=hall blueprint=hall@1 builders=2 cut_needed=33 open=1 ingots=215 cut=22 need=211 containers=9 stale=0 why=ok'
const RUN = 'issued block=copper_ore ingots=106 raw=7 blocks=0 cut=22 need=211 held=0 free=9'
const RUN_SKIP = 'skip=on_site ingots=106 raw=7 blocks=0 cut=22 need=211 held=0 free=9'
const DEP_CU = 'slots 30->28 stacks 2/2 clicked 2 bagdelta 24 tools - logs banked 0 kept 16 keep 16 banked raw_copper:8,cobblestone:16 stop done'
const DEP_LOG = 'slots 34->34 stacks 1/1 clicked 1 bagdelta 16 tools - logs banked 16 kept 16 keep 16 stock 1/0 banked spruce_log:16 stop done containers -5,71,8=took'
const KIT_TOOK = 'outcome=took need=kit_iron_any town=9 cand=3 visits=2 vfail=0 maxrep=1 left=0 tried=[-5,71,8:none;-9,71,-2:success]'
const KIT_NONE = 'outcome=no_iron need=kit_iron_any town=9 cand=9 visits=7 vfail=0 maxrep=1 left=0 tried=[-9,71,2:none;-8,71,6:none]'
const KIT_CRAFT = 'phase=kit outcome=crafted needs=iron_pickaxe drew=3 sticks=0 used=3 crafted=iron_pickaxe credit=0->0 parts=1 town=9 cand=8 visits=1 vfail=0 maxrep=1 left=0 stop=- before=iron_axe@218'
const KIT_MODE = 'phase=mode on=1 mode=on note=TOOLKIT_unset'

await t('READER: real records -> events; the rest -> nothing', () => {
  assert.deepEqual(R.eventFor(rec('_copperhall_gate', GATE_WAIT, 'no_effect')), { t: 'gate', for: 'hall', item: 'copper_ingot', need: 211, have: 106 })
  assert.deepEqual(R.eventFor(rec('_copperhall_gate', GATE_OK)), { t: 'met', for: 'hall', item: 'copper_ingot' })
  assert.deepEqual(R.eventFor(rec('_copper_run', RUN)), { t: 'producing', for: 'hall', item: 'copper_ingot', block: 'copper_ore' })
  assert.deepEqual(R.eventFor(rec('_town_deposit', DEP_CU)), { t: 'deposit', units: 8 })
  assert.deepEqual(R.eventFor(rec('_kit_search', KIT_TOOK)), { t: 'kit_took', chest: '-9,71,-2' })
  assert.deepEqual(R.eventFor(rec('_kit_search', KIT_NONE)), { t: 'kit_none', outcome: 'no_iron' })
  assert.equal(R.eventFor(rec('_kit_search', KIT_NONE.replace('no_iron', 'more'))), null, 'more: the search goes on (Codex r1)')
  assert.deepEqual(R.eventFor(rec('_kit_search', KIT_NONE.replace('no_iron', 'no_sticks'))), { t: 'kit_none', outcome: 'no_sticks' })
  assert.deepEqual(R.eventFor(rec('_toolkit', KIT_CRAFT.replace('crafted=iron_pickaxe', 'crafted=iron_axe+iron_shovel'))), { t: 'kit_crafted', drew: 3, crafted: 'iron_axe+iron_shovel' }, 'a multi-tool craft (Codex r1)')
  assert.deepEqual(R.eventFor(rec('_toolkit', KIT_CRAFT)), { t: 'kit_crafted', drew: 3, crafted: 'iron_pickaxe' })
  for (const r of [rec('_copper_run', RUN_SKIP, 'no_effect'), rec('_town_deposit', DEP_LOG), rec('_toolkit', KIT_MODE), rec('_town_deposit', DEP_CU, 'failed'),
    rec('_copperhall_gate', 'on=1 why=copper_unknown'), rec('_build', 'project=hall op=place')]) assert.equal(R.eventFor(r), null, r.skill.detail)
})

const H = 3600_000, M = 60_000
const T0 = Date.parse('2026-11-02T01:00:00Z')
await t('PROJECT: one request; the best view, never a partial one; refresh only on a real move, 30 min apart', () => {
  let s = { open: {} }
  let r = R.stepProject(s, { t: 'gate', for: 'hall', item: 'copper_ingot', need: 211, have: 106 }, 'A', T0); s = r.state
  assert.deepEqual(r.rows, [{ op: 'open', for: 'hall', item: 'copper_ingot', qty: 105, need: 211, have: 106 }])
  r = R.stepProject(s, { t: 'gate', for: 'hall', item: 'copper_ingot', need: 427, have: 3 }, 'B', T0 + M); s = r.state
  assert.deepEqual(r.rows, [], 'a partial view (have=3, need=427) neither opens a second request nor flaps the first')
  assert.equal(s.open['project:hall:copper_ingot'].qty, 105)
  r = R.stepProject(s, { t: 'gate', for: 'hall', item: 'copper_ingot', need: 211, have: 150 }, 'C', T0 + 10 * M); s = r.state
  assert.deepEqual(r.rows, [], 'moved 44 >= 26 but only 10 min after the last said')
  r = R.stepProject(s, { t: 'gate', for: 'hall', item: 'copper_ingot', need: 211, have: 152 }, 'C', T0 + 31 * M); s = r.state
  assert.deepEqual(r.rows.map(x => [x.op, x.qty, x.was]), [['update', 59, 105]], 'POSITIVE: a real move, 31 min on')
  r = R.stepProject(s, { t: 'gate', for: 'hall', item: 'copper_ingot', need: 211, have: 160 }, 'C', T0 + 70 * M); s = r.state
  assert.deepEqual(r.rows, [], 'moved 8 < 16: no row')
})
await t('PROJECT: producing and fills only while open; met says how long and how many fills; stale requests expire', () => {
  let s = { open: {} }
  assert.deepEqual(R.stepProject(s, { t: 'producing', for: 'hall', item: 'copper_ingot', block: 'copper_ore' }, 'A', T0).rows, [], 'no request: no producing row')
  assert.deepEqual(R.stepProject(s, { t: 'deposit', units: 8 }, 'A', T0).rows, [], 'no request: a copper deposit is just a deposit')
  s = R.stepProject(s, { t: 'gate', for: 'hall', item: 'copper_ingot', need: 211, have: 106 }, 'A', T0).state
  let r = R.stepProject(s, { t: 'producing', for: 'hall', item: 'copper_ingot', block: 'copper_ore' }, 'B', T0 + M); s = r.state
  assert.deepEqual(r.rows, [{ op: 'producing', for: 'hall', item: 'copper_ingot', qty: 105, block: 'copper_ore' }])
  r = R.stepProject(s, { t: 'deposit', units: 8 }, 'B', T0 + 2 * M); s = r.state
  assert.deepEqual(r.rows, [{ op: 'fill', for: 'hall', item: 'copper_ingot', units: 8, src: 'bag', qty: 105 }])
  r = R.stepProject(s, { t: 'met', for: 'hall', item: 'copper_ingot' }, 'C', T0 + 5 * H); s = r.state
  assert.deepEqual(r.rows, [{ op: 'met', for: 'hall', item: 'copper_ingot', need: 211, mins: 300, fills: 1, filled: 8 }])
  assert.deepEqual(s.open, {}, 'closed')
  assert.deepEqual(R.stepProject(s, { t: 'met', for: 'hall', item: 'copper_ingot' }, 'C', T0 + 5 * H + M).rows, [], 'met twice is nothing')
  s = R.stepProject({ open: {} }, { t: 'gate', for: 'hall', item: 'copper_ingot', need: 211, have: 106 }, 'A', T0).state
  r = R.stepProject(s, { t: 'deposit', units: 1 }, 'A', T0 + 6 * H + 1)
  assert.deepEqual(r.rows.map(x => x.op), ['expire'], 'no gate row for 6 h: it expires (and the deposit is not counted)')
})
await t('KIT: a took search + its craft within 120 s is filled from the chest; a late craft is nothing; none is unfilled', () => {
  let k = R.stepKit(null, { t: 'kit_took', chest: '-9,71,-2' }, T0)
  assert.deepEqual(k.rows, [])
  let k2 = R.stepKit(k.pend, { t: 'kit_crafted', drew: 3, crafted: 'iron_pickaxe' }, T0 + 5000)
  assert.deepEqual(k2.rows, [{ op: 'filled', kind: 'kit', item: 'iron_ingot', qty: 3, src: 'chest', at: '-9,71,-2', for: 'iron_pickaxe' }])
  k2 = R.stepKit(k.pend, { t: 'kit_crafted', drew: 3, crafted: 'iron_pickaxe' }, T0 + 121_000)
  assert.deepEqual(k2.rows, [], 'a craft 121 s after the search is not this draw')
  assert.deepEqual(R.stepKit(null, { t: 'kit_crafted', drew: 3, crafted: 'iron_pickaxe' }, T0).rows, [], 'a craft with no search (own iron) is no request')
  assert.deepEqual(R.stepKit(null, { t: 'kit_none', outcome: 'no_iron' }, T0).rows, [{ op: 'unfilled', kind: 'kit', item: 'iron_ingot', outcome: 'no_iron' }])
})

const FIX = fs.readFileSync(new URL('./fixtures/requests-showcase-1101-1103.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l))
const replay = (mod, rows = FIX) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-requests-replay-'))
  const clock = { t: 0 }, boards = {}, out = []
  for (const r of [...rows].sort((a, b) => (a['@timestamp'] < b['@timestamp'] ? -1 : 1))) {
    const b = r.bot.name
    clock.t = Date.parse(r['@timestamp'])
    boards[b] ??= mod.makeBoard({ bot: { username: b }, dir, now: () => clock.t, emit: row => out.push({ t: clock.t, b, ...row }) })
    boards[b].onRecord(r)
  }
  const ops = {}
  for (const o of out) { const op = /op=(\S+)/.exec(o.detail)[1]; ops[op] = (ops[op] ?? 0) + 1 }
  return { out, ops, dir }
}
await t('REPLAY 11-01..03 (415 real rows, 10 bots, one town file): 1 open, 4 updates, 93 producing, 4 bag fills, 1 met after 2,363 min, 51 kit fills (every took search, 7 of them multi-tool)', () => {
  const { out, ops, dir } = replay(R)
  assert.deepEqual(ops, { open: 1, update: 4, producing: 93, fill: 4, met: 1, filled: 51 })
  const met = out.find(o => /op=met/.test(o.detail))
  assert.equal(met.detail, 'op=met kind=project for=hall item=copper_ingot need=211 mins=2363 fills=4 filled=39')
  assert.ok(new Date(met.t).toISOString().startsWith('2026-11-03T16:38'), 'the hall opened 16:38Z')
  const j = fs.readFileSync(path.join(dir, R.JOURNAL_FILE), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(j.length, out.length, 'every row is in the town journal')
  assert.ok(j.every(x => x.v === 1 && x.by && x.op && x.t), 'journal lines carry v, by, op, t')
  assert.ok(out.every(o => /^[a-z]+=[a-z0-9_,:+-]+( [a-z]+=[a-z0-9_,:+-]+)*$/.test(o.detail)), 'details are key=value tokens only (no free text)')
})
await t('MUTANT KILLED: without the best view the partial views flap the request (the 11-01..03 have=0 / have=130 minutes)', async () => {
  await withMutant(R_URL, [['const best = views.reduce((a, v) => (v.have > a.have ? v : a))', 'const best = views[views.length - 1]']], mod => {
    assert.ok(replay(mod).ops.update > 8, JSON.stringify(replay(mod).ops))
  })
})
await t('MUTANT KILLED: without the open-only rule a copper run with no request is a producing row', async () => {
  await withMutant(R_URL, [["    if (r) rows.push({ op: 'producing'", "    if (true) rows.push({ op: 'producing'"]], mod => {
    assert.throws(() => mod.stepProject({ open: {} }, { t: 'producing', for: 'hall', item: 'copper_ingot', block: 'copper_ore' }, 'A', T0))
  })
})
await t('MUTANT KILLED: without the kit window a late craft is counted as this draw', async () => {
  await withMutant(R_URL, [['if (!pend || now - pend.at > KIT_PAIR_MS) return', 'if (!pend) return']], mod => {
    assert.equal(mod.stepKit({ at: T0, chest: '-9,71,-2' }, { t: 'kit_crafted', drew: 3, crafted: 'iron_pickaxe' }, T0 + 3 * H).rows.length, 1)
  })
})

await t('BOARD: two processes share ONE request through the town file; the kit pending is per bot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-requests-town-')), clock = { t: T0 }, rowsA = [], rowsB = []
  const a = R.makeBoard({ bot: { username: 'showcase-Alpha' }, dir, now: () => clock.t, emit: r => rowsA.push(r) })
  const b = R.makeBoard({ bot: { username: 'showcase-Bravo' }, dir, now: () => clock.t, emit: r => rowsB.push(r) })
  a.onRecord(rec('_copperhall_gate', GATE_WAIT, 'no_effect', 'showcase-Alpha'))
  clock.t += M; b.onRecord(rec('_copperhall_gate', GATE_WAIT, 'no_effect', 'showcase-Bravo'))
  assert.deepEqual([rowsA.map(r => r.detail), rowsB.length], [['op=open kind=project for=hall item=copper_ingot qty=105 need=211 have=106'], 0])
  b.onRecord(rec('_kit_search', KIT_TOOK, 'success', 'showcase-Bravo'))
  a.onRecord(rec('_toolkit', KIT_CRAFT, 'success', 'showcase-Alpha'))
  assert.equal(rowsA.length, 1, "Alpha's craft is not Bravo's draw")
  b.onRecord(rec('_toolkit', KIT_CRAFT, 'success', 'showcase-Bravo'))
  assert.deepEqual(rowsB.map(r => [r.kind, r.status, r.detail]), [['request', 'success', 'op=filled kind=kit for=iron_pickaxe item=iron_ingot qty=3 src=chest at=-9,71,-2']])
  a.onRecord({ ...rec('_request', 'op=open'), bot: { name: 'showcase-Alpha' } })
  assert.equal(rowsA.length, 1, 'never about its own rows')
})

// THE CHAT LINES
const say = (detail, bot = 'showcase-Gale') => SC.lineFor(rec('_request', detail, 'success', bot))
const NAMES = ['mike', 'showcase-Alpha', 'showcase-Gale']
await t('CHAT: each op reads as a plain line; tiers and keys; nothing for expire', () => {
  const L = [
    ['op=open kind=project for=hall item=copper_ingot qty=105 need=211 have=106', 2, 'The copper hall needs 105 more copper ingots (the town has 106).'],
    ['op=update kind=project for=hall item=copper_ingot qty=31 need=211 have=180 was=80', 2, 'The copper hall needs 31 more copper ingots (the town has 180).'],
    ['op=producing kind=project for=hall item=copper_ingot qty=49 block=copper_ore', 3, 'Heading out to mine copper ore for the copper hall (it still needs 49).'],
    ['op=producing kind=project for=hall item=copper_ingot qty=49 block=deepslate_copper_ore', 3, 'Heading out to mine copper ore for the copper hall (it still needs 49).'],
    ['op=fill kind=project for=hall item=copper_ingot qty=117 units=8 src=bag', 2, 'Brought 8 copper for the copper hall (it still needs 117).'],
    ['op=met kind=project for=hall item=copper_ingot need=211 mins=2363 fills=4 filled=39', 1, 'The copper hall has all the copper it needs after 39 h, 4 deliveries from our bags!'],
    ['op=met kind=project for=hall item=copper_ingot need=211 mins=20 fills=0 filled=0', 1, 'The copper hall has all the copper it needs!'],
    ['op=filled kind=kit for=iron_pickaxe item=iron_ingot qty=3 src=chest at=-9,71,-2', 2, 'I needed 3 iron ingots for an iron pickaxe and found them in the town chest at -9, 71, -2.'],
    ['op=filled kind=kit for=iron_shovel item=iron_ingot qty=1 src=chest at=-', 2, 'I needed 1 iron ingot for an iron shovel and found it in the town chests.'],
    ['op=unfilled kind=kit item=iron_ingot outcome=no_iron', 3, 'I needed iron ingots for my tools, but the town chests had none.'],
    ['op=filled kind=kit for=iron_axe+iron_shovel item=iron_ingot qty=4 src=chest at=-9,71,2', 2, 'I needed 4 iron ingots for an iron axe and an iron shovel and found them in the town chest at -9, 71, 2.'],
  ]
  for (const [d, tier, text] of L) {
    const c = say(d)
    assert.ok(c, d)
    assert.deepEqual([c.cat, c.tier, c.text], ['request', tier, text])
    assert.equal(SC.unsafeWhy(c.text, NAMES), null, c.text)
    assert.equal(addressed(c.text, 'showcase-Gale'), null, `parses as no command: ${c.text}`)
  }
  assert.equal(say('op=filled kind=kit for=iron_pickaxe item=iron_ingot qty=3 src=chest at=-9,71,-2').key, 'ironpick:showcase-Gale', 'shares the iron-pick line\'s key: never both')
  for (const o of ['no_sticks', 'unseen', 'stalled']) assert.equal(say(`op=unfilled kind=kit item=iron_ingot outcome=${o}`), null, `${o} is not "the chests had none" (Codex r1)`)
  assert.equal(say('op=expire kind=project for=hall item=copper_ingot qty=105 mins=360 fills=0 filled=0'), null)
  assert.equal(say('op=open kind=project for=hall item=Copper!x qty=5'), null, 'a non-registry item name is never spoken')
})
await t('CHAT: the 11-01..03 replay through one speaker -- the hall\'s requests are said, the copper runs at most once an hour', () => {
  const { out } = replay(R)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-requests-say-')), clock = { t: 0 }, said = []
  const sp = {}
  for (const o of out) {
    clock.t = o.t
    sp[o.b] ??= SC.makeSpeaker({ bot: { username: o.b }, say: x => said.push([clock.t, x]), dir, now: () => clock.t, defer: () => {}, names: () => NAMES })
    sp[o.b].onRecord({ '@timestamp': new Date(o.t).toISOString(), bot: { name: o.b }, skill: { name: '_request', status: o.status, detail: o.detail } })
  }
  const prod = said.filter(([, x]) => /^Heading out/.test(x))
  assert.ok(prod.length >= 5 && prod.length <= 39, `producing lines ${prod.length} (93 rows over 39 h)`)
  for (let i = 1; i < prod.length; i++) assert.ok(prod[i][0] - prod[i - 1][0] >= H, `at most once an hour: ${new Date(prod[i - 1][0]).toISOString()} ${new Date(prod[i][0]).toISOString()} ${prod[i][1]}`)
  assert.ok(said.some(([, x]) => x === 'The copper hall needs 427 more copper ingots (the town has 0).'), 'POSITIVE: the open line')
  assert.ok(said.some(([, x]) => /^The copper hall has all the copper it needs after 39 h/.test(x)), 'the met line')
  assert.ok(said.filter(([, x]) => /^I needed \d+ iron ingots? for/.test(x)).length >= 20, 'kit lines (51 rows, 30-min per-bot dedupe)')
})

// INSTALL
const { logEvent: _le } = await import('../src/logger.mjs')
const F = await import('../src/features.mjs')
const ROWS = []
const { tapRecords } = await import('../src/logger.mjs')
tapRecords(r => ROWS.push(r))
await t('INSTALL: on -> the mode row says on=1 and a logged gate row becomes a _request row; off / a fleet pool -> on=0 and nothing', () => {
  const bot = { username: 'showcase-Alpha', once: () => {} }
  ROWS.length = 0
  const board = F.installRequests(bot, { env: { REQUESTS: 'on' }, pool: 'showcase' })
  assert.ok(board)
  assert.ok(ROWS.some(r => r.skill?.name === '_requests_mode' && /^on=1 v=1 pool=showcase /.test(r.skill.detail)))
  _le({ kind: 'copperhall_gate', status: 'no_effect', detail: GATE_WAIT, snapshot: { bot: { pos: { x: 0, y: 70, z: 0 } } } })
  assert.ok(ROWS.some(r => r.skill?.name === '_request' && /^op=open kind=project for=hall item=copper_ingot qty=105 /.test(r.skill.detail)), JSON.stringify(ROWS.map(r => r.skill?.name)))
  for (const [env, pool] of [[{ REQUESTS: 'off' }, 'showcase'], [{}, 'hive-a']]) {
    ROWS.length = 0
    assert.equal(F.installRequests({ username: 'x', once: () => {} }, { env, pool }), null)
    assert.ok(ROWS.some(r => r.skill?.name === '_requests_mode' && /^on=0 /.test(r.skill.detail)))
  }
  assert.equal(R.requestsOn({}, 'showcase'), true); assert.equal(R.requestsOn({}, 'hive-a'), false); assert.equal(R.requestsOn({ REQUESTS: 'on' }, 'hive-a'), true)
})
await t('STRUCTURAL: installFeatures calls installRequests on its executable path', () => {
  const src = fs.readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  assert.equal((src.match(/try \{ installRequests\(bot\) \} catch/g) ?? []).length, 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

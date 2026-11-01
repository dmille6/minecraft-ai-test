// SHOWCHAT-01 (showchat.mjs + features.mjs installShowchat): the showcase's templated chat announcements (comms stage 2).
//
// Behaviour under test:
//   - the catalogue: REAL showcase records (11-01 skill logs, copied verbatim) -> the exact line a human reads; noise -> nothing;
//   - a section is news only on an open -> closed change the town saw (never on a first sighting, never twice);
//   - the rate rules: per-bot gap, per-town gap (shared ACROSS processes through the town file), dedupe, tier-3 quiet,
//     hourly caps, tier 1's wider cap;
//   - the output filter refuses command- and name-shaped lines, and every template output is safe AND parses as no command
//     for the whitelisted speaker (commands.mjs addressed());
//   - the chatter filter drops "milestone done -- now: idle" and friends, passes templates and /commands;
//   - the kill switch file silences announcements without a restart; SHOWCHAT=off installs nothing;
//   - installShowchat on a fake bot: a logged record becomes one chat line, a reconnect does not double it.
// Mutants (anchors asserted present and unique) prove the filter, the section rule, the town gap and the chatter filter live.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-showchat-logs-'))
process.env.BOT_NAME = 'showcase-Alpha'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
const POOLDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-showchat-pool-'))
process.env.POOL_STATE_DIR = POOLDIR

const SC_URL = new URL('../src/showchat.mjs', import.meta.url)
const SC = await import(SC_URL.href)
const { lineFor, segTransition, decide, unsafeWhy, isNoise, makeSpeaker, quietChatter, showchatOn, RATE, itemPhrase, projectName } = SC
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
  const f = path.join(path.dirname(new URL(url).pathname), `_mutant-showchat-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(f, src)
  try { return await fn(await import(f)) } finally { fs.unlinkSync(f) }
}

const rec = (name, detail, extra = {}) => ({ '@timestamp': '2026-11-01T15:16:23.000Z', bot: { name: 'showcase-Juno', pos: { x: -36.5, y: 70, z: -5.5 } }, skill: { name, status: 'success', detail, ...extra } })

// THE CATALOGUE: real 11-01 showcase details -> the line
const CASES = [
  [rec('_structure_complete', 'project=storehouse op=complete kind=storehouse@1 gen=2'), 'project_done', 1, 'The storehouse is finished!'],
  [rec('_structure_complete', 'project=monument op=complete kind=ziggurat@1 gen=2'), 'project_done', 1, 'The ziggurat is finished!'],
  [rec('_structure_complete', 'project=house1 op=complete kind=house@1 gen=2'), 'project_done', 1, 'The first house is finished!'],
  [rec('_build', 'project=monument op=sited cell=-55,69,-43 kind=e/B30/cells4889/fill953/cut57/clear1604 gen=1'), 'project_start', 1, 'Starting work on the ziggurat at -55, -43.'],
  [rec('_build', 'project=house1 op=sited cell=-33,-9 kind=W/S/free gen=1'), 'project_start', 1, 'Starting work on the first house at -33, -9.'],
  [rec('_expedition', 'op=start trip=showcase-Alpha-mvx8t3qq bearing=7 ring=150 reuse=1 markers_known=13 kit=torch:6'), 'expedition_out', 2, 'Heading out on an expedition to the north-east, aiming for 150 blocks out.'],
  [rec('_expedition_trip', 'trip=showcase-Alpha-mvx8t3qq bearing=7 ring=150 dist=76 reason=water returned=1 via=crumbs crumbs=3 markers=0 reused=1 deposited=0 ms=64310 haul=spruce_log:1'), 'expedition_back', 2, 'Back from the north-east: got 76 blocks out and turned back at water, brought home 1 spruce log.'],
  [rec('_expedition_trip', 'trip=showcase-Bravo-mvx8872t bearing=5 ring=100 dist=110 reason=reached returned=1 via=crumbs crumbs=4 markers=0 reused=0 deposited=0 ms=61864 haul=-'), 'expedition_back', 2, 'Back from the north-west: got 110 blocks out and reached the far mark.'],
  [rec('_town_deposit', 'slots 34->34 stacks 1/1 clicked 1 bagdelta 16 tools - logs banked 16 kept 16 keep 16 stock 1/0 banked spruce_log:16 stop done containers -5,71,8=took'), 'deposit', 3, 'Stored 16 spruce logs in the town chests.'],
  [rec('_kit_ironpick', 'outcome=crafted made=1 best=iron_pickaxe@30->iron_pickaxe@250 drew=3 iron_seen=19 keep=16 slots=31'), 'tech', 2, "Made an iron pickaxe from the town's iron."],
  [rec('_needs_rescue', 'arm=escape_guard at=-54,64,-31 block=? guard=? -- every escape dig here has crossed a guarded cell for 2 min', { status: 'failed' }), 'stuck', 2, "I'm stuck at -36, 70, -5. Working my way out."],
  [rec('_death', 'drowning; was running mine', { status: 'failed', fail_class: 'drowning' }), 'death', 1, 'I drowned near -36, 70, -5. Respawning in town.'],
  [rec('mine', 'mined 6', { inventory_delta: { raw_iron: 6, cobblestone: 12 } }), 'ore', 2, 'Found iron at y=70: +6 raw iron.'],
  [rec('mine', 'mined', { inventory_delta: { diamond: 2, raw_iron: 1 } }), 'ore', 1, 'Found diamonds at y=70! +2'],
  [rec('smelt', 'smelted', { inventory_delta: { iron_ingot: 15, raw_iron: -15 } }), 'smelt', 3, 'Smelted 15 iron ingots.'],
]
await t('CATALOGUE: real showcase records become the exact lines a human reads', () => {
  for (const [r, cat, tier, text] of CASES) {
    const c = lineFor(r)
    assert.ok(c, `no line for ${r.skill.name} ${r.skill.detail}`)
    assert.deepEqual([c.cat, c.tier, c.text], [cat, tier, text])
  }
})
await t('CATALOGUE: the noise makes no line (the 11-01 top kinds, a failed deposit, a gate-turned trip, a small deposit, a withdraw)', () => {
  const none = [
    rec('_path_reset', 'x'), rec('_milestone_complete', 'completed return#582; now idle'), rec('_build', 'project=monument op=clear_failed seg=F-W cell=-55,67,-35 block=grass_block kind=foreign result=no_stand'),
    rec('_build', 'project=storehouse op=place at=1,2,3'), { ...rec('_town_deposit', 'banked torch:6 stop done'), skill: { name: '_town_deposit', status: 'failed', detail: 'banked spruce_log:32' } },
    rec('_town_deposit', 'slots 27->26 stacks 1/1 clicked 1 bagdelta 6 tools - logs banked 0 kept 16 keep 16 banked torch:6 stop done'),
    rec('_expedition_trip', 'trip=x bearing=7 ring=100 dist=12 reason=water returned=1 haul=-'),
    rec('_expedition_trip', 'trip=x bearing=4 ring=150 dist=24 reason=- returned=0 via=later haul=-', { status: 'no_effect' }),
    rec('withdraw_pick', 'took', { inventory_delta: { iron_pickaxe: 1 } }), rec('mine', 'mined', { inventory_delta: { cobblestone: 30 } }),
    rec('_build', 'project=tidy op=sited cell=0,70,0 gen=1'), rec('_expedition', 'op=skip why=night', { status: 'no_effect' }),
  ]
  for (const r of none) assert.equal(lineFor(r), null, `${r.skill.name} ${r.skill.detail}`)
  assert.ok(lineFor(CASES[0][0]), 'positive control')
})
await t('WORDS: items and projects read naturally', () => {
  assert.equal(itemPhrase('torch', 6), '6 torches'); assert.equal(itemPhrase('spruce_log', 1), '1 spruce log')
  assert.equal(itemPhrase('raw_copper', 9), '9 raw copper'); assert.equal(itemPhrase('glass', 4), '4 glass')
  assert.equal(projectName('shop'), 'workshop'); assert.equal(projectName('house2'), 'house no. 2'); assert.equal(projectName('shopchest'), 'materials chests')
})

await t('SECTIONS: a closed row is news once; a repeat is not; reopened and closed again is news again; names read naturally', () => {
  const c = lineFor(rec('_build_seg', 'project=storehouse seg=wall-B open=0 done=14'))
  assert.equal(c.text, "Finished the storehouse's back wall (14 blocks).")
  let s = {}
  let r = segTransition(s, 'storehouse:wall-B', 0); assert.equal(r.announce, true, 'closed in the visit that first logged it (58 of 103 on the showcase)'); s = r.segs
  r = segTransition(s, 'storehouse:wall-B', 0); assert.equal(r.announce, false, 'a repeat row is not news'); s = r.segs
  s = {}
  r = segTransition(s, 'storehouse:wall-B', 8); assert.equal(r.announce, false); s = r.segs
  r = segTransition(s, 'storehouse:wall-B', 4); assert.equal(r.announce, false); s = r.segs
  r = segTransition(s, 'storehouse:wall-B', 0); assert.equal(r.announce, true, 'POSITIVE: open -> closed'); s = r.segs
  r = segTransition(s, 'storehouse:wall-B', 0); assert.equal(r.announce, false, 'not twice'); s = r.segs
  r = segTransition(s, 'storehouse:wall-B', 2); s = r.segs
  r = segTransition(s, 'storehouse:wall-B', 0); assert.equal(r.announce, true, 'reopened (damage) and closed again')
  const nm = (p, g) => lineFor(rec('_build_seg', `project=${p} seg=${g} open=0 done=20`)).text
  assert.equal(nm('monument', 'L03-E'), "Finished the ziggurat's layer 4, east side (20 blocks).")
  assert.equal(nm('monument', 'F-W'), "Finished the ziggurat's west foundation (20 blocks).")
  assert.equal(nm('wall', 'W-00'), "Finished the town wall's section 1 (20 blocks).")
  assert.equal(nm('treefarm', 'F'), "Finished the tree farm's planting field (20 blocks).")
  assert.equal(nm('house1', 'earth'), "Finished the first house's groundwork (20 blocks).")
  assert.equal(lineFor(rec('_build_seg', 'project=paths seg=P-house1-0 open=0 done=27')).text, null, 'path legs are tracked, not named')
})

await t('RATE: bot gap, town gap, dedupe, tier-3 quiet, hourly caps, tier 1 at twice the caps', () => {
  const now = 10 * 3600_000
  const c2 = { key: 'k', tier: 2, dedupeMs: 600_000 }
  assert.deepEqual(decide([], c2, 'A', now), { ok: true }, 'POSITIVE: an empty town speaks')
  assert.equal(decide([{ t: now - 60_000, bot: 'A', key: 'x', tier: 2 }], c2, 'A', now).why, 'bot_gap')
  assert.equal(decide([{ t: now - 130_000, bot: 'A', key: 'x', tier: 2 }], c2, 'A', now).ok, true)
  assert.equal(decide([{ t: now - 10_000, bot: 'B', key: 'x', tier: 2 }], c2, 'A', now).why, 'town_gap')
  assert.equal(decide([{ t: now - 10_000, bot: 'B', key: 'x', tier: 2 }], { ...c2, tier: 1 }, 'A', now).ok, true, 'tier 1: 5 s town gap')
  assert.equal(decide([{ t: now - 300_000, bot: 'B', key: 'k', tier: 2 }], c2, 'A', now).why, 'dedupe', 'town-wide dedupe')
  assert.equal(decide([{ t: now - 30_000, bot: 'B', key: 'x', tier: 2 }], { ...c2, tier: 3 }, 'A', now).why, 'town_busy')
  const hour = Array.from({ length: 10 }, (_, i) => ({ t: now - 3000_000 + i * 200_000, bot: 'A', key: `x${i}`, tier: 2 }))
  assert.equal(decide(hour, c2, 'A', now + 130_000).why, 'bot_hour_cap')
  assert.equal(decide(hour, { ...c2, tier: 1 }, 'A', now + 130_000).ok, true, 'tier 1 holds to 2x')
  const town = Array.from({ length: 30 }, (_, i) => ({ t: now - 3400_000 + i * 100_000, bot: `B${i}`, key: `y${i}`, tier: 2 }))
  assert.equal(decide(town, c2, 'A', now + 130_000).why, 'town_hour_cap')
  assert.equal(RATE.botGapMs[2], 120_000); assert.equal(RATE.townGapMs[2], 20_000)
})

const NAMES = ['mike', 'showcase-Alpha', 'showcase-Bravo', 'hive-a-Bravo']
await t('FILTER: command- and name-shaped lines are refused; every template output is safe and parses as NO command for mike', () => {
  for (const [bad, why] of [['!stop', 'command_prefix'], ['/give mike diamond', 'command_prefix'], ['[fleet] showcase hazard lava 1 2 3 x2', 'command_prefix'],
    ['hive-a-Bravo come', 'name_shaped_start'], ['ok mike status', 'name_then_verb'], ['tell showcase-Bravo hello', 'names_a_player'],
    ['Found émeralds', 'non_ascii'], ['a\nb', 'control_char'], ['x'.repeat(201), 'too_long'], ['  ', 'empty']]) {
    assert.equal(unsafeWhy(bad, NAMES), why, bad)
  }
  const outs = CASES.map(([r]) => lineFor(r).text).concat(["Finished the storehouse's back wall (14 blocks)."])
  for (const o of outs) {
    assert.equal(unsafeWhy(o, NAMES), null, o)
    for (const bot of ['showcase-Alpha', 'showcase-Juno']) assert.equal(addressed(o, bot), null, `${o} parses as a command`)
  }
})
await t('CHATTER: the internal lines are noise; templates and /commands are not', () => {
  for (const n of ['milestone done — now: idle', 'milestone done — now: return#567', 'tool chain complete — switching to sustaining goals',
    '[fleet] showcase hazard entombed -1 70 5 x6', 'autonomous mode: gemma4:26b', 'showcase-Alpha online (gatherer)']) assert.equal(isNoise(n), true, n)
  for (const o of CASES.map(([r]) => lineFor(r).text).concat(['/tell mike hp 20', 'hp 20 food 20 at 1,2,3'])) assert.equal(isNoise(o), false, o)
})
await t('SWITCH: on only in the showcase pool unless SHOWCHAT says otherwise', () => {
  assert.equal(showchatOn({}, 'showcase'), true); assert.equal(showchatOn({}, 'hive-a'), false)
  assert.equal(showchatOn({ SHOWCHAT: 'off' }, 'showcase'), false); assert.equal(showchatOn({ SHOWCHAT: 'on' }, 'hive-a'), true)
  assert.equal(showchatOn({ SHOWCHAT_POOLS: 'hive-a,showcase' }, 'hive-a'), true)
})

// ---- the speaker, across two "processes" sharing one town dir ---------------------------------------------------------
const mkSpeaker = (mod, name, dir, clock, extra = {}) => {
  const said = [], rows = []
  const sp = mod.makeSpeaker({ bot: { username: name }, say: x => said.push(x), dir, emit: r => rows.push(r), now: () => clock.t, defer: (fn) => clock.later.push(fn), names: () => NAMES, ...extra })
  return { sp, said, rows }
}
const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-showchat-town-'))
await t('SPEAKER: two bots share the town gap through the file; dedupe across them; lines file + _say row; drops counted', () => {
  const dir = freshDir(), clock = { t: 1e12, later: [] }
  const a = mkSpeaker(SC, 'showcase-Alpha', dir, clock), b = mkSpeaker(SC, 'showcase-Bravo', dir, clock)
  a.sp.onRecord(CASES[5][0])   // expedition out (tier 2)
  assert.deepEqual(a.said, ['Heading out on an expedition to the north-east, aiming for 150 blocks out.'], 'POSITIVE: the first line is said')
  clock.t += 5_000
  b.sp.onRecord(CASES[9][0])   // iron pick (tier 2) 5 s later from ANOTHER bot
  assert.deepEqual(b.said, [], 'the town gap holds across processes')
  assert.equal(b.sp.stats.dropped.town_gap, 1)
  clock.t += 30_000
  b.sp.onRecord(CASES[9][0]); assert.equal(b.said.length, 1, 'after the gap it speaks')
  clock.t += 200_000
  b.sp.onRecord(CASES[9][0]); assert.equal(b.said.length, 1, 'dedupe: the same key within 30 min')
  const lines = fs.readFileSync(path.join(dir, SC.LINES_FILE), 'utf8').trim().split('\n').map(JSON.parse)
  assert.deepEqual(lines.map(l => [l.bot, l.cat]), [['showcase-Alpha', 'expedition_out'], ['showcase-Bravo', 'tech']])
  assert.ok(a.rows.some(r => r.kind === 'say' && /cat=expedition_out tier=2 key=expout:showcase-Alpha-mvx8t3qq src=_expedition@15:16:23 text=Heading out/.test(r.detail)), JSON.stringify(a.rows))
  assert.equal(b.sp.flush(true), true)
  assert.ok(b.rows.some(r => r.kind === 'say_drop' && /dropped=dedupe:1,town_gap:1 /.test(r.detail)), JSON.stringify(b.rows))
})
await t('SPEAKER: a section is spoken once, at the town-seen close; a death waits for the respawn', () => {
  const dir = freshDir(), clock = { t: 2e12, later: [] }
  const a = mkSpeaker(SC, 'showcase-Haven', dir, clock), b = mkSpeaker(SC, 'showcase-Iris', dir, clock)
  a.sp.onRecord(rec('_build_seg', 'project=storehouse seg=wall-B open=4 done=10'))
  clock.t += 60_000
  b.sp.onRecord(rec('_build_seg', 'project=storehouse seg=wall-B open=0 done=14'))
  assert.deepEqual(b.said, ["Finished the storehouse's back wall (14 blocks)."], 'another bot closes what the town saw open')
  clock.t += 3 * 3600_000
  a.sp.onRecord(rec('_build_seg', 'project=storehouse seg=wall-B open=0 done=14'))
  assert.deepEqual(a.said, [], 'never twice (the town file remembers it closed, across bots)')
  a.sp.onRecord(CASES[11][0])
  assert.deepEqual(a.said, [], 'the death line is deferred')
  clock.t += 6_000; clock.later.shift()()
  assert.deepEqual(a.said, ['I drowned near -36, 70, -5. Respawning in town.'])
})
await t('KILL SWITCH: showchat.off silences announcements within 15 s, no restart; removing it resumes', () => {
  const dir = freshDir(), clock = { t: 3e12, later: [] }
  const a = mkSpeaker(SC, 'showcase-Alpha', dir, clock)
  a.sp.onRecord(CASES[0][0]); assert.equal(a.said.length, 1, 'POSITIVE: speaks before the switch')
  fs.writeFileSync(path.join(dir, SC.KILL_FILE), '')
  clock.t += 16_000
  a.sp.onRecord(CASES[1][0]); assert.equal(a.said.length, 1, 'killed'); assert.equal(a.sp.stats.dropped.killed, 1)
  fs.unlinkSync(path.join(dir, SC.KILL_FILE)); clock.t += 16_000
  a.sp.onRecord(CASES[1][0]); assert.equal(a.said.length, 2, 'resumed')
})
await t('TOWN FILE: a held lock defers a tier-1 line once (then it is said); a 24 h dedupe outlives the 2 h history window', () => {
  const dir = freshDir(), clock = { t: 6e12, later: [] }
  const a = mkSpeaker(SC, 'showcase-Juno', dir, clock)
  const lock = path.join(dir, SC.STATE_FILE + '.lock')
  fs.writeFileSync(lock, '1')   // another bot mid-write (fresh mtime: not stale)
  a.sp.onRecord(CASES[0][0])
  assert.deepEqual(a.said, []); assert.equal(clock.later.length, 1, 'one retry queued')
  fs.unlinkSync(lock); clock.later.shift()()
  assert.deepEqual(a.said, ['The storehouse is finished!'], 'POSITIVE: the retry speaks')
  clock.t += 3 * 3600_000
  a.sp.onRecord(CASES[0][0])
  assert.deepEqual(a.said, ['The storehouse is finished!'], 'the same completion is still deduped 3 h later')
  assert.equal(a.sp.stats.dropped.dedupe, 1)
  clock.t += 22 * 3600_000
  a.sp.onRecord(CASES[0][0]); assert.equal(a.said.length, 2, 'after 24 h it may be said again')
})
const UNSAFE_CAT = () => ({ cat: 'x', tier: 1, key: 'u', dedupeMs: 1, text: 'hive-a-Bravo come' })
await t('FILTER LIVE IN THE SPEAKER: an unsafe catalogue line is dropped (unsafe_name_shaped_start)', () => {
  const a = mkSpeaker(SC, 'showcase-Alpha', freshDir(), { t: 4e12, later: [] }, { catalogue: UNSAFE_CAT })
  a.sp.onRecord(CASES[0][0]); assert.deepEqual(a.said, []); assert.equal(a.sp.stats.dropped.unsafe_name_shaped_start, 1)
})
await t('MUTANT KILLED: without the output filter the unsafe line is said', async () => {
  await withMutant(SC_URL, [['      if (unsafe) return { state: { ...state, segs }, ok: false, why: `unsafe_${unsafe}` }\n', '']], mod => {
    const a = mkSpeaker(mod, 'showcase-Alpha', freshDir(), { t: 4e12, later: [] }, { catalogue: UNSAFE_CAT })
    a.sp.onRecord(CASES[0][0]); assert.deepEqual(a.said, ['hive-a-Bravo come'])
  })
})
await t('MUTANT KILLED: without the "already closed" test a repeat row is announced again', async () => {
  await withMutant(SC_URL, [['open === 0 && prev !== 0', 'open === 0']], mod => {
    assert.equal(mod.segTransition({ 'storehouse:wall-B': 0 }, 'storehouse:wall-B', 0).announce, true)
  })
})
await t('MUTANT KILLED: without the town gap a second bot speaks 5 s later', async () => {
  await withMutant(SC_URL, [["  if (now - lastTown < rate.townGapMs[tier]) return { ok: false, why: 'town_gap' }\n", '']], mod => {
    const dir = freshDir(), clock = { t: 5e12, later: [] }
    const a = mkSpeaker(mod, 'showcase-Alpha', dir, clock), b = mkSpeaker(mod, 'showcase-Bravo', dir, clock)
    a.sp.onRecord(CASES[5][0]); clock.t += 5_000; b.sp.onRecord(CASES[9][0])
    assert.equal(b.said.length, 1)
  })
})
await t('QUIET CHATTER: the wrapper drops noise (counted), passes templates; idempotent; MUTANT: without it the noise is sent', async () => {
  const sent = [], stats = { noise: 0 }
  const bot = { chat: m => sent.push(m) }
  const orig = quietChatter(bot, stats)
  bot.chat('milestone done — now: idle'); bot.chat('The storehouse is finished!')
  assert.deepEqual(sent, ['The storehouse is finished!']); assert.equal(stats.noise, 1)
  assert.equal(quietChatter(bot, stats), orig, 'a second install returns the same original, no double wrap')
  await withMutant(SC_URL, [['    if (isNoise(message)) { stats.noise++; return }\n', '']], mod => {
    const s2 = [], b2 = { chat: m => s2.push(m) }
    mod.quietChatter(b2, { noise: 0 }); b2.chat('milestone done — now: idle')
    assert.deepEqual(s2, ['milestone done — now: idle'])
  })
})

// ---- installShowchat on a fake bot (features.mjs) ------------------------------------------------------------------------
const { logEvent, tapRecords } = await import('../src/logger.mjs')
const { fakeWorld } = await import('./fakeworld.mjs')
const F = await import('../src/features.mjs')
const ROWS = []; tapRecords(r => ROWS.push(r))
await t('INSTALL: on -> a logged record becomes ONE chat line, noise is dropped, a reconnect does not double it; the mode row says on=1', () => {
  const w = fakeWorld(); const said = []; w.bot.chat = m => said.push(m); w.bot.username = 'showcase-Alpha'; w.bot.players = { mike: {} }
  ROWS.length = 0
  F.installShowchat(w.bot, { env: { SHOWCHAT: 'on' }, pool: 'showcase' })
  assert.ok(ROWS.some(r => r.skill?.name === '_showchat_mode' && /^on=1 v=1 pool=showcase killed=0 /.test(r.skill.detail)), 'mode row')
  w.bot.chat('milestone done — now: idle')
  assert.deepEqual(said, [], 'chatter dropped')
  // a reconnect: a NEW bot object, installFeatures again
  const w2 = fakeWorld(); const said2 = []; w2.bot.chat = m => said2.push(m); w2.bot.username = 'showcase-Alpha'
  F.installShowchat(w2.bot, { env: { SHOWCHAT: 'on' }, pool: 'showcase' })
  logEvent({ kind: 'structure_complete', status: 'success', detail: 'project=wall op=complete kind=wall@1 gen=3', snapshot: { bot: { pos: { x: 1, y: 70, z: 2 } } } })
  assert.deepEqual([said, said2], [[], ['The town wall is finished!']], 'only the live bot speaks, once')
  assert.ok(ROWS.some(r => r.skill?.name === '_say' && /text=The town wall is finished!$/.test(r.skill.detail)), 'the _say row')
})
await t('INSTALL: SHOWCHAT=off (or a fleet pool) -> mode row on=0, chat untouched, nothing said', () => {
  for (const [env, pool] of [[{ SHOWCHAT: 'off' }, 'showcase'], [{}, 'hive-a']]) {
    const w = fakeWorld(); const said = []; const chat = m => said.push(m); w.bot.chat = chat
    ROWS.length = 0
    assert.equal(F.installShowchat(w.bot, { env, pool }), null)
    assert.equal(w.bot.chat, chat, 'not wrapped')
    assert.ok(ROWS.some(r => r.skill?.name === '_showchat_mode' && /^on=0 /.test(r.skill.detail)))
  }
})
await t('STRUCTURAL: installFeatures calls installShowchat on its executable path', () => {
  const src = fs.readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  assert.equal((src.match(/try \{ installShowchat\(bot\) \} catch/g) ?? []).length, 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

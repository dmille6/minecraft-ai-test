// NOSTOCK-01show (OWNER 11-16 "we should not use idle bots to just collect random items"; docs/reports/gather-diag-2026-11-20.md):
//   (a) where NOSTOCK is on (the showcase), the gatherer chain's held counts are stepped over and the kit base's stock rungs are
//       asked only while the kit consumes them -- a gather is asked only for a named consumer (a refill job, a bill, iron, the kit);
//   (b) the 16-dirt `gather_rung` keep goes with them, so a visit spends bag dirt above the escape reserve (8 tower blocks);
//   (c) gather skips protected / built cells at enumeration, walks out past them once, and refuses naming the reason and a point.
// This file runs AS THE SHOWCASE (MEMORY_POOL=showcase before any import: the yard's lanes on, refill on -> NOSTOCK on).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
process.env.OLLAMA_MODEL ??= 'test'
process.env.MEMORY_POOL = 'showcase'
process.env.BOT_ROLE = 'gatherer'
process.env.HOME_X = '0'; process.env.HOME_Y = '30'; process.env.HOME_Z = '0'
process.env.LOG_DIR ??= mkdtempSync(join(tmpdir(), 'nostock-test-'))
process.env.STATE_DIR ??= mkdtempSync(join(tmpdir(), 'nostock-state-'))
const MS = await import('../src/milestones.mjs')
const TD = await import('../src/towndeposit.mjs')
const GB = await import('../src/gatherbuilt.mjs')
const SK = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const MC = createRequire(import.meta.url)('minecraft-data')('1.21.8')
const MS_URL = new URL('../src/milestones.mjs', import.meta.url)
const TD_URL = new URL('../src/towndeposit.mjs', import.meta.url)
const SK_URL = new URL('../src/skills.mjs', import.meta.url)

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
/** An anchored mutant (present AND unique), imported from test/ (CLAUDE.md: a mutant that silently fails to apply reads as killed). */
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-nostock-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---------------------------------------------------------------- (a) the milestone chain
const items = bag => () => Object.entries(bag).map(([name, count]) => ({ name, count, type: MC.itemsByName[name]?.id, maxDurability: /_pickaxe$/.test(name) ? 131 : undefined, durabilityUsed: 0 }))
const fakeBot = bag => ({ inventory: { items: items(bag) }, entity: { position: new Vec3(0, 30, 0) }, registry: MC })
/** Kit held: a table, a stone pickaxe, a furnace -- the kit base has no consumer left. */
const KIT = { crafting_table: 1, stone_pickaxe: 1, furnace: 1 }
const store = () => { const s = { attempts: {}, skipped: [], skippedAt: {}, skipCount: {}, cycle: 0, completions: {} }; return { getProgress: () => s, setProgress () {}, save () {} } }
const statusOf = (M, bag) => { const c = new M.MilestoneController(fakeBot(bag), 'gatherer', store(), null); c.refresh(); return c.status() }
const isGather = st => /^(gather_|stockpile_|refill_job)/.test(st.id) || /^gather with/.test(st.hint ?? '')

await ta('the switch: the showcase pool turns NOSTOCK on in both modules (they agree); a fleet pool leaves both off', async () => {
  assert.equal(MS.NOSTOCK.on, true); assert.equal(TD.NOSTOCK_KEEP.on, true)
  const script = "Promise.all([import('./src/milestones.mjs'), import('./src/towndeposit.mjs')]).then(([m, t]) => console.log(JSON.stringify([m.NOSTOCK.on, t.NOSTOCK_KEEP.on])))"
  const run = env => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ...env }, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).trim().split('\n').pop())
  assert.deepEqual(run({ MEMORY_POOL: 'board-a' }), [false, false], 'the fleet: untouched')
  assert.deepEqual(run({ MEMORY_POOL: 'showcase', REFILL: 'off' }), [false, false], 'REFILL=off: the switch is the refill switch')
})

await ta('(a) a bot at 15 dirt with its kit and no job: NO gather milestone (positive control: the base asks "Collect 16 dirt")', async () => {
  MS.setRefillJob(() => null)
  try {
    const bag = { dirt: 15, ...KIT }
    MS.setNoStock(false)
    const base = statusOf(MS, bag)
    assert.equal(base.id, 'gather_dirt_16', 'positive control: the base\'s chain lands on the dirt rung')
    assert.match(base.describe, /^Collect 16 dirt/)
    MS.setNoStock(null)
    const st = statusOf(MS, bag)
    assert.ok(!isGather(st), `no gather rung, got ${st.id}: ${st.describe}`)
    // and the chain does not re-enter for them: every one of the four reads done while the counts stay short
    for (const r of MS.MILESTONES_BY_ROLE.gatherer) {
      assert.equal(r.done(fakeBot(bag)), true, `${r.id} stepped over`)
      assert.equal(r.fulfilled(fakeBot(bag)), false, `${r.id} is a step-over, not a completion`)
    }
  } finally { MS.setRefillJob(null); MS.setNoStock(null) }
})

await ta('(a) a refill job STILL triggers gather: the job rung leads, wants its kind, hints a gather', async () => {
  const job = { id: 'j1', kind: 'dirt', n: 64, got: 0, by: 'bill', takers: ['showcase-Alpha'] }
  MS.setRefillJob(() => job)
  try {
    const st = statusOf(MS, { dirt: 15, ...KIT })
    assert.match(st.id, /^refill_job#/); assert.equal(st.wants, 'dirt'); assert.match(st.hint, /^gather with block=dirt/)
  } finally { MS.setRefillJob(null) }
})

await ta('(a) the kit base keeps its consumer: no table in the bag -> "Stockpile 8 logs" still asked; table + pickaxe -> not', async () => {
  MS.setRefillJob(() => null)
  try {
    assert.match(statusOf(MS, { dirt: 15 }).id, /^stockpile_wood#/, 'no table, no pickaxe: the wood is for them')
    assert.equal(MS.kitNeeds(fakeBot({ crafting_table: 1, wooden_pickaxe: 1 }), 'wood'), false)
    assert.equal(MS.kitNeeds(fakeBot({ crafting_table: 1, wooden_pickaxe: 1 }), 'stone'), true, 'stone: a furnace and a stone pickaxe')
    assert.equal(MS.kitNeeds(fakeBot(KIT), 'stone'), false)
  } finally { MS.setRefillJob(null) }
})

await ta('MUTANT KILLED (a): a stock rung that ignores the switch lands the chain on "Collect 16 dirt" again', async () => {
  await withMutant(MS_URL, 'done: (b, ...rest) => noStockNow() || base.done(b, ...rest) })', 'done: (b, ...rest) => base.done(b, ...rest) })', async M => {
    M.setRefillJob(() => null)
    assert.equal(statusOf(M, { dirt: 15, ...KIT }).id, 'gather_dirt_16')
  })
})
await ta('MUTANT KILLED (a): a kit stock rung that ignores the kit asks "Stockpile 8 logs" of a bot holding its kit', async () => {
  await withMutant(MS_URL, "|| (noStockNow() && !kitNeeds(b, kind)) })", '})', async M => {
    M.setRefillJob(() => null)
    assert.match(statusOf(M, { dirt: 15, ...KIT }).id, /^stockpile_wood#/)
  })
})

// ---------------------------------------------------------------- (b) the keep a visit subtracts (spare = held - keep)
const spare = (held, keep) => Object.fromEntries(Object.entries(held).map(([n, c]) => [n, Math.max(0, c - (keep[n] ?? 0))]))
await ta('(b) tidy draws bag dirt above the escape reserve: 40 dirt -> 8 kept (escape_reserve), 32 spare; the fleet keeps 16', async () => {
  const live = TD.townKeeps({ dirt: 40 })
  assert.deepEqual(live.keep, { dirt: 8 }); assert.equal(live.why.dirt, 'escape_reserve')
  assert.equal(spare({ dirt: 40 }, live.keep).dirt, 32)
  assert.equal(TD.townKeeps({ dirt: 40 }, { noStock: false }).keep.dirt, 16, 'positive control: the fleet\'s gather_rung keep')
  assert.equal(TD.townKeeps({ dirt: 40, sand: 30 }).keep.sand, undefined, 'the 8-sand stock keep goes too')
})
await ta('(b) ONE reserve: other tower blocks count toward it (3 cobblestone -> 5 dirt; 20 cobblestone -> no dirt kept); 5 dirt alone is all kept', async () => {
  assert.deepEqual(TD.townKeeps({ dirt: 40, cobblestone: 3 }).keep, { cobblestone: 3, dirt: 5 })
  assert.equal(TD.townKeeps({ dirt: 40, cobblestone: 20 }).keep.dirt, undefined)
  assert.equal(TD.townKeeps({ dirt: 5 }).keep.dirt, 5, 'never below the reserve: a deposit or visit never deepens it')
  assert.equal(TD.townKeeps({ dirt: 40 }, { wanted: ['dirt'] }).keep.dirt, 40, 'a job that wants dirt keeps it up to a stack, as before')
})
// Codex r2 blocker: a full bag (30 slots) whose only tower blocks are 8 dirt, the warehouse's dirt column with room -- the deposit's
// column and room layers lower a soft keep to free a slot; the escape's dirt is a HARD keep there, as the scaffold reserve is
const FULLBAG = [{ name: 'dirt', count: 8, slot: 9, stackSize: 64 }, ...['spruce_sapling', 'wheat_seeds', 'sugar_cane', 'clay', 'gravel', 'poppy', 'dandelion', 'apple', 'egg', 'lantern', 'torch', 'bone_meal', 'string',
  'spruce_stairs', 'chest', 'furnace', 'crafting_table', 'composter', 'shears', 'bucket', 'stone_hoe', 'iron_axe', 'stone_pickaxe', 'iron_pickaxe', 'flint', 'stick', 'oak_sapling', 'birch_sapling', 'wheat']
  .map((name, i) => ({ name, count: 5, slot: 10 + i, stackSize: 64 }))]
const dirtBanked = (T, o) => T.townDepositPlan(FULLBAG, o).steps.filter(st => st.name === 'dirt').reduce((t, st) => t + st.count, 0)
await ta('(b) the escape\'s dirt is a HARD keep for the deposit: a full bag never banks its last 8 dirt to a column or a room bank (Codex r2)', async () => {
  assert.equal(FULLBAG.length, 30); assert.equal(TD.townKeeps({ dirt: 8, stick: 5 }).why.dirt, 'escape_reserve')
  assert.equal(dirtBanked(TD, { columns: () => true }), 0, 'the column layer')
  assert.equal(dirtBanked(TD, { columns: () => true, room: true }), 0, 'a room visit')
  assert.ok(dirtBanked(TD, { columns: () => true }) === 0 && TD.townDepositPlan([{ name: 'dirt', count: 64, slot: 8, stackSize: 64 }, ...FULLBAG], { columns: () => true }).steps.filter(st => st.name === 'dirt').reduce((t, st) => t + st.count, 0) === 8, 'positive control: with 72 held, a whole slot (the 8) is banked and 64 stay')
})
await ta('MUTANT KILLED (b): the column layer without the escape keep banks all 8', async () => {
  await withMutant(TD_URL, "const hardKeep = n => ['wanted', 'scaffold_reserve', 'escape_reserve'].includes(why[n])", "const hardKeep = n => ['wanted', 'scaffold_reserve'].includes(why[n])", async T => {
    assert.equal(dirtBanked(T, { columns: () => true }), 8)
  })
})
await ta('MUTANT KILLED (b): the stock keep left on keeps 16', async () => {
  await withMutant(TD_URL, "for (const [n, t] of Object.entries(heldTargetsFor(noStock))) floor(n, t, 'gather_rung')", "for (const [n, t] of Object.entries(HELD_TARGETS)) floor(n, t, 'gather_rung')", async T => {
    assert.equal(T.townKeeps({ dirt: 40 }).keep.dirt, 16)
  })
})
await ta('MUTANT KILLED (b): no escape reserve keeps no dirt for a dirt-only bag', async () => {
  await withMutant(TD_URL, "floor('dirt', ESCAPE_BLOCKS - towered, 'escape_reserve')", 'void towered', async T => {
    assert.equal(T.townKeeps({ dirt: 40 }).keep.dirt, undefined)
  })
})

// ---------------------------------------------------------------- (c) gather skips built cells: a fake world whose findBlocks applies
// the matcher (cavefall.test.mjs gatherShelf), a stone floor at y=29, logs at y=30; HOUSE cells priced 100 by the profile's
// exclusionBreak (the exclusionAreasBreak index.mjs installs), and safeToBreak refusing them as mineflayer-pathfinder does.
const key = (x, y, z) => `${x},${y},${z}`
function logWorld ({ house = [], trees = [], at = [2.5, 30, 0.5], walkTo = 'arrive', sites = [], columnAt = null }) {
  const L = MC.blocksByName.spruce_log
  const logs = new Set([...house, ...trees].map(p => key(...p)))
  const houseSet = new Set(house.map(p => key(...p)))
  const digs = []
  const blk = (x, y, z) => {
    const isLog = logs.has(key(x, y, z)), isFloor = !isLog && y === 29
    const t = isLog ? L : isFloor ? MC.blocksByName.stone : MC.blocksByName.air
    return { name: t.name, type: t.id, position: new Vec3(x, y, z), boundingBox: (isLog || isFloor) ? 'block' : 'empty', diggable: isLog,
             canHarvest: () => true, digTime: () => 50, material: 'mineable/axe', hardness: isLog ? 2 : 0 }
  }
  // a fire column priced 101 as index.mjs's keepoutBreakPenalty prices it while a keep-out scope holds
  const moves = { exclusionBreak: b => (houseSet.has(key(b.position.x, b.position.y, b.position.z)) ? 100 : columnAt && columnAt(sites, b.position) ? 101 : 0) }
  moves.safeToBreak = b => moves.exclusionBreak(b) < 100
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => [], emptySlotCount: () => 30 },
    registry: { blocksByName: MC.blocksByName, blocks: MC.blocks, itemsByName: MC.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && b.type === matching)
      if (!fn({ type: L.id, name: 'spruce_log' })) return []
      return [...logs].map(k => blk(...k.split(',').map(Number))).filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance && fn(b))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: moves },
    pathfinder: { movements: moves, goal: null, setMovements () {}, stop () {}, isMining: () => false, async goto () {},
      setGoal (g) {
        bot.pathfinder.goal = g
        if (!g) return
        setTimeout(() => {
          if (walkTo === 'arrive') { bot.entity.position = new Vec3(g.x + 0.5, 30, g.z + 0.5); bot.walks.push([g.x, g.z]); bot.emit('goal_reached', g) } else bot.emit('path_update', { status: 'noPath', path: [] })
        }, 5)
      } },
    walks: [],
    nearestEntity: () => null, entities: {},
    async dig (b) { digs.push(b.position); logs.delete(key(b.position.x, b.position.y, b.position.z)) },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
    fireSitesNow: () => sites, protectZones: () => [],
  })
  return { bot, digs }
}
/** A two-storey wall of 40 logs (x 3..12, z 0..1, y 30..31): the 32 nearest are all house. */
const HOUSE = []; for (let x = 3; x <= 12; x++) for (let z = 0; z <= 1; z++) for (let y = 30; y <= 31; y++) HOUSE.push([x, y, z])
const runGather = (S, bot) => S.SKILLS.gather.run({ bot }, { block: 'spruce_log', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: String(e?.stack ?? e).slice(0, 300) }))

await ta('(c) a log gather in town skips the house blocks and takes the tree beyond them (never a house cell)', async () => {
  const { bot, digs } = logWorld({ house: HOUSE, trees: [[2, 30, 20]] })
  const r = await runGather(SK, bot)
  assert.ok(digs.length >= 1, `it dug: ${JSON.stringify(r).slice(0, 300)}`)
  assert.deepEqual([digs[0].x, digs[0].y, digs[0].z], [2, 30, 20])
  assert.ok(!digs.some(p => HOUSE.some(h => h[0] === p.x && h[1] === p.y && h[2] === p.z)), 'never a house cell')
})
await ta('MUTANT KILLED (c): without the enumeration skip, the 32 nearest are the house: refused, the tree never dug', async () => {
  await withMutant(SK_URL, '&& isBuiltCell(bot.collectBlock?.movements ?? bot.pathfinder?.movements, b)) {', '&& false) {', async S => {
    const { bot, digs } = logWorld({ house: HOUSE, trees: [[2, 30, 20]] })
    const r = await runGather(S, bot)
    assert.equal(digs.length, 0, 'the mutant dug something')
    assert.equal(r.failClass, 'no_safe_target')
    assert.match(r.detail, /protected \/ built/, 'the old veto branch now names built cells too: [built:32]')
  })
})

await ta('(c) CHAIN: only the town\'s buildings in range -> one walk out past them (away from home), the search again, the tree there taken', async () => {
  const rows = []; const untap = tapRecords(r => { if (r?.skill?.name === '_gather_built') rows.push(`${r.skill.status} ${r.skill.detail}`) })
  try {
    // the tree is 40+ out, beyond the 32-block search from where the bot stands, near the walk's point
    const pt = GB.builtRemedyPoint({ from: { x: 2, z: 0 }, home: { x: 0, z: 0 }, cells: HOUSE.map(([x, , z]) => ({ x, z })) })
    assert.ok(pt.x >= 12 + GB.BUILT_OUT && Math.abs(pt.z) <= 1, `out past the house, away from home: ${JSON.stringify(pt)}`)
    const { bot, digs } = logWorld({ house: HOUSE, trees: [[pt.x + 2, 30, pt.z]] })
    await runGather(SK, bot)
    assert.deepEqual(bot.walks, [[pt.x, pt.z]], 'one walk, to the point')
    assert.deepEqual(digs.map(p => [p.x, p.y, p.z]), [[pt.x + 2, 30, pt.z]], 'the tree, nothing else')
    assert.ok(rows.some(r => /^success op=walk block=spruce_log skipped=\d+ .* reached=1/.test(r)), rows.join(' | '))
  } finally { untap() }
})
await ta('(c) CHAIN: the walk out fails -> the refusal names "protected / built" and a goto point; from that point the gather succeeds', async () => {
  const pt = GB.builtRemedyPoint({ from: { x: 2, z: 0 }, home: { x: 0, z: 0 }, cells: HOUSE.map(([x, , z]) => ({ x, z })) })
  const tree = [pt.x + 2, 30, pt.z]
  const w1 = logWorld({ house: HOUSE, trees: [tree], walkTo: 'noPath' })
  const r = await runGather(SK, w1.bot)
  assert.equal(w1.digs.length, 0)
  assert.equal(r.failClass, 'no_safe_target')
  assert.match(r.detail, new RegExp(`^goto x=${pt.x} z=${pt.z} \\(25\\+ blocks out of town\\) and gather spruce_log there -- all \\d+ spruce_log within 32 blocks are protected / built`))
  // the remedy, performed: the bot at the named point gathers
  const w2 = logWorld({ house: HOUSE, trees: [tree], at: [pt.x + 0.5, 30, pt.z + 0.5] })
  await runGather(SK, w2.bot)
  assert.deepEqual(w2.digs.map(p => [p.x, p.y, p.z]), [tree])
})
const KO = await import('../src/keepout.mjs')
const FIRE = [{ kind: 'death:fire', x: 4, y: 20, z: 0, count: 4, deaths: 1, last: Date.now(), by: ['showcase-Echo'] }]
const TREE_IN_COLUMN = [[3, 30, 0], [4, 30, 0], [5, 30, 1]]
await ta('(c) COMPOSED with keep-out: logs only in a fire column (the gather profile prices them 101 too) are KEEP-OUT\'s -- its cooldown and remedy, no built walk', async () => {
  assert.ok(TREE_IN_COLUMN.every(p => KO.columnAt(FIRE, new Vec3(...p))), 'fixture: every log is in the column')
  const { bot, digs } = logWorld({ trees: TREE_IN_COLUMN, sites: FIRE, columnAt: KO.columnAt })
  const r = await runGather(SK, bot)
  assert.equal(digs.length, 0); assert.deepEqual(bot.walks, [], 'no built walk')
  assert.equal(r.failClass, 'keepout', JSON.stringify(r).slice(0, 300))
})
await ta('MUTANT KILLED (c): the built skip ahead of keep-out takes keep-out\'s cells (no cooldown; a walk on a bearing past the death site)', async () => {
  const src = readFileSync(SK_URL, 'utf8')
  const built = src.slice(src.indexOf('      // nostock-01show (c): a cell the gather profile prices at 100+'), src.indexOf('        return false\n      }\n', src.indexOf('builtSkipped++; if (builtCells')) + '        return false\n      }\n'.length)
  const koLine = src.slice(src.indexOf('      // KEEPOUT-01: a candidate in a fire column is skipped AT ENUMERATION'), src.indexOf('      // nostock-01show (c): a cell the gather profile prices at 100+'))
  assert.equal(src.split(koLine + built).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  await withMutant(SK_URL, koLine + built, built + koLine, async S => {
    const { bot } = logWorld({ trees: TREE_IN_COLUMN, sites: FIRE, columnAt: KO.columnAt })
    const r = await runGather(S, bot)
    assert.notEqual(r.failClass, 'keepout')
  })
})
await ta('(c) builtRemedyPoint: out from home along the bearing to the bot, past the farthest built cell; no home -> from the cells\' centre', async () => {
  assert.deepEqual(GB.builtRemedyPoint({ from: { x: 0, z: -10 }, home: { x: 0, z: 0 }, cells: [{ x: 0, z: -20 }] }), { x: 0, z: -45 })
  assert.deepEqual(GB.builtRemedyPoint({ from: { x: 0.2, z: 0 }, home: { x: 0, z: 0 }, cells: [] }), { x: 25, z: 0 }, 'on the home column: east')
  assert.deepEqual(GB.builtRemedyPoint({ from: { x: 10, z: 0 }, home: null, cells: [{ x: 0, z: 0 }] }), { x: 35, z: 0 })
  assert.equal(GB.builtRemedyPoint({ from: null }), null)
  assert.equal(GB.isBuiltCell({ exclusionBreak: () => 100 }, {}), true); assert.equal(GB.isBuiltCell({ exclusionBreak: () => 99 }, {}), false)
  assert.equal(GB.isBuiltCell({ exclusionBreak: () => { throw new Error('x') } }, {}), false, 'unreadable: not built (the base refuses it later, as before)')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

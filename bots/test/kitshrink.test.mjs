// THE SMALLER KIT (kitshrink.mjs, kitshrink-01; OWNER 10-16 "yes shrink"). Behaviour first: the rule, the bank's view, the
// refusal's move, the walk rule (the kit alone never walks a bot), the craft room order's far branch, the ESCAPE CHAIN
// through the real ladder code and the real lattice, and the tech ladder. Source assertions only for structure: one climb
// number for the reflex and the rule, and the consumer tripwire (kitshrink-sites.mjs), each with a mutant.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-kitshrink'
process.env.BOT_NAME = process.env.BOT_NAME || 'KitBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'ks-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const KS = await import('../src/kitshrink.mjs')
const LADDER = await import('../src/ladder.mjs')
const BANK = await import('../src/bankable.mjs')
const { escapePlan } = await import('../src/escape.mjs')
const REFLEX = await import('../src/reflex.mjs')
const MS = await import('../src/milestones.mjs')
const TD = await import('../src/towndeposit.mjs')
const SK = await import('../src/skills.mjs')
const SITES = await import('./kitshrink-sites.mjs')

const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$/
function item (name, count = 1, slot = 9, extra = {}) {
  const def = mcData.itemsByName[name]
  assert.ok(def, `unknown item ${name}`)
  const it = { name, count, slot, type: def.id, stackSize: def.stackSize, ...extra }
  if (TOOL.test(name)) { it.maxDurability = def.maxDurability; it.durabilityUsed = extra.durabilityUsed ?? 0 }
  return it
}
const bag = rows => rows.map(([name, count, uses], i) => item(name, count, 9 + i, uses != null ? { durabilityUsed: mcData.itemsByName[name].maxDurability - uses } : {}))
const filler = n => Array.from({ length: n }, (_, i) => ['white_wool', 1 + (i % 3)])

// ---- the rule -------------------------------------------------------------------------------------------------------
test('THE ESCAPE MINIMUM is asked of the real ladderPlan: 25 refused, 26 accepted, for the reflex\'s own climb', () => {
  assert.equal(LADDER.LADDER_CLIMB_NEED, REFLEX.PILLAR_MAX_BLOCKS + 1, 'one climb number for the reflex and the rule')
  assert.equal(KS.LADDER_ESCAPE_MIN, 26)
  const need = LADDER.LADDER_CLIMB_NEED
  assert.equal(LADDER.ladderPlan({ need, have: KS.LADDER_ESCAPE_MIN - 1, reach: need }).ok, false)
  assert.equal(LADDER.ladderPlan({ need, have: KS.LADDER_ESCAPE_MIN, reach: need }).ok, true)
  assert.equal(LADDER.ladderEscapeMin(need, 10), null, 'a bounded search that finds nothing says null (and null keeps every ladder)')
  assert.equal(KS.kitBankDecision('ladder', 3, { on: true }), 'bank')
})

test('kitBankDecision: torches and ladders below 26 bank; 26+ ladders stay; chests, stations, the bucket and others are not this rule; off = nothing', () => {
  const d = (n, h, on = true) => KS.kitBankDecision(n, h, { on })
  assert.equal(d('torch', 129), 'bank')
  assert.equal(d('ladder', 25), 'bank'); assert.equal(d('ladder', 26), 'escape_ladders'); assert.equal(d('ladder', 40), 'escape_ladders')
  for (const n of ['chest', 'crafting_table', 'furnace', 'bucket', 'glass', 'oak_log']) assert.equal(d(n, 1), null, n)
  assert.equal(d('torch', 4, false), null); assert.equal(d('ladder', 3, false), null)
})

test('the switch: KIT_SHRINK on|off, default on, unreadable -> on and said', () => {
  assert.deepEqual(KS.kitShrinkMode({}), { on: true, mode: 'on', note: null })
  assert.equal(KS.kitShrinkMode({ KIT_SHRINK: 'off' }).on, false)
  assert.equal(KS.kitShrinkMode({ KIT_SHRINK: ' ON ' }).on, true)
  const odd = KS.kitShrinkMode({ KIT_SHRINK: 'maybe' })
  assert.equal(odd.on, true); assert.match(odd.note, /unreadable/)
  assert.equal(KS.kitShrinkModeDetail({ on: true, mode: 'on', note: null }), 'phase=mode on=1 mode=on kit=torch,ladder ladder_min=26')
})

test('the bank row: bounded, every field name=before:banked, start counts; due only when the bag held or banked kit', () => {
  const d = KS.kitBankDetail({ heldBefore: { torch: 129, ladder: 17, crafting_table: 53, oak_log: 640 }, banked: { torch: 64, oak_log: 64 }, slotsBefore: 36, slotsAfter: 34 })
  assert.equal(d, 'phase=bank via=town_deposit torch=129:64 ladder=17:0 crafting_table=53:0 furnace=0:0 bucket=0:0 slots=36->34')
  assert.ok(d.length < 150)
  assert.equal(KS.kitBankRowDue({ oak_log: 3 }, { oak_log: 3 }), false)
  assert.equal(KS.kitBankRowDue({ ladder: 30 }, {}), true)
})

// ---- the bank's view (bankable.mjs) -----------------------------------------------------------------------------------
test('bankableInventory: torch and ladder (< 26) are bankable and counted as kit; 26 ladders are kept (not junk); the chest is still not_wanted', () => {
  const r = BANK.bankableInventory(bag([['torch', 4], ['ladder', 3], ['chest', 7], ['crafting_table', 1], ['furnace', 1], ['bucket', 1]]), { noSwords: false })
  assert.deepEqual(r.detail, { torch: 4, ladder: 3 })
  assert.equal(r.kit, 7); assert.equal(r.count, 7)
  assert.equal(r.excluded.chest, 'not_wanted')
  for (const n of ['crafting_table', 'furnace', 'bucket']) assert.equal(r.excluded[n], 'the_only_station', n)
  const k = BANK.bankableInventory(bag([['ladder', 26], ['torch', 2]]), { noSwords: false })
  assert.deepEqual(k.detail, { torch: 2 })
  assert.equal(k.excluded.ladder, 'escape_ladders'); assert.equal(k.junk, 0, 'kept ladders are not ballast')
})

test('the named refusal names a move: `deposit ladder` at 26 -> "kept for the ladder escape ... keep working" (no digits)', () => {
  const items = bag([['ladder', 26], ['oak_log', 3]])
  const why = BANK.depositNoopReason(items, 'ladder', { noSwords: false })
  assert.equal(why, 'not a banking target (kept for the ladder escape): you are carrying ladder — nothing to deposit, keep working')
  assert.doesNotMatch(why, /\d/)
  assert.equal(BANK.depositNoopReason(bag([['ladder', 3]]), 'ladder', { noSwords: false }), null, 'below the minimum: there is something to hand over')
})

// ---- the walk rule: the kit alone never walks a bot ----------------------------------------------------------------
test('depositDue: a kit-only bag 80 blocks out with no storage in reach is NOT due; with storage in reach it is; other surplus still walks', () => {
  const kitOnly = BANK.bankableInventory(bag([['torch', 64], ['ladder', 3], ...filler(31)]), { noSwords: false })
  assert.equal(kitOnly.count, 67); assert.equal(kitOnly.kit, 67)
  const due = (b, storage) => BANK.depositDue({ bankable: b.count, kitBankable: b.kit, distHome: 80, storageWithin48: storage, occupiedSlots: 34 })
  assert.equal(due(kitOnly, false), false, 'no walk for the kit alone')
  assert.equal(due(kitOnly, true), true, 'POSITIVE CONTROL: at the chest it banks')
  const mixed = BANK.bankableInventory(bag([['torch', 64], ['oak_log', 64], ['oak_log', 64], ['oak_log', 30], ...filler(30)]), { noSwords: false })
  assert.ok(mixed.count > mixed.kit && mixed.kit === 64)
  assert.equal(due(mixed, false), true, 'POSITIVE CONTROL: other surplus walks as before')
  assert.equal(BANK.depositDue({ bankable: 67, distHome: 80, storageWithin48: false, occupiedSlots: 34 }), true, 'without kitBankable: today\'s rule (the mutant the callers must not be)')
})

// a far bot for the craft room order (skills.mjs roomRemedy): no chest within 48, 400 blocks out
const farBot = items => ({ entity: { position: new Vec3(400, 70, 0) }, registry: mcData, food: 20, inventory: { items: () => items },
                            findBlock: () => null, findBlocks: () => [], blockAt: () => null, currentWants: [], game: { difficulty: 'peaceful' } })

test('ROOM ORDER, FAR: a full bag whose only bankable stacks are kit gets NO home trip; the same bag with a log stack still does (control)', () => {
  const kitOnly = bag([['torch', 20], ['ladder', 3], ['stone_pickaxe', 1, 100], ...filler(33)])
  const r = SK.roomRemedy(farBot(kitOnly), kitOnly, [])
  assert.notEqual(r.kind, 'home', JSON.stringify(r))
  assert.ok(!/torch|ladder/.test(r.text ?? ''), r.text)
  const withLogs = bag([['torch', 20], ['ladder', 3], ['oak_log', 64], ['oak_log', 64], ['oak_log', 20], ...filler(31)])
  const c = SK.roomRemedy(farBot(withLogs), withLogs, [])
  assert.equal(c.kind, 'home', `POSITIVE CONTROL (the far branch is live): ${JSON.stringify(c)}`)
  assert.equal(c.item, 'oak_log')
  const adv = SK.slotRemedy(farBot(kitOnly), kitOnly, [])
  assert.notEqual(adv.kind, 'home', `the advice path too: ${JSON.stringify(adv)}`)
})

// ---- MIXED BAGS (Codex code r1 P2-1): other surplus makes a deposit due, but a NAMED kit deposit never walks ------------
// 80 blocks out (inside DEPOSIT_NEAR_HOME 96, so depositDue walks home for the logs), no chest within 48; the craft needs
// the logs (`keep`), so the only stack a room deposit could empty is the torches.
const nearBot = (items, chest = false) => ({ ...farBot(items), entity: { position: new Vec3(80, 70, 0) },
  findBlock: ({ matching } = {}) => { const b = { position: new Vec3(2, 70, 0), type: mcData.blocksByName.chest.id }; return chest && matching?.(b) ? b : null } })
const mixedBag = () => bag([['torch', 20], ['oak_log', 64], ['oak_log', 64], ['stone_pickaxe', 1, 100], ...filler(32)])

test('ROOM ORDER, NEAR, MIXED: no chest in reach -> the room remedy never names the torches (the walk would be for them); a chest in reach -> it may', () => {
  const items = mixedBag(); const keep = [{ name: 'oak_log', count: 1 }]
  const r = SK.roomRemedy(nearBot(items), items, keep)
  assert.ok(!(r.kind === 'deposit' && r.item === 'torch'), `no walk for the torches: ${JSON.stringify(r)}`)
  assert.ok(!/deposit torch/.test(SK.slotRemedy(nearBot(items), items, keep).remedy ?? ''), 'the advice path too')
  const c = SK.roomRemedy(nearBot(items, true), items, keep)
  assert.equal(c.kind, 'deposit', `POSITIVE CONTROL (a chest within 48: no walk): ${JSON.stringify(c)}`)
  assert.equal(c.item, 'torch')
})

test('ADMISSION, MIXED: `deposit torch` 80 blocks out with no chest in reach is refused before the walk (the move: keep working); at a chest it is admitted', async () => {
  const { AdmissionControl } = await import('../src/admission.mjs')
  const { Lessons } = await import('../src/lessons.mjs')
  const A = new AdmissionControl(new Lessons(`${process.env.POOL_STATE_DIR}/lessons-adm.json`))
  const items = mixedBag()
  const bot = { ...nearBot(items), inventory: { items: () => items }, health: 20, food: 20 }
  const r = A.check({ skill: 'deposit', args: { item: 'torch' } }, bot, null)
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.reason, 'deposit_not_worth_it')
  assert.match(r.detail, /keep working/); assert.doesNotMatch(r.detail, /\d/)
  const plain = A.check({ skill: 'deposit', args: {} }, bot, null)
  assert.notEqual(plain.reason, 'deposit_not_worth_it', `POSITIVE CONTROL: the logs alone still make a plain deposit due: ${JSON.stringify(plain)}`)
  const atChest = { ...nearBot(items, true), inventory: { items: () => items }, health: 20, food: 20 }
  const c = A.check({ skill: 'deposit', args: { item: 'torch' } }, atChest, null)
  assert.notEqual(c.reason, 'deposit_not_worth_it', `a chest within 48: no walk, admitted: ${JSON.stringify(c)}`)
  // ...but a chest the deposit would SKIP (this bot's container backoff) is no chest (Codex code r2 P2)
  const backedOff = { ...atChest, skipContainers: new Map([['2,70,0', Date.now() + 60_000]]) }
  const b = A.check({ skill: 'deposit', args: { item: 'torch' } }, backedOff, null)
  assert.equal(b.reason, 'deposit_not_worth_it', `a backed-off chest does not count: ${JSON.stringify(b)}`)
  assert.equal(SK.usableChestNear(atChest), true); assert.equal(SK.usableChestNear(backedOff), false)
})

// ---- THE DEPOSIT RUNG (Claude code r4 P2): the kit never holds deposit_surplus -- at a full chest it would loop ----------
test('CHAIN: deposit_surplus is DONE for a kit-only bag beside a (full) town chest; a log surplus holds it (control); the prompt says nothing for the kit', async () => {
  const rung = MS.SUSTAINING.find(r => r.id === 'deposit_surplus')
  assert.ok(rung, 'the rung exists')
  const atTown = items => ({ inventory: { items: () => items }, registry: mcData, entity: { position: new Vec3(3, 70, 0) },
    findBlock: ({ matching } = {}) => { const b = { position: new Vec3(2, 70, 0), type: mcData.blocksByName.chest.id }; return matching?.(b) ? b : null } })
  const kitOnly = bag([['torch', 20], ['ladder', 3], ['crafting_table', 1], ...filler(30)])
  assert.equal(BANK.bankableInventory(kitOnly, { noSwords: false }).count, 23, 'positive control: the kit IS bankable (the town deposit takes it)')
  assert.equal(rung.done(atTown(kitOnly)), true, 'the kit alone never holds the rung')
  assert.equal(rung.fulfilled(atTown(kitOnly)), true)
  const withLogs = bag([['torch', 20], ['oak_log', 64], ['oak_log', 30], ...filler(30)])
  assert.equal(rung.done(atTown(withLogs)), false, 'POSITIVE CONTROL: other surplus at a chest holds it, as before')
  const { depositSituation } = await import('../src/prompt.mjs')
  const pbot = items => ({ ...atTown(items), inventory: { items: () => items } })
  assert.equal(depositSituation(pbot(kitOnly), {}), '', 'no CARRYING line for the kit alone')
  assert.match(depositSituation(pbot(withLogs), {}), /^CARRYING: \d+ items worth banking/, 'POSITIVE CONTROL: the line for real surplus')
})

// ---- THE ESCAPE CHAIN: a bot that banked its ladders at town is no worse off underground -------------------------------
// A 1x1 shaft of stone, 40 high: the ideal ladder wall. The reflex's ladderReady is ladderPlan(LADDER_CLIMB_NEED, have,
// bestLadderWall(...).reach); the routine is the real climbLadder; the plan is the real escape lattice.
const shaftAt = (dx, dy, dz) => {
  if (dx === 0 && dz === 0) return dy >= 0 && dy < 40 ? { name: 'air', boundingBox: 'empty', transparent: true } : { name: 'stone', boundingBox: 'block', transparent: false }
  return { name: 'stone', boundingBox: 'block', transparent: false }
}
const ladderReadyFor = have => {
  const need = LADDER.LADDER_CLIMB_NEED
  const wall = LADDER.bestLadderWall(shaftAt, need)
  return LADDER.ladderPlan({ need, have, reach: wall.reach }).ok
}
// a bot at the bottom of a shaft: no floor to ride down, a wall to cut a ramp into, sky above -- the rungs a ladder competes with
const STRANDED = { trapped: true, floorBelowSolid: false, underfootSolid: false, lateralTread: true, canStepOff: false, columnOpen: true, lateralHeadOpen: false, breachable: false }

test('ESCAPE CHAIN: the town deposit takes 3, 17 or 25 ladders -- the lattice chose the same rung before and after (the ladders were never usable)', async () => {
  for (const n of [3, 17, 25]) {
    const items = bag([['ladder', n], ['cobblestone', 64], ['stone_pickaxe', 1, 100], ['oak_log', 10], ...filler(32)])
    const plan = TD.townDepositPlan(items, { noSwords: false })
    assert.ok(plan.steps.some(s => s.name === 'ladder'), `${n} ladders bank`)
    const gone = new Set(plan.steps.map(s => s.slot))
    const after = items.filter(i => !gone.has(i.slot))
    const have = l => l.filter(i => i.name === 'ladder').reduce((a, i) => a + i.count, 0)
    assert.equal(ladderReadyFor(have(items)), false, `${n} ladders never made climb_ladder ready`)
    const before = escapePlan({ ...STRANDED, ladderReady: ladderReadyFor(have(items)), blocks: 64 })
    const now = escapePlan({ ...STRANDED, ladderReady: ladderReadyFor(have(after)), blocks: 64 })
    assert.equal(now, before, `${n}: the lattice's choice is unchanged`)
    assert.equal(now, 'stair_up', 'an executable rung remains: the ramp (tool + wall), as before the deposit')
    // the escape's other inputs: the pillar blocks and the pickaxe stay
    assert.equal(after.filter(i => i.name === 'cobblestone').reduce((a, i) => a + i.count, 0), 64)
    assert.ok(after.some(i => i.name === 'stone_pickaxe'))
  }
})

test('ESCAPE CHAIN: the real climbLadder with 3 ladders refuses BEFORE placing anything -- banking them removed nothing it could do', async () => {
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [item('ladder', 3)] },
                blockAt: p => shaftAt(Math.floor(p.x), Math.floor(p.y) - 64, Math.floor(p.z)) }
  const r = await LADDER.climbLadder(bot, { need: LADDER.LADDER_CLIMB_NEED, goals: { GoalBlock: class {} }, sleep: async () => {} })
  assert.equal(r.ok, false); assert.equal(r.placed, 0)
  assert.match(r.why, /3 ladders against a 25-block climb/)
})

test('ESCAPE CHAIN CONTROL: 26 ladders are KEPT by the town deposit and the lattice chooses climb_ladder', () => {
  const items = bag([['ladder', 26], ['cobblestone', 64], ['stone_pickaxe', 1, 100], ['torch', 5], ...filler(32)])
  const plan = TD.townDepositPlan(items, { noSwords: false })
  assert.ok(!plan.steps.some(s => s.name === 'ladder'), 'no ladder moves')
  assert.ok(plan.steps.some(s => s.name === 'torch'), 'positive control: the plan banks the torches')
  assert.equal(ladderReadyFor(26), true)
  assert.equal(escapePlan({ ...STRANDED, ladderReady: true, blocks: 64 }), 'climb_ladder')
})

// ---- the tech ladder: no rung reads a torch or a ladder -----------------------------------------------------------------
test('TECH LADDER: banking the kit flips no gatherer or SUSTAINING rung (the stations and the bucket stay)', () => {
  const fakeBot = items => ({ inventory: { items: () => items }, registry: mcData, findBlock: () => null, entity: { position: new Vec3(0, 70, 0) } })
  const GUARDED = [...MS.MILESTONES_BY_ROLE.gatherer, ...MS.SUSTAINING].filter(r => !['deposit_surplus', 'return', 'patrol'].includes(r.id))
  const bags = [
    bag([['torch', 20], ['ladder', 3], ['crafting_table', 1], ['furnace', 1], ['bucket', 1], ['cobblestone', 30], ['stick', 4], ['oak_log', 5], ['raw_iron', 2], ['coal', 3], ...filler(26)]),
    bag([['torch', 64], ['ladder', 25], ['crafting_table', 1], ['cobblestone', 8], ['oak_planks', 2], ['iron_ingot', 3], ['stone_pickaxe', 1, 100], ...filler(29)]),
  ]
  let checked = 0
  for (const items of bags) {
    const plan = TD.townDepositPlan(items, { noSwords: false })
    assert.ok(plan.steps.some(s => KS.KIT_BANK.includes(s.name)), 'positive control: kit moves')
    const gone = new Set(plan.steps.map(s => s.slot)); const rest = items.filter(i => !gone.has(i.slot))
    for (const rung of GUARDED) for (const n of [0, 3, 540]) { assert.equal(rung.done(fakeBot(rest), n), rung.done(fakeBot(items), n), `${rung.id} lap ${n}`); checked++ }
  }
  assert.ok(checked > 20)
})

// ---- structure: one climb number; the consumer tripwire ----------------------------------------------------------------
const REFLEX_SRC = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
test('STRUCTURE: both reflex ladder sites read LADDER_CLIMB_NEED (comments stripped); the old literal sum is gone', () => {
  const code = SITES.stripComments(REFLEX_SRC)
  assert.equal((code.match(/const need = LADDER_CLIMB_NEED\b/g) ?? []).length, 1, 'ladderReady')
  assert.equal((code.match(/climbLadder\(bot, \{ need: LADDER_CLIMB_NEED, /g) ?? []).length, 1, 'climb_ladder')
  assert.equal((code.match(/PILLAR_MAX_BLOCKS \+ 1/g) ?? []).length, 0, 'no second copy of the number')
})

test('STRUCTURE MUTANT: a reflex that kept `PILLAR_MAX_BLOCKS + 1` at ladderReady is caught', () => {
  const old = 'const need = LADDER_CLIMB_NEED'
  assert.ok(REFLEX_SRC.includes(old) && REFLEX_SRC.split(old).length === 2, 'ANCHOR MISSING or not unique')
  const code = SITES.stripComments(REFLEX_SRC.replace(old, 'const need = PILLAR_MAX_BLOCKS + 1'))
  assert.equal((code.match(/const need = LADDER_CLIMB_NEED\b/g) ?? []).length, 0)
  assert.equal((code.match(/PILLAR_MAX_BLOCKS \+ 1/g) ?? []).length, 1)
})

// WIRING (a value wired into its callers: a structural assertion). Every depositDue CALL in bots/src passes kitBankable,
// so no path (admission, the prompt's CARRYING line, the room advice) counts the kit toward a walk. Comments stripped.
const depositDueCalls = sources => {
  const out = []
  for (const [file, src] of Object.entries(sources)) {
    const code = SITES.stripComments(src)
    for (const m of code.matchAll(/(?<!function )depositDue\s*\(\s*\{/g)) {
      let depth = 0, i = m.index + m[0].length - 1, end = i
      for (; i < code.length; i++) { if (code[i] === '{') depth++; else if (code[i] === '}' && --depth === 0) { end = i; break } }
      out.push({ file, args: code.slice(m.index, end + 1) })
    }
  }
  return out
}
test('WIRING: every depositDue call in bots/src passes kitBankable (admission, prompt, the room advice)', () => {
  const calls = depositDueCalls(SITES.srcFiles(new URL('../src/', import.meta.url)))
  assert.deepEqual(calls.map(c => c.file).sort(), ['admission.mjs', 'prompt.mjs', 'skills.mjs'], 'positive control: the three callers are seen')
  // either the kit's share is passed (dropped without storage in reach), or the caller drops it outright (the prompt)
  for (const c of calls) assert.match(c.args, /kitBankable:\s*bank\.kit\b|bankable:\s*surplus,\s*kitBankable:\s*0/, `${c.file}: ${c.args.slice(0, 120)}`)
})
test('WIRING MUTANT: a caller that drops kitBankable is caught', () => {
  const files = SITES.srcFiles(new URL('../src/', import.meta.url))
  const old = 'bankable: surplus, kitBankable: 0, distHome, storageWithin48'
  assert.ok(files['prompt.mjs'].split(old).length === 2, 'ANCHOR MISSING or not unique')
  const calls = depositDueCalls({ ...files, 'prompt.mjs': files['prompt.mjs'].replace(old, 'distHome, storageWithin48') })
  assert.equal(calls.filter(c => !/kitBankable:\s*bank\.kit\b|bankable:\s*surplus,\s*kitBankable:\s*0/.test(c.args)).map(c => c.file).join(), 'prompt.mjs')
})

const SRC_DIR = new URL('../src/', import.meta.url)
const key = s => `${s.file} | ${s.line}`
test('TRIPWIRE: every executable torch/ladder site in bots/src is on the classified allowlist (a new consumer must be decided)', () => {
  const found = SITES.kitSites(SITES.srcFiles(SRC_DIR)).map(key).sort()
  const allowed = SITES.ALLOWED.map(key).sort()
  assert.ok(found.length >= 8, `positive control: the scan sees the known sites (${found.length})`)
  const extra = found.filter(k => !allowed.includes(k)), stale = allowed.filter(k => !found.includes(k))
  assert.deepEqual(extra, [], 'NEW torch/ladder site(s): kitshrink banks these items at town -- give the consumer a withdraw path or keep the item (kitshrink.mjs), then classify the site in kitshrink-sites.mjs')
  assert.deepEqual(stale, [], 'an allowlisted line is gone or was reformatted: RECLASSIFY it in kitshrink-sites.mjs (no new consumer is implied)')
})

test('TRIPWIRE MUTANT: treefarm-02\'s shape (place a carried torch) and shaft-01\'s (craft ladders) are caught; a comment is not', () => {
  const files = SITES.srcFiles(SRC_DIR)
  const anchor = 'export function roomRemedy ('
  assert.ok(files['skills.mjs'].split(anchor).length === 2, 'ANCHOR MISSING or not unique')
  const mut = { ...files, 'skills.mjs': files['skills.mjs'].replace(anchor, "const _m = { kind: 'place', item: 'torch' }\nconst _n = craftTimes('ladder', 3)\n// a comment naming 'torch' is not a site\n" + anchor) }
  const extra = SITES.kitSites(mut).map(key).filter(k => !SITES.ALLOWED.map(key).includes(k))
  assert.deepEqual(extra, ["skills.mjs | const _m = { kind: 'place', item: 'torch' }", "skills.mjs | const _n = craftTimes('ladder', 3)"])
})

// ---- the bank rule is gone when the kit rule is mutated away (anchored mutant of bankable.mjs) ---------------------------
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const BANK_PATH = new URL('../src/bankable.mjs', import.meta.url)
test('MUTANT KILLED: without the kit branch, torches and ladders are not_wanted again (the tests above would see nothing banked)', async () => {
  await withMutant(BANK_PATH, "if (!isTool && kit !== 'bank' && !want.has(name))", 'if (!isTool && !want.has(name))', mod => {
    const r = mod.bankableInventory(bag([['torch', 4], ['ladder', 3]]), { noSwords: false })
    assert.deepEqual(r.detail, {}); assert.equal(r.excluded.torch, 'not_wanted')
  })
})
test('MUTANT KILLED: without the escape exclusion, 26 ladders would bank (a usable escape stock leaves the bag)', async () => {
  await withMutant(BANK_PATH, "if (kit === 'escape_ladders') { excluded[name] = 'escape_ladders'; continue }", '', mod => {
    const r = mod.bankableInventory(bag([['ladder', 26]]), { noSwords: false })
    assert.ok(!r.detail.ladder, 'still not banked: not_wanted catches it')
    assert.equal(r.excluded.ladder, 'not_wanted', 'the reason changes (and it counts as junk)')
    assert.equal(r.junk, 26)
  })
})
test('MUTANT KILLED: depositDue that ignores kitBankable walks a kit-only bag', async () => {
  await withMutant(BANK_PATH, 'if (!storageWithin48) bankable = Math.max(0, (Number(bankable) || 0) - Math.max(0, Number(kitBankable) || 0))', '', mod => {
    assert.equal(mod.depositDue({ bankable: 67, kitBankable: 67, distHome: 80, storageWithin48: false, occupiedSlots: 34 }), true)
  })
})

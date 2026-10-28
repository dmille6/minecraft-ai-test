// smeltgate-01: this file proves the BASE's rule-out (its mutants remove it from the gate); the index-evidence gate is off
// here and proven in smeltgate.test.mjs and ironsmelt-chain.test.mjs (on)
process.env.SMELT_GATE = 'off'
// IRONSMELT-01: THE TOWN SMELT JOB SMELTS RAW IRON (FIRST), AND DOES NOT DISPATCH INTO A TOWN IT HAS SEEN EMPTY
// (docs/reports/ironsmelt-01-design-2026-10-23.md; OWNER 2026-10-23 ~12:40Z "yes build now").
//
// Behaviour, not text: the decisions are smeltjob.mjs's pure exports (ironsmeltMode, indexRuledOut, ironSmeltCount,
// ironBankPlan, smeltTownOrder's gate), driven directly; then the REAL smelt_town skill over the fake world (real withdraw
// clicks, real holds, real deposits; the fake's furnace does not smelt, so a job that took its input and coal ends at the
// furnace and BANKS -- the exit every ownership claim is about); then the REFUSAL CHAIN through the REAL CognitiveLoop: a town
// the index knows is empty gets no smelt_town (the bot keeps its other moves), and one deposit re-opens it; and anchored
// mutants (withMutant: the anchor present and unique, or the mutant is no kill).
//
// MEASURED 10-23: 1,359 of 1,661 jobs in 24 h ended town_has_none; of the 1,574 opens those jobs made that the index saw,
// 1,322 were of a container the index already KNEW held no raw copper, and 466 of 570 such jobs opened a container holding
// raw iron. The index's false-empty rate (13 h, 13 pools): 1 of 3,511 clean pairs for raw copper, 0 of 1,536 for raw iron.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
delete process.env.IRONSMELT; delete process.env.SMELT_RULEOUT
const FX = await import('./ironsmelt-fixture.mjs')
const { CF, CHESTS, FAR, FW, HK, HOME, NEAR, RECS, S0, SJ, SJ_PATH, SKILLS_PATH, TI, chest, clearWithdrawHolds, count, dirtyByIndex, fakeWorld, field, freshPool, job, kOf, killedBy, lastRow, later, memDir, offset, realNow, seenByIndex, sig, stack, t, tapRecords, town, townTotal, withMutant, withServer } = FX
assert.equal(SJ.SMELT_GATE.on, false, 'smeltgate-01 off in this file (the base rule-out under test)')

// ---- the pure decisions ----------------------------------------------------------------------------------------------
await t('THE SWITCHES: IRONSMELT on by default (off|0|false|no -> off; unreadable -> on, said); SMELT_RULEOUT rides on it; the mode row names both', () => {
  assert.deepEqual(SJ.ironsmeltMode({}), { on: true, mode: 'on', note: 'IRONSMELT unset' })
  for (const v of ['off', 'OFF', '0', 'false', 'no']) assert.equal(SJ.ironsmeltMode({ IRONSMELT: v }).on, false, v)
  assert.equal(SJ.ironsmeltMode({ IRONSMELT: 'maybe' }).on, true)
  assert.match(SJ.ironsmeltMode({ IRONSMELT: 'maybe' }).note, /unreadable/)
  assert.equal(SJ.ruleoutMode({}, { on: true }, { on: true }).on, true)
  assert.equal(SJ.ruleoutMode({ SMELT_RULEOUT: 'off' }, { on: true }, { on: true }).on, false)
  assert.equal(SJ.ruleoutMode({}, { on: false }, { on: true }).on, false, 'IRONSMELT=off is the base exactly: no rule-out either')
  assert.deepEqual(SJ.ruleoutMode({}, { on: true }, { on: false }), { on: false, why: 'off_noindex' }, 'TOWNINDEX=off: nothing to rule out with, and the mode row says so')
  assert.match(SJ.ironsmeltModeDetail({ on: true, mode: 'on' }, { on: false, why: 'off_noindex' }), /rule_out=off_noindex/)
  assert.deepEqual([...SJ.jobInputs(true)], ['raw_iron', 'raw_copper'], 'iron FIRST')
  assert.deepEqual([...SJ.jobInputs(false)], ['raw_copper'])
  assert.equal(SJ.IRONSMELT.on, true); assert.equal(SJ.SMELT_RULEOUT.on, true)
  assert.match(SJ.ironsmeltModeDetail(), /^phase=mode on=1 mode=on inputs=raw_iron,raw_copper miss_h=2 rule_out=index_known_none/)
  assert.match(SJ.ironsmeltModeDetail({ on: false, mode: 'off' }, { on: false }), /on=0 mode=off inputs=raw_copper .*rule_out=off/)
})

const NOW = 1_800_000_000_000
const entry = ({ names = { dirt: [5, 1] }, at = NOW - 60_000, h = null, dirtyAfter = false, k = '1,64,1' } = {}) => {
  const recs = [{ t: 'obs', id: 'o1', k, h: h ?? [k], at, names, used: 1, size: 27, w: null }]
  if (dirtyAfter) recs.push({ t: 'dirty', id: 'd1', k, h: [k], at: at + 1000, phase: 'post', op: 'x', w: null })
  return TI.foldIndex(recs).worlds.null
}
await t('indexRuledOut: KNOWN + fresh (< the miss life) + holds none -> ruled out (both halves); holding it, dirty, stale, future-dated, or deposited into since -> NOT', () => {
  const ru = (e, opts = {}) => SJ.indexRuledOut(e, 'raw_iron', NOW, { ttl: SJ.IRON_MISS_TTL_MS, ...opts })
  assert.deepEqual([...ru(entry()).keys], ['1,64,1']); assert.equal(ru(entry()).n, 1)
  assert.deepEqual([...ru(entry({ h: ['1,64,1', '1,64,2'] })).keys].sort(), ['1,64,1', '1,64,2'], 'a double chest: both halves')
  assert.equal(ru(entry({ names: { raw_iron: [3, 1] } })).n, 0, 'holds the input')
  assert.equal(SJ.indexRuledOut(entry({ names: { raw_iron: [3, 1] } }), 'raw_copper', NOW).n, 1, 'per need: iron there says nothing about copper')
  assert.equal(ru(entry({ dirtyAfter: true })).n, 0, 'a mutation mark after the observation')
  assert.equal(ru(entry({ at: NOW - SJ.IRON_MISS_TTL_MS - 1 })).n, 0, 'older than the miss life (2 h), though the index calls it known to 6 h')
  assert.equal(ru(entry({ at: NOW - SJ.IRON_MISS_TTL_MS + 60_000 })).n, 1, 'CONTROL: inside the miss life')
  assert.equal(ru(entry({ at: NOW + SJ.INDEX_FUTURE_SLACK_MS + 1 })).n, 0, 'stamped in the future')
  assert.equal(ru(entry(), { tookAt: { '1,64,1': NOW - 60_000 + SJ.RULE_OUT_TOOK_SLACK_MS + 1 } }).n, 0, 'a deposit recorded after it (town memory)')
  assert.equal(ru(entry(), { tookAt: { '1,64,1': NOW - 60_000 + 1 } }).n, 1, 'CONTROL: the took of the verifying re-open itself (1 ms after)')
  assert.equal(SJ.indexRuledOut({}, 'raw_iron', NOW).n, 0); assert.equal(SJ.indexRuledOut(entry(), null, NOW).n, 0)
})
await t('ironSmeltCount: at most the batch, the town take, and the bag ABOVE its opening count -- the bag\'s own raw iron is never fed', () => {
  assert.equal(SJ.ironSmeltCount({ withdrawn: 8, raw0: 3, rawNow: 11 }), 8)
  assert.equal(SJ.ironSmeltCount({ withdrawn: 5, raw0: 3, rawNow: 8 }), 5, 'own 3 + town 5: smelt 5, not 8')
  assert.equal(SJ.ironSmeltCount({ withdrawn: 12, raw0: 0, rawNow: 12 }), 8, 'the batch')
  assert.equal(SJ.ironSmeltCount({ withdrawn: 8, raw0: 3, rawNow: 5 }), 2, 'a take that went missing (a pickup lost, a toss): only what is above the own')
  assert.equal(SJ.ironSmeltCount({ withdrawn: 8, raw0: 3, rawNow: 2 }), 0)
})
await t('ironBankPlan: per name, exactly above the opening count; own held back; prior raw input bounded by take + prior', () => {
  // own 3 raw + 2 ingots; took 8, smelted 8 (the furnace also had 2 prior ingots taken): bank 10 ingots, 0 raw; hold 2 / 3
  assert.deepEqual(SJ.ironBankPlan({ raw0: 3, ingot0: 2, rawNow: 3, ingotNow: 12, withdrawn: 8 }), { iron_ingot: { deposit: 10, own: 2 }, raw_iron: { deposit: 0, own: 3 } })
  // a partial smelt: 5 of 8 made, 3 raw back from the furnace
  assert.deepEqual(SJ.ironBankPlan({ raw0: 3, ingot0: 2, rawNow: 6, ingotNow: 7, withdrawn: 8 }), { iron_ingot: { deposit: 5, own: 2 }, raw_iron: { deposit: 3, own: 3 } })
  // a raw iron picked up on the walk is not the town's to bank beyond the take (+ prior)
  assert.deepEqual(SJ.ironBankPlan({ raw0: 0, ingot0: 0, rawNow: 9, ingotNow: 0, withdrawn: 8 }).raw_iron, { deposit: 8, own: 1 })
  assert.deepEqual(SJ.ironBankPlan({ raw0: 0, ingot0: 0, rawNow: 9, ingotNow: 0, withdrawn: 8, priorRaw: 1 }).raw_iron, { deposit: 9, own: 0 })
  // the bag lost own iron meanwhile: nothing is banked, nothing goes negative
  assert.deepEqual(SJ.ironBankPlan({ raw0: 3, ingot0: 2, rawNow: 1, ingotNow: 1, withdrawn: 8 }), { iron_ingot: { deposit: 0, own: 1 }, raw_iron: { deposit: 0, own: 1 } })
})
const orderOf = (o = {}) => SJ.smeltTownOrder({ now: 1e12, atTown: true, freeSlots: 5, held: {}, townMiss: true, ironMiss: true, state: {}, ...o })
await t('THE GATE (smeltTownOrder): iron in town -> an order (iron first, even with copper carried); neither input anywhere and no copper -> town_has_none; IRONSMELT off -> the base', () => {
  assert.match(orderOf({ ironMiss: false }).order?.why ?? '', /raw iron left to look for.* iron ingots/)
  assert.match(orderOf({ ironMiss: false, held: { raw_copper: 4 } }).order?.why ?? '', /raw iron/, 'iron first, even with copper carried')
  assert.equal(orderOf().skip, 'town_has_none')
  assert.equal(orderOf().state.lastIssuedAt, 1e12, 'the look is charged the cooldown (base)')
  assert.match(orderOf({ held: { raw_copper: 4 } }).order?.why ?? '', /4 raw_copper/, 'the bag\'s copper still dispatches')
  assert.ok(orderOf({ held: { copper_ingot: 4 } }).order, 'carried ingots still dispatch (the carry return)')
  assert.ok(orderOf({ townMiss: false }).order, 'copper in town still dispatches')
  // IRONSMELT off: the iron reading is never even taken
  let asked = 0
  const off = orderOf({ iron: false, ironMiss: () => { asked++; return false } })
  assert.equal(off.skip, 'town_has_none'); assert.equal(asked, 0, 'the base gate exactly')
  // the cheap gates still come first (the look is lazy)
  assert.equal(orderOf({ freeSlots: 1, ironMiss: () => { throw new Error('read before room') } }).skip, 'room')
})

await t('THE ROW (Codex code r1 P3): the iron fields sit right after stop=, so the logger\'s 300-char cap can only cut the search tallies at the end -- every balance and ownership field survives at the widest values', () => {
  const wide = SJ.smeltTownDetail({ stop: 'smelt:transfer_unsettled', in: 'fe', fe: '999/999>999/999', fed: 64, ru: 99, n: 8, bag0: 1998, withdrawn: 8, coal: 1, smelted: 8, prior: 64,
    deposited: 136, depI: 128, depR: 8, bag1: 1998, furnaceLeft: '?', furnace: '-12345,-64,-12345', lease: 'unleased', verdict: 'unreconciled', diff: -128,
    chest: '-12345,-64,-12345', t0: 1760500000000, fuelBack: 64, looked: 28, more: 'coal' })
  const cut = wide.slice(0, 300)
  for (const k of ['stop', 'in', 'fe', 'fed', 'ru', 'n', 'bag0', 'withdrawn', 'coal', 'smelted', 'prior', 'deposited', 'dep_i', 'dep_r', 'bag1', 'left', 'verdict', 'diff', 't0']) {
    assert.ok(new RegExp(`(^| )${k}=\\S+ `).test(cut), `${k} survives the cap: ${cut}`)
  }
  assert.equal(field(cut, 'fe'), '999/999>999/999')
})
// ---- the real skill over the fake world ----------------------------------------------------------------------------
const ironFirst = async S => {
  // the NEAR chest holds raw copper; the FAR chest raw iron and coal: the job takes the IRON
  const w = town({ stock: { [kOf(NEAR)]: [stack('raw_copper', 8)], [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  const r = await job(S, w)
  const row = lastRow()
  assert.equal(field(row, 'in'), 'fe', row)
  assert.equal(field(row, 'withdrawn'), '8', row)
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(count(chest(w, NEAR), 'raw_copper'), 8, 'the copper is not touched')
  assert.equal(townTotal(w, 'raw_iron'), 8, 'no furnace: the town\'s raw iron goes back')
  assert.equal(townTotal(w, 'coal'), 4, 'and its coal')
  assert.equal(count(w.bag, 'raw_iron'), 0); assert.equal(w.dropped.length, 0)
  assert.match(row, /verdict=ok/, row)
}
await t('IRON FIRST: raw copper in the NEAREST chest, raw iron + coal in a far one -> the job takes the 8 raw iron (in=fe), never the copper; the no-furnace exit banks the iron and coal back', async () => {
  await ironFirst(S0)
})
const ownIron = async S => {
  const w = town({ bag: [stack('cobblestone', 3), stack('raw_iron', 3), stack('iron_ingot', 2)], stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  const r = await job(S, w)
  const row = lastRow()
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(count(w.bag, 'raw_iron'), 3, `the bag keeps its OWN 3 raw iron: ${row}`)
  assert.equal(count(w.bag, 'iron_ingot'), 2, 'and its own 2 ingots')
  assert.equal(townTotal(w, 'raw_iron'), 8, 'exactly the town\'s 8 back in town')
  assert.equal(townTotal(w, 'iron_ingot'), 0, 'none of the bag\'s ingots banked')
  assert.equal(field(row, 'fe'), '3/2>3/2', row); assert.match(row, /verdict=ok/, row)
}
await t('OWN IRON: a bag holding its own 3 raw iron + 2 ingots -> the job takes the town\'s 8, and every exit banks exactly the town\'s; fe=3/2>3/2, verdict=ok', async () => {
  await ownIron(S0)
})
const smeltCountScene = async S => {
  // a furnace in reach (past the furnace check); the town holds 5 raw iron; the bag its own 3: the furnace is fed 5, never 8
  const w = town({ bag: [stack('cobblestone', 3), stack('raw_iron', 3)], stock: { [kOf(FAR)]: [stack('raw_iron', 5), stack('coal', 4)] } })
  w.set(1, 64, -1, 'furnace')
  const r = await job(S, w, { runner: { current: { startedAt: Date.now() } } })
  const row = lastRow()
  assert.equal(field(row, 'withdrawn'), '5', row)
  assert.equal(field(row, 'n'), '5', `the smelt is sized to the town take, never the bag's own: ${row} (${r.stop})`)
  assert.equal(count(w.bag, 'raw_iron'), 3, 'the bag ends with its own 3')
}
await t('THE SMELT COUNT: town 5 raw iron + the bag\'s own 3 -> the job asks the furnace for 5 (n=5), never 8; the bag ends with its own 3', async () => {
  await smeltCountScene(S0)
})
const roomKeepScene = async S => {
  // a full bag (34 dirt stacks + own raw iron + own ingots): the take of raw iron merges into the bag's raw stack, the coal needs
  // a slot -- the room-making deposit must never bank the bag's OWN ingots for it
  const bag = [...Array.from({ length: 34 }, () => stack('dirt', 64)), stack('raw_iron', 3), stack('iron_ingot', 2)]
  const w = town({ bag, stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  await job(S, w)
  assert.equal(count(w.bag, 'iron_ingot'), 2, `the bag's own ingots stay: ${lastRow()}`)
  assert.equal(townTotal(w, 'iron_ingot'), 0, 'none banked to make room')
}
await t('THE ROOM KEEP: a full bag whose only bankable stack is its own iron ingots -> the take never banks them to make room', async () => {
  await roomKeepScene(S0)
})
const cutWithCopper = async S => {
  // a town of more containers than one pass covers, no iron anywhere: the iron pass is CUT with candidates left. With raw copper
  // carried, the job smelts the copper (in=cu) instead of idling it; CONTROL: no copper carried -> search_more (no strike)
  const extra = w => {
    for (let x = -12; x <= 12; x += 3) for (let z = -12; z <= 12; z += 3) {
      if (Math.hypot(x, z) > 13 || CHESTS.some(c => c[0] === x && c[2] === z) || (x === 6 && z === 0)) continue
      w.set(x, 64, z, 'chest'); w.stock(x, 64, z, [stack('dirt', 5)])
    }
    w.stock(...FAR, [stack('coal', 4)])
  }
  const w = town({ bag: [stack('cobblestone', 3), stack('raw_copper', 5)] }); extra(w)
  const r = await job(S, w)
  assert.equal(field(lastRow(), 'in'), 'cu', `${r.stop} ${lastRow()}`)
  assert.match(field(lastRow(), 'more') ?? '', /^fe\+/, `the cut iron pass is recorded (more=fe+<...>): ${lastRow()}`)
  const w2 = town(); extra(w2)
  const r2 = await job(S, w2)
  assert.equal(r2.stop, SJ.SMELT_SEARCH_MORE, `${r2.status} ${r2.stop} ${r2.detail}`)
  assert.equal(field(lastRow(), 'more'), 'fe', lastRow())
  assert.equal(count(w2.bag, 'coal'), 0, 'no coal carried away without input in hand')
}
await t('AN UNFINISHED IRON SEARCH never idles copper in hand: cut with candidates + carried copper -> a copper job; CONTROL: nothing carried -> search_more, more=fe, no coal taken', async () => {
  await cutWithCopper(S0)
})
const ruledOutGate = async S => {
  // every container's latest index observation: no raw iron, no raw copper, fresh, no mutation since -> nothing to look at
  const w = town()
  for (const c of CHESTS) seenByIndex(c)
  assert.equal(S.townIronMiss(w.bot), true, 'the iron search has no candidate: every container index-known empty')
  assert.equal(S.townCopperMiss(w.bot), true, 'nor the copper search')
  assert.equal(S.jobRuledOut(w.bot, 'raw_iron').n, CHESTS.length)
  // the job itself agrees with the gate: it opens NOTHING
  const r = await job(S, w)
  assert.equal(r.stop, 'town_has_none', `${r.status} ${r.stop} ${r.detail}`); assert.equal(w.spy.opened.length, 0, `${w.spy.opened}`)
  // A DEPOSIT RECORDED ONLY IN TOWN MEMORY (o=took, written by the depositor apart from the index -- its index marks failed)
  // re-opens that container too (Claude code r2 P3-4)
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => { e[kOf(CHESTS[2])] = { o: 'took', at: Date.now() + 10_000, strikes: [] } })
  assert.equal(S.townIronMiss(w.bot), false, 'a town-memory deposit mark after the observation makes it a candidate again')
  assert.equal(S.jobRuledOut(w.bot, 'raw_iron').n, CHESTS.length - 1)
  // ONE MUTATION MARK re-opens that container at once (a deposit: the index's dirty mark)
  dirtyByIndex(CHESTS[4])
  // smeltgate-01: the GATE's evidence is a move of the input, not any mark (a closed deposit records its moves); the took mark
  // above already keeps the gate open here, so the dirty mark is judged by the SEARCH (the rule-out count below)
  assert.equal(S.townIronMiss(w.bot), false, 'a deposit into one container makes it a candidate again')
  assert.equal(S.jobRuledOut(w.bot, 'raw_iron').n, CHESTS.length - 2, 'the dirty mark re-opened its container (not only the took mark) -- Claude r3 P3-3')
  // CONTROL: the same town with NO index -> both searches have candidates (the base: an order that opens and finds nothing)
  const w2 = town()
  assert.equal(S.townIronMiss(w2.bot), false); assert.equal(S.townCopperMiss(w2.bot), false)
}
await t('THE RULE-OUT IS THE GATE AND THE SEARCH: a town the index knows empty -> both gates true and the job opens nothing; one dirty mark re-opens; CONTROL: no index -> candidates (the base churn)', async () => {
  await ruledOutGate(S0)
})
const ruledHolder = async S => {
  // the index rules out the near containers only; the FAR one is index-known to HOLD raw iron -> the job goes straight there
  const w = town({ stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  for (const c of CHESTS) if (c !== FAR) seenByIndex(c)
  const r = await job(S, w)
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(w.spy.opened[0], kOf(FAR), `the first open is the one container not ruled out: ${w.spy.opened}`)
  assert.equal(field(lastRow(), 'ru'), String(CHESTS.length - 1), lastRow())
}
await t('THE RULE-OUT NARROWS THE SEARCH: the index knows 8 of 9 containers hold no raw iron -> the first open is the 9th (ru=8); the iron is taken there', async () => {
  await ruledHolder(S0)
})
await t('THE IRON MISS IS READ (Claude design r1 P3-1): every container a live iron miss -> townIronMiss true (with the index unread); CONTROL: one not -> false', async () => {
  const w = town()
  const keys = CHESTS.map(kOf)
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.IRON_MISS_KEY, SJ.IRON_MISS_TTL_MS, keys.slice(1)))
  assert.equal(S0.townIronMiss(w.bot), false)
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.noteItemMisses(e, SJ.IRON_MISS_KEY, SJ.IRON_MISS_TTL_MS, keys))
  assert.equal(S0.townIronMiss(w.bot), true)
})

// ---- mutants -----------------------------------------------------------------------------------------------------------
await t('MUTANTS: each removes one part of the change and a behaviour test above fails for it', async () => {
  const kills = {}
  kills.noIronPass = await withMutant(SKILLS_PATH, 'try { await jobWithdraw(ctx, { iron: IRONSMELT.on ? SMELT_JOB_BATCH : 0,', 'try { await jobWithdraw(ctx, { iron: 0,', S => killedBy(() => ironFirst(S)))
  kills.noOwnHold = await withMutant(SKILLS_PATH, "const restore = swapWithdrawHold(name, plan[name].own, Date.now() + 10 * 60_000)\n        try { await deposit(ctx, { item: name }, signal, { noRecovery: true, preferAt }) } finally { restore() }",
    "const restore = () => {}\n        try { await deposit(ctx, { item: name }, signal, { noRecovery: true, preferAt }) } finally { restore() }", S => killedBy(() => ownIron(S)))
  kills.bagCount = await withMutant(SKILLS_PATH, 'f.n = IN === SMELT_IRON_INPUT ? ironSmeltCount({ withdrawn: f.withdrawn, raw0, rawNow: have }) : Math.min(SMELT_JOB_BATCH, have)',
    'f.n = Math.min(SMELT_JOB_BATCH, have)', S => killedBy(() => smeltCountScene(S)))
  kills.noRoomKeep = await withMutant(SKILLS_PATH, 'const keep = IRONSMELT.on ? [...roomKeep(bot.currentWants ?? []), SMELT_IRON_INPUT, SMELT_IRON_OUTPUT] : roomKeep(bot.currentWants ?? [])',
    'const keep = roomKeep(bot.currentWants ?? [])', S => killedBy(() => roomKeepScene(S)))
  kills.idleCopper = await withMutant(SKILLS_PATH, 'if (cut && !(carried > 0) && !(ingots > 0)) { out.ironMore = true; return out }', 'if (cut) { out.ironMore = true; return out }', S => killedBy(() => cutWithCopper(S)))
  kills.noRuleOutGate = await withMutant(SKILLS_PATH, 'tried: jobRuledOut(bot, SMELT_IRON_INPUT).keys }) } catch { return false }', '}) } catch { return false }', S => killedBy(() => ruledOutGate(S)))
  kills.noRuleOutCopperGate = await withMutant(SKILLS_PATH, 'tried: jobRuledOut(bot, SMELT_JOB_INPUT).keys }) } catch { return false }', '}) } catch { return false }', S => killedBy(() => ruledOutGate(S)))
  kills.noTookWiring = await withMutant(SKILLS_PATH, "for (const [h, e] of Object.entries(mem ?? {})) if (e?.o === 'took' && Number.isFinite(e.at)) tookAt[h] = e.at", '', S => killedBy(() => ruledOutGate(S)))
  kills.noRuleOutSearch = await withMutant(SKILLS_PATH, "const ro = nd === SMELT_JOB_FUEL ? null : jobRuledOut(bot, nd)", 'const ro = null', S => killedBy(() => ruledHolder(S)))
  kills.ruleOutNoTtl = await withMutant(SJ_PATH, ' || now - at >= ttl) continue', ') continue', async SJm => killedBy(() => {
    assert.equal(SJm.indexRuledOut(entry({ at: NOW - SJ.IRON_MISS_TTL_MS - 1 }), 'raw_iron', NOW, { ttl: SJ.IRON_MISS_TTL_MS }).n, 0)
  }))
  kills.ruleOutNoTook = await withMutant(SJ_PATH, '    if (halves.some(h => Number.isFinite(tookAt?.[h]) && tookAt[h] > at + RULE_OUT_TOOK_SLACK_MS)) continue\n', '', async SJm => killedBy(() => {
    assert.equal(SJm.indexRuledOut(entry(), 'raw_iron', NOW, { tookAt: { '1,64,1': NOW } }).n, 0)
  }))
  kills.gateIgnoresIron = await withMutant(SJ_PATH, '  const townIron = !!iron && !lazy(ironMiss)', '  const townIron = false', async SJm => killedBy(() => {
    assert.ok(SJm.smeltTownOrder({ now: 1e12, atTown: true, freeSlots: 5, held: {}, townMiss: true, ironMiss: false, state: {} }).order)
  }))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})


FX.done()

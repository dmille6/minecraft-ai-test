// INDEXFETCH-01SHOW r2: THE WITHDRAW VERB USES THE INDEX'S HOLDERS AND CORRECTS A WRONG ENTRY (indexfetch.mjs nextHolder, shortRemedy;
// skills.mjs withdrawVerb). Behaviour in the fake world: a stale entry is corrected at once (the one shared index: a SECOND bot sees it)
// and the same withdraw goes on to the next listed holder; a fresh entry is withdrawn from at the first container (positive control);
// no holder at all -> a refusal that names what the bot can do. Then anchored mutants (each asserts its anchor is present and unique).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ixwd-logs-'))
process.env.BOT_NAME = 'IxWdBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ixwd-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const F = await import('../src/indexfetch.mjs')
const TI = await import('../src/townindex.mjs')
const S = await import('../src/skills.mjs')
const { SKILLS, townIndexEntries } = S
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const missRows = n0 => RECS.slice(n0).filter(r => r.skill?.name === '_index_fetch' && /op=miss/.test(r.skill.detail ?? '')).map(r => r.skill.detail)
const sig = () => new AbortController().signal
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const NEAR = [[14, 64, 3], [15, 64, -2], [12, 64, 6]]   // the three the sweep opens first
const FAR = [-15, 64, 2]   // beyond the sweep's reach from there (24): only the index names it
const CHESTS = [...NEAR, FAR]
const kOf = ([x, y, z]) => `${x},${y},${z}`
const withdraw = (w, S2 = S) => S2.SKILLS.withdraw.run({ bot: w.bot }, { item: 'dirt', count: 8 }, sig())
/** A town the index has SEEN: every chest holds dirt, one open of each writes its observation (the shared index). */
function seenTown () {
  freshPool(); clearWithdrawHolds(); TI.resetIndexCache()
  const w = withServer(fakeWorld({ bag: [stack('cobblestone', 3)] }))
  w.bot.worldId = 'w-1'
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 12)]) }
  // the census: each chest is opened once, as a withdraw of dirt would -- by a taking of an unwanted item that opens and moves nothing
  const hk = TI.indexHomeKey({ x: 0, y: 64, z: 0 })
  let at = Date.now() - 5 * 60_000
  for (const c of CHESTS) {
    const k = kOf(c)
    TI.appendIndex(process.env.POOL_STATE_DIR, hk, 'w-1', { t: 'obs', id: `o-${k}`, k, h: [k], at: at++, bot: 'Census', by: 'test', ...TI.observation([stack('dirt', 12)], 27) })
  }
  TI.resetIndexCache()
  return w
}
const entryDirt = (bot, c) => townIndexEntries(bot)?.[kOf(c)]?.obs?.names?.dirt?.[0] ?? 0
const stateOf = (bot, c) => TI.indexStateOf(townIndexEntries(bot)?.[kOf(c)])

await t('the census is readable: every chest listed with dirt (the fixture is not vacuous)', () => {
  const w = seenTown()
  for (const c of CHESTS) assert.equal(entryDirt(w.bot, c), 12, kOf(c))
  assert.equal(F.nextHolder(townIndexEntries(w.bot), 'dirt', {})?.names?.dirt, 12)
})

await t('POSITIVE CONTROL: a fresh entry is withdrawn from at the first container -- one open, no miss row, nothing corrected', async () => {
  const w = seenTown(); const n0 = RECS.length
  const r = await withdraw(w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'dirt'), 8)
  assert.equal(w.spy.opened.length, 1, `opened ${w.spy.opened}`)
  assert.deepEqual(missRows(n0), [])
})

await t('A STALE ENTRY is corrected at once and the same withdraw goes on to the next listed holder', async () => {
  const w = seenTown()
  for (const c of NEAR) w.stock(...c, [])   // emptied after the census, no mark: the index still lists dirt there
  const n0 = RECS.length
  const r = await withdraw(w)
  assert.equal(r.status, 'success', `${r.failClass}: ${r.detail}`)
  assert.equal(count(w.bag, 'dirt'), 8)
  assert.deepEqual([...w.spy.opened].sort(), CHESTS.map(c => w.key(...c)).sort(), `the three stale ones, then the holder: ${w.spy.opened}`)
  assert.equal(w.spy.opened.at(-1), w.key(...FAR))
  const rows = missRows(n0)
  assert.equal(rows.length, 3, rows.join(' | '))
  assert.match(rows[0], /op=miss item=dirt k=\S+ idx=12 saw=0 fix=observed/)
  // SHARED: a second bot reading the same index sees the corrections now -- nothing listed at the three, the far one marked (taken from)
  const w2 = fakeWorld(); w2.bot.worldId = 'w-1'; w2.bot.username = 'Other'
  for (const c of NEAR) assert.equal(entryDirt(w2.bot, c), 0, `still listed at ${kOf(c)}`)
  for (const c of NEAR) assert.equal(stateOf(w2.bot, c), 'known', `${kOf(c)}: the corrected entry is a clean observation`)
  assert.equal(stateOf(w2.bot, FAR), 'dirty', 'the holder was taken from: marked until its next open')
  assert.equal(F.nextHolder(townIndexEntries(w2.bot), 'dirt', {}), null, 'no stale holder is left for the next bot')
})

await t('the correction survives a write that failed: with no observation a dirty mark leaves no reader trusting the entry', async () => {
  const w = seenTown()
  w.bot.cobbleEnded = true   // townIndexObserve writes nothing (its own guard): the verb's fallback must mark the entry
  for (const c of NEAR) w.stock(...c, [])
  const r = await withdraw(w)
  assert.equal(r.status, 'success', `${r.failClass}: ${r.detail}`)
  for (const c of NEAR) assert.equal(stateOf(w.bot, c), 'dirty', `${kOf(c)} should be dirty`)
})

await t('NO HOLDER: every listed container is empty -> the refusal says the town is short and what to do (gather / craft); the entries opened are corrected', async () => {
  const w = seenTown()
  for (const c of CHESTS) w.stock(...c, [])
  const r = await withdraw(w)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'container_short')
  assert.match(r.detail, /the town is short of dirt and its index lists no other holder/)
  assert.match(r.detail, /gather it \(gather dirt\)/)
  assert.ok(!/craft/.test(r.detail), 'dirt has no recipe here: no craft remedy is named that cannot be performed')
  assert.match(r.detail, /stale index entries were corrected/)
  assert.ok(!(r.detail.includes('no ') && r.detail.includes('within')), 'state.mjs reads that pair as nothing_found')
  // the next bot is not sent to a corrected chest: nothing listed at the ones opened
  const opened = new Set(w.spy.opened)
  const listed = CHESTS.filter(c => entryDirt(w.bot, c) > 0).map(c => w.key(...c))
  assert.ok(opened.size === 4 && listed.every(k => !opened.has(k)), `opened ${[...opened]} still listed ${listed}`)
})

await t('the remedy names only what the bot can perform: gather (a block), craft (a recipe), both, or the shortage itself', () => {
  assert.match(F.shortRemedy('iron_pickaxe', { craftable: true }), /craft one \(craft 1 iron_pickaxe\)$/)
  assert.match(F.shortRemedy('stick', { gatherable: false, craftable: true }), /craft it \(craft <count> stick\)$/)
  assert.match(F.shortRemedy('coal', { gatherable: true, craftable: true }), /gather it \(gather coal\), or craft it/)
  const none = F.shortRemedy('wheat_seeds', { fixed: 1 })
  assert.match(none, /1 stale index entry was corrected/); assert.match(none, /only a drop.*the shortage stands/)
  assert.ok(!/gather it|craft/.test(none), none)
  for (const sk of ['gather', 'craft']) assert.ok(SKILLS[sk], sk)
})
await t('A DROP (wheat_seeds: no block, no recipe): the verb\'s refusal is the shortage, not a command that cannot run', async () => {
  const w = seenTown()
  const r = await SKILLS.withdraw.run({ bot: w.bot }, { item: 'wheat_seeds', count: 8 }, sig())
  assert.equal(r.failClass, 'container_short')
  assert.match(r.detail, /the town is short of wheat_seeds and its index lists no other holder -- it is only a drop/)
  assert.ok(!/gather wheat_seeds|craft <count> wheat_seeds/.test(r.detail), r.detail)
})
await t('A TOOL with a recipe: the refusal says craft one', async () => {
  const w = seenTown(); w.bot.recipesAll = () => [{ result: {} }]
  const r = await SKILLS.withdraw.run({ bot: w.bot }, { item: 'iron_pickaxe', count: 1 }, sig())
  assert.equal(r.failClass, 'container_short')
  assert.match(r.detail, /craft one \(craft 1 iron_pickaxe\)/)
  assert.match(r.detail, /\(a usable copy\)/)
})

await t('INDEXFETCH=off / an unreadable index: no holder is named, the nearest-chest sweep is as it was', async () => {
  assert.equal(F.nextHolder(null, 'dirt'), null)
  assert.equal(F.nextHolder({}, 'dirt'), null)
  const w = seenTown()
  for (const c of NEAR) w.stock(...c, [])
  // the sweep only: three nearest are empty and the fourth is out of its reach (no index to say so) -- today's refusal, kept
  const r = await withMutant(SKILLS_PATH, 'const h = ixHolder()', 'const h = null', m => withdraw(w, m))
  assert.equal(r.failClass, 'container_short')
})

// ------------------------------------------------------------------------------------------------- anchored mutants
await t('MUTANT KILLED: the verb never goes to the index-listed holder (the sweep alone) -> the stale case fails', async () => {
  assert.ok(await killedBy(async () => {
    const w = seenTown()
    for (const c of NEAR) w.stock(...c, [])
    const r = await withMutant(SKILLS_PATH, 'const h = ixHolder()', 'const h = null', m => withdraw(w, m))
    assert.equal(r.status, 'success', r.detail)
  }))
})
await t('MUTANT KILLED: the correction removed (no dirty mark when the open wrote no observation) -> the entry stays trusted', async () => {
  assert.ok(await killedBy(async () => {
    const w = seenTown()
    w.bot.cobbleEnded = true
    for (const c of NEAR) w.stock(...c, [])
    await withMutant(SKILLS_PATH, "townIndexDirty(bot, chestBlock.position, 'withdraw_miss', 'post') ? 'dirty' : 'failed'", "'failed'", m => withdraw(w, m))
    for (const c of NEAR) assert.equal(stateOf(w.bot, c), 'dirty', `${kOf(c)} should be dirty`)
  }))
})
await t('MUTANT KILLED: the refusal without its remedy -> the no-holder case fails', async () => {
  assert.ok(await killedBy(async () => {
    const w = seenTown()
    for (const c of CHESTS) w.stock(...c, [])
    const r = await withMutant(SKILLS_PATH, ' -- ${shortRemedy(item, { fixed, ...itemRoutes(bot, item) })}`', '`', m => withdraw(w, m))
    assert.match(r.detail, /the town is short of dirt/)
  }))
})
await t('MUTANT KILLED: an index-led visit uses up the sweep\'s three -> the fourth holder is never reached', async () => {
  assert.ok(await killedBy(async () => {
    const w = seenTown()
    for (const c of NEAR) w.stock(...c, [])
    const r = await withMutant(SKILLS_PATH, 'if (!led) n++', 'n++', m => withdraw(w, m))
    assert.equal(r.status, 'success', r.detail)
  }))
})

await t('MUTANT KILLED: every item reads as gatherable -> the drop\'s refusal promises a gather that cannot run', async () => {
  assert.ok(await killedBy(async () => {
    const w = seenTown()
    const r = await withMutant(SKILLS_PATH, 'try { gatherable = !!resolveBlockName(bot, item).name } catch { gatherable = false }', 'gatherable = true', m => m.SKILLS.withdraw.run({ bot: w.bot }, { item: 'wheat_seeds', count: 8 }, sig()))
    assert.ok(!/gather wheat_seeds/.test(r.detail), r.detail)
  }))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

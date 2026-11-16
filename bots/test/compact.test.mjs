// COMPACT-01 (src/compact.mjs has the measurement and the rules): nine of a mineral are one block; a name's fragments drawn and banked
// again merge. Behaviour (the pure plans over the LIVE town index figures of 11-16), anchored mutants, then the wiring.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-compact-${process.pid}`
process.env.BOT_NAME = 'TestBot'
const C = await import('../src/compact.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const P = n => new URL(`../src/${n}.mjs`, import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} in ${path.pathname} (a mutant that was never written reads as killed)`)
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (path, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(path, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const one = (src, re, what) => assert.equal((src.match(new RegExp(re, 'g')) ?? []).length, 1, `${what}: expected exactly one executable line matching ${re}`)

// LIVE 11-16 20:01Z, the town index summed over 33 containers: name -> [items, slots]
const LIVE = { cobblestone_wall: [3149, 70], moss_block: [410, 93], coal: [325, 53], copper_ingot: [787, 48], lantern: [178, 43], iron_pickaxe: [57, 57], cobbled_deepslate: [945, 31], spruce_log: [414, 25], lapis_lazuli: [330, 24], diamond: [112, 24], stone: [319, 21], snowball: [102, 20], wheat: [134, 19], stick: [74, 12] }
const STOCK = Object.fromEntries(Object.entries(LIVE).map(([k, v]) => [k, v[0]]))
const S = C.compactSettings({})
const size = n => (n === 'snowball' ? 16 : n === 'iron_pickaxe' ? 1 : 64)

await t('SETTINGS: on by default, COMPACT=off is the rollback; the loose keeps are a setting; every recipe is a storage block', () => {
  assert.equal(S.on, true); assert.equal(C.compactSettings({ COMPACT: 'off' }).on, false)
  assert.deepEqual([S.minCrafts, S.maxStacks, S.mergeMin], [7, 8, 3])
  assert.deepEqual([C.compactKeepOf('coal', S.keep), C.compactKeepOf('copper_ingot', S.keep), C.compactKeepOf('clay_ball', S.keep)], [128, 512, 0])
  assert.equal(C.compactKeepOf('coal', C.compactSettings({ COMPACT_KEEP: 'coal:0,*:5' }).keep), 0)
  assert.equal(C.compactKeepOf('diamond', C.compactSettings({ COMPACT_KEEP: 'coal:0,*:5' }).keep), 5)
  assert.deepEqual(Object.entries(C.RECIPES).map(([f, r]) => `${r.n} ${f} -> ${r.to}`), ['9 coal -> coal_block', '9 iron_ingot -> iron_block', '9 copper_ingot -> copper_block', '9 lapis_lazuli -> lapis_block', '9 redstone -> redstone_block', '9 diamond -> diamond_block', '9 gold_ingot -> gold_block', '9 iron_nugget -> iron_ingot', '9 wheat -> hay_block', '4 clay_ball -> clay', '4 snowball -> snow_block'])
  assert.match(C.compactModeDetail(S), /^on=1 min_crafts=7 max_stacks=8 merge_min=3 keep=coal:128,/)
})
await t('THE BAG: nuggets, clay balls and snowballs are crafted before banking -- whole crafts above the keep, and only with a slot for the product', () => {
  assert.deepEqual(C.bagCompact({ iron_nugget: 30, clay_ball: 14, snowball: 3, coal: 99 }, { free: 5 }), [{ from: 'iron_nugget', to: 'iron_ingot', crafts: 3, uses: 27 }, { from: 'clay_ball', to: 'clay', crafts: 3, uses: 12 }], '3 snowballs are no craft; coal is not the bag\'s to compact')
  assert.deepEqual(C.bagCompact({ iron_nugget: 30 }, { free: 0 }), [], 'no slot for the ingots: nothing (a craft into a full bag drops its product)')
  assert.equal(C.bagCompact({ iron_nugget: 30, iron_ingot: 2 }, { free: 0 }).length, 1, 'a stack to join is room enough')
  assert.deepEqual(C.bagCompact({ clay_ball: 14 }, { keeps: { clay_ball: 8 }, free: 2 })[0].crafts, 1, 'the keep stays')
  assert.deepEqual(C.bagCompact({ iron_nugget: 30 }, { free: 5, on: false }), [])
})
await t('THE CLERK COMPACTS what the chests hold above the loose keep: the LIVE town -> copper first (the most), 8 stacks a visit; never below the keep', () => {
  const c = C.chestCompact(STOCK, { free: 20, settings: S, stackOf: size })
  assert.deepEqual(c, { from: 'copper_ingot', to: 'copper_block', take: 270, crafts: 30 }, '787 - 512 kept = 275 -> 30 crafts')
  const noCu = { ...STOCK, copper_ingot: 500 }
  assert.deepEqual(C.chestCompact(noCu, { free: 20, settings: S, stackOf: size }), { from: 'lapis_lazuli', to: 'lapis_block', take: 261, crafts: 29 })
  assert.deepEqual(C.chestCompact({ coal: 325 }, { free: 20, settings: S, stackOf: size }), { from: 'coal', to: 'coal_block', take: 189, crafts: 21 }, '325 - 128 loose')
  assert.equal(C.chestCompact({ coal: 128 + 62 }, { free: 20, settings: S, stackOf: size }), null, '6 crafts: not worth a visit')
  assert.equal(C.chestCompact({ coal: 2000 }, { free: 20, settings: S, stackOf: size }).take, 504, '8 stacks a visit (512 -> 504, whole crafts)')
  assert.equal(C.chestCompact({ coal: 2000 }, { free: 4, settings: S, stackOf: size }).take, 126, 'two slots stay free: the product and the remainder')
  assert.equal(C.chestCompact({ coal: 2000 }, { free: 2, settings: S, stackOf: size }), null)
  assert.equal(C.chestCompact(STOCK, { free: 20, settings: C.compactSettings({ COMPACT: 'off' }), stackOf: size }), null)
  assert.equal(C.chestCompact(null, { free: 20 }), null, 'no index: no pass on a guess')
})
await t('THE CLERK MERGES the worst-fragmented name: the LIVE town -> moss (93 slots for 7 stacks\' worth); never a tool, never a skipped kind', () => {
  const m = C.mergePick(LIVE, { free: 12, settings: S, stackOf: size })
  assert.deepEqual(m, { name: 'moss_block', take: 410, slots: 93, after: 7, waste: 86 })
  assert.equal(C.mergePick(LIVE, { free: 4, settings: S, stackOf: size }).take, 192, 'what three slots carry')
  assert.equal(C.mergePick({ iron_pickaxe: [57, 57] }, { free: 12, settings: S, stackOf: size }), null, 'a tool does not stack')
  assert.equal(C.mergePick({ snowball: [102, 20] }, { free: 12, settings: S, stackOf: size }).after, 7, 'a 16-stack is judged by 16')
  assert.equal(C.mergePick({ stick: [74, 3] }, { free: 12, settings: S, stackOf: size }), null, 'wasting under 3 slots: not worth a visit')
  assert.equal(C.mergePick(LIVE, { free: 12, settings: S, stackOf: size, skip: n => n === 'moss_block' }).name, 'coal')
  assert.equal(C.mergePick(LIVE, { free: 1, settings: S, stackOf: size }), null)
})
await t('the take: never below the loose keep, judged on the town elsewhere + this chest; a merge takes what the chest shows', () => {
  assert.equal(C.compactAllow('coal', 100, { others: { coal: 100 }, here: { coal: 60 } }, 128), 32)
  assert.equal(C.compactAllow('coal', 100, { others: { coal: 20 }, here: { coal: 60 } }, 128), 0)
  assert.equal(C.compactAllow('moss_block', 410, { others: { moss_block: 400 }, here: { moss_block: 10 } }, 0), 10)
  assert.match(C.compactDetail({ op: 'compact', from: 'coal', to: 'coal_block', took: 189, made: 21, banked: { coal_block: 21 }, slots: '20->20', why: 'done' }), /^op=compact from=coal to=coal_block took=189 made=21 banked=coal_block:21 slots=20->20 why=done$/)
})
await t('MUTANTS KILLED: the loose keep ignored; a part craft taken; no slot kept for the product; a tool merged; the take past the keep', async () => {
  const CP = P('compact')
  await killedBy(CP, C, "    const over = (Number(stock[from]) || 0) - compactKeepOf(from, settings.keep)", "    const over = (Number(stock[from]) || 0)", M => assert.equal(M.chestCompact({ coal: 190 }, { free: 20, settings: S, stackOf: size }), null))
  await killedBy(CP, C, "    const take = Math.floor(Math.min(over, slots * (Number(stackOf(from)) || 64)) / r.n) * r.n", "    const take = Math.min(over, slots * (Number(stackOf(from)) || 64))", M => assert.equal(M.chestCompact({ coal: 325 }, { free: 20, settings: S, stackOf: size }).take % 9, 0))
  await killedBy(CP, C, "  const slots = Math.min(settings.maxStacks, Math.max(0, (Number(free) || 0) - 2))", "  const slots = Math.min(settings.maxStacks, Math.max(0, (Number(free) || 0)))", M => assert.equal(M.chestCompact({ coal: 2000 }, { free: 2, settings: S, stackOf: size }), null))
  await killedBy(CP, C, "    if (!(max > 1) || skip(name)) continue", "    if (skip(name)) continue", M => assert.equal(M.mergePick({ iron_pickaxe: [57, 57] }, { free: 12, settings: S, stackOf: () => 1 }), null))
  await killedBy(CP, C, "have - Math.max(0, Number(keep) || 0)))", "have))", M => assert.equal(M.compactAllow('coal', 100, { others: { coal: 20 }, here: { coal: 60 } }, 128), 0))
  await killedBy(CP, C, "    if (!((Number(held?.[r.to]) || 0) > 0)) { if (!(room > 0)) continue; room-- }", "", M => assert.deepEqual(M.bagCompact({ iron_nugget: 30 }, { free: 0 }), []))
})
await t('WIRED: the bag compacts before it banks; the clerk\'s pass runs under its lease from the first yard; what it took goes back by the deposit\'s own body', () => {
  const sk = strip(readFileSync(P('skills'), 'utf8'))
  one(sk, 'if \\(LANES\\.on && COMPACT\\.on && !drawing\\) f\\.crafted \\+= await bagCompactNow\\(ctx, signal\\)', 'the bag')
  one(sk, "const cl = cp \\? projTakeLease\\(dir, key, 'clerkpass', me\\) : null", 'one clerk at a time')
  one(sk, 'const wd = await matsWithdraw\\(ctx, \\{ \\[name\\]: pass\\.take \\}, signal, 30_000, matsReserve\\(\\)\\.table, \\(n, want, o\\) => compactAllow\\(n, want, o, keep\\)\\)', 'the take never passes the loose keep')
  one(sk, 'const p = await sortPut\\(bot, block, o, deadline, signal, bag0\\)', 'put back by the deposit\'s body, the bag\'s own stock kept')
  one(sk, "if \\(plot === YARD_PLOT\\) \\{ const cp = clerkPassNow\\(bot, now\\); if \\(cp\\) return \\{ kind: 'clerkpass', urgent: false,", 'the order reads the pass as upkeep, never urgent')
  one(sk, "logEvent\\(\\{ kind: 'compact_mode'", 'the licence row')
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall compact tests passed')

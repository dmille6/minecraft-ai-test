// mineorder-01 (showcase 11-13): a build order is not given to a bot deep in the mine, whatever the project -- except the two that
// are worked below ground (the town stair, the step well). Live: 7 of 31 aborted build visits in 75 minutes were such orders
// (yard, wallext and tidy visits at y 6-21 that ended entombed or stuck before the bot reached the town).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const SH = await import('../src/shop.mjs')
const { STEPWELL_PLOT } = await import('../src/stepwell.mjs')
const { SHAFT_PLOT } = await import('../src/shaftgeom.mjs')
const G2 = await import('../src/grounds2.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {}, record: null, complete: false, freeSlots: 10, groundY: 70 }
const ORDER = { skill: 'build_shop', args: {} }
// `over`: what the hook answers -- how far above the feet the highest solid block of the bot's column stands (60: the town's ground over a mine;
// 3: a room's roof; 0: open sky), null (unknown), or 'none' (no hook installed)
const ask = (M, plot, feet, extra = {}, over = 60) => { M.setActivePlot(() => plot); M.setOverHead(over === 'none' ? null : () => over); try { return M.buildOrder({ ...base, feet, ...extra }) } finally { M.setActivePlot(() => null); M.setOverHead(null) } }

console.log('THE RULE (shop.mjs startsBelow)')
await t('startsBelow: 9 or more under the town\'s ground is below for every project but the stair and the step well; a sink as before; unknown position or ground, or no plot: never', () => {
  const on = { on: true, over: 60 }, off = { on: false, over: 60 }
  assert.deepStrictEqual([SH.startsBelow('yard', [19, 9, -30], 70, { on: true, over: 0 }), SH.startsBelow('yard', [19, 9, -30], 70, { on: true, over: 3 }), SH.startsBelow('yard', [19, 9, -30], 70, { on: true, over: 8 }), SH.startsBelow('yard', [19, 9, -30], 70, { on: true, over: null }), SH.startsBelow('yard', [19, 9, -30], 70, { on: true })], [false, false, false, false, false], 'LOW-IS-NOT-UNDERGROUND: open air, a room\'s roof, or unknown, is never refused')
  assert.strictEqual(SH.startsBelow('yard', [19, 9, -30], 70, { on: true, over: 9 }), true)
  assert.strictEqual(SH.startsBelow('road', [19, 9, -30], 70, { on: true, over: 0 }), true, 'the sinks\' rule is as it was (nothing asked)')
  assert.deepStrictEqual(['yard', 'wallext', 'tidy', 'house1', 'cottage2'].map(p => SH.startsBelow(p, [19, 9, -30], 70, on)), [true, true, true, true, true], 'BELOW-EVERY-PROJECT')
  assert.deepStrictEqual([SHAFT_PLOT, STEPWELL_PLOT].map(p => SH.startsBelow(p, [19, 9, -30], 70, on)), [false, false], 'WORKED-BELOW')
  assert.strictEqual(SH.startsBelow('yard', [0, 62, 0], 70, on), false, 'eight under (a dip, the lake shore) is not a mine')
  assert.strictEqual(SH.startsBelow('yard', [0, 61, 0], 70, on), true)
  assert.deepStrictEqual([SH.startsBelow('yard', null, 70, on), SH.startsBelow('yard', [0, 9, 0], null, on), SH.startsBelow(null, [0, 9, 0], 70, on), SH.startsBelow('yard', [0, NaN, 0], 70, on)], [false, false, false, false], 'an unknown is never a refusal')
  assert.deepStrictEqual([SH.startsBelow('yard', [0, 9, 0], 70, off), SH.startsBelow('road', [0, 9, 0], 70, off)], [false, true], 'the switch off: the sinks\' rule alone')
  assert.deepStrictEqual([SH.mineOrderOn({}), SH.mineOrderOn({ MINEORDER: 'off' }), SH.mineOrderOn({ MINEORDER: '0' }), SH.mineOrderOn({ MINEORDER: 'on' })], [true, false, false, true])
})

console.log('THE ORDER (the real shop.mjs buildOrder)')
await t('LIVE: the yard at y 9, the wall extension at y 21 and the tidy at y 17 are not ordered in the mine (skip `underground`); the same bots at the surface are', () => {
  for (const [plot, feet] of [['yard', [19, 9, -30]], ['wallext', [24, 21, -27]], ['tidy', [25, 17, -26]]]) {
    assert.strictEqual(ask(SH, plot, feet).skip, 'underground', `IN-THE-MINE ${plot}`)
    assert.strictEqual(ask(SH, plot, feet).order, null)
    assert.deepStrictEqual(ask(SH, plot, [feet[0], 71, feet[2]]).order, ORDER, `POSITIVE CONTROL: ${plot} at the surface`)
  }
})
await t('the step well is ordered to its builder down the well; the stair keeps its own rule (not this one); a dip in town is no mine; an unknown position is asked as before', () => {
  assert.deepStrictEqual(ask(SH, STEPWELL_PLOT, [-55, 20, -74]).order, ORDER, 'STEPWELL-BELOW')
  assert.strictEqual(SH.startsBelow(SHAFT_PLOT, [22, 12, -26], 70), false)
  assert.deepStrictEqual(ask(SH, 'yard', [-2, 64, 25]).order, ORDER)
  assert.deepStrictEqual(ask(SH, 'yard', null).order, ORDER)
  assert.deepStrictEqual(ask(SH, null, [19, 9, -30]).skip ?? null, ask(SH, null, [19, 71, -30]).skip ?? null, 'no active plot: the answer does not depend on the depth')
})
await t('THE CHAIN: the skip is not turned into a grounds order (the grounds refuse an underground bot themselves), and it charges no cooldown: the same bot at the surface a second later is ordered', () => {
  assert.ok(!Object.hasOwn(G2.NO_ORDER_SKIPS ?? {}, 'underground') && !(Array.isArray(G2.NO_ORDER_SKIPS) && G2.NO_ORDER_SKIPS.includes('underground')), 'NO-GROUNDS-STAND-IN')
  const state = {}
  assert.strictEqual(ask(SH, 'yard', [19, 9, -30], { state }).skip, 'underground')
  assert.deepStrictEqual(state, {}, 'the refusal writes nothing to the order\'s state')
  assert.deepStrictEqual(ask(SH, 'yard', [19, 71, -30], { state, now: base.now + 1000 }).order, ORDER, 'REMEDY-REACHED: up, and asked again at once')
})
await t('r1 + r2 (Codex BLOCKERS) NEITHER LOW GROUND NOR A ROOF IS A MINE: a builder on an open-air cane bank 12 under home is ordered; so is one inside a low building under its own roof three blocks up; with the town\'s ground over it at the same depth it is not; unknown, or no hook: ordered as before', () => {
  assert.deepStrictEqual(ask(SH, 'canefarm', [-9, 61, -29], { groundY: 72 }, 0).order, ORDER, 'LOW-SURFACE-ORDERED')
  assert.deepStrictEqual(ask(SH, 'house1', [0, 61, 0], { groundY: 72 }, 3).order, ORDER, 'UNDER-ITS-OWN-ROOF-ORDERED (r2: a glass roof at y 64)')
  assert.strictEqual(ask(SH, 'house1', [0, 61, 0], { groundY: 72 }, 11).skip, 'underground')
  assert.deepStrictEqual(ask(SH, 'canefarm', [-9, 61, -29], { groundY: 72 }, null).order, ORDER, 'unknown is never a refusal')
  assert.deepStrictEqual(ask(SH, 'canefarm', [-9, 61, -29], { groundY: 72 }, 'none').order, ORDER, 'no hook: as before')
  // the hook is asked only below the line (one column read there, none at the surface)
  let asked = 0
  SH.setActivePlot(() => 'yard'); SH.setOverHead(() => { asked++; return 60 })
  try { SH.buildOrder({ ...base, feet: [0, 71, 0] }); assert.strictEqual(asked, 0); SH.buildOrder({ ...base, feet: [0, 20, 0] }); assert.strictEqual(asked, 1) } finally { SH.setActivePlot(() => null); SH.setOverHead(null) }
  // a hook that throws is an unknown
  SH.setActivePlot(() => 'yard'); SH.setOverHead(() => { throw new Error('unloaded') })
  try { assert.deepStrictEqual(SH.buildOrder({ ...base, feet: [0, 20, 0] }).order, ORDER) } finally { SH.setActivePlot(() => null); SH.setOverHead(null) }
})
await t('overHead: the height of the HIGHEST solid block over the feet (read from the top down); leaves are not counted; nothing solid is 0; an unread cell above that block is unknown; what it is made of does not matter', () => {
  const col = m => (x, y, z) => (y in m ? m[y] : { name: 'air', boundingBox: 'empty' })
  const stone = { name: 'stone', boundingBox: 'block' }, leaf = { name: 'spruce_leaves', boundingBox: 'block' }, glass = { name: 'glass', boundingBox: 'block' }
  assert.strictEqual(SH.overHead(col({}), [0, 61, 0], 94), 0)
  assert.strictEqual(SH.overHead(col({ 70: leaf, 71: leaf }), [0, 61, 0], 94), 0, 'under a tree is the surface')
  assert.strictEqual(SH.overHead(col({ 64: glass }), [0, 61, 0], 94), 3, 'ROOF-IS-THREE (a glass roof: a room)')
  assert.strictEqual(SH.overHead(col({ 23: stone, 66: stone }), [0, 20, 0], 94), 46, 'HIGHEST-COUNTS (a gallery roof with the ground over it: the ground)')
  assert.strictEqual(SH.overHead(col({ 62: stone }), [0, 61, 0], 94), 0, 'the block at head height is not over the head (feet 61: the scan ends at 63)')
  assert.strictEqual(SH.overHead(col({ 95: stone }), [0, 61, 0], 94), 0, 'nothing above `top` is read')
  assert.strictEqual(SH.overHead(col({ 80: null }), [0, 61, 0], 94), null, 'unread: unknown')
  assert.strictEqual(SH.overHead(col({ 80: null, 90: stone }), [0, 61, 0], 94), 29, 'the highest block is known before the unread cell is reached')
  assert.deepStrictEqual([SH.overHead(null, [0, 61, 0], 94), SH.overHead(col({}), null, 94), SH.overHead(col({}), [0, 61, 0], NaN)], [null, null, null])
})
await t('MINEORDER=off: a finite project is ordered in the mine as before; a sink is still refused', () => {
  const was = process.env.MINEORDER; process.env.MINEORDER = 'off'
  try {
    assert.deepStrictEqual(ask(SH, 'yard', [19, 9, -30]).order, ORDER)
    assert.strictEqual(ask(SH, 'road', [19, 9, -30]).skip, 'underground')
  } finally { if (was === undefined) delete process.env.MINEORDER; else process.env.MINEORDER = was }
})

console.log('MUTANTS (shop.mjs)')
await t('the rule only for sinks (as before) dies on IN-THE-MINE; the step well not exempt dies on STEPWELL-BELOW', async () => {
  let why = null
  await withMutant(SHOP_PATH, "  (isSinkPlot(plot) || (!!on && plot != null && !BELOW_PLOTS.includes(plot) && Number.isFinite(over) && over > SINK_SURFACE_DY))\n", '  (isSinkPlot(plot))\n', async M => {
    try { assert.strictEqual(ask(M, 'yard', [19, 9, -30]).skip, 'underground', 'IN-THE-MINE yard') } catch (e) { why = e }
  })
  assert.ok(why instanceof assert.AssertionError && /IN-THE-MINE/.test(why.message), `the mutant survived or died for another reason: ${why?.message?.slice(0, 80) ?? 'survived'}`)
  why = null
  await withMutant(SHOP_PATH, 'export const BELOW_PLOTS = Object.freeze([SHAFT_PLOT, STEPWELL_PLOT])\n', 'export const BELOW_PLOTS = Object.freeze([SHAFT_PLOT])\n', async M => {
    try { assert.deepStrictEqual(ask(M, STEPWELL_PLOT, [-55, 20, -74]).order, ORDER, 'STEPWELL-BELOW') } catch (e) { why = e }
  })
  assert.ok(why instanceof assert.AssertionError && /STEPWELL-BELOW/.test(why.message), `the mutant survived or died for another reason: ${why?.message?.slice(0, 80) ?? 'survived'}`)
})
await t('r1 + r2 MUTANTS: nothing asked of the column (every low bot refused) dies on LOW-SURFACE-ORDERED; any roof at all read as the ground dies on UNDER-ITS-OWN-ROOF-ORDERED; the LOWEST block read instead of the highest dies on HIGHEST-COUNTS', async () => {
  let why = null
  await withMutant(SHOP_PATH, ' && !BELOW_PLOTS.includes(plot) && Number.isFinite(over) && over > SINK_SURFACE_DY))\n', ' && !BELOW_PLOTS.includes(plot)))\n', async M => {
    try { assert.deepStrictEqual(ask(M, 'canefarm', [-9, 61, -29], { groundY: 72 }, 0).order, ORDER, 'LOW-SURFACE-ORDERED') } catch (e) { why = e }
  })
  assert.ok(why instanceof assert.AssertionError && /LOW-SURFACE-ORDERED/.test(why.message), `the mutant survived or died for another reason: ${why?.message?.slice(0, 80) ?? 'survived'}`)
  why = null
  await withMutant(SHOP_PATH, ' && Number.isFinite(over) && over > SINK_SURFACE_DY))\n', ' && Number.isFinite(over) && over > 0))\n', async M => {
    try { assert.deepStrictEqual(ask(M, 'house1', [0, 61, 0], { groundY: 72 }, 3).order, ORDER, 'UNDER-ITS-OWN-ROOF-ORDERED') } catch (e) { why = e }
  })
  assert.ok(why instanceof assert.AssertionError && /UNDER-ITS-OWN-ROOF-ORDERED/.test(why.message), `the mutant survived or died for another reason: ${why?.message?.slice(0, 80) ?? 'survived'}`)
  why = null
  await withMutant(SHOP_PATH, '  for (let y = top; y >= feet[1] + 2; y--) {\n', '  for (let y = feet[1] + 2; y <= top; y++) {\n', async M => {
    const stone = { name: 'stone', boundingBox: 'block' }
    try { assert.strictEqual(M.overHead((x, y) => (y === 23 || y === 66 ? stone : { name: 'air', boundingBox: 'empty' }), [0, 20, 0], 94), 46, 'HIGHEST-COUNTS') } catch (e) { why = e }
  })
  assert.ok(why instanceof assert.AssertionError && /HIGHEST-COUNTS/.test(why.message), `the mutant survived or died for another reason: ${why?.message?.slice(0, 80) ?? 'survived'}`)
})
await t('WIRING (structural, comments stripped): the order asks startsBelow once, in place of the sinks\' own line', () => {
  const sk = readFileSync(SHOP_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.strictEqual(sk.split("  if (startsBelow(plot0, feet, groundY, { over: overOf(feet, groundY) })) return { order: null, skip: 'underground' }").length, 2)
  const skills = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.strictEqual(skills.split('setOverHead(feet => { const b = activeMem?.bot; return b?.blockAt ? overHead((x, y, z) => b.blockAt(new Vec3(x, y, z)), feet, config.world.homeY + 24) : null })').length, 2, 'the hook is installed over the bot\'s own world')
  assert.ok(!sk.includes('if (isSinkPlot(plot0) && Array.isArray(feet)'), 'the old line is gone (one rule, not two)')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

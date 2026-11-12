// ORDERNOWAIT-01 (ordernowait.mjs; OWNER 11-06): the town hall and the cottage stop waiting for the enchanting workshop to STAND,
// while the order still gives the workshop first. Behaviour: shop.mjs activeProject over project states, the switch, the licence row.
// Mutants assert their anchor is present and unique (a mutant that never applied reads as killed).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const S = await import('../src/shop.mjs')
const N = await import('../src/ordernowait.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}

async function withMutant (rel, old, neu, fn) {
  const path = new URL(`../src/${rel}`, import.meta.url)
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${rel}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// The live entries, in PROJECTS order (the workshop before the hall and the house: the owner's order).
const pick = plots => S.PROJECTS.filter(p => plots.includes(p.plot))
// `yard` (complete) last: activeProject's quiet fallback is the last project not waiting -- it must never be the hall or the house
const LIST = pick(['storehouse', 'hall', 'storehub', 'enchantshop', 'townhall', 'cottage1', 'yard'])
const done = plot => ({ plot, exists: true, complete: true, damaged: false })
const BASE = [done('storehouse'), done('hall'), done('storehub'), done('yard')]
const SCENES = {
  // the workshop sited, open, a slot free for this bot: the workshop first
  benchFree: [...BASE, { plot: 'enchantshop', exists: true, complete: false, damaged: false, free: true }],
  // the workshop sited, open, both slots held: this bot goes on
  benchFull: [...BASE, { plot: 'enchantshop', exists: true, complete: false, damaged: false, free: false }],
  // the workshop unsited and waiting on a failed siting (11-05: no_site all day)
  benchNoSite: [...BASE, { plot: 'enchantshop', exists: false, complete: false, damaged: false, waiting: true }],
}

console.log('ORDERNOWAIT-01: THE ORDER, NOT A GATE')
await t('the live entries still name the workshop as `after` (the order is kept; only the gate goes)', () => {
  assert.strictEqual(S.PROJECTS.find(p => p.plot === 'townhall')?.after, 'enchantshop')
  assert.strictEqual(S.PROJECTS.find(p => p.plot === 'cottage1')?.after, 'enchantshop')
  const ix = plot => S.PROJECTS.findIndex(p => p.plot === plot)
  assert.ok(ix('enchantshop') < ix('townhall') && ix('townhall') < ix('cottage1'), 'workshop, then hall, then house')
})
await t('the workshop sited with a slot free: the workshop first (owner: "workshop first where it can be sited")', () => {
  assert.strictEqual(S.activeProject(SCENES.benchFree, LIST, { noWait: true }).plot, 'enchantshop')
})
await t('the workshop full: the town hall, not the workshop again', () => {
  assert.strictEqual(S.activeProject(SCENES.benchFull, LIST, { noWait: true }).plot, 'townhall')
})
await t('the workshop full and the hall full too: the cottage', () => {
  const st = [...SCENES.benchFull, { plot: 'townhall', exists: true, complete: false, damaged: false, free: false }]
  assert.strictEqual(S.activeProject(st, LIST, { noWait: true }).plot, 'cottage1')
})
await t('the workshop cannot site (waiting): the town hall sites on its own plot', () => {
  assert.strictEqual(S.activeProject(SCENES.benchNoSite, LIST, { noWait: true }).plot, 'townhall')
})
await t('each keeps its OWN opening rule: a waiting town hall (no X2) is passed for the cottage', () => {
  const st = [...SCENES.benchNoSite, { plot: 'townhall', exists: false, complete: false, damaged: false, waiting: true }]
  assert.strictEqual(S.activeProject(st, LIST, { noWait: true }).plot, 'cottage1')
})
await t('ROLLBACK ENCHANT_NOWAIT=off: the hall and the house wait for the workshop to stand, exactly as before', () => {
  for (const sc of ['benchFull', 'benchNoSite']) {
    const got = S.activeProject(SCENES[sc], LIST, { noWait: false })
    assert.strictEqual(got?.plot, sc === 'benchFull' ? 'enchantshop' : 'yard', `${sc}: ${got?.plot}`)
  }
})
await t('every other `after` is still a gate: the hall waits for an unfinished storehouse with the switch on', () => {
  const st = [{ plot: 'storehouse', exists: true, complete: false, damaged: false, free: false }, done('yard')]
  const got = S.activeProject(st, pick(['storehouse', 'hall', 'yard']), { noWait: true })
  assert.notStrictEqual(got?.plot, 'hall', 'the hall is not offered while the storehouse is unfinished')
})
await t('afterMet: only the listed plots, and only for the workshop', () => {
  assert.strictEqual(N.afterMet({ plot: 'townhall', after: 'enchantshop' }, false, { noWait: true }), true)
  assert.strictEqual(N.afterMet({ plot: 'cottage1', after: 'enchantshop' }, false, { noWait: true }), true)
  assert.strictEqual(N.afterMet({ plot: 'house2', after: 'enchantshop' }, false, { noWait: true }), false, 'an unlisted plot still waits')
  assert.strictEqual(N.afterMet({ plot: 'townhall', after: 'storehub' }, false, { noWait: true }), false, 'another after still gates')
  assert.strictEqual(N.afterMet({ plot: 'townhall', after: 'enchantshop' }, false, { noWait: false }), false)
  assert.strictEqual(N.afterMet({ plot: 'townhall', after: 'enchantshop' }, true, { noWait: false }), true)
  assert.strictEqual(N.afterMet({ plot: 'x' }, false, { noWait: false }), true, 'no after: met')
})
await t('the switch: on in the showcase pool only; ENCHANT_NOWAIT=off / on override; the licence row says so', () => {
  assert.strictEqual(N.noWaitSwitches({}, 'showcase').on, true)
  assert.strictEqual(N.noWaitSwitches({}, 'board-a').on, false)
  assert.strictEqual(N.noWaitSwitches({ ENCHANT_NOWAIT: 'off' }, 'showcase').on, false)
  assert.strictEqual(N.noWaitSwitches({ ENCHANT_NOWAIT: 'on' }, 'board-a').on, true)
  assert.strictEqual(N.noWaitSwitches({ ENCHANT_NOWAIT_POOLS: 'board-a' }, 'board-a').on, true)
  assert.strictEqual(N.noWaitModeDetail({ on: true }), 'on=1 plots=townhall,cottage1 after=enchantshop order=unchanged')
  assert.ok(N.noWaitModeDetail({ on: false }).startsWith('on=0 '))
})
await t('WIRING: activeProject defaults to the switch, and features.mjs writes the licence row', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
  const shop = strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
  assert.ok(shop.includes('{ upkeepTurn = false, noWait = NOWAIT.on, service = null, sinkTurn = false } = {}'), 'activeProject reads the switch by default')
  assert.ok(shop.includes("export const NOWAIT = Object.freeze(noWaitSwitches(process.env, process.env.MEMORY_POOL ?? ''))"))
  const feat = strip(readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))
  assert.ok(/kind: 'ordernowait_mode'[^\n]*noWaitModeDetail\(NOWAIT\)/.test(feat), 'the licence row is written')
})

console.log('MUTANTS')
// projfix-01: the gate reads the `after` project's state once (its `waiting` too: a landmark behind one that found no site)
const GATE_NEW = "    const sa = st(list.find(q => q.plot === p.after) ?? { plot: p.after })\n    if (!afterMet(p, sa.complete, { noWait, chainSkip: chainSkipOk(isCivicPlot(p.plot) && isCivicPlot(p.after), sa) })) continue   // ordernowait-01; projfix-01\n"
const GATE_OLD = "    if (p.after && !st(list.find(q => q.plot === p.after) ?? { plot: p.after }).complete) continue\n"
await t('MUTANT KILLED: the old gate back in activeProject -> the hall waits behind a full workshop', async () => {
  await withMutant('shop.mjs', GATE_NEW, GATE_OLD, async M => {
    assert.notStrictEqual(M.activeProject(SCENES.benchFull, LIST, { noWait: true }).plot, 'townhall')
  })
})
await t('MUTANT KILLED: the gate dropped altogether -> the hall jumps an unfinished storehouse', async () => {
  await withMutant('shop.mjs', GATE_NEW, '', async M => {
    const st = [{ plot: 'storehouse', exists: true, complete: false, damaged: false, free: false }, { plot: 'yard', exists: true, complete: true, damaged: false }]
    assert.strictEqual(M.activeProject(st, M.PROJECTS.filter(p => ['storehouse', 'hall', 'yard'].includes(p.plot)), { noWait: true }).plot, 'hall')
  })
})
await t('MUTANT KILLED: afterMet without the plot list -> any project after the workshop stops waiting', async () => {
  await withMutant('ordernowait.mjs', ' && NOWAIT_PLOTS.includes(p.plot)) return true', ') return true', async M => {
    assert.strictEqual(M.afterMet({ plot: 'house2', after: 'enchantshop' }, false, { noWait: true }), true)
  })
})
await t('MUTANT KILLED: afterMet ignoring the switch -> the rollback does nothing', async () => {
  await withMutant('ordernowait.mjs', '  if (noWait && p.after === NOWAIT_AFTER', '  if (p.after === NOWAIT_AFTER', async M => {
    assert.strictEqual(M.afterMet({ plot: 'townhall', after: 'enchantshop' }, false, { noWait: false }), true)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

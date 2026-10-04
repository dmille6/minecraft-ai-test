// Mutants of src/craftsync.mjs, each required to REPRODUCE the defect its guard exists for. A mutant that does
// not show the defect means the corresponding test in craftsync.test.mjs proves nothing. Anchors are asserted
// present and unique (CLAUDE.md: a mutant that silently fails to apply reads as killed).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as CS from '../src/craftsync.mjs'
import { trial as trialWith, restored, stubBot, STUB_RECIPE } from './helpers/craftsync-trial.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const SRC = new URL('../src/craftsync.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SRC, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}. A mutant that was never written reads as killed.`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  // The copy lives in test/, so craftsync's own relative imports (./inflight.mjs) are pointed back at src/.
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\/([^']+)'/g, "from '../src/$1'"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

await t('MUTANT KILLED: no quiet wait after a click -> the A-only craft bursts and is lost again', async () => {
  await withMutant('      await cappedClick(st, orig.clickWindow, slot, mouseButton, mode)\n      await waitQuiet(st, win, clickPhase)\n',
    '      await cappedClick(st, orig.clickWindow, slot, mouseButton, mode)\n', async mod => {
      const r = await trialWith(mod, { opts: { rewriteStateId: false } })
      assert.ok(r.minGap < CS.CRAFT_SYNC.quietMs, 'the mutant still waits between clicks')
      assert.equal(r.server.count('wooden_pickaxe'), 0, 'the mutant kept the craft, so the lockstep test proves nothing')
    })
})

await t('MUTANT KILLED: no resync click -> the resync test sees none', async () => {
  await withMutant("    st.origWrite.call(bot._client, 'window_click', resyncPacket(win))\n", '', async mod => {
    const r = await trialWith(mod, {})
    assert.equal(r.tableResyncs.length, 0, 'the mutant still sends a resync')
  })
})

await t('MUTANT KILLED: put-away not routed -> its clicks burst past the lockstep and the row undercounts', async () => {
  await withMutant('    const mine = { clickWindow, putAway, putSelectedItemRange, ...guards }',
    '    const mine = { clickWindow, ...guards }', async mod => {
      const r = await trialWith(mod, { opts: { rewriteStateId: false } })
      assert.ok(r.minGap < CS.CRAFT_SYNC.quietMs, `min gap ${r.minGap}: the put-away still waits`)
      assert.ok(r.rows[0].args.clicks < r.real.length, 'the row still counts every wire click')
    })
})

await t('MUTANT KILLED: wrappers not restored -> they outlive the craft', async () => {
  await withMutant("      try { restore?.({ fuse }) } finally { active = null; bot.removeListener?.('end', onEnd) }",
    '      active = null', async mod => {
      const r = await trialWith(mod, {})
      assert.ok(!restored(r), 'the mutant restored anyway')
    })
})

await t('MUTANT KILLED: verification ignored -> a lost craft resolves as success', async () => {
  await withMutant('        if (!confirmed) {', '        if (false) {', async mod => {
    const r = await trialWith(mod, { lag: 999, fallbackMs: 400, opts: { rewriteStateId: false } })
    assert.equal(r.server.count('wooden_pickaxe'), 0, 'lockstep kept it; the mutant is not exercised')
    assert.equal(r.error, null, 'the mutant still refused the lost craft')
  })
})

await t('MUTANT KILLED: a click timeout that silently continues -> the craft resolves', async () => {
  await withMutant('        st.clickTimedOut = slot\n        throw new Error(`craftsync: click on slot ${slot} not answered in ${cfg.clickCapMs} ms`)\n',
    '        break\n', async mod => {
      const { bot } = stubBot({ click: () => new Promise(() => {}) })
      mod.installCraftSync(bot, { clickCapMs: 100 })
      await bot.craft(STUB_RECIPE, 1)                    // resolves: the mutant's defect
    })
})

await t('MUTANT KILLED: overlapping crafts allowed -> the second craft is not refused', async () => {
  await withMutant('    if (active || zombie) {', '    if (false) {', async mod => {
    let second = null
    await trialWith(mod, {
      during: async ({ bot }) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        try { await bot.craft(bot.recipesFor(1, null, 1, true)[0] ?? { result: { id: 1, count: 1 } }, 1, null) } catch (e) { second = e }
      },
    })
    assert.notEqual(second?.failClass, 'craft_busy', 'the mutant still refused the overlap')
  })
})

await t('MUTANT KILLED: resync without proof -> a held cursor is dropped on the ground', async () => {
  await withMutant('export function cursorProvablyEmpty (proof, win, clicksSent) {\n  return ',
    'export function cursorProvablyEmpty (proof, win, clicksSent) {\n  return true || ', async mod => {
    const r = await trialWith(mod, { cursorOnOpen: ['dirt', 3] })
    assert.ok(r.tableResyncs.length > 0)
    assert.ok(r.server.dropped.length > 0, 'the mutant did not drop the cursor; the safety test proves nothing')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

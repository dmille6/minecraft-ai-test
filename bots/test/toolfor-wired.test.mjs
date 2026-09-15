// Structural invariants (behaviour is in toolfor.test.mjs / toolwatch.test.mjs): every dig-tool picker goes through
// toolFor, the pathfinder's travel digs included, and a tool loss is logged. Comments stripped before matching;
// each anchor proven present and unique; mutants remove the executable line and must be seen to fail.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const src = f => strip(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
const once = (s, needle, where) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
t('the pathfinder\'s bestHarvestTool is overridden with toolFor, after the plugin loads', () => {
  const s = src('index.mjs')
  once(s, 'bot.pathfinder.bestHarvestTool = block => travelTool(block,', 'index.mjs')
  assert.ok(s.indexOf("bot.once('spawn', () => {") < s.indexOf('bot.pathfinder.bestHarvestTool = block => travelTool('), 'override lives inside the spawn handler (plugins inject after login)')
})
t('skills.bestTool and reflex.bestTool return toolFor(...).item and no fastest-tool loop survives', () => {
  for (const f of ['skills.mjs', 'reflex.mjs']) {
    const s = src(f)
    once(s, 'return applyToolPolicy(bot, block)', f)
    assert.equal(s.includes('bestTime'), false, `${f}: the digTime-minimising loop is gone`)
  }
})
t('a tool loss logs tool_broke / tool_gone from a diffTools result, and the listener is removed on end', () => {
  const s = src('index.mjs')
  once(s, "bot.inventory?.off?.('updateSlot', onSlot)", 'index.mjs')
  once(s, "kind: d.broke ? 'tool_broke' : 'tool_gone'", 'index.mjs')
  once(s, 'for (const d of diffTools(toolItemsBefore, now))', 'index.mjs')
})
// mutant: the pathfinder override deleted -> the first test must fail for that reason
t('mutant: deleting the override line is detected', () => {
  const s = src('index.mjs').replace('bot.pathfinder.bestHarvestTool = block => travelTool(block,', '')
  assert.throws(() => once(s, 'bot.pathfinder.bestHarvestTool = block => travelTool(block,', 'mutant'), /found 0/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

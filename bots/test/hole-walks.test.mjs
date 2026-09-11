// EVERY WALK UNDER A DIG-CAPABLE PROFILE WANTS THE HOLE.
//
// withTimeout's default installs the harvest watchdog, which cancels a dig of
// any block the held item cannot harvest. Right for gather's target block;
// wrong for a walk whose whole purpose is to dig through what blocks it.
// The dig-approach learned this on 2026-09-10 (22 of 38 walks cancelled at
// 1.00 s). goto's ascent and descent retries and surface's climb had the same
// default. hive-b-Delta, 2026-09-11: 3.5 h floating in a water pocket under a
// stone lid, a one-block exit beside it; reconstructed from an RCON scan, the
// escape profile has a 3-step path (break the lid, jump west, walk) and the
// live retry said "no route out of here even with digging allowed".
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const RAW = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
const walks = code => [...code.matchAll(/with(Ascent|Descent|Gather)Movements\(\s*(?:async\s*)?\(\)\s*=>\s*\{?([\s\S]{0,600}?)\n\s*\}?\)/g)]
  .map(m => ({ profile: m[1], body: m[2] })).filter(w => /pathfinder\.goto\(/.test(w.body))

t('every goto inside a dig-capable profile opts out of the harvest watchdog', () => {
  const ws = walks(strip(RAW))
  // Three block-bodied walks here; the dig-approach's expression-bodied walk
  // is covered by dig-approach-watchdog.test.mjs.
  assert.ok(ws.length >= 3, `expected the 3 block-bodied dig-profile walks, found ${ws.length}`)
  for (const w of ws) assert.match(w.body, /needsDrop:\s*false/, `${w.profile} walk runs with the watchdog on:\n${w.body.slice(0, 160)}`)
})

t('MUTANTS: putting the default back on ANY of the three walks is caught, one at a time', () => {
  const anchors = [
    ["await withTimeout(bot.pathfinder.goto(goal), 25000, bot, { needsDrop: false })", "await withTimeout(bot.pathfinder.goto(goal), 25000, bot)"],
    ["await withTimeout(bot.pathfinder.goto(goal), 20000, bot, { needsDrop: false })", "await withTimeout(bot.pathfinder.goto(goal), 20000, bot)"],
    ["await withTimeout(bot.pathfinder.goto(new goals.GoalY(stageY)), STAGE_MS, bot, { needsDrop: false })", "await withTimeout(bot.pathfinder.goto(new goals.GoalY(stageY)), STAGE_MS, bot)"],
  ]
  for (const [anchor, mutant] of anchors) {
    assert.equal(RAW.split(anchor).length - 1, 1, `ANCHOR MISSING or not unique: ${anchor.slice(0, 50)}`)
    const m = strip(RAW.replace(anchor, mutant))
    const bad = walks(m).filter(w => !/needsDrop:\s*false/.test(w.body))
    assert.equal(bad.length, 1, `the mutant on '${anchor.slice(0, 40)}' was not the one unguarded walk (found ${bad.length})`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

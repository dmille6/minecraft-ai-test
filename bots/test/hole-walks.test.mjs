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

// THE RETRY LEAVES A MARK. Before 2026-09-11 the dig retry logged a warn line
// and nothing else: its success rate was unreadable in telemetry, so the canary
// for the watchdog fix had no denominator (Codex review). Both outcomes must
// emit `goto_dig_retry`, and the success mark must precede the `continue`.
const retryBlock = code => {
  const i = code.indexOf("retrying this leg with digging allowed")
  const j = code.indexOf("retrying this leg with a larger drop allowed", i)   // the next retry's own warn line; comments are stripped
  assert.ok(i > 0 && j > i, 'retry block not found')
  return code.slice(i, j)
}
t('the goto dig retry logs goto_dig_retry on success (before continue) and on failure', () => {
  const b = retryBlock(strip(RAW))
  const marks = [...b.matchAll(/logEvent\(\{\s*kind:\s*'goto_dig_retry',\s*status:\s*'(success|failed)'/g)].map(m => m[1])
  assert.deepEqual(marks.sort(), ['failed', 'success'], `expected one mark per outcome, found ${marks}`)
  const succ = b.indexOf("status: 'success'"), cont = b.indexOf('continue', succ)
  assert.ok(succ > 0 && cont > succ, 'the success mark must be logged before the retry continues')
})
t('MUTANT: dropping either mark is caught', () => {
  for (const status of ['success', 'failed']) {
    const anchor = `logEvent({ kind: 'goto_dig_retry', status: '${status}',`
    assert.equal(RAW.split(anchor).length - 1, 1, `ANCHOR MISSING or not unique: ${anchor}`)
    const m = strip(RAW.replace(anchor, `void ({ kind: 'goto_dig_retry_x', status: '${status}',`))
    const marks = [...retryBlock(m).matchAll(/logEvent\(\{\s*kind:\s*'goto_dig_retry',\s*status:\s*'(success|failed)'/g)]
    assert.equal(marks.length, 1, `mutant on '${status}' still shows both marks`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

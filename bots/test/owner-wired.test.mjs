// Structural invariants for the owner route (behaviour: owner-machine.test.mjs, owner-runtime.test.mjs). Comments
// stripped; anchors unique; a mutant; and one behavioural check that OWNER=1 turns the arbiter on.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const rfx = strip(readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
const once = (s, needle, where) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
t('the owner is built once in startReflexes from this module\'s rungs, attached beside the arbiter, only when OWNER=1', () => {
  once(rfx, 'if (config.reflex.owner && runner?.arb) {', 'reflex'); once(rfx, 'runner.owner = new MovementOwner({ bot, arb: runner.arb, rungs: ownerRungs,', 'reflex')
  for (const r of ['pillar: async (b, { alive, blocksLeft }) =>', 'stair: async (b, { alive, deadlineAt }) =>', 'underfoot: async (b) =>']) once(rfx, r, 'reflex')
  assert.ok(rfx.indexOf('runner.owner = new MovementOwner') > rfx.indexOf('const drowningOwnsBody = () =>'), 'the stair rung yields to the air reflex through drowningOwnsBody, defined above it')
})
t('the route sits INSIDE the entombed arm\'s gate and try, before the legacy body takes the body, and returns into the finally that clears escaping', () => {
  const gate = "if (!escaping && !marooned && !climbing && !inDanger && isEntombed(bot) &&"
  once(rfx, gate, 'reflex')
  const arm = rfx.slice(rfx.indexOf(gate), rfx.indexOf('} finally { escaping = false }', rfx.indexOf(gate)))
  once(arm, 'if (config.reflex.owner && runner.owner) {', 'arm')
  once(arm, "const r = await runner.owner.assessAndRun({ cls: 'entombed', key, obs: { blocks, tool, climbNeed: climbNeedAbove(bmap(bot), pos) }, before: here(),", 'arm')
  const iRoute = arm.indexOf('if (config.reflex.owner && runner.owner) {'), iTake = arm.indexOf("entombedGrant = await takeBody(bot, runner, 'entombed', PRIORITY.escape)"), iTry = arm.indexOf('try {'), iEsc = arm.indexOf('escaping = true')
  assert.ok(iEsc > 0 && iTry > iEsc && iRoute > iTry && iRoute < iTake, `escaping=true@${iEsc} < try@${iTry} < route@${iRoute} < legacy takeBody@${iTake}`)
  assert.ok(arm.slice(iRoute, iTake).includes('\n            return\n'), 'the route returns before the legacy body')
  assert.ok(arm.slice(iRoute, iTake).includes("if (r.result === 'closed') { escapeFailures = 0; climbRefusals = 0; refusalPlaceStreak = 0 }"), 'a closed episode clears the legacy counters')
})
t('mutant: moving the route AFTER the legacy takeBody is detected', () => {
  const gate = "if (!escaping && !marooned && !climbing && !inDanger && isEntombed(bot) &&"
  const arm = rfx.slice(rfx.indexOf(gate), rfx.indexOf('} finally { escaping = false }', rfx.indexOf(gate)))
  const take = "entombedGrant = await takeBody(bot, runner, 'entombed', PRIORITY.escape)"
  const m = arm.replace(take, '').replace('if (config.reflex.owner && runner.owner) {', take + '\n          if (config.reflex.owner && runner.owner) {')
  assert.notEqual(m, arm, 'MUTATION DID NOT APPLY')
  assert.ok(m.indexOf('if (config.reflex.owner && runner.owner) {') > m.indexOf(take), 'the mutant takes the body first, which the real assertion forbids')
})
t('OWNER=1 turns the arbiter on (behavioural: config.mjs evaluated in a child process)', () => {
  const run = env => spawnSync(process.execPath, ['-e', "import('./src/config.mjs').then(m => console.log(JSON.stringify({ a: m.config.reflex.arbiter, o: m.config.reflex.owner })))"], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct', ...env }, encoding: 'utf8' })
  const on = JSON.parse(run({ OWNER: '1', ARBITER: '0' }).stdout.trim().split('\n').pop()); assert.deepEqual(on, { a: true, o: true })
  const off = JSON.parse(run({ OWNER: '0', ARBITER: '0' }).stdout.trim().split('\n').pop()); assert.deepEqual(off, { a: false, o: false })
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

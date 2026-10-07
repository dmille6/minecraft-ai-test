/**
 * BENCH-ONLY (bench-c2): the C2 directive queue -- overseer / stuck-escalation directives delivered over chat by a
 * whitelisted director and executed by the cognitive loop AS PROPOSALS (admission, feedback, one row each).
 *
 * 1. the queue's rules (pure); 2. THE REAL LOOP: CognitiveLoop.#tick driven with a fake runner and a spy model
 * (the harness of learned-avoid-scope.test.mjs) -- admission vets the step, a reject releases and the brain decides,
 * a success advances, a runner pause is waited out at the real cadence; 3. wiring as structural source assertions
 * (comments stripped), each with a mutant that must produce ITS OWN problem message.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-directives'
process.env.BOT_NAME = process.env.BOT_NAME || 'DirBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'test-model'

const { parseDirective, DirectiveQueue, directorAllowed, directives, MAX_REFUSALS, MAX_STEPS, PAUSE_WAIT_MS } = await import('../src/directives.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')

const J = o => JSON.stringify(o)
const SK = ['goto', 'gather', 'craft', 'deposit', 'surface', 'mine', 'explore', 'status']

// ---- 1. parsing ---------------------------------------------------------------------------------------------------
{
  const p = parseDirective('ov1', J({ o: 'overseer', s: [{ skill: 'goto', args: { x: 1, y: 70, z: 2 } }, { k: 'gather', a: { block: 'oak_log', count: 16 } }], l: 600, w: 'GET_WOOD' }), { knownSkills: SK, now: 1000 })
  assert.ok(p.ok)
  assert.deepStrictEqual(p.directive.steps.map(s => s.skill), ['goto', 'gather'])
  assert.strictEqual(p.directive.expiresAt, 1000 + 600_000)
  assert.strictEqual(parseDirective('bad id!', J({ o: 'overseer', s: [{ skill: 'goto' }] })).why, 'bad_id')
  assert.strictEqual(parseDirective('x', '{not json').why, 'bad_json')
  assert.strictEqual(parseDirective('x', '[1,2]').why, 'bad_json')
  assert.strictEqual(parseDirective('x', J({ o: 'mayor', s: [{ skill: 'goto' }] })).why, 'bad_origin')
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: [] })).why, 'bad_steps')
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: Array(MAX_STEPS + 1).fill({ skill: 'goto' }) })).why, 'bad_steps')
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: [{ skill: 'fly' }] }), { knownSkills: SK }).why, 'unknown_skill')
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: [{ skill: 'goto', args: [1] }] })).why, 'bad_args')
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: [{ skill: 'Goto;rm' }] })).why, 'bad_skill')
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: [{ skill: 'goto' }], l: 99999 }), { now: 0 }).directive.expiresAt, 900_000)
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: [{ skill: 'goto' }], l: 1 }), { now: 0 }).directive.expiresAt, 30_000)
}
const mk = (id, origin, n = 2, now = 0, lease = 600, skills = ['goto', 'gather']) =>
  parseDirective(id, J({ o: origin, s: Array.from({ length: n }, (_, i) => ({ skill: skills[i] ?? 'gather', args: {} })), l: lease }), { now }).directive
const statuses = q => q.drain().map(e => e.status)

// ---- 1. the queue ---------------------------------------------------------------------------------------------------
{
  const q = new DirectiveQueue()
  assert.strictEqual(q.next(0), null, 'empty: the brain decides')
  q.offer(mk('a', 'overseer'), 0)
  const s0 = q.next(1); assert.strictEqual(s0.skill, 'goto')
  q.report(s0.gen, 'done', 'success', 'arrived', 2)
  const s1 = q.next(3); assert.strictEqual(s1.skill, 'gather', 'a success advances')
  q.report(s1.gen, 'done', 'success', 'collected', 4)
  assert.strictEqual(q.next(5), null, 'completed -> the brain decides again')
  assert.deepStrictEqual(statuses(q), ['requested', 'step_done', 'step_done', 'completed'])
  for (const [k, st] of [['done', 'failed'], ['done', 'unknown'], ['done', 'no_effect'], ['done', 'aborted'], ['rejected', null]]) {
    q.offer(mk('r' + k + st, 'overseer'), 10); const g = q.next(11).gen
    q.report(g, k, st, 'x', 12)
    assert.strictEqual(q.next(13), null, `${k}/${st} releases control at once (no dead end)`)
  }
}
{ // a report from an OLD delivery never completes a NEW one, even with the SAME id (Codex review finding 2)
  const q = new DirectiveQueue()
  q.offer(mk('same', 'overseer'), 0); const old = q.next(1).gen
  assert.strictEqual(q.offer(mk('same', 'overseer'), 2), false, 'a same-id resend while active is a duplicate')
  q.offer(mk('other', 'overseer'), 3)                      // replaces (equal priority), new generation
  q.report(old, 'done', 'success', 'stale', 4)
  assert.strictEqual(q.next(5).id, 'other'); assert.strictEqual(q.next(5).step, 0, 'the stale success did not advance the new one')
  assert.ok(statuses(q).includes('duplicate'))
}
{ // runner PAUSE: wait for the runner's own auto-resume, re-propose ONCE, then give up (both reviews, finding 1)
  const q = new DirectiveQueue()
  q.offer(mk('p', 'escalation', 1, 0), 0); const g = q.next(0).gen
  q.report(g, 'runner_refusal', 'failed', 'paused after repeated failures; 87s until auto-resume', 1000, 'runner_paused')
  for (const t of [1000, 20_000, 60_000, 90_000]) assert.strictEqual(q.next(t), null, `not re-proposed at +${t / 1000}s (repeat window)`)
  assert.ok(q.next(1000 + 92_000), 're-proposed once the runner has auto-resumed')
  q.report(g, 'done', 'success', 'ok', 95_000)
  assert.strictEqual(statuses(q).at(-1), 'completed', 'the step that waited out a pause then completes')
  q.offer(mk('p2', 'escalation', 1, 0), 0); const g2 = q.next(0).gen
  q.report(g2, 'runner_refusal', 'failed', 'paused; 120s until auto-resume', 0, 'runner_paused')
  q.report(g2, 'runner_refusal', 'failed', 'paused; 120s until auto-resume', PAUSE_WAIT_MS + 1, 'runner_paused')
  assert.strictEqual(q.next(PAUSE_WAIT_MS + 2), null, 'a pause that outlasts the wait releases (bounded)')
}
{ // busy / body_held: a bounded number of retries
  const q = new DirectiveQueue()
  q.offer(mk('b', 'overseer', 1), 0); const g = q.next(0).gen
  for (let i = 1; i < MAX_REFUSALS; i++) { q.report(g, 'runner_refusal', 'failed', 'busy', i * 20_000, 'runner_busy'); assert.ok(q.active) }
  q.report(g, 'runner_refusal', 'failed', 'busy', 99_000, 'runner_busy')
  assert.strictEqual(q.active, null)
}
{ // lease, priority, reconnect
  const q = new DirectiveQueue()
  q.offer(mk('e', 'overseer', 2, 0, 60), 0)
  assert.ok(q.next(59_999)); assert.strictEqual(q.next(60_000), null, 'the lease ends it')
  q.offer(mk('o1', 'overseer'), 0)
  assert.ok(q.offer(mk('e1', 'escalation'), 1)); assert.strictEqual(q.next(2).id, 'e1')
  assert.strictEqual(q.offer(mk('o2', 'overseer'), 3), false, 'overseer never displaces escalation')
  q.releaseAll('disconnect', 4); assert.strictEqual(q.next(5), null, 'a new connection releases what the old one held')
}
{ // the sink gets each event at once, with its own time
  const q = new DirectiveQueue(); const seen = []
  q.setSink(e => seen.push(e))
  q.offer(mk('s', 'overseer'), 777)
  assert.strictEqual(seen[0].status, 'requested'); assert.strictEqual(seen[0].at, 777); assert.deepStrictEqual(q.drain(), [])
}
assert.strictEqual(directorAllowed('mbench-Mayor', {}), false, 'unset director = the hook is off')
assert.strictEqual(directorAllowed('mbench-Mayor', { C2_DIRECTOR: 'mbench-Mayor' }), true)
assert.strictEqual(directorAllowed('Steve', { C2_DIRECTOR: 'mbench-Mayor' }), false)

// ---- 2. THE REAL LOOP -----------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-dir-'))
let seq = 0
const freshLessons = () => { const L = new Lessons(path.join(tmp, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const loopBot = () => ({
  entity: { position: { x: 0, y: 70, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
  time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, inventory: { items: () => [] },
  registry: { blocksByName: { oak_log: { id: 17 } }, itemsByName: {}, blocks: {}, items: {}, biomesArray: [], biomes: {} },
  recipesFor: () => [], recipesAll: () => [], findBlock: () => null, findBlocks: () => [],
  blockAt: () => ({ name: 'air', boundingBox: 'empty' }), setControlState: () => {}, clearControlStates: () => {},
  players: {}, entities: {}, experience: { level: 0 },
})
/** One real decision. runs: list of skills the runner was asked to run; asked: how often the MODEL was asked. */
const oneTick = async (runnerResult) => {
  const runs = []; let asked = 0
  const runner = { isBusy: () => false, run: async (skill, args, opts) => { runs.push({ skill, args, trigger: opts?.trigger }); return runnerResult(skill) } }
  const loop = new CognitiveLoop(loopBot(), runner, freshLessons(), null)
  loop.llm = { decide: async () => { asked++; return { schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'model' } } } }
  return { loop, runs, get asked () { return asked }, async go () { loop.start(); await new Promise(r => setTimeout(r, 120)); loop.stop() } }
}
{
  // a directive step is run INSTEAD of asking the model, through the runner, tagged with its origin
  const t = await oneTick(() => ({ status: 'success', detail: 'ok', delta: {}, contractEvidence: ['x'] }))
  directives.offer(mk('L1', 'overseer', 1, Date.now(), 600, ['explore']), Date.now())
  await t.go()
  assert.strictEqual(t.runs[0]?.skill, 'explore', 'the directive step ran')
  assert.match(t.runs[0].trigger, /^directive:overseer\//, 'the row says who asked, and keeps the original trigger')
  assert.strictEqual(t.asked, 0, 'the model was not asked for that decision')
}
{
  // ADMISSION VETS IT: mine to a y ABOVE the bot is refused by the gate -> the directive is released, nothing ran
  const t = await oneTick(() => ({ status: 'success', detail: 'ok' }))
  directives.releaseAll('test', Date.now())
  directives.offer(mk('L2', 'escalation', 1, Date.now(), 600, ['mine']), Date.now())
  directives.active.steps[0].args = { y: 200 }
  await t.go()
  assert.ok(!t.runs.some(r => r.skill === 'mine'), 'an admission-refused step must not reach the runner')
  assert.strictEqual(directives.active, null, 'the refusal released control -- the brain decides next')
  assert.match(String(t.loop.lastOutcome), /^rejected: bad_args/, 'positive control: it was the GATE that refused it')
}
{
  // a runner PAUSE keeps the directive (waiting) and does not train the admission cooldown
  const t = await oneTick(() => ({ status: 'failed', failClass: 'runner_paused', detail: 'paused after repeated failures; 87s until auto-resume' }))
  directives.releaseAll('test', Date.now())
  directives.offer(mk('L3', 'overseer', 1, Date.now(), 600, ['explore']), Date.now())
  await t.go()
  assert.strictEqual(t.runs.length, 1, 'positive control: the runner was asked once and refused')
  assert.ok(directives.active, 'still active, waiting for the auto-resume')
  assert.ok(directives.active.retryAt > Date.now() + 60_000, 'retry scheduled at the runner\'s own auto-resume')
  const gate = t.loop.admission.check({ skill: 'explore', args: {}, reason: 'x' }, loopBot(), null)
  assert.notStrictEqual(gate.reason, 'cooldown', 'a step that never ran must not put its action on cooldown')
  directives.releaseAll('test', Date.now())
}

// ---- 3. wiring (structural; comments stripped) ------------------------------------------------------------------------
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const cog = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
const cmd = strip(readFileSync(new URL('../src/commands.mjs', import.meta.url), 'utf8'))
function wiringProblems (cog, cmd) {
  const p = []
  const iNext = cog.indexOf('directives.next(Date.now())'), iOrder = cog.indexOf('orderFor(readyFor(this.bot, milestone))')
  if (iNext < 0 || iOrder < 0 || iNext > iOrder) p.push('NEXT_BEFORE_ORDER')
  if (!/const res = order\s*\?/.test(cog)) p.push('ORDER_IS_PROPOSAL')
  if (!/if \(dstep && rejection\) directives\.report\(dstep\.gen, 'rejected'/.test(cog)) p.push('REJECT_REPORTED')
  if (!/directives\.report\(dstep\.gen, neverRan \? 'runner_refusal' : 'done'/.test(cog)) p.push('OUTCOME_REPORTED')
  if (/if \(dstep\)\s*\{[^}]*runner\.run\(/.test(cog)) p.push('COGNITIVE_SIDE_DOOR')
  const caseBody = (cmd.split("case 'directive'")[1] ?? '').split('case ')[0]
  if (!caseBody || /runner\.run\(/.test(caseBody)) p.push('CHAT_SIDE_DOOR')
  if (!/if \(process\.env\.C2_DIRECTOR && !directorAllowed\(username\)\) return/.test(cmd)) p.push('DIRECTOR_ONLY')
  return p
}
assert.deepStrictEqual(wiringProblems(cog, cmd), [], 'wiring')
const mut = (src, old, rep) => {
  assert.strictEqual(src.split(old).length - 1, 1, `ANCHOR MISSING or not unique: ${old.slice(0, 60)}`)
  return src.replace(old, rep)
}
const expect = (problems, code) => assert.ok(problems.includes(code), `mutant should raise ${code}, got ${problems}`)
expect(wiringProblems(mut(cog, "if (dstep && rejection) directives.report(dstep.gen, 'rejected'", "if (false) directives.report(dstep.gen, 'rejected'"), cmd), 'REJECT_REPORTED')
expect(wiringProblems(mut(cog, 'directives.next(Date.now())', 'null'), cmd), 'NEXT_BEFORE_ORDER')
expect(wiringProblems(mut(cog, 'const res = order', 'const res = null'), cmd), 'ORDER_IS_PROPOSAL')
expect(wiringProblems(mut(cog, "directives.report(dstep.gen, neverRan ? 'runner_refusal' : 'done'", "void (dstep.gen, neverRan ? 'runner_refusal' : 'done'"), cmd), 'OUTCOME_REPORTED')
expect(wiringProblems(mut(cog, 'const dstep = directives.next(Date.now())', 'const dstep = directives.next(Date.now())\n    if (dstep) { await this.runner.run(dstep.skill, dstep.args, {}); return }'), cmd), 'COGNITIVE_SIDE_DOOR')
expect(wiringProblems(cog, mut(cmd, 'directives.offer(p.directive, Date.now())', "runner.run('goto', {}, {})")), 'CHAT_SIDE_DOOR')
expect(wiringProblems(cog, mut(cmd, 'if (process.env.C2_DIRECTOR && !directorAllowed(username)) return', '')), 'DIRECTOR_ONLY')

console.log('directives.test: all assertions passed')
process.exit(0)

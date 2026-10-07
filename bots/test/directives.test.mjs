/**
 * BENCH-ONLY (bench-c2): the C2 directive queue -- overseer / stuck-escalation directives delivered over chat by a
 * whitelisted director and executed by the cognitive loop AS PROPOSALS (admission, feedback, one row each).
 *
 * Behaviour first (the queue is pure); then the wiring, as structural source assertions with comments stripped,
 * each of which has been seen to fail against a mutant (bottom of the file).
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { parseDirective, DirectiveQueue, directorAllowed, MAX_REFUSALS, MAX_STEPS } from '../src/directives.mjs'

const J = o => JSON.stringify(o)
const SK = ['goto', 'gather', 'craft', 'deposit', 'surface', 'mine']

// ---- parsing --------------------------------------------------------------------------------------------------
{
  const p = parseDirective('ov1', J({ o: 'overseer', s: [{ skill: 'goto', args: { x: 1, y: 70, z: 2 } }, { k: 'gather', a: { block: 'oak_log', count: 16 } }], l: 600, w: 'GET_WOOD' }), { knownSkills: SK, now: 1000 })
  assert.ok(p.ok, 'a well-formed two-step directive parses')
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
  // lease clamped both ways
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: [{ skill: 'goto' }], l: 99999 }), { now: 0 }).directive.expiresAt, 900_000)
  assert.strictEqual(parseDirective('x', J({ o: 'overseer', s: [{ skill: 'goto' }], l: 1 }), { now: 0 }).directive.expiresAt, 30_000)
}

const mk = (id, origin, n = 2, now = 0, lease = 600) =>
  parseDirective(id, J({ o: origin, s: Array.from({ length: n }, (_, i) => ({ skill: i ? 'gather' : 'goto', args: {} })), l: lease }), { now }).directive

// ---- the queue: happy path, release on failure, release on admission refusal ----------------------------------
{
  const q = new DirectiveQueue()
  assert.strictEqual(q.next(0), null, 'empty queue: the brain decides')
  q.offer(mk('a', 'overseer'), 0)
  assert.strictEqual(q.next(1).skill, 'goto')
  q.report('a', 'done', 'success', 'arrived')
  assert.strictEqual(q.next(2).skill, 'gather', 'a success advances to the next step')
  q.report('a', 'done', 'success', 'collected')
  assert.strictEqual(q.next(3), null, 'completed -> the brain decides again')
  assert.deepStrictEqual(q.drain().map(e => e.status), ['requested', 'step_done', 'step_done', 'completed'])

  q.offer(mk('b', 'overseer'), 10)
  q.report('b', 'done', 'failed', 'no path')
  assert.strictEqual(q.next(11), null, 'a FAILED step releases control at once (no dead end)')
  q.offer(mk('c', 'overseer'), 20)
  q.report('c', 'rejected', null, 'repeat_loop')
  assert.strictEqual(q.next(21), null, 'an ADMISSION refusal releases control at once')
  for (const st of ['unknown', 'no_effect', 'aborted']) {
    q.offer(mk('d' + st, 'overseer'), 30); q.report('d' + st, 'done', st, '')
    assert.strictEqual(q.next(31), null, `${st} releases control`)
  }
  const ev = q.drain().map(e => e.status)
  assert.ok(ev.includes('released') && ev.includes('refused'))
  q.report('zzz', 'done', 'success', '')           // a report for a directive that is not active is ignored
}

// ---- runner refusals wait for the runner's own auto-resume, then give up --------------------------------------
{
  const q = new DirectiveQueue()
  q.offer(mk('r', 'escalation'), 0)
  for (let i = 1; i < MAX_REFUSALS; i++) {
    q.report('r', 'runner_refusal', null, 'runner_paused')
    assert.ok(q.next(i), `refusal ${i} of ${MAX_REFUSALS}: still pending (the pause auto-resumes)`)
  }
  q.report('r', 'runner_refusal', null, 'runner_paused')
  assert.strictEqual(q.next(10), null, `after ${MAX_REFUSALS} refusals the directive is dropped, never held for ever`)
}

// ---- lease expiry -------------------------------------------------------------------------------------------------
{
  const q = new DirectiveQueue()
  q.offer(mk('e', 'overseer', 2, 0, 60), 0)
  assert.ok(q.next(59_999))
  assert.strictEqual(q.next(60_000), null, 'the lease ends the directive')
  assert.deepStrictEqual(q.drain().map(e => e.status), ['requested', 'expired'])
}

// ---- priority: escalation pre-empts overseer; overseer never displaces escalation -------------------------------
{
  const q = new DirectiveQueue()
  q.offer(mk('o1', 'overseer'), 0)
  assert.ok(q.offer(mk('e1', 'escalation'), 1))
  assert.strictEqual(q.next(2).id, 'e1')
  assert.strictEqual(q.offer(mk('o2', 'overseer'), 3), false, 'an overseer directive is refused while escalation runs')
  assert.strictEqual(q.next(4).id, 'e1')
  assert.ok(q.offer(mk('e2', 'escalation'), 5), 'a newer escalation replaces the older one')
  assert.strictEqual(q.next(6).id, 'e2')
  assert.deepStrictEqual(q.drain().map(e => e.status), ['requested', 'superseded', 'requested', 'refused', 'superseded', 'requested'])
}

// ---- who may direct -------------------------------------------------------------------------------------------------
assert.strictEqual(directorAllowed('mbench-Mayor', {}), false, 'unset director = the hook is off')
assert.strictEqual(directorAllowed('mbench-Mayor', { C2_DIRECTOR: 'mbench-Mayor' }), true)
assert.strictEqual(directorAllowed('Steve', { C2_DIRECTOR: 'mbench-Mayor' }), false)

// ---- wiring (structural; comments stripped so an explanation cannot satisfy an assertion) ---------------------------
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const cog = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
const cmd = strip(readFileSync(new URL('../src/commands.mjs', import.meta.url), 'utf8'))
export function wiringProblems (cog, cmd) {
  const p = []
  const iNext = cog.indexOf('directives.next(Date.now())')
  const iOrder = cog.indexOf('orderFor(readyFor(this.bot, milestone))')
  if (iNext < 0 || iOrder < 0 || iNext > iOrder) p.push('directive step is not taken before the work order')
  if (!/admission\.check\(res\.proposal/.test(cog)) p.push('proposals no longer pass admission')
  if (!/if \(dstep && rejection\) directives\.report\(dstep\.id, 'rejected'/.test(cog)) p.push('an admission refusal is not reported')
  if (!/directives\.report\(dstep\.id, RUNNER_REFUSALS\.has\(runFailClass\)/.test(cog)) p.push('the executed outcome is not reported')
  const caseBody = (cmd.split("case 'directive'")[1] ?? '').split('case ')[0]
  if (!caseBody) p.push('no directive verb')
  if (/runner\.run\(/.test(caseBody)) p.push('the directive verb runs a skill directly (side-door)')
  if (!/if \(process\.env\.C2_DIRECTOR && !directorAllowed\(username\)\) return/.test(cmd)) p.push('chat verbs are not restricted to the director')
  return p
}
assert.deepStrictEqual(wiringProblems(cog, cmd), [], 'wiring')
// MUTANTS: each must be caught (anchor present and unique, then the mutation must produce a problem).
const mut = (src, old, rep) => {
  const n = src.split(old).length - 1
  assert.strictEqual(n, 1, `ANCHOR MISSING or not unique: ${old.slice(0, 50)}`)
  return src.replace(old, rep)
}
assert.ok(wiringProblems(mut(cog, "if (dstep && rejection) directives.report(dstep.id, 'rejected'", "if (false) directives.report(dstep.id, 'rejected'"), cmd).length)
assert.ok(wiringProblems(mut(cog, 'directives.next(Date.now())', 'null'), cmd).length)
assert.ok(wiringProblems(cog, mut(cmd, 'directives.offer(p.directive, Date.now())', "runner.run('goto', {}, {})")).length)
assert.ok(wiringProblems(cog, mut(cmd, 'if (process.env.C2_DIRECTOR && !directorAllowed(username)) return', '')).length)

console.log('directives.test: all assertions passed')

// voyager-01 stage 1: ADVERSARIAL tests of the sandbox (design §3.3, §9). Each case is generated code that tries to get
// out, run forever, eat memory or multiply actions, run DIRECTLY through runSkill (no lint in front), because the isolate
// must hold on its own. The lint has its own tests (lint.test.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSkill, violationFromError, TRAPPED_GLOBALS } from '../src/sandbox.mjs'

const calls = []
const handlers = {
  observe: async () => { calls.push('observe'); return { ok: true, pos: { x: 1, y: 64, z: 2 } } },
  slowObserve: async () => { calls.push('observe'); await new Promise(r => setTimeout(r, 30)); return { ok: true } },
  wait: async ([ms]) => { await new Promise(r => setTimeout(r, Math.min(Number(ms) || 0, 50))); return { ok: true } },
  slow: async () => { await new Promise(r => setTimeout(r, 2_000)); return { ok: true } },
  boom: async () => { throw new Error('host side failed') },
  echo: async (args) => ({ ok: true, args }),
  log: async () => ({ ok: true }),
}
const run = (code, budget = {}, extra = {}) => {
  const fnName = /async function ([A-Za-z0-9]+)/.exec(code)?.[1] ?? 'skill'
  return runSkill({ code, fnName, handlers, budget: { wallMs: 5_000, cpuMs: 500, steps: 20, ...budget }, ...extra })
}

test('a plain skill runs, calls the facade and returns a copied value', async () => {
  const r = await run(`async function plain(bot) { const o = await bot.observe(); await bot.log('at', o.pos.x); return { y: o.pos.y } }`)
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.value, { y: 64 })
  assert.equal(r.steps, 2)
  assert.ok(r.log.some(l => l.startsWith('log: at 1')))
  assert.deepEqual(r.violations, [])
})

test('require / process / fetch / Buffer: blocked and reported as violations', async () => {
  for (const name of ['require', 'process', 'fetch', 'Buffer', 'setTimeout', 'module', 'global']) {
    const r = await run(`async function tryIt(bot) { return ${name === 'require' ? "require('fs')" : `${name}.toString()`} }`)
    assert.equal(r.status, 'error', name)
    assert.deepEqual(r.violations, [name], name)
  }
})

test('a caught attempt is still reported (the trap fires before the throw)', async () => {
  const r = await run(`async function sneaky(bot) { try { require('child_process') } catch (e) {} try { typeof process } catch (e) {} return 1 }`)
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.violations.sort(), ['process', 'require'])
})

test('the raw dispatcher is gone and the global has no host objects', async () => {
  const r = await run(`async function look(bot) {
    const g = (0, eval)('this');
    const names = Object.getOwnPropertyNames(g).filter(n => !${JSON.stringify(TRAPPED_GLOBALS)}.includes(n));
    return { names, call: typeof g.__vy_call, viol: typeof g.__vy_violation }
  }`)
  assert.equal(r.status, 'ok')
  assert.equal(r.value.call, 'undefined')
  assert.equal(r.value.viol, 'undefined')
  for (const host of ['require', 'process', 'ivm', '__vy_call']) assert.ok(!r.value.names.includes(host), host)
})

test('constructor walks reach only the isolate: Function("return process") is trapped', async () => {
  const r = await run(`async function walk(bot) {
    const F = bot.observe.constructor.constructor;   // the isolate's Function
    let p = 'none'; try { p = typeof F('return process')() } catch (e) { p = String(e.message) }
    let g = F('return this')();
    return { p, sameGlobal: g === (0, eval)('this'), hasBotOnly: typeof g.bot }
  }`)
  assert.equal(r.status, 'ok')
  assert.match(r.value.p, /process is not defined/)
  assert.equal(r.value.sameGlobal, true)
  assert.deepEqual(r.violations, ['process'])
})

test('a host-side throw comes back as data, not as a host Error object', async () => {
  const r = await run(`async function hostErr(bot) {
    const x = await bot.boom();
    let reach = 'no'; try { reach = typeof x.constructor.constructor('return process')() } catch (e) { reach = 'trapped' }
    return { x, reach }
  }`)
  assert.equal(r.status, 'ok')
  assert.equal(r.value.x.ok, false)
  assert.equal(r.value.reach, 'trapped')
})

test('dynamic import() is refused inside the isolate', async () => {
  const r = await run(`async function imp(bot) { const fs = await import('fs'); return typeof fs }`)
  assert.equal(r.status, 'error')
})

test('prototype pollution inside the isolate does not reach the host', async () => {
  const r = await run(`async function pollute(bot) { Object.prototype.vyPolluted = 1; Array.prototype.push = null; JSON.parse = () => ({ __vy_error: 'x' }); return 1 }`)
  assert.equal(r.status, 'ok')
  assert.equal(({}).vyPolluted, undefined)
  assert.equal(typeof [].push, 'function')
})

test('bot cannot be replaced or extended', async () => {
  const r = await run(`async function swap(bot2) { try { bot = 1 } catch (e) {} try { globalThis.bot.extra = 1 } catch (e) {} return { t: typeof bot, extra: bot.extra ?? null } }`)
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.value, { t: 'object', extra: null })
})

test('a synchronous infinite loop is killed by the CPU budget, and the host event loop keeps running', async () => {
  let ticks = 0
  const t = setInterval(() => ticks++, 20)
  let killedWith = null
  const r = await run(`async function spin(bot) { await bot.observe(); while (true) {} }`, { cpuMs: 300 }, { onKill: w => { killedWith = w } })
  clearInterval(t)
  assert.equal(r.status, 'budget')
  assert.equal(r.budget, 'cpu')
  assert.equal(killedWith, 'cpu')
  assert.ok(ticks >= 5, `host timers ran ${ticks} times during the loop`)
})

test('an infinite loop before any await is killed too', async () => {
  const r = await run(`async function spin0(bot) { for (;;) {} }`, { cpuMs: 300 })
  assert.equal(r.status, 'budget')
  assert.equal(r.budget, 'cpu')
})

test('an awaiting infinite loop is stopped by the step budget', async () => {
  const r = await run(`async function forever(bot) { for (;;) { await bot.wait(0) } }`, { steps: 15 })
  assert.equal(r.status, 'budget')
  assert.equal(r.budget, 'steps')
  assert.equal(r.steps, 16)
})

test('the wall-clock budget stops a skill stuck on a slow call', async () => {
  const r = await run(`async function stuck(bot) { await bot.slow(); return 1 }`, { wallMs: 300 })
  assert.equal(r.status, 'budget')
  assert.equal(r.budget, 'wall')
})

test('a memory bomb hits the isolate heap limit, not the host', async () => {
  const r = await run(`async function bomb(bot) { const a = []; for (;;) a.push(new Array(1e6).fill(7)) }`, { cpuMs: 20_000, memoryMb: 32 })
  assert.equal(r.status, 'budget')
  assert.ok(['memory', 'cpu'].includes(r.budget), r.budget)
})

test('Promise.all of 1,000 calls runs ONE; the rest are refused', async () => {
  calls.length = 0
  const r = await run(`async function flood(bot) {
    const rs = await Promise.allSettled(Array.from({ length: 1000 }, () => bot.slowObserve()));
    return { ok: rs.filter(x => x.status === 'fulfilled').length, refused: rs.filter(x => x.status === 'rejected').length }
  }`, { steps: 2000 })
  assert.equal(r.status, 'ok')
  assert.equal(r.value.ok, 1)
  assert.equal(r.value.refused, 999)
  assert.equal(calls.length, 1)
})

test('arguments are copied as JSON: functions and getters do not cross', async () => {
  const r = await run(`async function args(bot) {
    let hits = 0;
    const tricky = { get a () { hits++; return 5 }, f () { return 1 } };
    const out = await bot.echo(tricky, () => 1, 'x');
    return { out: out.args, hits }
  }`)
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.value.out, [{ a: 5 }, null, 'x'])
})

test('oversized arguments are refused before the handler runs', async () => {
  const r = await run(`async function big(bot) { try { await bot.echo('x'.repeat(10000)); return 'sent' } catch (e) { return e.message } }`)
  assert.equal(r.status, 'ok')
  assert.match(r.value, /too large/)
})

test('an unknown facade name is refused', async () => {
  const r = await run(`async function unknown(bot) { return typeof bot.chatCommand }`)
  assert.equal(r.value, 'undefined')
})

test('violationFromError recognises only trapped names', () => {
  assert.equal(violationFromError('require is not defined'), 'require')
  assert.equal(violationFromError('fooBar is not defined'), null)
  assert.equal(violationFromError(''), null)
})

test('a flood of trap reads is reported once and ends the run (review finding 1)', async () => {
  const events = []
  const r = await run(`async function flood2(bot) { for (let i = 0; i < 1e7; i++) { try { this['req' + 'uire'] } catch (e) {} } return 1 }`, { cpuMs: 5000 }, { onEvent: e => events.push(e) })
  assert.equal(r.status, 'budget')
  assert.equal(r.budget, 'violation')
  assert.equal(events.filter(e => e.kind === 'violation').length, 1)
})

test('a huge error or result is refused on the host side (review finding 2)', async () => {
  const r = await run(`async function huge(bot) { throw new Error('x'.repeat(30_000_000)) }`, { cpuMs: 5000, memoryMb: 128 })
  assert.ok(r.error.length < 1000, `error is ${r.error.length} chars`)
  const r2 = await run(`async function huge2(bot) { return 'y'.repeat(5_000_000) }`, { cpuMs: 5000, memoryMb: 128 })
  assert.equal(r2.status, 'error')
  assert.match(r2.error, /keep it short/)
})

test('an un-awaited call still running at return is killed (review finding 3)', async () => {
  let killedWith = null
  const r = await run(`async function early(bot) { bot.slow(); return 1 }`, {}, { onKill: w => { killedWith = w } })
  assert.equal(killedWith, 'returned_early')
  assert.equal(r.status, 'ok')
})

test('a storm of refused concurrent calls is ended (review finding 8)', async () => {
  const r = await run(`async function storm(bot) { const p = bot.slow(); for (let i = 0; i < 5000; i++) { bot.observe().catch(() => {}) } await p; return 1 }`, { refusals: 50 })
  assert.equal(r.status, 'budget')
  assert.equal(r.budget, 'refusals')
})

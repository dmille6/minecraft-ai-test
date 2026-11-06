// voyager-01: THE SANDBOX FOR GENERATED CODE (docs/reports/voyager-01-design-2026-11-06.md §3.3).
//
// A fresh isolated-vm isolate per execution. The only thing that crosses the boundary is ONE dispatcher callback that
// takes (name, jsonString) and returns a jsonString: strings are copied by value, so no host object, Reference, Vec3,
// Block, Item or function can ever reach the isolate, and nothing the isolate makes can reach the host except text.
// Node's `vm` is not a security boundary and is not used.
//
// The isolate is the boundary. The lint (lint.mjs) is a filter for better errors; the watcher, the systemd network
// namespace, the unit's user and syscall filter, and the Paper plugin are the walls outside this one.
//
// Budgets: wall clock, isolate CPU (polled), facade steps, one facade call in flight, isolate heap. A breach disposes
// the isolate (which terminates running code, including a synchronous `while(true){}`), and the caller is told which.

import ivm from 'isolated-vm'

export const BUDGET_DEFAULTS = Object.freeze({ wallMs: 240_000, cpuMs: 3_000, steps: 80, memoryMb: 64, pollMs: 100,
                                               argBytes: 4_096, resultBytes: 16_384, logLines: 200 })

// Names a skill may not touch. Inside the isolate each one is a non-configurable getter that reports the attempt to the
// host (even when the code catches the error) and then throws the same ReferenceError a bare isolate would.
export const TRAPPED_GLOBALS = Object.freeze(['require', 'process', 'module', 'exports', '__dirname', '__filename',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Buffer', 'setTimeout', 'setInterval', 'setImmediate',
  'clearTimeout', 'clearInterval', 'importScripts', 'Deno', 'Bun', 'navigator', 'location', 'document', 'window',
  'global', 'ivm', 'isolatedVm', '_ivm'])

// The prelude runs first, in its own script, inside an IIFE so its locals (the dispatcher, the saved JSON functions) are
// closure-private: a later script cannot name them. It removes the raw dispatcher globals, installs the traps, and
// defines `bot` as a frozen, non-writable, non-configurable global whose methods are plain async functions.
function preludeSource (names) {
  return `(function () {
  'use strict';
  const start = globalThis.__vy_call;
  const viol = globalThis.__vy_violation;
  delete globalThis.__vy_call;
  delete globalThis.__vy_violation;
  const stringify = JSON.stringify, parse = JSON.parse, freeze = Object.freeze, defineProperty = Object.defineProperty;
  const pending = new Map();
  // The host answers a call by invoking this (through a host-held Reference: host -> isolate only). The isolate never
  // holds a Reference to anything on the host. It is removed from the global by the host right after it takes it.
  globalThis.__vy_settle = function (id, text) { const res = pending.get(id); if (res) { pending.delete(id); res(text) } };
  const call = (name, a) => new Promise(resolve => {
    const id = start(name, a);
    if (typeof id === 'string') { resolve(id); return }   // refused at once: the reply text itself
    pending.set(id, resolve);
  });
  const trapped = ${JSON.stringify(TRAPPED_GLOBALS)};
  for (const n of trapped) {
    defineProperty(globalThis, n, { configurable: false, enumerable: false,
      get () { try { viol(n) } catch (e) {} throw new ReferenceError(n + ' is not defined') },
      set (v) { try { viol(n) } catch (e) {} throw new ReferenceError(n + ' is not defined') } });
  }
  const facade = {};
  for (const name of ${JSON.stringify(names)}) {
    facade[name] = async function (...args) {
      let a;
      try { a = stringify(args) } catch (e) { throw new TypeError(name + ': arguments must be plain JSON values') }
      const out = await call(name, a === undefined ? '[]' : a);
      const r = parse(out);
      if (r && r.__vy_error) throw new Error(r.__vy_error);
      return r;
    };
  }
  defineProperty(globalThis, 'bot', { value: freeze(facade), writable: false, enumerable: true, configurable: false });
})();`
}

// The epilogue calls the skill and reports its outcome as JSON text. Whatever the code does to JSON or String only
// changes its own report: the verifier never reads the return value (verifier.mjs reads the world).
function epilogueSource (fnName) {
  return `(async function () {
  try { const v = await ${fnName}(bot); let s; try { s = JSON.stringify({ ok: true, value: v === undefined ? null : v }) } catch (e) { s = '{"ok":true,"value":"<unserialisable>"}' } return s; }
  catch (e) { let s; try { s = JSON.stringify({ ok: false, name: String(e && e.name), message: String(e && e.message).slice(0, 600) }) } catch (e2) { s = '{"ok":false,"name":"Error","message":"<unserialisable error>"}' } return s; }
})()`
}

/** A runtime error that names a trapped global, e.g. "require is not defined". Pure. */
export function violationFromError (message) {
  const m = /^([A-Za-z_$][\w$]*) is not defined$/.exec(String(message ?? '').trim())
  return m && TRAPPED_GLOBALS.includes(m[1]) ? m[1] : null
}

/**
 * Run one generated skill.
 * @param {object} o
 * @param {string} o.code       the skill source (one async function declaration, already linted)
 * @param {string} o.fnName     its name
 * @param {string} [o.prelude]  library skills' source, prepended (function declarations)
 * @param {object} o.handlers   { name: async (argsArray) => plainObject } -- the facade, host side
 * @param {object} [o.budget]
 * @param {(e:object)=>void} [o.onEvent]  telemetry hook: {kind:'call'|'violation'|'budget', ...}
 * @param {()=>void} [o.onKill]           called once when a budget kills the run (the caller interrupts the runner)
 * @returns {Promise<{status:string, budget?:string, error?:string, value?:any, steps:number, violations:string[], log:string[], ms:number, cpuMs:number}>}
 */
export async function runSkill ({ code, fnName, prelude = '', handlers, budget = {}, onEvent = () => {}, onKill = () => {} }) {
  const B = { ...BUDGET_DEFAULTS, ...budget }
  const names = Object.keys(handlers).filter(n => /^[a-zA-Z][a-zA-Z0-9]*$/.test(n))
  const started = Date.now()
  const log = []
  const violations = []
  let steps = 0, inFlight = 0, killed = null, disposed = false
  const push = line => { if (log.length < B.logLines) log.push(String(line).slice(0, 300)) }
  const ev = e => { try { onEvent(e) } catch { /* telemetry */ } }

  const isolate = new ivm.Isolate({ memoryLimit: B.memoryMb })
  const kill = why => {
    if (killed || disposed) return
    killed = why
    ev({ kind: 'budget', budget: why, steps })
    try { onKill(why) } catch { /* the caller's hook must never keep the isolate alive */ }
    try { isolate.dispose(); disposed = true } catch { /* already gone */ }
  }

  // settle(id, text) lives in the isolate; the host holds the only Reference to it (set after the prelude runs)
  let settleRef = null, nextId = 1
  const reply = o => { const s = JSON.stringify(o); return s.length > B.resultBytes ? JSON.stringify({ ok: false, reason: 'result too large' }) : s }
  const deliver = (id, text) => {
    if (killed || disposed || !settleRef) return
    settleRef.apply(undefined, [id, text], { arguments: { copy: true } }).catch(() => { /* disposed mid-delivery: a budget kill */ })
  }
  // ONE host function, synchronous from the isolate's side: it validates, then either returns the refusal TEXT at once,
  // or starts the handler and returns a numeric ticket. The handler's answer is delivered later through settle.
  const dispatcher = new ivm.Callback((name, argText) => {
    if (killed) return reply({ __vy_error: `stopped: ${killed} budget` })
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, name) || !names.includes(name)) {
      return reply({ __vy_error: `bot.${String(name).slice(0, 32)} is not a facade call` })
    }
    if (typeof argText !== 'string' || argText.length > B.argBytes) return reply({ __vy_error: `${name}: arguments too large` })
    if (inFlight > 0) return reply({ __vy_error: `${name}: one bot call at a time -- await each call before the next (no Promise.all)` })
    if (++steps > B.steps) { setImmediate(() => kill('steps')); return reply({ __vy_error: `stopped: more than ${B.steps} bot calls` }) }
    let args
    try { args = JSON.parse(argText) } catch { return reply({ __vy_error: `${name}: arguments are not JSON` }) }
    if (!Array.isArray(args)) return reply({ __vy_error: `${name}: arguments are not a list` })
    if (name === 'log') { push(`log: ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`); return reply({ ok: true }) }
    const id = nextId++
    inFlight++
    const t0 = Date.now()
    Promise.resolve().then(() => handlers[name](args)).then(r => {
      const out = r && typeof r === 'object' ? r : { ok: true, value: r ?? null }
      push(`${name}(${argText.slice(1, -1).slice(0, 80)}) -> ${JSON.stringify(out).slice(0, 160)}`)
      ev({ kind: 'call', name, ms: Date.now() - t0, ok: out.ok !== false })
      return reply(out)
    }, e => {
      const msg = String(e?.message ?? e).slice(0, 200)
      push(`${name}(${argText.slice(1, -1).slice(0, 80)}) threw: ${msg}`)
      ev({ kind: 'call', name, ms: Date.now() - t0, ok: false })
      return reply({ ok: false, reason: msg })
    }).then(text => { inFlight--; deliver(id, text) })
    return id
  })

  const onViolation = new ivm.Callback(n => {
    const name = String(n).slice(0, 32)
    if (!violations.includes(name)) violations.push(name)
    push(`SANDBOX: the skill touched "${name}", which does not exist here`)
    ev({ kind: 'violation', name })
  }, { ignored: true })

  const wall = setTimeout(() => kill('wall'), B.wallMs)
  const poll = setInterval(() => {
    try { if (!disposed && Number(isolate.cpuTime) / 1e6 > B.cpuMs) kill('cpu') } catch { /* disposed */ }
  }, B.pollMs)

  const finish = (o) => {
    clearTimeout(wall); clearInterval(poll)
    let cpuMs = 0
    try { cpuMs = Math.round(Number(isolate.cpuTime) / 1e6) } catch { /* disposed */ }
    if (!disposed) { try { isolate.dispose(); disposed = true } catch { /* gone */ } }
    return { steps, violations, log, ms: Date.now() - started, cpuMs, ...o }
  }

  try {
    const context = await isolate.createContext()
    const jail = context.global
    await jail.set('__vy_call', dispatcher)
    await jail.set('__vy_violation', onViolation)
    await (await isolate.compileScript(preludeSource(names), { filename: 'voyager:prelude' })).run(context, { timeout: 1000 })
    settleRef = await jail.get('__vy_settle', { reference: true })
    await jail.delete('__vy_settle')
    if (prelude) {
      await (await isolate.compileScript(prelude, { filename: 'voyager:library' })).run(context, { timeout: 1000 })
    }
    await (await isolate.compileScript(code, { filename: `skill:${fnName}` })).run(context, { timeout: 1000 })
    const script = await isolate.compileScript(epilogueSource(fnName), { filename: 'voyager:run' })
    const text = await script.run(context, { promise: true, copy: true })
    if (killed) return finish({ status: 'budget', budget: killed, error: `stopped by the ${killed} budget` })
    let r
    try { r = JSON.parse(String(text)) } catch { r = { ok: false, name: 'Error', message: 'the skill returned no readable result' } }
    if (r.ok) return finish({ status: 'ok', value: r.value })
    const v = violationFromError(r.message)
    if (v && !violations.includes(v)) violations.push(v)
    return finish({ status: 'error', error: `${r.name}: ${r.message}` })
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (killed) return finish({ status: 'budget', budget: killed, error: `stopped by the ${killed} budget` })
    if (/memory limit/i.test(msg)) { killed = 'memory'; ev({ kind: 'budget', budget: 'memory', steps }); try { onKill('memory') } catch {} return finish({ status: 'budget', budget: 'memory', error: 'stopped: the skill used too much memory' }) }
    if (/Script execution timed out/i.test(msg)) return finish({ status: 'budget', budget: 'cpu', error: 'stopped: top-level code ran too long (put work inside the async function)' })
    const v = violationFromError(msg.replace(/^ReferenceError: /, ''))
    if (v && !violations.includes(v)) violations.push(v)
    return finish({ status: 'error', error: msg.slice(0, 600) })
  }
}

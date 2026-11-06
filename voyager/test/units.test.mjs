// voyager-01: behaviour tests for the pure pieces -- lint, verifier, feasibility, library, chat filter, proxy pricing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lintSkill, extractCode } from '../src/lint.mjs'
import { checkTask, alreadyMet, verify, largestCluster, infeasibleName, outcomeSignature } from '../src/verifier.mjs'
import { Library, libraryPrelude, normalise } from '../src/library.mjs'
import { filterSay, checkArgs, nearSpawn } from '../src/facade.mjs'
import { isCommandPacket } from '../src/chatguard.mjs'
import { parseJsonObject } from '../src/prompts.mjs'
import { describeDelta } from '../src/loop.mjs'
import { runSkill } from '../src/sandbox.mjs'

process.env.VOYAGER_PROXY_NO_LISTEN = '1'
const { reserveUsd, usageUsd, rebuildControl } = await import('../proxy/proxy.mjs')

test('lint accepts one async function(bot) and names its facade and library calls', () => {
  const r = lintSkill('async function getWood(bot) { const r = await bot.mine("oak_log", 3); await makeTable(bot); return r }', { known: ['makeTable'] })
  assert.equal(r.ok, true, r.errors.join())
  assert.equal(r.fnName, 'getWood')
  assert.deepEqual(r.calls, ['makeTable'])
  assert.deepEqual(r.facadeCalls, ['mine'])
})

test('lint refuses the obvious escapes, each with a reason', () => {
  const cases = {
    "async function a1b(bot) { require('fs') }": /require/,
    "async function a1b(bot) { await import('fs') }": /import/,
    'async function a1b(bot) { process.exit() }': /process/,
    'async function a1b(bot) { bot.constructor.constructor("x")() }': /constructor/,
    'async function a1b(bot) { bot["constructor"] }': /constructor/,
    'async function a1b(bot) { eval("1") }': /eval/,
    'async function a1b(bot) { new Function("x") }': /Function/,
    'async function a1b(bot) { globalThis.x = 1 }': /globalThis/,
    'async function a1b(bot) { while (true) {} }': /while/,
    'async function a1b(bot) { for (;;) { bot.observe() } }': /for/,
    'async function a1b(bot) { with (bot) {} }': /with|syntax/,
    'function a1b(bot) { }': /ONE top-level/,
    'async function a1b(bot) {} const x = 1': /ONE top-level/,
    'async function a1b(b) {}': /parameter named `bot`/,
    'async function a1b(bot) { fetch("http://x") }': /fetch/,
  }
  for (const [code, re] of Object.entries(cases)) {
    const r = lintSkill(code)
    assert.equal(r.ok, false, code)
    assert.match(r.errors.join(' | '), re, code)
  }
})

test('lint lets an awaiting loop through (the step budget bounds it)', () => {
  assert.equal(lintSkill('async function walker(bot) { while (true) { const r = await bot.explore(32); if (r.ok) break } }').ok, true)
})

test('extractCode takes the fenced block', () => {
  assert.equal(extractCode('Here:\n```javascript\nasync function x(bot) {}\n```\nbye'), 'async function x(bot) {}')
  assert.equal(extractCode('async function y(bot) {}'), 'async function y(bot) {}')
})

const reg = { items: new Set(['oak_log', 'stone_pickaxe', 'quartz', 'iron_ingot']), blocks: new Set(['oak_log', 'stone', 'cobblestone', 'iron_ore']) }

test('checkTask: typed checks, real ids, and the peaceful/no-Nether list', () => {
  assert.equal(checkTask({ task: 'get logs', success: { kind: 'have', item: 'oak_log', count: 4 } }, reg).ok, true)
  assert.match(checkTask({ task: 'get quartz', success: { kind: 'have', item: 'quartz', count: 1 } }, reg).reason, /cannot be obtained/)
  assert.match(checkTask({ task: 'get gold', success: { kind: 'have', item: 'gold_ingot', count: 1 } }, reg).reason, /not a Minecraft item/)
  assert.match(checkTask({ task: 'be happy', success: { kind: 'feel' } }, reg).reason, /one of/)
  assert.equal(checkTask({ task: 'build a hut', success: { kind: 'structure', min_blocks: 20, max_span: 8 } }, reg).ok, true)
  assert.equal(checkTask({ task: 'build a hut', success: { kind: 'structure', min_blocks: 2, max_span: 8 } }, reg).ok, false)
  assert.equal(checkTask({ task: 'go deep', success: { kind: 'reach', y: 10, dir: 'below' } }, reg).ok, true)
  assert.equal(checkTask(null, reg).ok, false)
  assert.equal(infeasibleName('blaze_rod'), true)
  assert.equal(infeasibleName('zombie_spawn_egg'), true)
  assert.equal(infeasibleName('oak_planks'), false)
})

test('alreadyMet refuses a reach target that is already true', () => {
  assert.equal(alreadyMet({ kind: 'reach', y: 70, dir: 'below' }, { pos: { y: 64 } }), true)
  assert.equal(alreadyMet({ kind: 'reach', y: 30, dir: 'below' }, { pos: { y: 64 } }), false)
  assert.equal(alreadyMet({ kind: 'reach', block: 'stone', within: 4 }, { pos: { y: 64 }, nearBlock: () => true }), true)
  assert.equal(alreadyMet({ kind: 'have', item: 'oak_log', count: 1 }, { pos: { y: 64 } }), false)
})

test('verify: have counts the net gain minus chest takes (B4 a)', () => {
  const s = { kind: 'have', item: 'oak_log', count: 4 }
  assert.equal(verify(s, { inv: { oak_log: 1 }, pos: {} }, { inv: { oak_log: 5 }, pos: {} }, {}).ok, true)
  assert.equal(verify(s, { inv: {}, pos: {} }, { inv: { oak_log: 5 }, pos: {} }, { chestTaken: { oak_log: 5 } }).ok, false)
  assert.equal(verify(s, { inv: { oak_log: 3 }, pos: {} }, { inv: { oak_log: 5 }, pos: {} }, {}).ok, false)
})

test('verify: craft needs a craft row AND a gain', () => {
  const s = { kind: 'craft', item: 'stone_pickaxe' }
  assert.equal(verify(s, { inv: {}, pos: {} }, { inv: { stone_pickaxe: 1 }, pos: {} }, { crafted: { stone_pickaxe: 1 } }).ok, true)
  assert.equal(verify(s, { inv: {}, pos: {} }, { inv: { stone_pickaxe: 1 }, pos: {} }, { crafted: {} }).ok, false)
})

const wall = (n, x0 = 0) => Array.from({ length: n }, (_, i) => ({ x: x0 + (i % 5), y: 64 + Math.floor(i / 5), z: 0, block: 'cobblestone' }))

test('verify: structure = a connected standing cluster within the span, not a rebuild (B4 c)', () => {
  const s = { kind: 'structure', min_blocks: 10, max_span: 8 }
  assert.equal(verify(s, { inv: {}, pos: {} }, { inv: {}, pos: {} }, { standing: wall(10) }).ok, true)
  assert.equal(verify(s, { inv: {}, pos: {} }, { inv: {}, pos: {} }, { standing: wall(9) }).ok, false)
  const scattered = Array.from({ length: 12 }, (_, i) => ({ x: i * 3, y: 64, z: 0, block: 'dirt' }))
  assert.match(verify(s, { inv: {}, pos: {} }, { inv: {}, pos: {} }, { standing: scattered }).why, /largest connected/)
  assert.match(verify(s, { inv: {}, pos: {} }, { inv: {}, pos: {} }, { standing: wall(10), earlierStructures: [wall(10)] }).why, /rebuild/)
  assert.equal(verify(s, { inv: {}, pos: {} }, { inv: {}, pos: {} }, { standing: wall(10, 100), earlierStructures: [wall(10)] }).ok, true)
  assert.equal(largestCluster(wall(7)).length, 7)
})

test('verify: placed counts only standing blocks of that kind', () => {
  const s = { kind: 'placed', block: 'cobblestone', count: 3 }
  assert.equal(verify(s, { inv: {}, pos: {} }, { inv: {}, pos: {} }, { standing: wall(3) }).ok, true)
  assert.equal(verify(s, { inv: {}, pos: {} }, { inv: {}, pos: {} }, { standing: wall(2) }).ok, false)
})

test('outcome signatures separate invention from variants', () => {
  assert.equal(outcomeSignature({ kind: 'have', item: 'oak_log', count: 4 }), outcomeSignature({ kind: 'have', item: 'oak_log', count: 9 }))
  assert.notEqual(outcomeSignature({ kind: 'have', item: 'oak_log' }), outcomeSignature({ kind: 'have', item: 'cobblestone' }))
})

test('library: invented / variant / composition / reuse, atomic files, retrieval', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vylib-'))
  const lib = new Library(dir)
  const t1 = { task: 'collect oak logs', success: { kind: 'have', item: 'oak_log', count: 3 } }
  assert.equal(lib.addVerified({ name: 'getLogs', code: 'async function getLogs(bot) { await bot.mine("oak_log", 3) }', task: t1, calls: [], ownCalls: 1, at: 't' }).kind, 'invented')
  assert.equal(lib.addVerified({ name: 'getLogs2', code: 'async function getLogs2(bot) {\n  await bot.mine("oak_log", 3) }', task: t1, calls: [], ownCalls: 1, at: 't' }).kind, 'reuse')
  assert.equal(lib.addVerified({ name: 'moreLogs', code: 'async function moreLogs(bot) { await bot.mine("oak_log", 8) }', task: t1, calls: [], ownCalls: 1, at: 't' }).kind, 'variant')
  assert.equal(lib.addVerified({ name: 'wrapLogs', code: 'async function wrapLogs(bot) { await getLogs(bot) }', task: { task: 'wood again', success: { kind: 'have', item: 'stick', count: 1 } }, calls: ['getLogs'], ownCalls: 0, at: 't' }).kind, 'composition')
  assert.deepEqual(new Library(dir).names().sort(), ['getLogs', 'moreLogs', 'wrapLogs'])
  assert.equal(lib.retrieve({ task: 'get some oak logs', success: { kind: 'have', item: 'oak_log' } })[0].name.includes('Logs'), true)
  lib.markFailed('getLogs'); lib.markFailed('getLogs'); lib.markFailed('getLogs')
  assert.equal(lib.active().some(s => s.name === 'getLogs'), false)
  fs.writeFileSync(path.join(dir, 'torn.json'), '{"name": "x", "code": ')
  assert.doesNotThrow(() => new Library(dir))
})

test('library prelude: a library call reports itself at run time (B4 d), unreached calls do not', async () => {
  const skills = [{ name: 'helperOne', code: 'async function helperOne(bot) { return 7 }' }, { name: 'helperTwo', code: 'async function helperTwo(bot) { return 8 }' }]
  const handlers = { observe: async () => ({ ok: true }) }
  const r = await runSkill({ code: 'async function caller(bot) { const a = await helperOne(bot); if (false) await helperTwo(bot); return a }', fnName: 'caller',
    prelude: libraryPrelude(skills), handlers, budget: { wallMs: 3000 } })
  assert.equal(r.status, 'ok')
  assert.equal(r.value, 7)
  assert.deepEqual(r.marks, ['helperOne'])
  // the skill cannot fake a mark: the callback is gone and the facade has no such call
  const f = await runSkill({ code: 'async function faker(bot) { let a = typeof __vy_mark; let b = typeof bot.useSkill; try { __impl_helperTwo } catch (e) { return [a, b, "no impl"] } return [a, b, "impl visible"] }', fnName: 'faker',
    prelude: libraryPrelude(skills), handlers, budget: { wallMs: 3000 } })
  assert.deepEqual(f.value, ['undefined', 'undefined', 'no impl'])
  assert.deepEqual(f.marks, [])
})

test('normalise ignores comments, whitespace and the name', () => {
  assert.equal(normalise('async function a(bot) { // hi\n return 1 }'), normalise('async function b(bot) {\n\n return 1 }'))
})

test('chat filter: slashes and look-alikes are commands; plain text passes, capped', () => {
  for (const s of ['/give vy-a diamond', '  /op vy-a', '／op me', '∕tp 0 0 0', '​/kill', '⁄gamemode creative']) assert.equal(filterSay(s).why, 'command', s)
  assert.equal(filterSay('hello world').line, 'hello world')
  assert.equal(filterSay('x'.repeat(300)).line.length, 100)
  assert.equal(filterSay('').line, null)
})

test('command packets are recognised', () => {
  assert.equal(isCommandPacket('chat_command', { command: 'op me' }), true)
  assert.equal(isCommandPacket('chat_command_signed', {}), true)
  assert.equal(isCommandPacket('chat_message', { message: '/op me' }), true)
  assert.equal(isCommandPacket('chat_message', { message: 'hi' }), false)
  assert.equal(isCommandPacket('position', {}), false)
})

test('facade argument checks and the spawn zone', () => {
  assert.equal(checkArgs([['name'], ['int']], ['oak_log', 3]).args[1], 3)
  assert.match(checkArgs([['name']], ['Oak Log']).error, /Minecraft id/)
  assert.match(checkArgs([['int', { max: 64 }]], [65]).error, /1-64/)
  assert.match(checkArgs([['coord']], [5000]).error, /coordinate/)
  assert.equal(checkArgs([['int', { default: 1 }]], []).args[0], 1)
  assert.equal(nearSpawn({ x: 0, y: 64, z: 0 }, 8, -8), true)
  assert.equal(nearSpawn({ x: 0, y: 64, z: 0 }, 9, 0), false)
})

test('parseJsonObject finds the object in prose and fences', () => {
  assert.deepEqual(parseJsonObject('sure: {"task":"x {y}","success":{"kind":"have"}} ok'), { task: 'x {y}', success: { kind: 'have' } })
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 })
  assert.equal(parseJsonObject('nothing'), null)
})

test('describeDelta says what changed', () => {
  const d = describeDelta({ inv: { oak_log: 1 }, pos: { x: 0, y: 64, z: 0 } }, { inv: { oak_log: 4 }, pos: { x: 10, y: 64, z: 0 } }, { placed: [], dug: [] })
  assert.match(d, /\+3 oak_log/)
  assert.match(d, /moved 10/)
})

test('proxy pricing: reserve before, settle after; control requests rebuilt from an allowlist', () => {
  const arm = { inUsdPerMTok: 0.10, outUsdPerMTok: 0.50, model: 'qwen2.5:7b-instruct' }
  assert.ok(reserveUsd(arm, 30_000, 4096) > usageUsd(arm, { input_tokens: 9000, output_tokens: 1000 }))
  assert.equal(Math.round(usageUsd(arm, { input_tokens: 1e6, output_tokens: 1e6 }) * 100) / 100, 0.6)
  const b = rebuildControl(arm, { model: 'qwen2.5:72b', keep_alive: -1, messages: [{ role: 'user', content: 'hi' }, { role: 'tool', content: 'x' }], options: { num_ctx: 131072, temperature: 0.7, seed: 1 }, format: { type: 'object' }, raw: true })
  assert.equal(b.model, 'qwen2.5:7b-instruct')
  assert.equal(b.keep_alive, '15m')
  assert.equal(b.options.num_ctx, 8192)
  assert.equal(b.options.seed, undefined)
  assert.equal(b.raw, undefined)
  assert.equal(b.messages.length, 1)
})

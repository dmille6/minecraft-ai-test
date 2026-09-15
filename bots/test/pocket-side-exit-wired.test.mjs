// Structural invariants for step 4b (behaviour: floodpocket.test.mjs sideExit). Comments stripped; anchors unique; a mutant.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const src = strip(readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
const once = (s, needle, where) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
const rung = src.slice(src.indexOf('async function floodedPocketRung'), src.indexOf('async function digBounded'))
t('the rung runs the side exit once, in shallow water (feet in water, head not water), before a placement, and a failed exit ends the rung', () => {
  once(rung, "if (!sideExited && bot.entity.isInWater && WATERLIKE.test(feetB?.name || '') && !!headB && (headB.name === 'air' || headB.name === 'cave_air'))", 'rung')
  once(rung, 'const why = await sideExitStep(feetY)', 'rung')
  once(rung, "return end(false, `side exit: ${why}${sub ? ' -- SUBMERGED (or head cell unknown): the air reflex owns the body now' : ''}`)", 'rung')
  assert.ok(rung.indexOf('const why = await sideExitStep(feetY)') < rung.indexOf('await bot.placeBlock(under, new Vec3(0, 1, 0))'), 'the exit is tried before the jump-place')
})
t('the step out swims up while pushing, releases both controls in finally, and checks abort on every poll', () => {
  once(rung, "bot.setControlState('forward', true); bot.setControlState('jump', true)", 'rung')
  once(rung, "finally { bot.setControlState('jump', false); bot.setControlState('forward', false) }", 'rung')
  const loop = rung.slice(rung.indexOf('const upBy = Date.now() + 3_000'), rung.indexOf('if (!out) return'))
  assert.ok(loop.includes('const a = abortIfNeeded(); if (a) return'), 'abort checked inside the step-out poll')
})
t('the seal happens only after settling on the ledge, and the pillar resumes only after centring back over the column', () => {
  const i0 = rung.indexOf('const c0 = await centerOn(fx, fz, 1_500)'), i1 = rung.indexOf('const c1 = await centerOn(nx, nz, 1_500)'), i2 = rung.indexOf('const e2 = await placeOnto(fx, feetY - 1, fz)'), i3 = rung.indexOf('const c2 = await centerOn(fx, fz, 2_000)')
  assert.ok(i0 > 0 && i0 < i1 && i1 < i2 && i2 < i3, 'centre in the column -> fill -> settle on the ledge -> seal -> return, in that order')
  once(rung, "if (!clearOf(nx, nz)) return", 'rung'); once(rung, "if (!clearOf(fx, fz)) return", 'rung')
  const iN = rung.indexOf('for (const y of (ex.digs ?? []))'); assert.ok(iN > rung.indexOf('for (const y of ex.fill)') && iN < rung.indexOf("bot.setControlState('forward', true); bot.setControlState('jump', true)"), 'the notch is dug after the fills and before the step out')
  once(rung, 'await digBounded(bot, cell, 30_000)', 'rung')
  once(rung, 'sideExit(B, fx, fz, feetY)', 'rung')
})
t('mutant: deleting the shallow-water trigger is detected', () => {
  const m = rung.replace("if (!sideExited && bot.entity.isInWater && WATERLIKE.test(feetB?.name || '') && !!headB && (headB.name === 'air' || headB.name === 'cave_air'))", 'if (false)')
  assert.throws(() => once(m, "if (!sideExited && bot.entity.isInWater && WATERLIKE.test(feetB?.name || '') && !!headB && (headB.name === 'air' || headB.name === 'cave_air'))", 'mutant'), /found 0/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

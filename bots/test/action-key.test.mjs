// Regression tests for the admission gate.
//
// Written because the fleet froze: the veto rate climbed 23% -> 72% across
// sixteen hours until three quarters of every decision was rejected before it
// could execute, and nothing in the codebase could have caught it. Each of
// these asserts one of the three mechanisms that caused or now prevents that.
//
//   node --test bots/test/gate.test.mjs        (from the harness directory)
//
// The imports resolve against the runtime harness, so run this where the agent
// actually runs -- these are integration tests over real modules, not units
// with the world mocked away.
//
// This file was split out of gate.test.mjs and shipped without its import, so
// every run died on `actionKey is not defined` -- it was in the suite, it was
// never once green, and nothing noticed because nothing checked exit codes.
import { actionKey } from '../src/skills.mjs'


let pass = 0, fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${got}\n        want ${want}`}`)
}

console.log('actionKey: hallucinated args must not mint new identities')
const base = actionKey('craft', { item: 'stick' })
t('player=agent collapses',   actionKey('craft', { item: 'stick', player: 'agent' }), base)
t('player=Miner01 collapses', actionKey('craft', { item: 'stick', player: 'Miner01' }), base)
t('key order irrelevant',
  actionKey('gather', { count: 1, block: 'oak_log' }),
  actionKey('gather', { block: 'oak_log', count: 1 }))
t('real args still separate different actions',
  actionKey('gather', { block: 'dirt', count: 1 }) !== actionKey('gather', { block: 'oak_log', count: 1 }), true)
t('count still matters',
  actionKey('gather', { block: 'oak_log', count: 1 }) !== actionKey('gather', { block: 'oak_log', count: 2 }), true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

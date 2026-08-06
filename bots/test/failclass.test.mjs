// Coverage test for the failure taxonomy.
//
// `other` was the LARGEST failure class at 36% of everything -- which makes the
// taxonomy decorative, since "something went wrong, 1076 times" is not a finding.
// Two causes: half the bucket was `no_effect` outcomes handed to a failure
// classifier, and the rest was string drift (goto says "no route"; the classifier
// matched only "no path").
//
// Every string below is a VERBATIM detail message taken from Elasticsearch, with
// numbers left in. Reword a skill's message without updating classifyFailure and
// this test fails instead of the class silently becoming `other`.
import { classifyFailure } from '../src/state.mjs'

let pass = 0, fail = 0
const t = (detail, want) => {
  const got = classifyFailure(detail)
  const ok = got === want
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${want.padEnd(18)} ${detail.slice(0, 52)}${ok ? '' : `\n         got ${got}`}`)
}

t('no route toward 28,0 — blocked after 3 leg(s), 41 blocks short', 'no_path')
t('stagnation', 'stagnation')
t('entombed', 'hazard_interrupt')
t('drowning', 'hazard_interrupt')
t('no pickaxe, so descending would strand this bot beside stone it cannot mine', 'missing_tool')
t('dirt found but every candidate is buried — use mine to dig down', 'buried')
t('no recipe available for stick; place the crafting_table first', 'needs_station')
t('cannot see undefined', 'bad_target')
t('stalled 12 blocks short of 40,-6: The goal was changed before it could be complete', 'preempted')
t('could not explore: explored 31 blocks to 12,44 in 2 legs', 'nothing_found')
t('cannot craft wooden_pickaxe -- needs 3x oak_planks (you have 24x stick)', 'missing_ingredients')
t('oak_log found but unreachable after 3 attempts', 'no_path')
t('pathfinding exceeded 25000ms', 'path_timeout')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

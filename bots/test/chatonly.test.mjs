// The model must only be offered skills that can succeed without a human.
//
// `come` and `follow` need a player to come to or follow. In autonomous
// operation there is nobody there, so the model picked them 29 times and failed
// 29 times -- every failure the literal string "cannot see undefined". They were
// never broken; they were inapplicable, and offering them was the defect.
//
// The admission gate also let them through: `if (p && !bot.players[p])`
// short-circuits when p is undefined, so it rejected a WRONG player and waved
// through a MISSING one.
import { SKILLS } from '../src/skills.mjs'
import { AdmissionControl } from '../src/admission.mjs'

let pass = 0, fail = 0
const t = (n, got, want) => {
  const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${got}, want ${want})`}`)
}

const autonomous = Object.keys(SKILLS).filter(n => !SKILLS[n].chatOnly)

console.log('the autonomous skill set excludes skills needing a human')
t('come is chat-only', SKILLS.come.chatOnly === true, true)
t('follow is chat-only', SKILLS.follow.chatOnly === true, true)
t('come not offered to the model', autonomous.includes('come'), false)
t('follow not offered to the model', autonomous.includes('follow'), false)
t('gather still offered', autonomous.includes('gather'), true)
t('build still offered', autonomous.includes('build'), true)
t('the set is not empty', autonomous.length > 5, true)

console.log('\nthe gate REQUIRES a player, it does not merely validate one')
const bot = {
  registry: { blocksByName: {}, itemsByName: {} },
  entity: { position: { y: 70 } },
  players: { Steve: {} },
  inventory: { items: () => [] },
}
const gate = new AdmissionControl(null)
for (const skill of ['come', 'follow']) {
  const missing = gate.check({ skill, args: {} }, bot)
  t(`${skill} with NO player is rejected`, missing.ok, false)
  t(`${skill} missing-player reason is bad_args`, missing.reason, 'bad_args')
  const wrong = gate.check({ skill, args: { player: 'Nobody' } }, bot)
  t(`${skill} with an offline player is rejected`, wrong.reason, 'no_such_player')
  const good = gate.check({ skill, args: { player: 'Steve' } }, bot)
  t(`${skill} with a real player is admitted`, good.ok, true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
// kitshrink-01 SOURCE MUTANTS: each mutant edits one anchored, UNIQUE line of bots/src, runs the named test file through the
// suite runner, and must turn it red; the file is restored byte-for-byte in a finally. A mutant whose anchor is missing or
// not unique is a FAILURE of this script, never "killed" (CLAUDE.md: mutants must assert their anchor).
//   node scripts/kitshrink-mutants.mjs            (from bots/)
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const M = [
  ['kit branch gone', 'src/bankable.mjs', "if (!isTool && kit !== 'bank' && !want.has(name))", 'if (!isTool && !want.has(name))', 'towndeposit'],
  ['escape exclusion gone', 'src/bankable.mjs', "if (kit === 'escape_ladders') { excluded[name] = 'escape_ladders'; continue }", '', 'kitshrink'],
  ['26+ ladders bank too', 'src/kitshrink.mjs', "if (name === 'ladder' && !(Number(held) < LADDER_ESCAPE_MIN)) return 'escape_ladders'", '', 'towndeposit'],
  ['depositDue counts the kit', 'src/bankable.mjs', '  bankable = Math.max(0, (Number(bankable) || 0) - Math.max(0, Number(kitBankable) || 0))', '', 'kitshrink'],
  ['the kit count never reported', 'src/bankable.mjs', "    if (kit === 'bank') kitCount += credited\n", '', 'kitshrink'],
  ['roomRemedy far branch sends kit trips', 'src/skills.mjs', 'roomDepositTarget(bot, items, [...keep, ...KIT_NO_TRIP])', 'roomDepositTarget(bot, items, keep)', 'kitshrink'],
  ['slotRemedy far advice sends kit trips', 'src/skills.mjs', "depositPlan(items, null, { wants: bot.currentWants ?? [] }), [...keep, ...KIT_NO_TRIP]) } catch { far = null }", "depositPlan(items, null, { wants: bot.currentWants ?? [] }), keep) } catch { far = null }", 'kitshrink'],
  ['no bank row', 'src/skills.mjs', "try { if (kitBankRowDue(heldBefore, banked)) logEvent(", 'try { if (false) logEvent(', 'towndeposit'],
  ['bank row counts after+banked', 'src/skills.mjs', "kitBankDetail({ via: 'town_deposit', heldBefore, banked,", "kitBankDetail({ via: 'town_deposit', heldBefore: held(items()), banked,", 'towndeposit'],
  ['escape minimum restated as 25', 'src/kitshrink.mjs', 'export const LADDER_ESCAPE_MIN = ladderEscapeMin(LADDER_CLIMB_NEED)', 'export const LADDER_ESCAPE_MIN = 25', 'kitshrink'],
  ['chests join the kit', 'src/kitshrink.mjs', "export const KIT_BANK = Object.freeze(['torch', 'ladder'])", "export const KIT_BANK = Object.freeze(['torch', 'ladder', 'chest'])", 'towndeposit'],
  ['the refusal names no move', 'src/bankable.mjs', '(${EXCLUSION_PHRASE.escape_ladders}): you are carrying ${item} — nothing to deposit, keep working`', '(${EXCLUSION_PHRASE.escape_ladders}): you are carrying ${item} — nothing to deposit`', 'kitshrink'],
  ['a named kit deposit walks', 'src/admission.mjs', "if (!reconcile && ((arg.item && KIT_BANK.includes(arg.item)) || (!arg.item && bank.kit > 0 && bank.count - bank.kit <= 0))) {", 'if (false) {', 'kitshrink'],
  ['depositDue counts the kit at a chest', 'src/bankable.mjs', '  bankable = Math.max(0, (Number(bankable) || 0) - Math.max(0, Number(kitBankable) || 0))', '  if (!storageWithin48) bankable = Math.max(0, (Number(bankable) || 0) - Math.max(0, Number(kitBankable) || 0))', 'kitshrink'],
  ['a kit-only deposit walks home', 'src/skills.mjs', 'if (kitOnly) return { status:', 'if (false) return { status:', 'towndeposit'],
  ['the kit holds the deposit rung', 'src/milestones.mjs', 'return Math.max(0, r.count - (r.kit ?? 0)) }', 'return r.count }', 'kitshrink'],
  ['the prompt urges a deposit for the kit', 'src/prompt.mjs', 'const surplus = Math.max(0, bank.count - (bank.kit ?? 0))', 'const surplus = bank.count', 'kitshrink'],
  ['the kit opens a new chest (the stop before any walk, seen from a full chest)', 'src/skills.mjs', "    if (kitOnly) return { status: 'no_effect', failClass: null, detail:", "    if (false) return { status: 'no_effect', failClass: null, detail:", 'chest-full'],
  ['the near room order names the kit', 'src/skills.mjs', 'roomDepositTarget(bot, items, kitKeep(bot, keep))', 'roomDepositTarget(bot, items, keep)', 'kitshrink'],
  ['a kit-only deposit walks to a chest in reach', 'src/skills.mjs', "    if (kitOnly) return { status: 'no_effect', failClass: null, detail:", "    if (kitOnly && !chestBlock) return { status: 'no_effect', failClass: null, detail:", 'towndeposit'],
  ['the near room advice names the kit', 'src/skills.mjs', 'depositPlan(items, null, { wants: bot.currentWants ?? [] }), kitKeep(bot, keep)) } catch { return null }', 'depositPlan(items, null, { wants: bot.currentWants ?? [] }), keep) } catch { return null }', 'kitshrink'],
  ['reflex ladderReady keeps its own number', 'src/reflex.mjs', 'const need = LADDER_CLIMB_NEED   //', 'const need = 24 + 1   //', 'kitshrink'],
  ['ladder climb need drifts', 'src/ladder.mjs', 'export const LADDER_CLIMB_NEED = 25', 'export const LADDER_CLIMB_NEED = 20', 'kitshrink'],
]

let bad = 0
for (const [name, file, old, neu, test] of M) {
  const src = readFileSync(file, 'utf8')
  const n = src.split(old).length - 1
  if (n !== 1) { console.log(`ANCHOR ${n === 0 ? 'MISSING' : 'NOT UNIQUE (' + n + ')'}: ${name}`); bad++; continue }
  writeFileSync(file, src.replace(old, neu))
  let r
  try { r = spawnSync('node', ['scripts/run-tests.mjs', test], { encoding: 'utf8', timeout: 600_000 }) } finally { writeFileSync(file, src) }
  const killed = r.status !== 0 && /FAIL/.test(r.stdout + r.stderr)
  console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${name} (${file}; ${test})`)
  if (!killed) bad++
}
console.log(bad ? `${bad} mutant(s) not killed or not applied` : `all ${M.length} mutants killed`)
process.exit(bad ? 1 : 0)

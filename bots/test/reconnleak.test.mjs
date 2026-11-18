// reconnleak-01show: EVERY TIMER AND PROCESS LISTENER connect() STARTS ENDS WITH ITS CONNECTION. connect() runs again on every
// reconnect; an interval it never clears keeps its closure's context -- the dead bot, its Client and its World (chunk ArrayBuffers)
// -- for the life of the process. Showcase 11-18: a reconnect storm stacked old worlds to 1,448 MB rss (memTimer, the wedge sampler).
// Structural (behaviour needs a server: the kick rig is the behaviour proof): comments stripped, executable code only; mutants bite.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const SRC = new URL('../src/index.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')
const bodyOf = src => { const s = strip(src); const a = s.indexOf('function connect()'); assert.ok(a >= 0, 'connect() is in index.mjs'); return s.slice(a, s.indexOf('\n}\n', a)) }
// the one timer meant to outlive its connection: the reconnect itself
const OWN = new Set(['connect'])
/** connect()'s body -> every timer or process listener it starts that nothing clears ([] when none). */
export function leaks (src) {
  const body = bodyOf(src), out = []
  const re = /(?:(?:const|let)\s+(\w+)\s*=\s*|(\w+)\s*=\s*)?(setInterval|setTimeout)\(\s*(\w+)?/g
  let m
  while ((m = re.exec(body))) {
    const name = m[1] ?? m[2] ?? null, kind = m[3], first = m[4]
    if (!name) { if (kind === 'setTimeout' && OWN.has(first)) continue; out.push(`${kind} anonymous`); continue }
    const clear = kind === 'setInterval' ? 'clearInterval' : 'clearTimeout'
    if (!new RegExp(`${clear}\\(${name}\\)`).test(body)) out.push(`${kind} ${name}`)
  }
  const pre = /process\.(?:on|once)\(\s*'(\w+)'\s*,\s*(\w+)/g
  while ((m = pre.exec(body))) if (!new RegExp(`process\\.removeListener\\(\\s*'${m[1]}'\\s*,\\s*${m[2]}\\)`).test(body)) out.push(`process ${m[1]} ${m[2]}`)
  return out
}
test('every timer and process listener in connect() is cleared', () => { assert.deepEqual(leaks(readFileSync(SRC, 'utf8')), []) })
test('the three found are cleared on the bot\'s end', () => {
  const s = strip(readFileSync(SRC, 'utf8'))
  for (const a of ["bot.once('end', () => clearInterval(memTimer))", "bot.once('end', () => clearInterval(wedgeTimer))", "process.removeListener('exit', stopTrace)"]) assert.equal(s.split(a).length, 2, a)
})
const mutate = (old, neu) => { const src = readFileSync(SRC, 'utf8'); assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${old}`); return src.replace(old, neu) }
test('the viewer is closed on end and never started after it', () => {
  const s = strip(readFileSync(SRC, 'utf8'))
  assert.match(s, /bot\.once\('end', \(\) => \{ viewerEnded = true; try \{ probe\.close\(\) \} catch \{\s*\} for \(let i = 0; i < 10 && bot\.viewer\?\.close; i\+\+\) \{ try \{ bot\.viewer\.close\(\) \} catch \{\s*\} \} \}\)/)
  assert.equal(s.split('if (viewerEnded) return').length, 2)
})
test('mutant: memTimer never cleared is caught', () => {
  assert.deepEqual(leaks(mutate("  bot.once('end', () => clearInterval(memTimer))\n", '')), ['setInterval memTimer'])
})
test('mutant: the wedge sampler anonymous again (as it was) is caught', () => {
  assert.deepEqual(leaks(mutate('    const wedgeTimer = setInterval(() => {\n', '    setInterval(() => {\n')), ['setInterval anonymous'])
})
test('mutant: the air trace\'s exit listener kept is caught', () => {
  assert.deepEqual(leaks(mutate("process.removeListener('exit', stopTrace); ", '')), ['process exit stopTrace'])
})
test('a new uncleared timeout is caught too', () => {
  assert.deepEqual(leaks(mutate("  bot.once('end', () => clearInterval(memTimer))\n", "  bot.once('end', () => clearInterval(memTimer))\n  const later = setTimeout(() => {}, 1)\n")), ['setTimeout later'])
})

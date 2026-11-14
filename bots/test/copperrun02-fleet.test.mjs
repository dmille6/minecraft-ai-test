// COPPERRUN-02, THE FLEET PART (fleet variant canary-handcap-copper-on-601fe6a3): only the PROTECTED hunks of copperrun-02 ride the
// fleet (oretunnel.mjs COPPER_TUNNEL_KINDS / tunnelKindsFor `copper`, skills.mjs gatherRun's two calls), byte-identical to the
// showcase's, so a fleet KEEP covers the showcase's protected code. The fleet has no copper hall (no copperhall.mjs, no trip code),
// so nothing sets bot.copperTunnelUntil: the copper branch is INERT here. Behaviour: copper tunnels only with the flag (positive
// control: iron, diamond and coal as before); the wiring structural; an anchored mutant.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const OT = await import('../src/oretunnel.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

await t('copper ore tunnels only on the trip flag; POSITIVE CONTROL: iron and diamond (on its flag) unchanged', () => {
  assert.strictEqual(OT.tunnelKindsFor('copper_ore'), null, 'no flag: no tunnel (as the fleet base)')
  assert.strictEqual(OT.tunnelKindsFor('deepslate_copper_ore', { copper: false }), null)
  assert.deepStrictEqual(OT.tunnelKindsFor('copper_ore', { copper: true }), { kinds: OT.COPPER_TUNNEL_KINDS, label: 'copper' })
  assert.strictEqual(OT.tunnelKindsFor('iron_ore', { copper: true }).label, 'iron')
  assert.strictEqual(OT.tunnelKindsFor('iron_ore').label, 'iron')
  assert.strictEqual(OT.tunnelKindsFor('diamond_ore', { diamond: true }).label, 'diamond')
  assert.deepStrictEqual(OT.COPPER_TUNNEL_KINDS, ['copper_ore', 'deepslate_copper_ore'])
})
await t('INERT on the fleet: the copper hall is off in a fleet pool and nothing sets copperTunnelUntil (gatherRun only reads it)', async () => {
  // one trunk (11-14): the module is on main now; on a fleet pool the hall's switch is off (POSITIVE CONTROL: on in the showcase pool)
  const { copperhallOn } = await import('../src/copperhall.mjs')
  assert.strictEqual(copperhallOn({}, 'hive-a'), false, 'the copper hall is off in a fleet pool')
  assert.strictEqual(copperhallOn({}, 'showcase'), true, 'control: on in the showcase pool')
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(!/copperTunnelUntil\s*=[^=]/.test(src), 'something sets copperTunnelUntil')
  assert.strictEqual((src.match(/\(Number\(bot\.copperTunnelUntil\) \|\| 0\) > Date\.now\(\)/g) ?? []).length, 2, 'the two gatherRun reads')
})
await t('the wiring (structural): gatherRun asks tunnelKindsFor with the trip flag in both places', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/const ironStrict = tunnelKindsFor\(blockName, \{ copper: \(Number\(bot\.copperTunnelUntil\) \|\| 0\) > Date\.now\(\) \}\) != null/.test(src))
  assert.ok(/const tk = tunnelKindsFor\(viaSource \?\? blockName, \{ diamond: bot\.deepTunnelKinds === true \}\) \?\? \(\(Number\(bot\.copperTunnelUntil\) \|\| 0\) > Date\.now\(\) \? tunnelKindsFor\(viaSource \?\? blockName, \{ copper: true \}\) : null\)/.test(src))
})
await t('MUTANT: copper without its flag (the copper test dropped) -- copper ore would tunnel on every gather (anchor present and unique)', async () => {
  const p = new URL('../src/oretunnel.mjs', import.meta.url)
  const src = readFileSync(p, 'utf8')
  const old = "if (copper && COPPER_TUNNEL_KINDS.includes(name))"
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const { writeFileSync, unlinkSync } = await import('node:fs')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, 'if (COPPER_TUNNEL_KINDS.includes(name))').replace(/from '\.\//g, "from '../src/"))
  try { const M = await import(out.href); assert.ok(M.tunnelKindsFor('copper_ore') != null, 'the mutant did not change the answer') } finally { try { unlinkSync(out) } catch {} }
})
console.log(`\ncopperrun02-fleet: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

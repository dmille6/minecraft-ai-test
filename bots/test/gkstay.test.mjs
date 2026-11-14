// GKSTAY-01 (coordinator 11-06 ~00:00Z): THE KEEPER LEASE CHURNED after gklease-01. Showcase 9dfa85b9 22:56-23:57Z: 6 takes, 5
// `keeper_release why=underground` in 1.25 h, 1 grounds visit (the dips were `gather dirt` to y 50-54: Bravo, Haven, Iris, Juno).
// Fleet e447b65b, 1.18 h, 80 bots: 102 takes, 91 underground releases; the first skill below `mine y=16` (idle_work's iron hint) 9 of 22.
// Behaviour (groundskeeper.mjs unfitPersist; on the fleet idlework.mjs holderMeans + idlePick), then the wiring. Mutants anchored.
import assert from 'node:assert'
import fs from 'node:fs'
const GK = await import('../src/groundskeeper.mjs')
const FLEET = fs.existsSync(new URL('../src/idlework.mjs', import.meta.url))
const IW = FLEET ? await import('../src/idlework.mjs') : null

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
const T0 = Date.parse('2026-11-06T23:08:07Z'), S = 1000, MIN = 60_000

console.log('THE PERSISTENCE (groundskeeper.mjs unfitPersist)')
await t('LIVE Juno: a dirt dip to y 54 for a minute is no release; five minutes below without a break is; back up resets the run', () => {
  let since = null
  const step = (unfit, t) => { const r = GK.unfitPersist(since, unfit, t); since = r.since; return r.held }
  assert.strictEqual(step('underground', T0), false)
  assert.strictEqual(step('underground', T0 + 60 * S), false)
  assert.strictEqual(step(null, T0 + 70 * S), false, 'back at the surface')
  assert.strictEqual(since, null)
  assert.strictEqual(step('underground', T0 + 80 * S), false, 'a new run starts')
  assert.strictEqual(step('underground', T0 + 80 * S + 4 * MIN), false)
  assert.strictEqual(step('underground', T0 + 80 * S + 5 * MIN), true, 'five minutes below: the release')
  assert.deepStrictEqual(GK.unfitPersist(T0 + 10 * MIN, 'away', T0), { since: T0, held: false }, 'a start in the future (a bad clock) restarts the run')
})
await t('MUTANT KILLED: the persistence cut (held at once: the live churn)', async () => {
  const sc = M => assert.strictEqual(M.unfitPersist(null, 'underground', T0).held, false)
  await killedBy(GK_PATH, GK, '  return { since: s, held: now - s >= ms }\n', '  return { since: s, held: true }\n', sc)
})

if (FLEET) {
  console.log('THE HOLDER\'S LAP (idlework.mjs holderMeans + idlePick)')
  const IW_PATH = new URL('../src/idlework.mjs', import.meta.url)
  const all = { iron: true, logs: true, coal: true, grounds: true }
  await t('a holder\'s lap never opens iron or coal: grounds first, else logs, else scout; a non-holder\'s lap as before; GKSTAY=0 as before', () => {
    const kinds = new Set()
    for (let c = 0; c < 16; c++) kinds.add(IW.idlePick(c, { means: IW.holderMeans(all, true, true), rotation: IW.IDLE_ROTATION_GK }))
    assert.ok(!kinds.has('iron') && !kinds.has('coal'), [...kinds].join(','))
    assert.ok(kinds.has('grounds') && kinds.has('logs'), [...kinds].join(','))
    assert.strictEqual(IW.idlePick(1, { means: IW.holderMeans({ iron: true, coal: true, logs: false, grounds: false }, true, true), rotation: IW.IDLE_ROTATION_GK }), 'scout', 'nothing on the surface: the scout lap, never a mine batch')
    assert.strictEqual(IW.idlePick(1, { means: IW.holderMeans(all, false, true), rotation: IW.IDLE_ROTATION_GK }), 'iron', 'a non-holder: as before')
    assert.strictEqual(IW.idlePick(1, { means: IW.holderMeans(all, true, false), rotation: IW.IDLE_ROTATION_GK }), 'iron', 'the switch off: as before')
    assert.ok(IW.belowKind('iron') && IW.belowKind('coal') && !IW.belowKind('logs') && !IW.belowKind('grounds') && !IW.belowKind(null))
  })
  await t('MUTANT KILLED: the holder gate cut (a holder\'s iron lap: the live `mine y=16`)', async () => {
    const sc = M => assert.strictEqual(M.holderMeans({ iron: true }, true, true).iron, false)
    await killedBy(IW_PATH, IW, '  for (const k of BELOW_KINDS) out[k] = false\n', '', sc)
  })
}

console.log('WIRING (source, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = (src, ms) => {
  const one = (re, s = src) => { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one('const up = unfitPersist\\(bot\\.gkUnfitSince \\?\\? null, unfit(Now)?, now\\)')
  one('bot\\.gkUnfitSince = up\\.since')
  if (FLEET) {
    one("if \\(GKSTAY_ON && d === 'mine' && below\\) \\{ releaseKeeper\\(bot, k\\.lease, 'handoff', now\\); bot\\.gkRestUntil = now \\+ GK_FIT\\.restMs; d = 'none' \\}")
    one("const unfit = d === 'mine' \\? \\(up\\.held \\? unfitNow : null\\) : \\(unfitNow \\?\\? \\(below \\? 'below_batch' : null\\)\\)")
    one('setHoldsGrounds\\(b => keeperNow\\(b\\)\\)')
    one("if \\(!renewal && GKSTAY_ON && belowKind\\(idleKindNow\\(\\)\\)\\) return \\{ ok: false, why: 'below_batch' \\}")
    one('return (logCapMeans\\()?holderMeans\\(idleBagMeans\\(', ms)   // logcap-02 wraps the line (logCapMeans)
    one('setIdleKindNow\\(\\(\\) => IDLE\\.state\\?\\.kind \\?\\? null\\)', ms)
  } else {
    one("const c = groundsLeaseCheck\\(\\{ d, unfit: d === 'mine' \\? unfitHeld : unfit, idle:")
  }
}
await t('keeperOrder persists the unfit run, takes only fit (fleet: no take over a below batch, a handoff over one); the lap reads the lease; a cut line fails', () => {
  const src = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const ms = FLEET ? strip(fs.readFileSync(new URL('../src/milestones.mjs', import.meta.url), 'utf8')) : ''
  wiring(src, ms)
  const cut = 'bot.gkUnfitSince = up.since'
  assert.ok(src.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(src.replace(cut, ''), ms), assert.AssertionError)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

// GKWORK-01 (control session 11-07): THE GROUNDSKEEPER ALWAYS HAS WORK, OR LETS THE LEASE GO (gkwork.mjs).
// Showcase 24 h: 29 keeper terms, 25.9 keeper-h, grounds visits 1.4% of it; the interior stage read "cuts left 0/77, fills left 0/1331"
// on ~30 keeper visits by 13 bots and never completed (per-bot clears / park waits under a lease that rotates every ~20 min).
// Fleet 63d28320: 11 of 42 terms ended `stuck` on a STALLED stage whose waiver room was spent (board-b 12 of 69 waived, 3 cells stuck,
// 15 waiting). Behaviour first (the pure rules and the refusal chain they compose), then the wiring. Mutants anchored and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const W = await import('../src/gkwork.mjs')
const SHOP = await import('../src/shop.mjs')
const SHOWCASE = /closing = false/.test(fs.readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))

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
const W_PATH = new URL('../src/gkwork.mjs', import.meta.url)
const T0 = Date.parse('2026-11-07T02:18:18Z'), MIN = 60_000
// the live showcase stage: tidy g88, stage 1 inwall, 1331 cells, 77 cuts
const STAGE = { sitedAt: 1793892876060, stage: 1, stageId: 'inwall', cells: Array.from({ length: 1331 }, (_, i) => ({ at: [i, 66, 0], role: 'earth' })), cut: Array.from({ length: 77 }, (_, i) => ({ at: [i, 67, 1] })) }
const EMPTY = { cutLeft: 0, fillLeft: 0, placed: 0, cleared: 0, planted: 0, unread: false }

console.log('THE EVIDENCE (gkwork.mjs visitEmpty)')
await t('LIVE Kite 04:16Z "complete; cuts left 0/77, fills left 0/1331" placed 0 is empty; an unread cell, a cut or fill left, or a placement is not', () => {
  assert.strictEqual(W.visitEmpty(EMPTY), true)
  assert.strictEqual(W.visitEmpty({ ...EMPTY, unread: true }), false, 'unknown terrain never counts as clean')
  assert.strictEqual(W.visitEmpty({ ...EMPTY, fillLeft: 2 }), false)
  assert.strictEqual(W.visitEmpty({ ...EMPTY, cutLeft: 1 }), false)
  assert.strictEqual(W.visitEmpty({ ...EMPTY, placed: 1 }), false)
  assert.strictEqual(W.visitWorked({ cleared: 3 }), true)
  assert.strictEqual(W.visitWorked({}), false)
})

console.log('THE TOWN COUNTS (strikeNext / strikesTotal / gkwVisit)')
const rotate = (M, bots, { G = M.GKW } = {}) => {
  const files = new Map(); const sig = M.gkwSig(STAGE); const out = []
  bots.forEach((b, i) => {
    const now = T0 + i * 20 * MIN
    const ev = typeof b === 'string' ? { who: b, empty: true, worked: false } : b
    files.set(ev.who, M.strikeNext(files.get(ev.who) ?? null, { sig, empty: ev.empty, worked: ev.worked, now, G }))
    out.push(M.strikesTotal([...files.values()], { sig, now, G }))
  })
  return out
}
await t('LIVE rotation: Juno, Maple, Comet each ONE empty visit a 20-min term -- the per-bot count never passes 1, the town reaches 3 and closes', async () => {
  // the mutant is the per-bot counter the live stage waited on: the most strikes any ONE holder has
  await killedBy(W_PATH, W, '  for (const f of mine) for (const t of f.strikes ?? []) if (Number.isFinite(t) && t > lastWork && t <= now && now - t < G.windowMs) n++', '  for (const f of mine) n = Math.max(n, (f.strikes ?? []).filter(t => t > lastWork).length)', M => {
    const tot = rotate(M, ['showcase-Juno', 'showcase-Maple', 'showcase-Comet'])
    assert.deepStrictEqual(tot, [1, 2, 3])
    assert.strictEqual(M.strikesClose(tot.at(-1)), true)
    assert.strictEqual(M.strikesClose(2), false)
  })
})
await t('a visit that changed the ground (any bot) clears the strikes before it; a new stage starts again; a stamp older than the window is forgotten', async () => {
  await killedBy(W_PATH, W, 'const lastWork = Math.max(-Infinity, ...mine.map(f => (Number.isFinite(f.workAt) ? f.workAt : -Infinity)))', 'const lastWork = -Infinity', M => {
    const tot = rotate(M, ['A', 'B', { who: 'C', empty: false, worked: true }, 'D', 'E'])
    assert.deepStrictEqual(tot, [1, 2, 0, 1, 2], 'C worked: A and B no longer count')
  })
  const sig = W.gkwSig(STAGE), sig2 = W.gkwSig({ ...STAGE, stageId: 'outbands', stage: 2 })
  assert.notStrictEqual(sig, sig2)
  assert.strictEqual(W.gkwSig({ ...STAGE, gen: 99, waived: { a: 1 } }), sig, 'a waiver (a new generation) is the same stage')
  const f = W.strikeNext(W.strikeNext(null, { sig, empty: true, now: T0 }), { sig: sig2, empty: true, now: T0 + MIN })
  assert.deepStrictEqual(f.strikes, [T0 + MIN])
  assert.strictEqual(W.strikesTotal([{ sig, strikes: [T0], workAt: null }], { sig, now: T0 + 7 * 60 * MIN }), 0)
})
await t('gkwVisit writes one file per holder in the town dir and reads the town: the third bot closes; an unwritable dir closes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkwork-'))
  try {
    const key = 'project-0_70_0.tidy'
    const a = W.gkwVisit(dir, key, 'showcase-Juno', STAGE, { empty: true, now: T0 })
    const b = W.gkwVisit(dir, key, 'showcase-Maple', STAGE, { empty: true, now: T0 + 20 * MIN })
    const c = W.gkwVisit(dir, key, 'showcase-Comet', STAGE, { empty: true, now: T0 + 40 * MIN })
    assert.deepStrictEqual([a.total, b.total, c.total, a.close, c.close], [1, 2, 3, false, true])
    assert.strictEqual(fs.readdirSync(dir).filter(n => n.startsWith(`${key}.gkwork.`)).length, 3)
    const nf = W.gkwVisit(path.join(dir, 'x\0bad'), key, 'showcase-Kite', STAGE, { empty: true, now: T0 })
    assert.strictEqual(nf.close, false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

console.log('THE REFUSAL CHAIN (softHoldsGive -> completion | keeperAfterVisit release; tidyQuiet closing)')
await t('the soft holds give way only to a town close; the hard holds are never theirs', async () => {
  await killedBy(W_PATH, W, '(close ? { clearsOk: true, crewHolds: false } :', '(false ? { clearsOk: true, crewHolds: false } :', M => {
    assert.deepStrictEqual(M.softHoldsGive({ clearsOk: false, crewHolds: true, close: true }), { clearsOk: true, crewHolds: false })
    assert.deepStrictEqual(M.softHoldsGive({ clearsOk: false, crewHolds: true, close: false }), { clearsOk: false, crewHolds: true })
  })
})
// One keeper term after another, the way buildTidy composes them: completion needs no cut/fill left, every cell read, the clears and
// park holds satisfied (or given way) and no hard hold. Returns what the keeper does after each visit.
const term = (M, { hard = false, visits = 5 } = {}) => {
  const files = new Map(); const sig = M.gkwSig(STAGE); const log = []
  for (let i = 0; i < visits; i++) {
    const who = `bot${i}`, now = T0 + i * 3 * MIN
    files.set(who, M.strikeNext(null, { sig, empty: true, now }))
    const close = M.strikesClose(M.strikesTotal([...files.values()], { sig, now }))
    const h = M.softHoldsGive({ clearsOk: false, crewHolds: false, close })   // the live per-bot clears wait never passes
    const completed = h.clearsOk && !h.crewHolds && !hard
    const after = M.keeperAfterVisit({ keeper: true, empty: true, completed, close })
    const pending = after === 'keep' && !completed ? { at: now } : null
    const quiet = SHOWCASE ? SHOP.tidyQuiet({ idle: true, keeper: true, prepWork: false, closing: M.gkwClosing(pending, now + MIN) }) : false
    log.push(completed ? 'complete' : after === 'release' ? 'release' : quiet ? 'QUIET_HOLD' : 'again')
    if (completed || after === 'release') break
  }
  return log
}
await t('LIVE showcase stage: three empty keeper visits complete it (the land plan moves on); never a quiet hold with the lease', async () => {
  await killedBy(W_PATH, W, 'export const strikesClose = (total, G = GKW) => Number(total) >= G.emptyVisits', 'export const strikesClose = (total, G = GKW) => false', M => {
    assert.deepStrictEqual(term(M), ['again', 'again', 'complete'])
  })
})
await t('a HARD hold (unread, prep, a stand up): the third visit releases the lease `no_work_now` instead of 20 min idle', async () => {
  await killedBy(W_PATH, W, "  return close ? 'release' : 'keep'", "  return 'keep'", M => {
    const log = term(M, { hard: true })
    assert.deepStrictEqual(log, ['again', 'again', 'release'])
    assert.ok(!log.includes('QUIET_HOLD'))
  })
  assert.strictEqual(W.keeperAfterVisit({ keeper: false, empty: true, close: true }), 'keep', 'a helper holds no keeper lease')
  assert.strictEqual(W.keeperAfterVisit({ keeper: true, empty: false, close: true }), 'keep', 'a visit that found work keeps it')
})
await t('batch20 fold (Codex BLOCKER): a keeper whose forest is due keeps the lease after an empty closing tidy visit', async () => {
  assert.strictEqual(W.keeperAfterVisit({ keeper: true, empty: true, close: true }), 'release', 'POSITIVE: no forest work -> no_work_now')
  assert.strictEqual(W.keeperAfterVisit({ keeper: true, empty: true, close: true, forestDue: true }), 'keep', 'the forest due keeps it')
  await killedBy(W_PATH, W, "  if (!keeper || completed || !empty || forestDue) return 'keep'", "  if (!keeper || completed || !empty) return 'keep'", M => {
    assert.strictEqual(M.keeperAfterVisit({ keeper: true, empty: true, close: true, forestDue: true }), 'keep')
  })
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(/keeperAfterVisit\(\{ keeper: role === 'keeper', empty: gkw\.empty, completed, close: gkw\.close, forestDue: [^}]*forestDemandNow\(bot\)/.test(src), 'wired: the forest demand rides in')
})
await t('showcase: the keeper collecting strikes is not quieted (tidyQuiet closing); a helper or a bot past the window is', () => {
  if (!SHOWCASE) return
  assert.strictEqual(SHOP.tidyQuiet({ idle: true, keeper: true, closing: true }), false)
  assert.strictEqual(SHOP.tidyQuiet({ idle: true, keeper: false, closing: true }), true)
  assert.strictEqual(SHOP.tidyQuiet({ idle: true, keeper: true, closing: W.gkwClosing({ at: T0 }, T0 + 7 * 60 * MIN) }), true)
  assert.strictEqual(SHOP.tidyQuiet({ idle: true, keeper: true, prepWork: true }), false, 'siteprep-02 unchanged')
})

console.log('THE STALLED STAGE (stallWaive)')
const BOARD_B = { cells: Array.from({ length: 69 }, (_, i) => ({ at: [-206 + i, 62, 117], role: i === 68 ? 'light' : 'earth' })), waived: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${-206 + 40 + i},62,117`, { why: 'no_stand' }])) }
const DEF = [{ k: '-206,62,117', why: 'no_stand', visits: 3 }, { k: '-205,62,117', why: 'no_stand', visits: 4 }, { k: '-204,62,117', why: 'no_stand', visits: 3 }]
await t('LIVE board-b: STALLED, 12 of 69 waived (the tenth spent), 3 cells at 3+ town visits -> the 3 are waived; not stalled, or the ordinary waiver gave, nothing', async () => {
  await killedBy(W_PATH, W, '  if (!stalled || Number(waivedNow) > 0) return []', '  if (Number(waivedNow) > 0) return []', M => {
    assert.deepStrictEqual(M.stallWaive(BOARD_B, DEF, { stalled: true }).map(d => d.k), DEF.map(d => d.k))
    assert.deepStrictEqual(M.stallWaive(BOARD_B, DEF, { stalled: false }), [])
  })
  assert.deepStrictEqual(W.stallWaive(BOARD_B, DEF, { stalled: true, waivedNow: 1 }), [])
  assert.ok(W.stallWaive(BOARD_B, DEF, { stalled: true })[0].why.startsWith('stalled:'))
})
await t('the bounds: a cell under the town count, a light, a non-record cell, past the quarter, past stallMax a visit', async () => {
  await killedBy(W_PATH, W, '    if ((Number(d?.visits) || 0) < G.stallVisits) continue', '', M => {
    assert.deepStrictEqual(M.stallWaive(BOARD_B, [{ k: '-206,62,117', visits: 2 }], { stalled: true }), [])
  })
  assert.deepStrictEqual(W.stallWaive(BOARD_B, [{ k: '-138,62,117', visits: 9 }, { k: '9,9,9', visits: 9 }], { stalled: true }), [], 'the light and a stranger')
  const full = { ...BOARD_B, waived: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`${-206 + 30 + i},62,117`, {}])) }
  assert.strictEqual(W.stallWaive(full, DEF, { stalled: true }).length, 0, 'ceil(0.25 * 68) = 17 waived: no room')
  const many = Array.from({ length: 10 }, (_, i) => ({ k: `${-206 + i},62,117`, visits: 5 }))
  assert.strictEqual(W.stallWaive(BOARD_B, many, { stalled: true }).length, 5, 'board-b: ceil(0.25 * 68) - 12 = 5 left')
  assert.strictEqual(W.stallWaive({ ...BOARD_B, waived: {} }, many, { stalled: true }).length, W.GKW.stallMax, 'at most stallMax a visit')
})
await t('heldWhy names what held an empty stage open', () => {
  assert.strictEqual(W.heldWhy({ clearsLeft: 48, clearsOk: false }), 'clears:48')
  assert.strictEqual(W.heldWhy({ crewHeld: 2, crewHolds: true, unread: true }), 'park:2,unread')
  assert.strictEqual(W.heldWhy({}), '-')
})
await t('GKWORK=0 is the switch', () => {
  assert.strictEqual(W.gkworkOn({}), true)
  assert.strictEqual(W.gkworkOn({ GKWORK: '0' }), false)
  assert.strictEqual(W.gkworkOn({ GKWORK: 'off' }), false)
})

console.log('WIRING (source, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = src => {
  const one = (re, s = src) => { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one('const GKW_ON = gkworkOn\\(\\)')
  one('gkw = gkwVisit\\(dir, key, me, rw, \\{ empty, worked: visitWorked\\(r\\) \\}\\)')
  one(SHOWCASE ? ';\\(\\{ clearsOk, crewHolds \\} = softHoldsGive\\(\\{ clearsOk, crewHolds, close: gkw\\.close \\}\\)\\)' : ';\\(\\{ clearsOk \\} = softHoldsGive\\(\\{ clearsOk, close: gkw\\.close \\}\\)\\)')
  one("releaseKeeper\\(bot, k\\.lease, 'no_work_now'\\)")
  one("stallWaive\\(rec, (gkWaivable\\(rec, )?r\\.deferred \\?\\? \\[\\]\\)?, \\{ stalled: r\\.stop === 'stuck_on_cell'")
  if (SHOWCASE) one('closing: GKW_ON && gkwClosing\\(b\\?\\.gkwPending \\?\\? null\\)')
  // the strikes are read before the completion test that uses the soft holds
  const i = src.indexOf('gkw = gkwVisit('), j = src.indexOf(SHOWCASE ? 'if (caps.complete && !crewHolds && !platformUp(rw)' : 'if (!prog.cutLeft && !prog.fillLeft && !unread && clearsOk)')
  assert.ok(i > 0 && j > i, `gkwVisit ${i} before the completion test ${j}`)
}
await t('buildTidy counts the town strikes before the completion, gives the soft holds way, releases no_work_now, waives a stalled stage; a cut line fails', () => {
  const src = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(src)
  const cut = "releaseKeeper(bot, k.lease, 'no_work_now')"
  assert.ok(src.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(src.replace(cut, '')), assert.AssertionError)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1

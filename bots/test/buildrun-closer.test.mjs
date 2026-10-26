// SHOP-01: THE ROOF-CLOSING CLICK UNDER AN ABORT (Claude's re-stack review P3). A closer cell takes the barrier, waits for it to
// clear, then HOLDS the block and LOOKS again before it sends. lavastep-01's danger move reserves the body and aborts the running
// skill; if that abort lands while the re-hold or the re-look is awaited, the click must not go out (the danger move may hold the
// body, and the hand may be its seal). The visit ends `aborted` with the barrier released.
import assert from 'node:assert'
const { R, PJ, both, server, bot, SITE, project } = await import('./helpers/buildfake.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}

/** A visit whose abort flips during a closer's RE-LOOK (the second look at one support and face in a row) -> { r, sentAfter, flipped }. */
async function abortAtTheReLook (Mod) {
  const srv = server(), pr = project(SITE.record)
  let flag = false, last = null, sentAfter = 0
  const e = bot(srv, 'A', { aborted: () => flag })
  const look = e.look
  e.look = async (support, face) => { const k = `${support}|${face}`; if (k === last) flag = true; last = k; return look(support, face) }
  const send = e.send
  e.send = (...a) => { if (flag) sentAfter++; return send(...a) }
  const h = PJ.recordHead(pr.dir, pr.key)
  const r = await Mod.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 4000, barrierWaitMs: 50 })
  return { r, sentAfter, flipped: flag, pr }
}

console.log('THE CLOSER\'S RE-HOLD / RE-LOOK UNDER AN ABORT')
await t('an abort during the closer\'s re-look sends nothing; the visit ends aborted and the barrier is released', async () => {
  const { r, sentAfter, flipped, pr } = await abortAtTheReLook(R)
  assert.ok(flipped, 'the scene reached a closer cell (control)')
  assert.strictEqual(sentAfter, 0, 'no click after the abort')
  assert.strictEqual(r.stop, 'aborted')
  // the barrier was released: another builder's closer takes it at once
  assert.ok(PJ.barrierTake(pr.dir, pr.key, 'B', { why: 'closer', cell: [0, 0, 0], now: Date.now() }).ok, 'the barrier is free')
})
await t('MUTANT the re-check dropped: the click goes out after the abort', () => both(
  "      if (e.aborted()) { PJ.barrierRelease(dir, key, me, barGen); return 'aborted' }\n    }",
  "    }", async M => {
    const { sentAfter } = await abortAtTheReLook(M)
    assert.strictEqual(sentAfter, 0)
  }))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

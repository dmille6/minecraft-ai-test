// FOLDWATCH-01: the stagnation watchdog exempts a bamboo fold -- only while it progresses (watchdog.mjs foldWindow).
//
// bamboo-02 on the fleet (10-19): 3 of 14 folds were cut by the stagnation watchdog, and 2 of those by the fold itself.
// A fold stands still and LOSES an item per craft (2 bamboo -> 1 stick); stagnation wants items gained > 0 over the busy
// samples (hive-b-Comet: "items -6" with 7 fold crafts inside the window, so +1 without the fold). smeltjob-01's furnace
// window is the precedent. Behaviour through the REAL StagnationWatchdog, on a scripted clock; every exemption has its
// positive control (the same history without it, and a fold that STALLS, are still judged).
import assert from 'node:assert'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'foldwatch-test-'))
process.env.LOG_LEVEL ??= 'error'
const WD = await import('../src/watchdog.mjs')
const { config } = await import('../src/config.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const STEP = config.watchdog.sampleMs, WIN = config.watchdog.windowMs

/**
 * Replay a scripted history into a real watchdog -> the cancels it issued. plan(i) -> { busy, fold, progress, craft,
 * gain }: busy = a skill running; fold = the fold's window open; progress = a confirmed craft this step (stamps
 * foldProgressAt); craft = items lost by the fold this step (booked in foldItemsSpent unless book is false);
 * gain = items picked up this step. `from`/`to`: only the stagnation cancels issued at steps in [from, to) count.
 */
async function replay (plan, { book = true, from = 0, to = Infinity } = {}) {
  const realNow = Date.now
  let now = realNow(); Date.now = () => now
  try {
    const cancels = []; let busy = false; let items = 100; let step = 0
    const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, food: 20,
      inventory: { items: () => [{ name: 'cobblestone', count: items }] },
      time: { age: 1, day: 1 }, game: { dimension: 'overworld' }, pathfinder: { getPathTo: () => null, movements: {} }, quit () {},
      stationaryUntil: 0, furnaceWindowUntil: 0, foldWindowUntil: 0, foldProgressAt: 0, foldItemsSpent: 0 }
    const wd = new WD.StagnationWatchdog(bot, { isBusy: () => busy, cancel: r => cancels.push({ r, i: step }), resume () {}, run: async () => {} },
      { running: true, milestones: { allDone: false } })
    let started = false
    for (let i = 0; i * STEP <= WIN * 2; i++) {
      step = i
      const s = plan(i) ?? {}
      busy = !!s.busy
      if (s.fold && !started) { started = true; bot.foldWindowUntil = now + 90_000; bot.foldProgressAt = now }
      if (!s.fold) { started = false; bot.foldWindowUntil = 0 }
      if (s.progress) bot.foldProgressAt = now
      if (s.craft) { items -= s.craft; if (book) bot.foldItemsSpent += s.craft }
      if (s.gain) items += s.gain
      wd.lastActionAt = now
      await wd.check()
      now += STEP
    }
    return cancels.filter(c => c.r === 'stagnation' && c.i >= from && c.i < to).map(c => `stagnation@${c.i}`)
  } finally { Date.now = realNow }
}
const n = Math.ceil(WIN / STEP)

await t('foldWindowOpen: open only inside the declared window AND within FOLD_STALL_MS of the last confirmed craft', () => {
  const S = WD.FOLD_STALL_MS
  assert.equal(WD.foldWindowOpen({ until: 1000, progressAt: 0, now: 500 }), true)
  assert.equal(WD.foldWindowOpen({ until: 1000, progressAt: 0, now: 1000 }), false, 'the window closes at its own end')
  assert.equal(WD.foldWindowOpen({ until: 10 * S, progressAt: 0, now: S }), true)
  assert.equal(WD.foldWindowOpen({ until: 10 * S, progressAt: 0, now: S + 1 }), false, 'a stalled fold is no longer exempt')
  assert.equal(WD.foldWindowOpen({}), false, 'no declaration, no exemption')
  assert.ok(S >= 5_000 && S <= 30_000, `FOLD_STALL_MS ${S}: several ~1.1 s crafts, far below the 180 s window`)
})

await t('stagnationItems adds back the fold\'s booked loss (and never subtracts)', () => {
  assert.equal(WD.stagnationItems({ bamboo: 50, stick: 32 }, 7), 89)
  assert.equal(WD.stagnationItems({ bamboo: 50 }, -3), 50)
  assert.equal(WD.stagnationItems({ bamboo: 50 }), 50)
})

// a busy, motionless, gainless prelude just short of a judgeable window, then a 90 s fold (6 steps), then idle
const prelude = (i, during) => (i < n - 2 ? { busy: true } : i < n + 4 ? during : {})
await t('A PROGRESSING FOLD IS NOT CANCELLED: its busy prelude cannot cut it, and its own stillness and item loss are not judged', async () => {
  const FOLD = { from: n - 2, to: n + 4 }   // only a cancel DURING the fold is the defect (the prelude itself is judged after it)
  assert.deepEqual(await replay(i => prelude(i, { busy: true, fold: true, progress: true, craft: 1 }), FOLD), [], 'the progressing fold was cut')
  // POSITIVE CONTROL: the identical history with no fold declared IS cut during those steps
  assert.ok((await replay(i => prelude(i, { busy: true, craft: 1 }), FOLD)).length > 0, 'the control was not judged: this proves nothing')
})

await t('POSITIVE CONTROL -- A STALLED FOLD STILL TRIPS: window open, no confirmed craft after the first steps', async () => {
  // the same prelude; the fold confirms one craft, then nothing: FOLD_STALL_MS later it is judged as any skill
  assert.ok((await replay(i => prelude(i, { busy: true, fold: true, progress: i === n - 2 }), { from: n - 2, to: n + 4 })).length > 0,
    'a fold with no confirmed craft was exempted for its whole window')
})

await t('THE FLEET SHAPE (hive-b-Comet): a gaining busy prelude, then a fold -> neither the fold nor the stretch after it is read as a loss', async () => {
  // busy and gaining a little before the fold, a 7-step fold, then busy and still: at the base the fold's -7 made the
  // window's gain negative (items -6) and the watchdog cut the fold
  // busy, gaining one item just before a 6-step fold; then two busy, still steps -- judged with the gain in the window
  const plan = i => (i < n - 4 ? { busy: true, gain: i === n - 5 ? 1 : 0 } : i < n + 2 ? { busy: true, fold: true, progress: true, craft: 1 } : i < n + 4 ? { busy: true } : {})
  const AFTER = { from: n - 4, to: n + 4 }
  assert.deepEqual(await replay(plan, AFTER), [], 'the fold\'s own consumption was judged as stagnation')
  // POSITIVE CONTROL: the same history with the loss NOT booked (the base's counting) IS cancelled right after the fold
  assert.ok((await replay(plan, { ...AFTER, book: false })).length > 0, 'without the booked loss the history is not stagnant: this proves nothing')
})

await t('A FOLD\'S TIME IS NOT BUSY TIME: 30 s busy + a 90 s fold + 15 s busy is below the busy minimum, so nothing is judged', async () => {
  // gainless and motionless throughout; only the fold's 90 s would lift the busy time over MIN_BUSY_MS (60 s)
  const plan = i => (i < 2 ? { busy: true } : i < 8 ? { busy: true, fold: true, progress: true, craft: 1 } : i < 9 ? { busy: true } : {})
  assert.deepEqual(await replay(plan, { from: 8 }), [], 'the fold\'s own time was counted as busy time')
  // POSITIVE CONTROL: the same history with no fold declared is judged (135 s busy, still, no gain)
  assert.ok((await replay(i => ({ ...plan(i), fold: false }), { from: 8 })).length > 0, 'the control was not judged: this proves nothing')
})

await t('A FOLD THAT ENDS, then a genuinely stuck stretch, is judged again', async () => {
  const plan = i => (i < 4 ? { busy: true, fold: true, progress: true, craft: 1 } : { busy: true })
  assert.ok((await replay(plan)).length > 0)
})

await t('WIRED: the sample and the judge both ask declaredSession, and it covers the furnace and the fold', () => {
  const src = fs.readFileSync(new URL('../src/watchdog.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  assert.match(src, /const furnace = declaredSession\(this\.bot\)/)
  assert.match(src, /if \(declaredSession\(this\.bot\)\) return/)
  assert.match(src, /const items = stagnationItems\(inventorySummary\(this\.bot\), this\.bot\.foldItemsSpent\)/)
  const bot = { furnaceWindowUntil: Date.now() + 1000 }
  assert.equal(WD.declaredSession(bot), true)
  assert.equal(WD.declaredSession({ foldWindowUntil: Date.now() + 1000, foldProgressAt: Date.now() }), true)
  assert.equal(WD.declaredSession({}), false)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

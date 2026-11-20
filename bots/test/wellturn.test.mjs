// WELLFIX-01SHOW (wellturn.mjs): turns at the junk well -- the lease, the line, and the wait's words. Behaviour of the pure
// turn rule and of the line's files; the skill's chain (one throws, the other waits, then throws) is in well.test.mjs.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { wellTurn, readTickets, touchTicket, dropTicket, wellTurnDetail, wellTurnOn, wellWaitMs, WELL_TICKET_TTL_MS, WELL_WAIT_MS } from '../src/wellturn.mjs'
import { acquireFurnaceLease, furnaceLeaseState } from '../src/furnacelease.mjs'

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }
const NOW = 1_800_000_000_000
const CAP = { x: 12, y: 73, z: 7 }

console.log('THE TURN (pure)')
await t('a free well and no line: go', () => {
  assert.deepEqual(wellTurn({ lease: { live: false }, tickets: [], me: 'A', now: NOW }), { go: true, why: null, who: null, place: 1 })
})
await t('another holder: busy, named; this bot\'s own lease is not "busy"', () => {
  const r = wellTurn({ lease: { live: true, holder: 'B' }, tickets: [{ who: 'A', at: NOW - 5, seen: NOW }], me: 'A', now: NOW })
  assert.deepEqual([r.go, r.why, r.who, r.place], [false, 'busy', 'B', 1])
  assert.equal(wellTurn({ lease: { live: true, holder: 'A' }, tickets: [], me: 'A', now: NOW }).go, true)
})
await t('THE LINE: first ask first -- the older ticket goes, the newer waits (queued behind it, place 2), whatever the names', () => {
  const tk = [{ who: 'Z', at: NOW - 9000, seen: NOW }, { who: 'A', at: NOW - 1000, seen: NOW }]
  const a = wellTurn({ lease: { live: false }, tickets: tk, me: 'A', now: NOW })
  assert.deepEqual([a.go, a.why, a.who, a.place], [false, 'queued', 'Z', 2])
  assert.equal(wellTurn({ lease: { live: false }, tickets: tk, me: 'Z', now: NOW }).go, true)
})
await t('a bot with no ticket is last in line', () => {
  const r = wellTurn({ lease: { live: false }, tickets: [{ who: 'Z', at: NOW - 10, seen: NOW }], me: 'A', now: NOW })
  assert.deepEqual([r.go, r.why, r.place], [false, 'queued', 2])
})
await t('NO DEAD HEAD: a ticket not refreshed for WELL_TICKET_TTL_MS drops out of line by itself', () => {
  const tk = [{ who: 'Z', at: NOW - 10 * 60_000, seen: NOW - WELL_TICKET_TTL_MS }, { who: 'A', at: NOW - 1000, seen: NOW }]
  assert.equal(wellTurn({ lease: { live: false }, tickets: tk, me: 'A', now: NOW }).go, true)
  assert.equal(wellTurn({ lease: { live: false }, tickets: [{ ...tk[0], seen: NOW - WELL_TICKET_TTL_MS + 1 }, tk[1]], me: 'A', now: NOW }).go, false, 'positive control: one ms younger, it is still ahead')
})
await t('the words name who, the place, the wait, and what happens next (nothing for the bot to decide)', () => {
  assert.match(wellTurnDetail({ why: 'busy', who: 'B', place: 1, waitedMs: 30_000 }), /^wait for B to finish its turn at the town junk well; waited 30 s here\. This bot keeps place 1 in line for 3 min and the order is asked again at its cooldown$/)
  assert.match(wellTurnDetail({ why: 'queued', who: 'Z', place: 2, waitedMs: 0 }), /^wait for Z, ahead in line/)
  assert.match(wellTurnDetail({ why: 'near', who: null, place: 1, waitedMs: 1500, near: { who: 'C', dist: 2.04 } }), /^wait for C to move off the town junk well \(2\.0 blocks\): it opens only with nobody within 5; waited 2 s/)
})
await t('switch and clock: on by default, WELLTURN=off turns it off; the wait never exceeds WELL_WAIT_MS', () => {
  assert.equal(wellTurnOn({}), true); assert.equal(wellTurnOn({ WELLTURN: 'off' }), false)
  assert.equal(wellWaitMs({}), WELL_WAIT_MS); assert.equal(wellWaitMs({ WELLTURN_WAIT_MS: '1500' }), 1500); assert.equal(wellWaitMs({ WELLTURN_WAIT_MS: '999999' }), WELL_WAIT_MS)
})

console.log('THE LINE ON DISK')
await t('touch keeps the first ask while live, refreshes `seen`; drop leaves the line; two bots read the same line', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wellturn-'))
  touchTicket(dir, CAP, 'A:1', NOW); touchTicket(dir, CAP, 'B:2', NOW + 10); touchTicket(dir, CAP, 'A:1', NOW + 500)
  const tk = readTickets(dir, CAP).sort((a, b) => a.at - b.at)
  assert.deepEqual(tk.map(x => [x.who, x.at, x.seen]), [['A:1', NOW, NOW + 500], ['B:2', NOW + 10, NOW + 10]])
  assert.equal(wellTurn({ lease: { live: false }, tickets: tk, me: 'B:2', now: NOW + 600 }).why, 'queued')
  dropTicket(dir, CAP, 'A:1')
  assert.equal(wellTurn({ lease: { live: false }, tickets: readTickets(dir, CAP), me: 'B:2', now: NOW + 600 }).go, true)
  touchTicket(dir, CAP, 'A:1', NOW + 600 + WELL_TICKET_TTL_MS + 1)
  assert.equal(readTickets(dir, CAP).find(x => x.who === 'A:1').at, NOW + 600 + WELL_TICKET_TTL_MS + 1, 'a returning bot past its life starts a new place')
})
await t('the lease (furnacelease generation files, key = the cap): one holder; the other reads it busy; released, it is free', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wellturn-'))
  const a = acquireFurnaceLease(dir, CAP, 'A:1', { what: 'well', ttl: 150_000 })
  assert.equal(a.ok, true); assert.equal(a.unleased, undefined)
  const b = acquireFurnaceLease(dir, CAP, 'B:2', { what: 'well', ttl: 150_000 })
  assert.deepEqual([b.ok, b.holder], [false, 'A:1'])
  assert.equal(wellTurn({ lease: furnaceLeaseState(dir, CAP), tickets: [], me: 'B:2' }).why, 'busy')
  a.release()
  assert.equal(wellTurn({ lease: furnaceLeaseState(dir, CAP), tickets: [], me: 'B:2' }).go, true)
})
await t('FAIL-OPEN: an unusable directory gives no line (go)', () => {
  touchTicket('/dev/null/x', CAP, 'A', NOW)
  assert.deepEqual(readTickets('/dev/null/x', CAP), [])
  assert.equal(wellTurn({ lease: furnaceLeaseState('/dev/null/x', CAP), tickets: readTickets('/dev/null/x', CAP), me: 'A' }).go, true)
})

console.log('MUTANTS (anchored)')
const P = new URL('../src/wellturn.mjs', import.meta.url)
const mutant = async (old, neu, fn) => {
  const src = readFileSync(P, 'utf8')
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-wellturn-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT: the line ignored (only the lease) -> the newer bot jumps the older one', async () => {
  await mutant("  if (head && (mine < 0 || live.indexOf(head) < mine)) return { go: false, why: 'queued', who: head.who, place }\n", '', M => {
    const tk = [{ who: 'Z', at: NOW - 9000, seen: NOW }, { who: 'A', at: NOW - 1000, seen: NOW }]
    assert.equal(M.wellTurn({ lease: { live: false }, tickets: tk, me: 'A', now: NOW }).go, true, 'mutant inert')
  })
})
await t('MUTANT: stale tickets kept -> a dead head blocks the line forever (the dead end the TTL removes)', async () => {
  await mutant(' && now - Number(t.seen ?? t.at) < ttl)', ')', M => {
    const tk = [{ who: 'Z', at: NOW - 3_600_000, seen: NOW - 3_600_000 }, { who: 'A', at: NOW - 1000, seen: NOW }]
    assert.equal(M.wellTurn({ lease: { live: false }, tickets: tk, me: 'A', now: NOW }).go, false, 'mutant inert')
  })
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)

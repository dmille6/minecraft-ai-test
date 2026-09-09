// PLACING WHILE FALLING IS NOT A LACK OF ROOM.
//
// `place` gates the entire tech tree: a bot that cannot put a crafting table
// down cannot make a wooden pickaxe, and 187 of 194 `craft` refusals in one
// 200-minute window were exactly that. Two separate things were being counted
// as one number, and the fixes for them are opposites:
//
//   all 24 cells empty      -> the bot is in open air or open water. It is
//                              FALLING. There will be somewhere to place the
//                              moment it lands, and waiting is the whole remedy.
//   cells full of stone     -> the bot is boxed in. Waiting changes nothing;
//                              it has to dig or escape.
//
// Both used to return `no_space` with the sentence "nowhere to place", which is
// simply false in the first case.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const CODE = fs.readFileSync(path.join(SRC, 'skills.mjs'), 'utf8')
// Comments in this codebase quote the code they explain, so a naive grep
// matches the explanation. Strip them before asserting on anything executable.
const EXEC = CODE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const { UNKNOWN_FAIL_CLASSES, statusFor } = await import('../src/skills.mjs')

test('airborne is UNKNOWN, so a fall never teaches the fleet that placing fails', () => {
  assert.ok(UNKNOWN_FAIL_CLASSES.has('airborne'),
    'filed as `failed` it would feed the avoid machinery a lesson about the wrong thing')
  assert.equal(statusFor('airborne'), 'unknown')
  // The contrast case must NOT be laundered: being boxed in is a real refusal.
  assert.equal(statusFor('no_space'), 'failed',
    'a bot walled in by stone has genuinely failed and should be recorded as such')
})

test('the two situations return different classes', () => {
  assert.match(EXEC, /failClass: 'airborne'/, 'the airborne branch exists in executable code')
  assert.match(EXEC, /seen\.noSupport === 24 && bot\.entity\?\.onGround === false/,
    'and it fires only when nothing is solid anywhere AND the bot is off the ground')
})

test('placeBlock is bounded, or one silent spot eats every candidate', () => {
  // bot.placeBlock waits on a server blockUpdate that may never arrive. Left
  // unbounded, the first bad candidate consumed the whole skill budget and the
  // five remaining ones were never reached.
  // COUNT THE CALL SITES, do not merely find one. The first version of this
  // asserted that SOME withTimeout+placeBlock existed, and a mutant that
  // unbound place() survived it by matching build()'s copy instead -- the
  // "matched a different call site" failure this repo has already paid for.
  const bare = EXEC.match(/(?<!withTimeout\()\bbot\.placeBlock\(ref\b/g) ?? []
  assert.equal(bare.length, 0,
    `every placeBlock(ref) must be wrapped; found ${bare.length} bare`)
  const wrapped = EXEC.match(/withTimeout\(bot\.placeBlock\(ref\b/g) ?? []
  assert.equal(wrapped.length, 2,
    `place() and build() both wrap it -- expected 2, found ${wrapped.length}`)
  assert.match(EXEC, /const PLACE_ACK_MS = [0-9_]+/, 'and the ceiling is a real constant')
})

test('craft names the real obstacle, not the advice that just failed', () => {
  // `stationOnly` means the bot HAS a table and lacks nothing else -- so the
  // resolver already called place() and place() already failed. Telling the
  // model "place the crafting_table first" is telling it to redo what failed.
  assert.doesNotMatch(EXEC, /no recipe available for \$\{item\}; place the crafting_table first/,
    'the refusal must not print a remedy that has just been attempted and failed')
  assert.match(EXEC, /stationFailure/,
    'the place failure is carried down to the refusal that reports it')
})

test('the failure counts attempts, not candidates', () => {
  // "failed at 1 spot(s)" reported how many spots EXISTED and read as how many
  // were tried. It misled a whole investigation.
  assert.match(EXEC, /failed after \$\{tried\} of \$\{candidates\.length\} spot\(s\)/,
    'both numbers, each labelled for what it is')
})

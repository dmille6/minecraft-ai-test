// THE REFLEX WAS READING FISH.
//
// mineflayer 4.37.1 lib/plugins/entities.js sets `bot.oxygenLevel` from ANY
// entity's air_supply metadata:
//
//     const entity = fetchEntity(packet.entityId)
//     if (metas.air_supply != null) bot.oxygenLevel = Math.round(metas.air_supply / 15)
//
// with no check that `entity` is the bot. The older breath.js path guards it
// (`if (bot.entity.id !== packet.entityId) return`); the metadata path that
// supersedes it on 1.21.8 does not.
//
// A player's air supply is 300, so oxygenLevel cannot exceed 20. Fish and
// dolphins carry 4800, which is 320. Over six hours this fleet's reflex saw
// 400, 320, 319, 318, 315, 308, 303, 290, 284, 271, 241, 189 and 20, with an
// aquatic mob within 24 blocks on 41% of all decisions. Only the 20s were ours.
//
// Every drowning threshold is a fraction of the largest value seen, so one cod
// swimming past redefined full air as 320 and a bot at 3 of 20 units got no
// rescue. It is why 184 releases logged `oxygen 20, health 20` and read as
// safe: 20 IS full air for a player, and the code had been taught full was 320.
//
// A previous version of reflex.mjs noted the symptom in a comment -- "arrives
// on two scales intermittently" -- and reasoned about which scale rather than
// asking why a single bot had two. Absence of an explanation was taken for a
// property of the server.
import assert from 'node:assert'
import { isOwnEntity, installOwnAir } from '../src/own-air.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

/** A bot plus a client that reproduces mineflayer's unguarded write. */
function fakeBot (selfId = 7) {
  const handlers = []
  const bot = {
    entity: { id: selfId },
    oxygenLevel: null,
    _client: {
      on: (ev, fn) => { if (ev === 'entity_metadata') handlers.push(fn) },
      removeListener: (ev, fn) => {
        const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1)
      },
    },
  }
  // mineflayer's plugin registers FIRST and writes unconditionally; ours is
  // registered after by installOwnAir, so it runs second. That ordering is the
  // whole mechanism, so the fake has to honour it.
  const emit = (entityId, airSupply) => {
    bot.oxygenLevel = Math.round(airSupply / 15)     // <- the upstream bug
    for (const h of handlers) h({ entityId })
  }
  // A metadata packet with no air_supply in it, which is MOST of them: pose,
  // flags, custom name. mineflayer leaves oxygenLevel untouched.
  const emitOther = (entityId) => {
    for (const h of handlers) h({ entityId })
  }
  return { bot, emit, emitOther }
}

t('a player air supply of 300 reads as 20', () => {
  const { bot, emit } = fakeBot()
  installOwnAir(bot)
  emit(7, 300)
  assert.equal(bot.oxygenLevel, 20)
  assert.equal(bot.ownOxygenLevel, 20)
})

t('A COD SWIMMING PAST CANNOT REDEFINE OUR AIR', () => {
  const { bot, emit } = fakeBot()
  installOwnAir(bot)
  emit(7, 300)          // us, full
  emit(99, 4800)        // a cod, entity 99
  assert.equal(bot.oxygenLevel, 20,
    `a fish set our oxygen to ${bot.oxygenLevel}; every drowning threshold is ` +
    `a fraction of the largest value seen, so this is the whole bug`)
})

t('THE THREE-OF-TWENTY CASE: drowning is not masked by a dolphin', () => {
  // The bot is seconds from drowning. A dolphin surfaces nearby.
  const { bot, emit } = fakeBot()
  installOwnAir(bot)
  emit(7, 300)
  emit(7, 45)           // 3 of 20 -- an emergency
  emit(42, 4800)        // dolphin
  assert.equal(bot.oxygenLevel, 3,
    'the emergency was overwritten by a passing dolphin and the bot drowns')
})

t('our own reading still updates freely, up and down', () => {
  const { bot, emit } = fakeBot()
  installOwnAir(bot)
  emit(7, 300); emit(7, 150); emit(7, 15); emit(7, 300)
  assert.equal(bot.oxygenLevel, 20, 'refilling at the surface must be visible')
})

t('a foreign packet before we have ever heard from ourselves is not repaired', () => {
  // Nothing to restore yet. Honest: ownOxygenLevel stays null and the reflex
  // falls back to the drain trend, which needs no absolute scale.
  const { bot, emit } = fakeBot()
  installOwnAir(bot)
  emit(99, 4800)
  assert.equal(bot.ownOxygenLevel, null)
})

t('no player value can exceed 20, which is the invariant the fleet violated', () => {
  const { bot, emit } = fakeBot()
  installOwnAir(bot)
  for (const [id, air] of [[7, 300], [11, 4800], [7, 285], [12, 6000], [7, 270]]) emit(id, air)
  assert.ok(bot.oxygenLevel <= 20,
    `oxygen read ${bot.oxygenLevel}; a player's air supply is 300 and 300/15 = 20`)
})

t('A DELTA PACKET OF OURS CANNOT LAUNDER A FISH VALUE', () => {
  // The flaw in the first version of this guard, and the reason it only half
  // worked in production. Entity metadata is a delta: most packets about us
  // carry no air_supply, so oxygenLevel still holds whatever the last write
  // left. Asking only "was that packet ours?" then adopts a fish as our own.
  const { bot, emit, emitOther } = fakeBot()
  installOwnAir(bot)
  emit(7, 300)          // us, full: 20
  emit(88, 4800)        // a cod: 320, repaired back to 20
  emitOther(7)          // us again, but a pose update with no air in it
  assert.equal(bot.ownOxygenLevel, 20,
    `our air was recorded as ${bot.ownOxygenLevel} from a packet that never ` +
    `contained an air reading`)
  assert.equal(bot.oxygenLevel, 20)
})

t('a fish before we know our own air is dropped, not adopted', () => {
  const { bot, emit, emitOther } = fakeBot()
  installOwnAir(bot)
  emit(88, 4800)        // cod first, nothing of ours to restore
  emitOther(7)
  assert.equal(bot.ownOxygenLevel, null, 'a fish became our baseline')
  assert.ok(bot.oxygenLevel == null || bot.oxygenLevel <= 20,
    `oxygen left at ${bot.oxygenLevel}`)
})

t('the guard counts what it did, so the fix is checkable in flight', () => {
  const { bot, emit } = fakeBot()
  installOwnAir(bot)
  emit(7, 300); emit(88, 4800); emit(88, 4500); emit(7, 150)
  assert.equal(bot.ownAirStats.ours, 2)
  assert.equal(bot.ownAirStats.foreign, 2)
  assert.equal(bot.ownAirStats.repaired, 2)
})

t('packets that carry no air reading are not counted as air events', () => {
  // The early return exists for this. Mutating it away does NOT corrupt the
  // reading -- the restore-to-last rule is what protects that -- but it does
  // make every pose update look like an air packet, and these counters are how
  // the fix gets verified in flight against 40 live bots. A diagnostic that
  // counts the wrong thing is the failure mode this whole day has been about.
  const { bot, emit, emitOther } = fakeBot()
  installOwnAir(bot)
  emit(7, 300)
  emitOther(7)          // our pose
  emitOther(88)         // a cod's pose
  emitOther(88)
  assert.equal(bot.ownAirStats.ours, 1,
    `${bot.ownAirStats.ours} air readings counted from 1 real one`)
  assert.equal(bot.ownAirStats.foreign, 0,
    `${bot.ownAirStats.foreign} foreign air writes counted from 0 real ones`)
})

t('isOwnEntity is strict about a missing id rather than guessing', () => {
  assert.equal(isOwnEntity({ entityId: 7 }, undefined), false)
  assert.equal(isOwnEntity(null, 7), false)
  assert.equal(isOwnEntity({ entityId: 7 }, 7), true)
})

t('uninstalling stops the repair', () => {
  const { bot, emit } = fakeBot()
  const off = installOwnAir(bot)
  emit(7, 300)
  off()
  emit(99, 4800)
  assert.equal(bot.oxygenLevel, 320, 'listener was not removed')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

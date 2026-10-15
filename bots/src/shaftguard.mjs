// THE SHAFT'S DIG CHOKEPOINT (shaft-01; design 4.3 T2(b), Codex shaft plan r1 P1-2/P1-3).
//
// ONE PLACE FOR EVERY DIG. The shaft's lining and ladders must survive every dig a bot can make -- target (mine, gather, the
// ore tunnel: structureguard already refuses those), transit (the pathfinder's own breaks: the profiles' break exclusion
// refuses those) and SURVIVAL (the entombment escape, the escape rungs, a stuck breaker), which no per-skill guard sees. So
// bot.dig itself is wrapped: a dig of a reserved shaft cell is REFUSED unless
//   - it is the builder's own (dig scope by=dig_shaft), or
//   - the digging bot has NO verified ladder exit from where it stands (shaftindex ladderExit) -- then the dig passes and the
//     shaft absorbs the damage: a bot below a broken ladder must still be able to dig itself out (CLAUDE.md: a refusal must
//     name a remedy the bot can perform from where it is; without an exit there is none, so there is no refusal).
// With an exit the refusal names it ("climb column N to the pad"), and cognitive's first order for a bot in the shaft is that
// climb (shaft_exit), so the remedy is not advice but the next thing that happens.
import { ladderExit } from './shaftindex.mjs'
import { isFullCube } from './builder.mjs'

/**
 * THE DECISION -> { allow: true } | { allow: false, why, exit }. Pure.
 *   cell     the dig target {x, y, z};  shaft  the keep-out's shaft index (null: none recorded here)
 *   by       the dig scope's author (dig_shaft is the builder);  exit  ladderExit(...) for the digging bot (lazy: a thunk)
 */
export function shaftDigDecision ({ cell, shaft, by = null, exit = () => ({ ok: false }) }) {
  if (!shaft || !cell || !shaft.has(cell.x, cell.y, cell.z)) return { allow: true }
  if (by === 'dig_shaft') return { allow: true }
  // the climb out may take the CAP off from below (a capped shaft with a bot inside: Claude plan r2 P2-1) -- the cap only
  if (by === 'shaft_exit' && shaft.core(cell.x, cell.y, cell.z) && cell.y === shaft.site?.c) return { allow: true }
  const e = exit()
  if (!e?.ok) return { allow: true, absorbed: true, why: e?.why ?? 'no verified ladder exit' }
  return { allow: false, exit: e, why: `${shaft.roleAt(cell.x, cell.y, cell.z) ?? 'a cell'} of the shared mineshaft; climb column ${e.col} to the pad instead` }
}

/**
 * Wrap bot.dig -> uninstall(). keepOut() = the structures keep-out (its `.shaft` index); scopeBy() = the current dig scope's
 * `by`; read(x,y,z) = the bot's world; onRefuse({cell, why, exit}) / onAbsorb({cell, why}) for the rows. A refused dig
 * REJECTS with an error flagged `reserved` (the escape rungs treat a rejected dig as a failed rung). Never throws on its own.
 */
export function installShaftDigGuard (bot, { keepOut, scopeBy = () => null, read, onRefuse = () => {}, onAbsorb = () => {} } = {}) {
  const was = bot.dig
  const guarded = function (block, ...rest) {
    let d = { allow: true }
    try {
      const p = block?.position
      const shaft = p ? keepOut()?.shaft ?? null : null
      if (shaft) {
        const cell = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
        d = shaftDigDecision({ cell, shaft, by: scopeBy(), exit: () => { const h = shaftHold(shaft, read, bot.entity?.position, { fails: bot.__shaftExitFails ?? [], capOk: hasPickaxe(bot) }); return h.hold ? h.exit : { ok: false, why: h.exhausted ? 'the climb out failed twice: released' : (h.exit?.why ?? 'no exit') } } })
        if (!d.allow) { try { onRefuse({ cell, why: d.why, exit: d.exit }) } catch { /* telemetry */ } }
        else if (d.absorbed) { try { onAbsorb({ cell, why: d.why }) } catch { /* telemetry */ } }
      }
    } catch { d = { allow: true } }
    if (!d.allow) return Promise.reject(Object.assign(new Error(`shaft_reserved: ${d.why}`), { reserved: true, shaft: true }))
    return was.call(this, block, ...rest)
  }
  guarded.__shaftguard = true
  bot.dig = guarded
  return () => { if (bot.dig === guarded) bot.dig = was }
}

export const hasPickaxe = bot => { try { return (bot.inventory?.items?.() ?? []).some(i => /_pickaxe$/.test(i.name)) } catch { return false } }
/** A read over the bot's world for ladderExit: name, collision class and a ladder's facing. null = unloaded. */
export function shaftRead (bot) {
  return (x, y, z) => {
    try {
      const b = bot.blockAt({ x, y, z, offset () { return this }, floored () { return this } })
      if (!b) return null
      let props = null
      try { props = b.getProperties?.() ?? null } catch { props = null }
      // the properties ride along (Codex code r1 P2: a waterlogged block is wet to the shared predicates)
      return { name: b.name, boundingBox: b.boundingBox, facing: b.name === 'ladder' ? (props?.facing ?? null) : null, props, full: isFullCube(b) }
    } catch { return null }
  }
}

/**
 * IS THIS BOT IN THE SHAFT WITH A WAY OUT? -> { hold, exit } (shaft-01 T1, Codex shaft plan r1 P1-2). Pure over its inputs. While
 * it holds, the reflex's movement arms (wall, marooned, entombed, unstick) stand down: a ladder overhead is not a ceiling and
 * the lining is not a wall to dig, and cognitive's first order is the climb out (shaft_exit). Without an exit nothing is held.
 */
export const EXIT_FAIL_WINDOW_MS = 10 * 60_000
export const EXIT_FAILS_RELEASE = 2
/** Has this bot's climb out failed often enough that the hold must release (Claude plan r2 P1-1)? Pure. */
export const exitExhausted = (fails = [], now = Date.now()) => fails.filter(t => now - t < EXIT_FAIL_WINDOW_MS).length >= EXIT_FAILS_RELEASE
export function shaftHold (shaft, read, feet, { fails = [], now = Date.now(), capOk = false } = {}) {
  if (!shaft || !feet || !shaft.inEnvelope(feet.x, feet.y, feet.z)) return { hold: false, exit: null, outside: true }
  // A BOUNDED HOLD: two failed climbs out within 10 min and the hold releases -- the reflexes and (absorbed) digs apply again
  if (exitExhausted(fails, now)) return { hold: false, exit: null, exhausted: true }
  const e = ladderExit(shaft, read, feet, { capOk })
  return { hold: !!e.ok, exit: e }
}

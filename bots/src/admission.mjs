// Admission layer -- ADR-0002.
//
// A deterministic gate between the model and the runner. Even schema-valid
// output is checked here before anything executes.
//
// This is what makes the model ADVISORY rather than authoritative, and it is
// the cleanest expression of "reliability before intelligence" in the design.
// Every rejection carries a reason code, which turns the useless observation
// "the model is unreliable" into a distribution over specific, fixable causes
// you can query in Kibana.

import { SKILLS } from './skills.mjs'
import { config } from './config.mjs'
import { horizontalDistanceFromSpawn } from './state.mjs'


const REPEAT_WINDOW = 4

export class AdmissionControl {
  constructor(lessons = null) {
    this.lessons = lessons
    this.failedCooldowns = new Map()   // key -> expiry timestamp
    this.recent = []                   // last N admitted keys, for repeat detection
    this.blockedCount = {}             // per-key block tally, for probation
  }

  static key(skill, args) {
    return `${skill}:${JSON.stringify(args ?? {})}`
  }

  /** Record that a proposal we admitted ended in failure, so we stop re-picking it. */
  noteFailure(skill, args) {
    this.failedCooldowns.set(AdmissionControl.key(skill, args),
                             Date.now() + config.skills.failedCooldownMs)
  }

  noteSuccess(skill, args) {
    this.failedCooldowns.delete(AdmissionControl.key(skill, args))
  }

  /** Called after an escape action, so the model gets a clean slate to choose from. */
  clearRepeatWindow() { this.recent = [] }

  /**
   * @returns {{ok: true, skill, args} | {ok: false, reason: string, detail: string}}
   */
  check(proposal, bot) {
    if (!proposal || typeof proposal !== 'object') {
      return { ok: false, reason: 'no_proposal', detail: 'model produced nothing usable' }
    }
    const { skill } = proposal
    const args = { ...(proposal.args ?? {}) }

    // Normalise one unambiguous confusion: gather takes `block`, but models
    // reach for `item` because block ids read like item ids. The intent is not
    // in doubt, so rejecting it would be pedantic -- but it IS recorded, so the
    // rate stays visible in telemetry rather than being silently absorbed.
    if (skill === 'gather' && !args.block && typeof args.item === 'string') {
      args.block = args.item
      delete args.item
      this.normalisations = (this.normalisations ?? 0) + 1
    }

    // --- known skill ------------------------------------------------------
    if (!SKILLS[skill]) {
      return { ok: false, reason: 'unknown_skill', detail: `"${skill}" is not in the registry` }
    }

    // --- argument sanity, per skill ---------------------------------------
    if (skill === 'gather') {
      if (!args.block || typeof args.block !== 'string') {
        return { ok: false, reason: 'bad_args', detail: 'gather needs a block name' }
      }
      if (!bot.registry.blocksByName[args.block]) {
        return { ok: false, reason: 'bad_args', detail: `"${args.block}" is not a real block` }
      }
      const n = Number(args.count)
      if (!Number.isFinite(n) || n <= 0 || n > 128) {
        return { ok: false, reason: 'bad_args', detail: `count ${args.count} outside 1..128` }
      }
    }

    if (skill === 'goto') {
      const { x, y, z } = args
      if (![x, y, z].every(v => Number.isFinite(Number(v)))) {
        return { ok: false, reason: 'bad_args', detail: 'goto needs numeric x, y, z' }
      }
      // Never let a goal chase the bot past the world border into ungenerated
      // chunks -- the whole point of pregenerating and setting a border.
      const d = horizontalDistanceFromSpawn({ x: Number(x), z: Number(z) })
      if (d > config.world.borderRadius) {
        return { ok: false, reason: 'outside_border', detail: `${Math.round(d)} > ${config.world.borderRadius}` }
      }
      // Absolute bounds are far too loose to be useful: the model repeatedly
      // chose y=140 while standing at y=70, which passes any sane global check
      // and then fails to path because it is 70 blocks up in open sky.
      // Plausibility is RELATIVE to where the bot currently is.
      const dy = Math.abs(Number(y) - bot.entity.position.y)
      if (dy > 40) {
        return {
          ok: false, reason: 'unreachable_elevation',
          detail: `y=${y} is ${Math.round(dy)} blocks from your y=${bot.entity.position.y.toFixed(0)}`,
        }
      }
    }

    if (skill === 'craft') {
      if (!args.item || typeof args.item !== 'string') {
        return { ok: false, reason: 'bad_args', detail: 'craft needs an item name' }
      }
      if (!bot.registry.itemsByName[args.item]) {
        return { ok: false, reason: 'bad_args', detail: `"${args.item}" is not a real item` }
      }
      const n = Number(args.count ?? 1)
      if (!Number.isFinite(n) || n <= 0 || n > 64) {
        return { ok: false, reason: 'bad_args', detail: `count ${args.count} outside 1..64` }
      }
    }

    if (skill === 'place') {
      if (!args.item || typeof args.item !== 'string') {
        return { ok: false, reason: 'bad_args', detail: 'place needs an item name' }
      }
      if (!bot.inventory.items().some(i => i.name === args.item)) {
        return { ok: false, reason: 'bad_args', detail: `no ${args.item} in inventory to place` }
      }
    }

    if (skill === 'mine') {
      const y = Number(args.y ?? 12)
      if (!Number.isFinite(y) || y < -59 || y > 120) {
        return { ok: false, reason: 'bad_args', detail: `mine target y=${args.y} outside -59..120` }
      }
    }

    if (skill === 'follow' || skill === 'come') {
      const p = args.player
      if (p && !bot.players[p]) {
        return { ok: false, reason: 'no_such_player', detail: `${p} is not online` }
      }
    }

    // --- cooldown on things that just failed -------------------------------
    const key = AdmissionControl.key(skill, args)
    const until = this.failedCooldowns.get(key)
    if (until && Date.now() < until) {
      return {
        ok: false, reason: 'cooldown',
        detail: `${skill} with these args failed recently; ${Math.ceil((until - Date.now()) / 1000)}s left`,
      }
    }

    // --- what past RUNS learned ---------------------------------------------
    // A within-run cooldown forgets everything at restart, so the bot would
    // cheerfully retry an action that has failed on every run since the world
    // was created. This is the persistent half of that.
    const priorFails = this.lessons?.failCount(skill, args) ?? 0
    if (priorFails >= 4) {
      // PROBATION. A learned block with no way to be disproved is permanent,
      // and the world changes: terrain gets mined, inventories fill, the bot
      // moves. Observed live -- Scout01 made zero executed decisions across an
      // entire run because every action its milestone required had been
      // learned-blocked, and nothing could ever clear them.
      //
      // Every 5th attempt goes through. If it fails the count rises and the
      // block tightens; if it succeeds, recordSuccess() weakens the rule. That
      // is the inverse the guard was missing -- the fifth instance of this
      // shape in this codebase.
      const k = AdmissionControl.key(skill, args)
      const n = (this.blockedCount[k] = (this.blockedCount[k] ?? 0) + 1)
      if (n % 5 !== 0) {
        return {
          ok: false, reason: 'learned_avoid',
          detail: `${skill} with these args has failed ${priorFails}x across runs (retry in ${5 - (n % 5)})`,
        }
      }
      // fall through on probation
    }

    // --- oscillation guard --------------------------------------------------
    const repeats = this.recent.filter(k => k === key).length
    if (repeats >= REPEAT_WINDOW) {
      return { ok: false, reason: 'repeat_loop', detail: `chose the identical action ${repeats}x in a row` }
    }

    this.recent.push(key)
    if (this.recent.length > REPEAT_WINDOW * 2) this.recent.shift()
    return { ok: true, skill, args }
  }
}

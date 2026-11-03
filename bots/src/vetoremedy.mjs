// VETO REMEDY (idlegap, OWNER 11-03 item 6 "measure bot busy time", then cut the 54% "between").
//
// MEASURED (canary host, llm-<bot>.jsonl + skill-<bot>.jsonl, full walks, lib/busytime.classify; 80 bots, fleet 53fd28ee,
// 11-03 19:45-20:45Z = 80.0 bot-h observed): between 43.3% of bot-time (34.6 bot-h). Attributed to the decision BEFORE each
// gap, 62% of it follows a VETO: 4,487 of 7,834 model calls (57%) were refused by the admission gate, and every refusal costs
// ~2.2 s of model time plus the whole 15.5 s cooldown with nothing done. The 6 h before the 15 s promotion (480 bot-h, 30 s
// cooldown) has the same shape (between 52.5%, vetoes ~58% of it).
//
// THE BIGGEST CLUSTER IS ONE RUNG. On `return` ("Return home with what you gathered", hint "use the home skill") the model
// asks for `goto <home at the surface>` from underground and the gate refuses it (unreachable_elevation: "y=75 is 42 blocks
// ABOVE your y=33 -- you cannot climb that in one move"), or names a kept item to deposit (deposit_nothing_to_bank), every
// ~17 s for as long as the bot stays there. 24 h (11-02 19:00 - 11-03 19:00): 382 of ~1,920 bot-h on `return`, 33,201 model
// calls on it, 81% vetoed (goto 20,740, deposit 6,206); `home` was proposed 907 times fleet-wide. In the measured hour the
// vetoes on `return` hold 9.0 of the 34.5 between-hours (26%). The second is `deposit_surplus`: the model names ONE kept item
// (apple, the last iron pickaxe, the last iron axe) while bankable surplus exists -- 1.9 between-hours.
//
// THE RULE. Right after a MODEL proposal is vetoed on an idle tick, the remedy the refusal implies is queued as a work order
// for the very next tick (~250 ms later) instead of waiting out the cooldown and asking the model again:
//
//   return_home   on the `return` rung, any vetoed proposal other than `home` -> `home` (the rung's own skill; it climbs out
//                 via `surface` when it is stranded below sea level, skills.mjs home)
//   deposit_all   on the `deposit_surplus` rung, a NAMED deposit refused as nothing-to-bank / item-missing -> `deposit` with no
//                 item (everything bankable: the rung's fulfilled() is bankable < 4, so while it is current there is surplus)
//
// WHAT IT NEVER DOES. It never starts a skill itself and never admits anything: the remedy is an ORDER, so admission.check()
// still judges it, the runner still runs it, and its outcome still lands in every handler. It never replaces an ADMITTED model
// decision, a work order, or a reflex: only a model veto arms it, the order chain of the next tick runs first (any order wins),
// and the keep-out / sky-descend exits still override it. It never acts on a non-idle trigger (a death, a reflex handoff,
// startup reach the model). It never queues a remedy the gate's memory already refuses (cooldown / learned_avoid / repeat_loop),
// and a remedy is used once and expires after REMEDY_TTL_MS or when the rung changes. It cannot spin: one remedy per veto, and
// a veto needs a model call, so remedies come at most at today's model cadence -- and every remedy replaces the model call the
// cooldown would have made, so model calls/min can only fall.
//
// Switches: VETOREMEDY=0 turns it off; VETOREMEDY_RULES=return_home,deposit_all picks the rules.

export const REMEDY_RULES = Object.freeze(['return_home', 'deposit_all'])
export const REMEDY_TTL_MS = 5_000
export const REMEDY_DELAY_MS = 250
// THE EXPOSURE BUDGET (Codex design: `home` succeeds 347 of 912 times and a failed climb is exposure): one remedy of a rule per
// REMEDY_MIN_GAP_MS and at most REMEDY_MAX_PER_HOUR per rule, whatever the gate's memory says. The vetoes in between take the
// old path (cooldown, then the model).
export const REMEDY_MIN_GAP_MS = 45_000
export const REMEDY_MAX_PER_HOUR = 20

const off = v => v === '0' || v === 'false' || v === 'off'

/** The switches, read once from the environment. Unset = on, both rules. */
export function vetoRemedyConfig (env = process.env) {
  const rules = env.VETOREMEDY_RULES
  return {
    on: !off(env.VETOREMEDY),
    rules: new Set(rules ? rules.split(',').map(s => s.trim()).filter(Boolean) : REMEDY_RULES),
    ttlMs: REMEDY_TTL_MS,
    delayMs: REMEDY_DELAY_MS,
    minGapMs: REMEDY_MIN_GAP_MS,
    maxPerHour: REMEDY_MAX_PER_HOUR,
  }
}

/** PURE. The budget: may `rule` be used at `now`, given `history` = [{ rule, at }] of remedies already queued? */
export function remedyBudgetOk ({ cfg, rule, history, now }) {
  const mine = (history ?? []).filter(h => h?.rule === rule && now - h.at < 3_600_000)
  if (mine.length >= (cfg?.maxPerHour ?? REMEDY_MAX_PER_HOUR)) return false
  return !mine.some(h => now - h.at < (cfg?.minGapMs ?? REMEDY_MIN_GAP_MS))
}

/** The rung family: `return#1232` -> `return`. A prerequisite override (`return#1232+prereq`) is NOT the rung: the prerequisite
 *  is the task then, so it maps to null and no rule applies. */
export function rungOf (milestoneId) {
  const m = /^([a-z_]+)(#\d+)?$/.exec(String(milestoneId ?? ''))
  return m ? m[1] : null
}

const NAMED_DEPOSIT_VETOES = new Set(['deposit_nothing_to_bank', 'deposit_item_missing'])
const WILDCARD = new Set(['', 'none', 'null', 'any', 'all', 'everything', 'items', 'inventory', 'undefined'])

/**
 * PURE. A vetoed model proposal -> the remedy order { skill, args, why, rule, remedy: true } or null.
 * `memoryRefuses(skill, args)` is the admission gate's read-only memory check (admission.mjs); a remedy it refuses is not
 * queued (the model, or the next remedy, takes the turn instead of a refused order).
 */
export function vetoRemedy ({ cfg, trigger, milestoneId, proposal, rejection, fromOrder = false, memoryRefuses, history = [], now = Date.now() }) {
  if (!cfg?.on || fromOrder || trigger !== 'idle' || !rejection?.reason || !proposal?.skill) return null
  const rung = rungOf(milestoneId)
  let out = null
  if (rung === 'return' && cfg.rules?.has('return_home') && proposal.skill !== 'home') {
    out = { skill: 'home', args: {}, rule: 'return_home' }
  } else if (rung === 'deposit_surplus' && cfg.rules?.has('deposit_all') && proposal.skill === 'deposit' &&
             NAMED_DEPOSIT_VETOES.has(rejection.reason) && !WILDCARD.has(String(proposal.args?.item ?? '').trim().toLowerCase())) {
    out = { skill: 'deposit', args: {}, rule: 'deposit_all' }
  }
  if (!out) return null
  if (!remedyBudgetOk({ cfg, rule: out.rule, history, now })) return null
  let refused = 'unknown'
  try { refused = memoryRefuses?.(out.skill, out.args) ?? null } catch { refused = 'unknown' }
  if (refused) return null
  return { ...out, remedy: true,
           why: `veto remedy ${out.rule}: the model's ${proposal.skill} was refused (${rejection.reason}); the ${rung} rung's own ${out.skill} instead of waiting out the cooldown` }
}

/** PURE. At the next tick: the queued remedy if it is still valid (idle trigger, same rung, inside its TTL), else null. */
export function takeRemedy ({ cfg, pending, trigger, milestoneId, now }) {
  if (!cfg?.on || !pending?.order || trigger !== 'idle') return null
  if (!(now - (pending.at ?? -Infinity) <= (cfg.ttlMs ?? REMEDY_TTL_MS))) return null
  if (pending.milestoneId !== milestoneId) return null
  return pending.order
}

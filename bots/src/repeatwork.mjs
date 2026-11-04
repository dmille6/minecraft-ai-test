// REPEATWORK-01 (idlegap design 2026-11-03 piece 2; owner overnight grant 11-04): THE REPEAT WINDOW DOES NOT REFUSE WORK THAT
// IS WORKING.
//
// The oscillation guard (admission.mjs: 4 identical admitted keys in the last 8 -> repeat_loop) counts keys, not outcomes, so
// a gather that gained the rung's own item every time is refused exactly like a goto that never arrived. Measured
// post-cooldown15-02 (11-03 19:30 - 11-04 04:00Z, 80 bots, 680 bot-h, full walks of llm-<bot>.jsonl): 3,222 repeat_loop
// vetoes on gather and 617 on mine left 33.4 between-hours; in 708 of the gather ones (22%) and 95 of the mine ones (15%) the
// same key's previous run, on the same rung, had succeeded with a gain -- 6.6 bot-h, ~19 bot-h a day; 656 of the 708 gather
// ones on a rung with a target (gather_dirt_16 500, stockpile_wood 115, gather_iron_ore_3 36, ...). Requiring three such
// runs in a row (the design's first draft) catches 7.8% / 0.6%: the window refuses a gather that keeps working long before
// three of its runs are back to back.
//
// THE RULE: a GATHER whose LAST run of the same key, admitted on the same rung id while that rung had a target, met its
// contract AND gained an item the rung wants (the cognitive layer's `valuable` verdict -> AdmissionControl.noteSuccess) is
// not refused by the window. Any other outcome since -- a failure, an unknown, a success that gained nothing wanted, a run
// whose outcome never came back -- and the window refuses it as before. The rung changing (its id carries #N) resets it.
// NOT MINE: mine's contract is inventory_gain OR position, so its `valuable` includes "descended 2+ blocks" -- the gate
// cannot tell a wanted gain from a dig-down / climb-up yo-yo, which is what the window exists to stop (mine was 0.7 of the
// 6.6 bot-h). NOT A RUNG WITHOUT A TARGET (idle, patrol, return): there any gain is `valuable`. Explore and everything else
// are unchanged: no progress signal here (the design excludes explore until it has a visited-cell one).
//
// memoryRefuses() and check() decide through repeatDecision, so an order asking "would the gate refuse this?" gets the same
// answer the model does. REPEATWORK=0 turns the rule off (the window is then exactly the old one).

export function repeatWorkConfig (env = process.env) {
  return { on: String(env.REPEATWORK ?? '1') !== '0' }
}

/** The skills whose runs carry a progress verdict the window can trust (gather's contract is inventory_gain alone). */
export const PROGRESS_SKILLS = new Set(['gather'])

/**
 * THE WINDOW'S DECISION, pure. -> { refuse, why: null | 'repeat_loop' | 'progress' }.
 * `repeats` = this key's entries in the window; `last` = the key's last run ({ gain, milestoneId, targeted }) or undefined.
 */
export function repeatDecision ({ cfg, skill, repeats, window, last, milestoneId }) {
  if (!(repeats >= window)) return { refuse: false, why: null }
  if (cfg?.on && PROGRESS_SKILLS.has(skill) && last?.gain === true && last.targeted === true && milestoneId != null && last.milestoneId === milestoneId) {
    return { refuse: false, why: 'progress' }
  }
  return { refuse: true, why: 'repeat_loop' }
}

/** The per-key run ledger, bounded (oldest key out first). Map insertion order = recency. */
export const LEDGER_MAX = 64
export function ledgerSet (ledger, key, entry) {
  ledger.delete(key)
  ledger.set(key, entry)
  while (ledger.size > LEDGER_MAX) ledger.delete(ledger.keys().next().value)
  return ledger
}

/** One repeatwork_tally row per bot per 10 min: the canary read's own line (counts since the last row). */
export const TALLY_MS = 10 * 60 * 1000
export function tallyLine ({ secs, c }) {
  const g = k => c[k] ?? 0
  const checks = g('checks')
  return `secs=${Math.round(secs)} checks=${checks} checks_per_min=${secs > 0 ? (checks * 60 / secs).toFixed(2) : '0'} ` +
    `refused=${g('refused')} refusals_per_check=${checks > 0 ? (g('refused') / checks).toFixed(3) : '0'} admitted=${g('admitted')} ` +
    `admitted_per_bot_h=${secs > 0 ? (g('admitted') * 3600 / secs).toFixed(1) : '0'} repeat_refused=${g('repeat_refused')} ` +
    `progress_admits=${g('progress_admits')} gains=${g('gains')} fails=${g('fails')}`
}

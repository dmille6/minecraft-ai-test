// THE RUNNER DECLINED: ONE SET (homefix-01, docs/reports/expansion-plan-2026-10-19.md §2 "The H2 fix", item 2).
//
// A declined run never started a skill, so it is not evidence about the skill, the world or the remedy: no handler may
// back off on it, no cooldown may be charged, no latch may close and no lesson may be written. Until homefix-01 five
// separately named copies of this set decided that (composter RUNNER_DECLINED, milestones RUNNER_REFUSALS, toolkit and
// recount private sets, towndeposit TD_RUNNER_DECLINED), and a new decline class would have had to be added to each by
// hand -- the shape in which one is always missed. Every one of them now imports THIS set.
//
//   runner_paused    the runner is in its repeated-failure pause
//   runner_busy      a skill is running
//   body_held        a reflex holds the body (arbiter)
//   runner_reserved  the watchdog reserved the runner for its rescue (Runner.reserve; <= 20 s): "not now"
//   reserve_expired  (the reserving owner only) the reservation ran out with the old skill still unwinding

export const RUNNER_DECLINED = new Set(['runner_paused', 'runner_busy', 'body_held', 'runner_reserved', 'reserve_expired'])

/** Did the runner decline this run (it never started)? Accepts a result object or a bare fail class. Pure. */
export function runnerDeclined (r) {
  const fc = typeof r === 'string' ? r : r?.failClass
  return fc != null && RUNNER_DECLINED.has(fc)
}

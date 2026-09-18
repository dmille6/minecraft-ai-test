// owner.mjs, pure: episodes, rung order and skipping, budgets, closing predicates, holds, evidence exits, the strategy latch.
import assert from 'node:assert/strict'
import { newEpisode, rungsFor, nextRung, recordRung, closeEpisode, holdReason, safeHoldExit, mayOpen, transition, EPISODE_DEADLINE_MS, LADDER_BLOCK_RESERVE, BLOCK_BUDGET_EXTRA, BUDGET_OVERRUN } from '../src/owner.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const AT = { x: 100, y: 40, z: 100 }
t('rung order per class mirrors the arms: entombed pillar->stair->underfoot, marooned adjacent first, ladder walk->dig; an unknown class throws', () => {
  assert.deepEqual(rungsFor('entombed'), ['pillar', 'stair', 'underfoot']); assert.deepEqual(rungsFor('marooned'), ['adjacent', 'pillar', 'stair', 'underfoot']); assert.deepEqual(rungsFor('ladder'), ['walk', 'dig'])
  assert.throws(() => newEpisode({ cls: 'swim', at: AT }), /unknown recovery class/)
})
t('a new episode has one deadline and a block budget of need + 2, and starts in ASSESS', () => {
  const e = newEpisode({ cls: 'entombed', at: AT, now: 1000, blocks: 10, climbNeed: 5 })
  assert.equal(e.deadline, 1000 + EPISODE_DEADLINE_MS); assert.equal(e.blockBudget, 5 + BLOCK_BUDGET_EXTRA); assert.equal(e.state, 'ASSESS'); assert.equal(e.tried.length, 0)
  assert.throws(() => { e.state = 'WORK' }, /read only|Cannot assign/, 'episodes are immutable')
})
t('nextRung skips a refused, failed or exhausted rung but retries a preempted one, and refuses pillar/dig without the blocks', () => {
  let e = newEpisode({ cls: 'entombed', at: AT, now: 0, blocks: 3, climbNeed: 5 })
  // The pre-gate is a FLOOR, not the climb test: the rung re-measures the need when it runs and judges it against
  // what the bot holds. Gating here on the frozen budget refused climbs the bot could afford (owner-01b, 18 Sep).
  assert.equal(nextRung(e, { blocks: 3, climbNeed: 5, tool: true }, 1).rung, 'stair', 'pillar needs 7, 3 held: skipped to the stair')
  assert.equal(nextRung(e, { blocks: 9, climbNeed: 5, tool: true }, 1).rung, 'pillar')
  e = recordRung(e, { rung: 'pillar', outcome: 'preempted' }); assert.equal(nextRung(e, { blocks: 9 }, 2).rung, 'pillar'); assert.match(nextRung(e, { blocks: 9 }, 2).reason, /after preemption/)
  e = recordRung(e, { rung: 'pillar', outcome: 'failed', blocksSpent: 4 }); assert.equal(e.blocksSpent, 4)
  assert.equal(nextRung(e, { blocks: 9, tool: true }, 3).rung, 'stair'); assert.equal(nextRung(e, { blocks: 9, tool: false }, 3).rung, 'stair', 'a bare-hand ramp is legal (the legacy arm cuts stone by hand); the rung itself decides')
  e = recordRung(e, { rung: 'stair', outcome: 'refused' }); e = recordRung(e, { rung: 'underfoot', outcome: 'exhausted' })
  assert.equal(nextRung(e, { blocks: 9, tool: true }, 4), null, 'every rung spent')
  const l = newEpisode({ cls: 'ladder', at: AT, now: 0 })
  assert.equal(nextRung(recordRung(l, { rung: 'walk', outcome: 'failed' }), { blocks: LADDER_BLOCK_RESERVE - 1 }, 1), null, 'the dig leg keeps its reserve')
  assert.equal(nextRung(recordRung(l, { rung: 'walk', outcome: 'failed' }), { blocks: LADDER_BLOCK_RESERVE }, 1).rung, 'dig')
})
t('past the deadline nothing runs and the hold reason is deadline; with rungs left it is runnable; all spent is exhausted', () => {
  const e = newEpisode({ cls: 'marooned', at: AT, now: 0, blocks: 20, climbNeed: 2 })
  assert.equal(nextRung(e, { blocks: 20 }, EPISODE_DEADLINE_MS), null); assert.equal(holdReason(e, { blocks: 20 }, EPISODE_DEADLINE_MS), 'deadline')
  assert.equal(holdReason(e, { blocks: 20 }, 1), 'runnable')
  let x = e; for (const r of rungsFor('marooned')) x = recordRung(x, { rung: r, outcome: 'failed' })
  assert.equal(holdReason(x, { blocks: 20 }, 1), 'exhausted')
  const y = recordRung(recordRung(e, { rung: 'adjacent', outcome: 'refused' }), { rung: 'underfoot', outcome: 'refused' })
  const z = recordRung(y, { rung: 'stair', outcome: 'refused' })
  assert.equal(holdReason(z, { blocks: 0 }, 1), 'no_rung', 'pillar is untried but unrunnable now (no blocks): a different hold from exhaustion')
  assert.equal(holdReason(z, { blocks: 20 }, 1), 'runnable', 'and it becomes runnable when the blocks arrive')
})
t('closeEpisode needs the shared postcondition AND the class predicate; a rise into a still-entombed cell does not close', () => {
  const before = { x: 0, y: 40, z: 0, wet: false }
  const up5 = { x: 0, y: 45, z: 0, wet: false }
  const ent = newEpisode({ cls: 'entombed', at: AT })
  assert.equal(closeEpisode(ent, before, up5, { entombed: false, supported: true }).closed, true)
  assert.equal(closeEpisode(ent, before, up5, { entombed: true, supported: true }).closed, false, 'rose 5 but still entombed')
  assert.equal(closeEpisode(ent, before, up5, { entombed: false, supported: false }).closed, false, 'not standing')
  assert.equal(closeEpisode(ent, before, { x: 2, y: 41, z: 0, wet: false }, { entombed: false, supported: true }).closed, false, 'free but did not relocate')
  const mar = newEpisode({ cls: 'marooned', at: AT })
  assert.equal(closeEpisode(mar, before, { x: 9, y: 40, z: 0, wet: false }, { canStartPath: true }).closed, true)
  assert.equal(closeEpisode(mar, before, { x: 9, y: 40, z: 0, wet: false }, { canStartPath: false }).closed, false, 'moved 9 but no path')
  assert.equal(closeEpisode(newEpisode({ cls: 'ladder', at: AT }), before, { x: 9, y: 40, z: 0, wet: true }, {}).closed, false, 'wet is not an escape')
})
t('SAFE-HOLD exits on any evidence kind and on nothing else', () => {
  assert.equal(safeHoldExit({ reason: 'exhausted' }, {}).exit, false)
  for (const k of ['displaced', 'inventoryChanged', 'blockChangedNearby', 'pathStartable', 'newRequest']) assert.equal(safeHoldExit({ reason: 'exhausted' }, { [k]: true }).exit, true, k)
  assert.equal(safeHoldExit({ reason: 'x' }, { displaced: true, newRequest: true }).why, 'displaced+newRequest')
})
t('exhaustion latches the unchanged strategy for an hour, never the machine: a new class opens, and displacement re-opens', () => {
  const h = [1, 2, 3].map(i => ({ cls: 'entombed', strategy: 'pillar', at: 1000 * i, pos: { x: 0, y: 40, z: 0 } }))
  assert.equal(mayOpen({ cls: 'entombed', strategy: 'pillar', pos: { x: 1, y: 40, z: 0 }, now: 5000, history: h }).open, false)
  assert.equal(mayOpen({ cls: 'marooned', strategy: 'pillar', pos: { x: 1, y: 40, z: 0 }, now: 5000, history: h }).open, true, 'another class')
  assert.equal(mayOpen({ cls: 'entombed', strategy: 'stair', pos: { x: 1, y: 40, z: 0 }, now: 5000, history: h }).open, true, 'another strategy')
  assert.equal(mayOpen({ cls: 'entombed', strategy: 'pillar', pos: { x: 20, y: 40, z: 0 }, now: 5000, history: h }).open, true, 'displaced 20 blocks')
  assert.equal(mayOpen({ cls: 'entombed', strategy: 'pillar', pos: { x: 1, y: 40, z: 0 }, now: 5000 + 3_600_000, history: h }).open, true, 'an hour later')
})
t('transitions are records with a reason, and only between named states', () => {
  const tr = transition('ASSESS', 'ESCAPE', { reason: 'entombed detected', budget: { deadlineMs: 1000 } })
  assert.equal(tr.reason, 'entombed detected'); assert.throws(() => transition('ASSESS', 'FLY', { reason: 'x' }), /bad transition/)
})
t('REGRESSION (owner-01b): the gate uses the LIVE climb need, not the budget frozen at assess', () => {
  // The episode opened when the need was 6, so its budget is 8. The need is now 14 and the bot holds 40.
  // The old code compared 14+2 against the remaining budget of 8 and refused a climb the bot could easily afford.
  const e = newEpisode({ cls: 'entombed', at: AT, now: 0, blocks: 40, climbNeed: 6 })
  assert.equal(e.blockBudget, 8)
  assert.equal(nextRung(e, { blocks: 40, climbNeed: 14 }, 1).rung, 'pillar', 'affordable against the live need')
  assert.equal(nextRung(e, { blocks: 9, climbNeed: 14 }, 1).rung, 'stair', 'genuinely short: 9 < 16')
})
t('the block gate does not latch: a needs_blocks refusal is re-gated from live facts, not skipped for the episode', () => {
  let e = newEpisode({ cls: 'entombed', at: AT, now: 0, blocks: 4, climbNeed: 12 })
  e = recordRung(e, { rung: 'pillar', outcome: 'refused', why: 'needs_blocks' })
  assert.equal(nextRung(e, { blocks: 4, climbNeed: 12 }, 1).rung, 'stair', 'still cannot afford it')
  assert.equal(nextRung(e, { blocks: 40, climbNeed: 12 }, 2).rung, 'pillar', 'the live facts changed')
  assert.equal(nextRung(e, { blocks: 40, climbNeed: 2 }, 2).rung, 'pillar', 'a SHRINKING need re-admits it too')
})
t('a refusal that is NOT about blocks stays final however much the bot gathers', () => {
  let e = newEpisode({ cls: 'entombed', at: AT, now: 0, blocks: 4, climbNeed: 2 })
  e = recordRung(e, { rung: 'pillar', outcome: 'refused', why: 'needs_pickaxe' })
  assert.equal(nextRung(e, { blocks: 400, climbNeed: 2 }, 1).rung, 'stair', 'a pickaxe is not dirt')
})
t('the block budget is a REAL spend cap: past it pillar is skipped as over_budget, whatever the bot holds', () => {
  let e = newEpisode({ cls: 'entombed', at: AT, now: 0, blocks: 400, climbNeed: 6 })
  const cap = Math.max(e.blockBudget, 6 + BLOCK_BUDGET_EXTRA) * BUDGET_OVERRUN
  e = recordRung(e, { rung: 'pillar', outcome: 'ran', blocksSpent: cap })
  const skipped = []
  assert.equal(nextRung(e, { blocks: 400, climbNeed: 6, skipped }, 1)?.rung, 'stair')
  assert.match(skipped.find(x => x.rung === 'pillar').why, /over_budget/, 'the cap is enforced, which it never was before')
})
t('THE LADDER STANDS DOWN FOR THE AIR REFLEX, and only for it', () => {
  // owner-01b, 18 Sep: hive-a-Bravo drowned at a recorded drowning site while the owner held the body at escape
  // priority and the air reflex preempted every pillar. The canary was reverted on that death.
  const e = newEpisode({ cls: 'entombed', at: AT, now: 0, blocks: 40, climbNeed: 3 })
  assert.equal(nextRung(e, { blocks: 40, climbNeed: 3, airOwns: true }, 1), null, 'the air reflex holds the body')
  assert.equal(nextRung(e, { blocks: 40, climbNeed: 3, headUnderwater: true }, 1), null, 'only the air reflex can help here')
  assert.equal(holdReason(e, { blocks: 40, climbNeed: 3, airOwns: true }, 1), 'air')
  assert.equal(nextRung(e, { blocks: 40, climbNeed: 3, airOwns: false, headUnderwater: false }, 1).rung, 'pillar')
})
t('NO DEAD ZONE: wet feet with a breathing head is not the air reflex\'s business, and the bot still climbs out', () => {
  // The first version of this gate keyed on isInWater. A bot walled in with one block of water at its feet, head in
  // air and full oxygen, is not an air emergency -- assessAir declines it -- so that gate left it with no rung and
  // no reflex. Two correct guards meeting where the bot has no legal move is this project's oldest bug class.
  const e = newEpisode({ cls: 'entombed', at: AT, now: 0, blocks: 40, climbNeed: 3 })
  const wetFeet = { blocks: 40, climbNeed: 3, wet: true, airOwns: false, headUnderwater: false }
  assert.equal(nextRung(e, wetFeet, 1).rung, 'pillar', 'standing in water is not drowning')
  assert.equal(holdReason(e, wetFeet, 1), 'runnable')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)

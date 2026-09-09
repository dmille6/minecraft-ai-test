// 68% OF EVERY PICKAXE THE FLEET HAS EVER LOST WAS DESTROYED ESCAPING.
//
// Counted 2026-09-05 over every archive, plain and rotated, denominator first:
// 11,202 pickaxe gains against 8,803 losses. Of the losses, 5,951 (68%) came
// during escape activity, 2,551 (29%) are unexplained, 246 (3%) were deposited,
// and 55 (1%) were dropped on death. Mean health at the moment of loss: 20.0 of
// 20, minimum 19. Nothing was killing these bots. They were grinding their own
// tools to dust digging themselves out of holes.
//
// The escape routines break blocks to make a HOLE. `harvestUnderfoot` returns
// `fell`; `pillarOut` measures the rise. Neither reads the drop. So the pickaxe
// was buying nothing either of them needed.
//
// The fix is NOT "never equip". Bare hands are slower, and some blocks really
// do need a tool -- and this repo's named bug class is a new guard leaving a
// bot with no legal move. So it is a PREFERENCE with a fallback, and these
// tests pin both halves: the tool comes off for the common case, and comes back
// when the registry says bare-handed cannot finish.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import { digHand, planDig, MIN_DIG_MS, MAX_DIG_MS } from '../src/digbudget.mjs'

test('POSITIVE CONTROL: the decision can return all three answers', () => {
  // Without this every assertion below could pass because it always said 'bare'.
  assert.equal(digHand({ bareMs: 500, toolMs: 100 }).hand, 'bare')
  assert.equal(digHand({ bareMs: MAX_DIG_MS + 1, toolMs: 500 }).hand, 'tool')
  assert.equal(digHand({ bareMs: MAX_DIG_MS + 1, toolMs: MAX_DIG_MS + 1 }).hand, null)
})

test('THE COMMON CASE: cobble the bot placed itself is dug bare-handed', () => {
  // A marooned bot stands on its own pillar. Cobblestone bare-handed is ~10s,
  // with a stone pickaxe ~0.4s. The tool is faster and irrelevant: the routine
  // wants the cell empty, and 5,951 pickaxes went into buying that speed.
  const d = digHand({ bareMs: 10_000, toolMs: 400 })
  assert.equal(d.hand, 'bare')
  assert.equal(d.refuse, false)
  assert.ok(d.budgetMs >= 10_000, 'a bare-handed budget must cover a bare-handed dig')
})

test('THE BUDGET FOLLOWS THE HAND', () => {
  // Dropping the tool while keeping the tooled deadline just converts the
  // durability saving into `dig exceeded 6000ms` -- 145 such failures were
  // recorded at the old fixed budget. The budget must be priced for the hand
  // that actually swings.
  const bare = digHand({ bareMs: 10_000, toolMs: 400 })
  const tooled = digHand({ bareMs: MAX_DIG_MS + 1, toolMs: 10_000 })
  assert.deepEqual({ hand: bare.hand, b: bare.budgetMs },
                   { hand: 'bare', b: planDig(10_000).budgetMs })
  assert.deepEqual({ hand: tooled.hand, b: tooled.budgetMs },
                   { hand: 'tool', b: planDig(10_000).budgetMs })
})

test('THE FALLBACK: a block bare hands cannot finish still gets the tool', () => {
  // Deepslate is ~99s bare-handed and well past MAX_DIG_MS. Refusing outright
  // would take away a descent the bot can currently make. That is the bug class
  // this repo keeps rebuilding, so the pickaxe comes back for exactly these.
  const d = digHand({ bareMs: 99_000, toolMs: 2_000 })
  assert.equal(d.hand, 'tool')
  assert.equal(d.refuse, false)
})

test('...and only then — a tool is never equipped for a block bare hands can break', () => {
  // Property: across the whole band the registry can report, the tool is
  // reached for ONLY when the bare-handed swing is itself refused.
  for (let bareMs = 100; bareMs <= 60_000; bareMs += 100) {
    const d = digHand({ bareMs, toolMs: 100 })
    const bareRefused = planDig(bareMs).refuse
    assert.equal(d.hand === 'tool', bareRefused,
      `bareMs=${bareMs}: tool used=${d.hand === 'tool'} but bare refused=${bareRefused}`)
  }
})

test('BOTH TOO SLOW IS A REFUSAL, not a silent skip', () => {
  const d = digHand({ bareMs: 99_000, toolMs: 99_000 })
  assert.equal(d.hand, null)
  assert.equal(d.refuse, true)
  assert.equal(d.budgetMs, 0)
})

test('UNKNOWN IS NOT HOPELESS — it inherits planDig’s try-it rule', () => {
  // Test fakes, modded blocks and registry gaps all land here. `planDig`
  // already decided that a missing lookup means try it with the floor budget,
  // and this must not quietly invent a stricter rule on top of it.
  for (const bareMs of [null, undefined, NaN, 0, -1]) {
    const d = digHand({ bareMs, toolMs: 400 })
    assert.equal(d.hand, 'bare', `bareMs=${bareMs} must still swing bare-handed`)
    assert.equal(d.budgetMs, MIN_DIG_MS)
  }
  assert.equal(digHand().hand, 'bare', 'no arguments at all must not refuse')
})

// Same shape as `withMutant` in climb-escape.test.mjs, which CLAUDE.md says to
// reuse: assert the anchor is present AND unique, write the mutant to a TEMP
// file under test/ (never into src/ — the runner SIGKILLs, and an in-place
// mutant survives on disk and fleet-recycle deploys it within six hours).
async function withMutant (url, old, neu, fn) {
  const src = fs.readFileSync(url, 'utf8')
  assert.ok(src.includes(old), 'MUTANT ANCHOR MISSING: it was never written, which reads as killed')
  assert.strictEqual(src.split(old).length, 2, 'MUTANT ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`,
                      import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

test('MUTANT: preferring the tool again must be caught', async () => {
  // The regression this guards is the code that was there until today: reach
  // for `bestTool` first and equip it whenever one exists.
  await withMutant(new URL('../src/digbudget.mjs', import.meta.url),
    "  const bare = planDig(bareMs)\n  if (!bare.refuse) return { hand: 'bare', budgetMs: bare.budgetMs, refuse: false }",
    "  const bare = planDig(bareMs)\n  { const t = planDig(toolMs); if (!t.refuse) return { hand: 'tool', budgetMs: t.budgetMs, refuse: false } }",
    async mut => {
      assert.equal(mut.digHand({ bareMs: 10_000, toolMs: 400 }).hand, 'tool',
        'the mutant must actually change behaviour, or it proves nothing')
      assert.equal(digHand({ bareMs: 10_000, toolMs: 400 }).hand, 'bare',
        'and the real module must still choose bare hands for cobble')
    })
})

// ---------------------------------------------------------------------------
// AND IT HAS TO BE WIRED IN. Four times this week a fix was correct, tested,
// deployed and never routed to. A pure function nobody calls saves no pickaxes.
//
// Source assertions, because behaviour cannot reach "which module-level call
// site exists". Comments are stripped first: this codebase quotes the code it
// explains, so a naive grep matches the prose rather than the executable line.

test('the two escape routines actually use it', () => {
  const raw = fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  assert.ok(code.includes('async function harvestUnderfoot'),
    'POSITIVE CONTROL: the stripper left the executable text intact')
  assert.match(code, /import \{[^}]*digHand[^}]*\} from '\.\/digbudget\.mjs'/,
    'digHand must be imported, not just written')

  // `harvestUnderfoot` CHOOSES A HAND THROUGH `escapeDigPlan` NOW, and that is
  // the fix, not a weakening. It called `digHand` on the situational prediction
  // and let its `refuse` be terminal -- the one usage `digEnv`'s docstring
  // forbids -- which told placebo-b-Comet for four days that the tuff_bricks
  // under its feet (hardness 1.5, same as stone) could not be broken. The hand
  // choice still happens, inside `escapeDigPlan`, still on the real numbers.
  for (const [name, start, chooser] of [
    ['harvestUnderfoot', 'async function harvestUnderfoot', /escapeDigPlan\(\{/],
    ['pillarOut', 'async function pillarOut', /digHand\(\{/]]) {
    const i = code.indexOf(start)
    assert.ok(i > 0, `POSITIVE CONTROL: ${name} is still there`)
    const body = code.slice(i, i + 2600)
    assert.match(body, chooser, `${name} must decide the hand, not assume the tool`)
    assert.doesNotMatch(body, /const tool = bestTool\(bot, \w+\)\n\s*if \(tool\) await bot\.equip/,
      `${name} equips a tool unconditionally again — that is the 5,951 pickaxes`)
  }

  // AND THE REFUSAL MUST NOT COME BACK ONTO THE SITUATIONAL NUMBER. This is the
  // whole Comet defect: a 5x `notOnGround` penalty deciding whether a block is
  // breakable AT ALL, rather than how long the swing gets.
  const uf = code.slice(code.indexOf('async function harvestUnderfoot'))
    .slice(0, 2600)
  assert.doesNotMatch(uf, /\bdigHand\(\{/,
    'harvestUnderfoot must not veto on digHand again — that is the tuff_bricks refusal')
  const call = uf.match(/escapeDigPlan\(\{[\s\S]*?\n  \}\)/)
  assert.ok(call, 'POSITIVE CONTROL: the escapeDigPlan call site is readable')
  assert.match(call[0], /bareHardnessMs: predictedDigMs\(target, null\)/,
    'the REFUSAL must be priced on the grounded prediction')
  assert.match(call[0], /bareActualMs: predictedDigMs\(target, null, env\)/,
    'the DEADLINE must be priced on the real one')
})

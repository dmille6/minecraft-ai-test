// THE KIT'S CONSUMER TRIPWIRE (kitshrink-01; Claude design review r1 P2-4 / r2 P2-2): every EXECUTABLE line of bots/src that
// names a torch or a ladder as a quoted string, classified one site at a time. kitshrink banks torches and ladders (below
// the escape minimum) at the town deposit, so a NEW consumer of either -- treefarm-02 places growth torches "only those
// carried"; shaft-01's builder places ladders at the collar -- would be starved silently. The test compares the sites
// against an allowlist of (file, line) pairs, each with its reason, so a new site fails until someone decides: give the
// consumer a withdraw path, or keep the item in kitshrink.mjs. Shared by kitshrink.test.mjs (the scan and its mutant).
// LIMITS (Claude code review r1): it sees QUOTED names only -- a regex literal (/^(torch|...)$/) or a bare property read
// (counts.torch) is not a site. treefarm-02 and shaft-01 are caught through their quoted sites. And it matches exact line
// text, so a reformat of an allowlisted line fails it too: then RECLASSIFY the line, no consumer is implied.
import { readFileSync, readdirSync } from 'node:fs'

/** Comments out, strings kept: block comments, then `//` outside a quoted string. Pure. */
export function stripComments (src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  return noBlock.split('\n').map(line => {
    let q = null
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) { if (c === '\\') { i++; continue } if (c === q) q = null; continue }
      if (c === '\'' || c === '"' || c === '`') { q = c; continue }
      if (c === '/' && line[i + 1] === '/') return line.slice(0, i)
    }
    return line
  }).join('\n')
}

export const KIT_SITE = /['"`](torch|ladder)['"`]/

/** [{ file, line }] -- every executable line naming a quoted 'torch' or 'ladder'. Pure over { file: source }. */
export function kitSites (sources) {
  const out = []
  for (const [file, src] of Object.entries(sources)) {
    for (const line of stripComments(src).split('\n')) if (KIT_SITE.test(line)) out.push({ file, line: line.trim() })
  }
  return out
}

export function srcFiles (dir) {
  const out = {}
  for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()) out[f] = readFileSync(new URL(f, dir), 'utf8')
  return out
}

/** THE ALLOWLIST: (file, exact executable line) -> why it is not a consumer the bank can starve. */
export const ALLOWED = Object.freeze([
  { file: 'kitshrink.mjs', line: "export const KIT_BANK = Object.freeze(['torch', 'ladder'])", why: 'the rule itself' },
  { file: 'kitshrink.mjs', line: "if (name === 'ladder' && !(Number(held) < LADDER_ESCAPE_MIN)) return 'escape_ladders'", why: 'the rule itself' },
  { file: 'reflex.mjs', line: "const have = bot.inventory.items().filter(it => it.name === 'ladder')", why: 'ladderReady: the escape counts ladders against ladderPlan (the rule keeps a bag at LADDER_ESCAPE_MIN whole)' },
  { file: 'ladder.mjs', line: "if (block.name === 'ladder') return true", why: 'a BLOCK read (a placed ladder in the column), not an item' },
  { file: 'ladder.mjs', line: "if (target?.name === 'ladder') { placed++; continue }", why: 'a BLOCK read (a rung already placed)' },
  { file: 'ladder.mjs', line: "if (bot.blockAt(cell)?.name !== 'ladder') {", why: 'a BLOCK read (the placement read back)' },
  { file: 'ladder.mjs', line: "const held = () => (bot.inventory?.items?.() ?? []).filter(i => i.name === 'ladder')", why: 'climbLadder: the escape routine, gated by ladderPlan (the rule keeps a usable stock)' },
  { file: 'ladder.mjs', line: "const item = held() > 0 ? (bot.inventory?.items?.() ?? []).find(i => i.name === 'ladder') : null", why: 'climbLadder: the escape routine (as above)' },
  { file: 'prompt.mjs', line: "'furnace', 'crafting_table', 'chest', 'ladder', 'torch', 'stick', 'oak_planks',", why: 'the model\'s craftable-targets list (advice, never a deterministic consumer)' },
  { file: 'skills.mjs', line: "'sapling', 'torch', 'button', 'carpet', 'pressure_plate', 'mushroom',", why: 'a block-shape name list (non-solid blocks), not an item use' },
])

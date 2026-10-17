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
  { file: 'cognitive.mjs', line: "const held = items.reduce((n, it) => n + (it?.name === 'torch' ? (it.count ?? 0) : 0), 0)", why: "treefarm-02: the farm's torch FETCH reads how many torches the bag holds (the shortfall it withdraws) -- the withdraw path itself" },
  { file: 'cognitive.mjs', line: "if (this.farmTorchIssued && admitted.skill === 'withdraw' && admitted.args?.item === 'torch') {", why: "treefarm-02: the torch fetch's outcome (its backoff) -- the withdraw path itself" },
  { file: 'skills.mjs', line: "if (a.role === 'torch') return idx.torch.has(`${x},${y},${z}`)", why: "treefarm-02: a farm cell's ROLE tag (onFarmPlan), not an item" },
  { file: 'skills.mjs', line: "else if (a.role === 'torch') f.torches++", why: "treefarm-02: counts a server-confirmed torch placement for the row (the consumer is tendPlan, below)" },
  { file: 'treefarm.mjs', line: "const cells = [...plots.map(p => ({ ...p, role: 'plot' })), ...torches.map(t => ({ ...t, role: 'torch' }))]", why: "treefarm-02: a farm cell's ROLE tag (the record), not an item" },
  { file: 'treefarm.mjs', line: "export const torchesOf = record => (record?.cells ?? []).filter(c => c.role === 'torch')", why: "treefarm-02: a ROLE read" },
  { file: 'treefarm.mjs', line: "if (b.name === 'torch') return 'done'", why: "treefarm-02: a BLOCK read (a torch already standing in its cell)" },
  { file: 'treefarm.mjs', line: "for (const t of torches) if (t.state === 'open' && (left.torch ?? 0) > 0) { actions.push({ kind: 'place', cell: t.cell, item: 'torch', role: 'torch' }); left.torch-- }", why: "treefarm-02: THE CONSUMER (places carried torches). DECIDED: given a WITHDRAW PATH -- treefarm.mjs farmTorchOrder takes the shortfall from the town chests at town, and withdraw holds it back from the next deposit for HOLD_MS (test: treefarm-compose LOOP CHAIN kitshrink x farm)" },
  { file: 'treefarm.mjs', line: "} else if (c.role === 'torch') {", why: "treefarm-02: a ROLE read (farmIndex)" },
  { file: 'treefarm.mjs', line: "if (idx.torch?.has(cellKey(x, y, z))) return item === 'torch' ? null : 'a tree-farm torch cell'", why: "treefarm-02: what a torch CELL may take (a placement rule for every placer), not a consumer" },
  { file: 'treefarm.mjs', line: "else if (c.role === 'torch') out.push({ x: c.x, z: c.z, r: FARM_TORCH_WELL_DISTANCE, what: 'a tree-farm torch' })", why: "treefarm-02: a ROLE read (the well's keep-out)" },
  { file: 'treefarm.mjs', line: "const rOf = q => (q.role === 'torch' ? Math.min(r, FARM_TORCH_WELL_DISTANCE) : r)", why: "treefarm-02: a ROLE read (farmYields)" },
  { file: 'treefarm.mjs', line: "else if (c.role === 'torch') out.push({ x: c.x, y: c.y, z: c.z, r: 0 }, { x: c.x, y: c.y - 1, z: c.z, r: 0 })", why: "treefarm-02: a ROLE read (farmKeepOut)" },
  { file: 'treefarm.mjs', line: "const args = { item: 'torch', count: short, town: true }", why: "treefarm-02: THE WITHDRAW PATH for the consumer above (the farm's torch fetch at town)" },
  { file: 'cognitive.mjs', line: "room: () => items.length < 36 || items.some(it => it?.name === 'torch' && (it.count ?? 0) < 64),", why: "treefarm-02: the torch fetch's room check (a bag that can take a torch) -- the withdraw path itself" },
])

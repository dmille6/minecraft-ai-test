// prompt_transform.mjs <bots-dir> <in.jsonl> <out.jsonl> -- rewrite logged replay items (m3-eval.jsonl shape) into the
// promptcache-01 prompt layout, using <bots-dir>'s OWN exported functions so the replay scores exactly what the bots
// would send:
//   - the system message's final identity line ("You are <bot>, ...") moves to the first line of the user message;
//   - RECENT EVENTS goes through prompt.mjs compactEvents() with the item's LAST ACTION;
//   - peer lessons ("... seen at ... reported by A and B", "A and B hit K Nx near ...") are re-rendered with
//     worldfacts.mjs seenLine()/hazardLine() (self = the item's bot).
// Everything else (sentinel, schema, other lines) is untouched. An item ALREADY in the promptcache layout (the fleet runs
// it since promptcache-01 was promoted on 11-01: the identity line opens the user message, the system has none) is
// passed through as logged -- it is what the bots sent (llpatrol-01 dry run 11-06: 2,638 of 9,000 good items from
// 11-01..11-03 were refused, which would have failed the 11-08 round's transform phase). Exits 1 if any item is in
// neither layout. Prints counts of what changed. Read-only apart from <out.jsonl>.
import fs from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/learnloop-pt-logs'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'transform'
const [botsDir, inPath, outPath] = process.argv.slice(2)
if (!outPath) { console.error('usage: prompt_transform.mjs <bots-dir> <in.jsonl> <out.jsonl>'); process.exit(2) }
const { compactEvents } = await import(botsDir + '/src/prompt.mjs')
const { seenLine, hazardLine } = await import(botsDir + '/src/worldfacts.mjs')

const SEEN = /^(\S+) seen at x=(-?\d+) y=(-?\d+) z=(-?\d+) \((\d+) blocks away, reported by (.+)\)$/
const HAZ = /^((?:\S+ and )*\S+) hit (\S+) (\d+)x near (-?\d+),(-?\d+),(-?\d+) — avoid it$/
const IDENT = /\n*(You are \S+, an autonomous \S+ agent in Minecraft\.)\s*$/
const IDENT_USER = /^You are \S+, an autonomous \S+ agent in Minecraft\.\n/
const IDENT_ANY = /You are \S+, an autonomous \S+ agent in Minecraft\./

export function transform (it) {
  const m = IDENT.exec(it.system)
  if (!m) {
    if (IDENT_USER.test(it.user) && !IDENT_ANY.test(it.system)) return { ...it, transform: 'promptcache-01 (as logged)' }
    return null
  }
  const system = it.system.slice(0, m.index)
  const lines = it.user.split('\n')
  const lastLine = lines.find(l => l.startsWith('LAST ACTION: '))
  const lastOutcome = lastLine ? lastLine.slice('LAST ACTION: '.length) : null
  const out = [m[1]]
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l === 'RECENT EVENTS (oldest first):') {
      const evs = []
      i++
      while (i < lines.length && lines[i].startsWith('  - ')) { evs.push(lines[i].slice(4)); i++ }
      const shown = compactEvents(evs, lastOutcome)
      if (shown.length) out.push(l, ...shown.map(t => `  - ${t}`))
      continue
    }
    if (l.startsWith('  - ')) {
      const body = l.slice(4)
      let s = SEEN.exec(body)
      if (s) { out.push('  - ' + seenLine({ kind: s[1], x: s[2], y: s[3], z: s[4], d: s[5], by: s[6].split(' and ') }, it.bot)); i++; continue }
      s = HAZ.exec(body)
      if (s) { out.push('  - ' + hazardLine(s[1].split(' and '), { kind: s[2], count: s[3], x: s[4], y: s[5], z: s[6] })); i++; continue }
    }
    out.push(l); i++
  }
  return { ...it, system, user: out.join('\n'), transform: 'promptcache-01' }
}

const src = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
let bad = 0, chars0 = 0, chars1 = 0
const rows = []
for (const it of src) {
  const t = transform(it)
  if (!t) { bad++; continue }
  chars0 += it.user.length + it.system.length; chars1 += t.user.length + t.system.length
  rows.push(JSON.stringify(t))
}
fs.writeFileSync(outPath, rows.join('\n') + '\n')
const logged = rows.filter(r => r.includes('"transform":"promptcache-01 (as logged)"')).length
console.error(`${rows.length} items transformed (${logged} already in the layout, as logged), ${bad} in neither layout; system+user chars ${chars0} -> ${chars1} (${(100 * (1 - chars1 / chars0)).toFixed(1)}% fewer)`)
process.exit(bad ? 1 : 0)

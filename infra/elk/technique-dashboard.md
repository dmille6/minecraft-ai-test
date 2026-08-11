# The Lexicon Dashboard — coined techniques, their meanings, and their lives

Operator request: a Kibana board showing the bots' coined words, what each
means, and how often each is used, as a timeline line graph.

## Data model (add BOTH pieces in ONE batched mapping change — dynamic:strict
## rejects whole documents on any unmapped key; this bit us twice)

### 1. Coinage events (`mcai-skill-agents`, kind `_technique_coined`)
One document per christening:

```json
"technique": {
  "name":            { "type": "keyword" },   // the coined word: "mudhop"
  "description":     { "type": "text", "fields": { "raw": { "type": "keyword" } } },
  "definition_hash": { "type": "keyword" },   // what the word MEANS, immutably
  "roots":           { "type": "keyword" }    // ["mud","hop"] — palette decomposition
}
```
Coiner = existing `bot.name`; settlement = existing `exp.pool`. First-coinage
date = the document's `@timestamp`. Etymology (board adoption, loanwords)
comes later from board-ledger events joined on `technique.name`.

### 2. Usage marking (every skill record)
Coined macros run through the ordinary runner, so `skill.name` already equals
the coined word on every use. Add ONE field so the dashboard can separate
vocabulary from plumbing:

```json
"skill": { "coined": { "type": "boolean" } }   // true when the skill is a bot-made technique
```

## The dashboard ("Lexicon"), four panels

1. **The timeline (the centerpiece)** — Lens line chart:
   - x: `@timestamp` (date histogram, auto interval)
   - y: count of records
   - filter: `skill.coined: true`
   - breakdown: top 15 `skill.name` — one line per word, birth to habit.
     A word's line starting at zero, spiking on adoption, and decaying when a
     better technique displaces it IS the cultural-evolution measurement.

2. **The dictionary** — data table over `_technique_coined` events:
   `technique.name` · `technique.description` · `bot.name` (coiner) ·
   `exp.pool` (settlement) · `@timestamp` (coined) — sorted newest first.

3. **Dialect comparison** — same timeline, split by `exp.pool` instead of
   name: which settlement's vocabulary is growing, and when a word jumps
   pools (a loanword arriving by courier), it shows as a line appearing in a
   second settlement's panel.

4. **The adoption curve (operator's addition, the scientific centerpiece)** —
   Lens line chart:
   - x: `@timestamp` (date histogram)
   - y: **unique count of `bot.name`** — how many distinct bots used the word
     in each bucket
   - filter: `skill.coined: true`, breakdown by `skill.name`
   This is the diffusion S-curve from the innovation literature, per word:
   coiner-only (1) -> pool-mates adopt (2-3) -> board carries it to other
   settlements (climbing). A word whose usage count is high but whose adopter
   count is stuck at 1 is one bot's private habit; a word whose adopter curve
   keeps climbing is CULTURE. The hive should show step-jumps to full pool
   size instantly; the board should show the slow climb with courier-shaped
   delays; isolated bots should flatline at 1 forever. The whole experiment,
   visible in one chart.

5. **Top words** — horizontal bar of `skill.name` by total uses,
   `skill.coined: true`, with a companion metric: distinct coined words to
   date (the civilization's vocabulary size).

## Ship checklist (Phase 1/2, with composition learning)
- [ ] Batched mapping PUT: `technique.*` + `skill.coined` on `mcai-skill-*`
      indices AND both index templates (the rollover lesson)
- [ ] Runner sets `skill.coined: true` when executing a macro
- [ ] Coinage path emits `_technique_coined` with description + roots
- [ ] Build the four panels against the live Kibana (authored via UI or API
      at ship time — saved-object JSON is version-fragile, so we assemble it
      against the running instance rather than committing blind exports)
- [ ] Export the finished dashboard NDJSON back into this directory so later
      warehouses can import it

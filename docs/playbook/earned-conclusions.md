# 9 · Earned conclusions

## The brief

Seven bots sat trapped underground being told, over and over, that there was
no way out. There was a way out. The pathfinder just couldn't *see* one —
and we had let "my search didn't find a route" become "no route exists."
One bot was told it was hopeless while standing one block below the surface.

The verdict "impossible" ends all trying, so it has to be *earned*, not
inferred. A search coming back empty says the search was insufficient — maybe
the world, maybe the tool, maybe the time budget. Before the system is
allowed to conclude hopelessness, it must actually attempt the thing by the
most direct means available: in our case, literally digging straight up and
stacking blocks. Only "I tried the direct way and physically gained nothing"
earns the verdict — and only that verdict is allowed to become a lesson.

Corollary: a tool that answers "I haven't finished thinking" has not answered
"no." We once read a pathfinder's `partial` (search cut short) as a refusal —
28 strandings out of 28 were this misreading.

## The deep end

### The scar

Three stacked misreadings in the `surface` skill, each turning weak evidence
into a terminal verdict:
1. **Probe mismatch**: asked A* for a 105-block vertical route in a 1000ms
   budget — a question it can't answer in the time — and reported the timeout
   as "walled in."
2. **`partial` as refusal**: the library advances its search generator once
   per call (~40ms slice); underground it answers `partial` almost always.
   Requiring `status === 'success'` read "unfinished" as "impossible" —
   including Miner01 at y=62 told there was no route to y=63.
3. **No direct attempt**: both searches empty → `stranded`, immediately.
   The shaft climb (dig-and-pillar, no pathfinder at all) would have worked.
The rewrite: staged goals sized to the question, budgets sized to the stage,
`partial` treated as "try anyway," and `stranded` reachable only after the
shaft attempt measurably gains no altitude. The verdict taxonomy encodes it:
`path_interrupted` (traversal problem), `travel_incomplete` (working — call
again), `stranded` (earned, world's fault, may become a lesson).

### The rule

- Terminal negatives require a direct attempt by the strongest available
  means, with measured null result — search failure alone never suffices.
- Distinguish exhausted searches (`noPath` — a real no) from truncated ones
  (`partial`/timeout — not evidence).
- Ask probes questions they can answer within their budget; a conclusion may
  not exceed its evidence.
- Only earned verdicts feed the lesson store (pattern 1's gate applies with
  extra force to hopelessness, which pattern 5 shows is uniquely toxic).

### Why it's true

Agents act on conclusions, and "impossible" is the only conclusion that
produces *zero further evidence* — it's self-sealing. Every other error
self-corrects through retries; hopelessness never generates the data that
would refute it. So the asymmetry of caution flips: false "it works" gets
caught by the gate, but false "it can't work" must be prevented at the
inference step, because nothing downstream will catch it.

### How it shows up per game

- **Minecraft** (built): `shaftAscend`, the verdict taxonomy, staged probes —
  `bots/src/skills.mjs`, contract-tested in `surface.test.mjs`.
- **TrackMania**: "this corner can't be taken faster" must be earned by
  drilling it with save-states, not inferred from a plateaued aggregate lap
  time — plateaus mean the *training* stalled, not that the ceiling is real.
- **BAR**: "that push can't succeed" from a pathfinding or simulation probe
  is tier-1 evidence at best; commanders concluding unwinnable-and-idle is
  the strategic stranding. A retreat-and-rebuild attempt is the shaft climb.

### The prediction

Every new harness will initially contain at least one place where a tool's
resource-limited non-answer is treated as a world-fact — and it will be found
where an agent has inexplicably stopped trying something that obviously
should work. Grep for where search results become verdicts; demand the
direct-attempt step.

### The record

- **2026-08 · Minecraft**: held; the fix took strandings from "28 of 28
  invocations" to earned-only, and rescued bots the old code had written off.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*

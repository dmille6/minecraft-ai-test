# Requests: comms stage 3, requests and hand-offs that get fulfilled (design 2026-11-03)

OWNER 11-03: "yes design all using both claude and codex, put them in the queue and implement and deploy where you feel is
right". Owner rules already in force (10-21/10-22, [owner-comms-1021]): stage 3 has no trades and no rescue parties; peers
inform and never command; nothing reaches a prompt as free text; the bench brain never writes a message in v1; judge on
behaviour, not talk. The frontier job assigner did not beat a greedy rule in Paper (coop-b5), so everything here is
deterministic. Earlier design: `comms-design-2026-10-21.md` section 6 (Contract Net REQUEST/OFFER/AWARD/DELIVER, fenced).
Ledger row `comms-stage3`.

## 1. Measured (11-03)

| what | number | denominator |
|---|---|---|
| copper hall waiting on copper | opened 11-02 01:15Z, met 11-03 16:38Z (2,363 min); need 211 ingots above the floor, town held 106-194 | 835 gate rows, 10 bots, 11-01..03 |
| townmates' bags during the copper wait | copper (raw + ingot + block) p10/p50/p90 = 0/0/8; holders 0.38 of 9; >= 16 in 6.6% of minutes | 442 wait-minutes |
| what filled the copper | the copper run (gather copper ore when idle): 95 issued; verified town deposits of copper while waiting: 4 (39 units) | 417 town deposits |
| kit iron drawn from town chests | 51 `_kit_search outcome=took`, each followed by its craft (7 multi-tool); 0 other outcomes | 51 searches, 68 h, 10 bots |
| showcase item-shortage failures | rare: withdraw_pick short of sticks 3, smelt furnace unreachable 6, no sand within N 10 | 9,335 failed rows of 150,009 (24 h) |
| fleet shortage rows with a townmate holding >= 4 | iron prerequisite 63 (49%); craft short of iron 43 (65%); craft room short of sticks 55 (7%); smelt_town no coal 7 (0%); escape needs a pickaxe 497 (3%) | 516,583 rows, 80 bots, 16 pools, 6.0 h |
| showcase chat | 163 lines on 11-03: ore 55, expedition_out 34, tech 16, deposit 15, stuck 14, smelt 12, project_done 6, expedition_back 6, section 3, project_start 2 | showchat-lines.jsonl |

**Correction (stated to Codex as measured, then found wrong):** "74 minutes of the toolkit searching for kit iron while peers
held 32 iron" counted `_toolkit_search_mode`, which is a spawn-time mode row, not a search. The real searches are the 51
`_kit_search` rows above, all `took`.

**Reading:** the showcase's one big shortage (the hall's copper) was a **production** shortage: nobody's bag had copper to
hand over. Kit iron is a **"a town chest has it"** case, and it already works. A bag-to-bag hand-off has little headroom today
(Codex and Claude agree); townmates' iron on the fleet is mostly their own keep.

The two chat defects: the plural bug is `itemPhrase` adding "es" to an already-plural name ("44 stone brickses", 18:09Z).
"Juno said I'm stuck 13 times" is, by the logs, Juno twice; the repeat was **town-wide at one place**: 11 of 16 stuck rows
were 8 bots in the mineshaft's stair column (x 24..26, z -24..-27, escape_guard holding on the shaft record), 9 spoken. That
trap itself is a protected-scope bug for the control session, not this item.

## 2. The design (Claude)

A **request** is a typed record of a need a deterministic job already has: `{v, kind: project|kit, for, item (registry
name), qty, need, have, src, at, op}`. Writers are the jobs' own telemetry rows, read through the logger's record tap, so a
request can never say what did not happen. One per (project, item) town-wide; one per (bot, draw) for a kit.

| op | from | meaning |
|---|---|---|
| open / update | `_copperhall_gate why=copper_wait` | the project's shortfall, read from the town's **best view** over 30 min (each bot's gate counts only what its own index sees; the same minute read have=0 and have=130) |
| producing | `_copper_run issued` while open | a bot went to make the item |
| fill | a verified `_town_deposit` of the item while open | a hand-off from a bag into the town's chests |
| met | the gate's `why=ok` | the need is covered, with minutes and fills |
| expire | no gate row for 6 h | the project stopped asking |
| filled (kit) | `_kit_search took` + `_toolkit phase=kit crafted` within 120 s | a town chest answered; names the chest |
| unfilled (kit) | `_kit_search` no_iron / no_sticks / unseen / stalled | nobody answered (only no_iron is spoken) |

**Fulfilment order** (the owner's "a bot that has it or a town chest that has it"): (1) the requester's own draw from a town
chest (exists: the toolkit search, the builders' draws); (2) a townmate's bag surplus, banked at its next town visit into the
request's destination (piece 4, only if measured headroom appears); (3) production by an idle bot through an existing job
(the copper run, generalised in piece 3). **No bot ever waits on a request**: it reorders work a planner already has and never
overrides maintenance (bag-full, spent tool, no pickaxe rank above it).

**Fences** (for the pieces that move items): one live fill tranche per request and one per helper; the earlier design's
award lease (`wx` + `link()` generations) and process-incarnation rule for takeover; verified transfers only (the town
deposit's re-open); `staged` (in a chest) is not `received`; uncertain = `unknown`, never retried automatically.

**Chat** (showchat's templates, rate rules, kill switch): tier 1 met; tier 2 open/update, fill, kit filled; tier 3 producing
(one an hour town-wide) and kit unfilled. Dedupe: a request's open line 30 min, its met line 6 h; the kit filled line shares
the iron-pick line's key so a bot never says both.

**Chest index (storehub):** one source interface `{container, item, count, observed_at, state}`. Today it is townindex
(`readIndex` / `indexStateOf`); the storehub index replaces it behind the same interface, never summed with it. Dirty, stale
or missing is **unknown, not zero**; fall back to the bounded local search. It improves where a draw looks first; it never
owns requests or proves a transfer.

## 3. Codex's independent design (verbatim, codex exec read-only, 11-03)

> Given the measurements and the goal, not Claude's design. The iron figure it was given was wrong (section 1).

> Build a small deterministic request layer around existing jobs and town storage. Defer dedicated couriers: the measurements support production for copper and better use of shared chests for iron, with limited evidence for bag-to-bag delivery.
>
> The earlier design’s fencing and verification are useful. Its full bidding machinery is premature. Also, today’s `ledger.mjs` implements furnace observations, not a general request state machine; that infrastructure is still work.
>
> 1. What a request means
>
> A request records an unmet requirement of executable work, not a chat utterance or an instruction to another bot.
>
> Writers are deterministic job adapters:
>
> - Toolkit and ordinary crafting: the missing ingredients for the next craft.
> - Project planner: the remaining material requirement, including an opening gate such as the copper hall’s.
> - Materials maker: inputs missing for an actually needed batch.
> - Town smelter: missing fuel only when input exists and the job otherwise qualifies.
>
> Do not create requests from generic failures, movement failures, or escape episodes. No trades or rescue requests.
>
> Fields: schema version; request ID; world, pool and home; owning job and its generation; requester; registry item; integer quantity; destination policy; reason enum; creation, refresh and expiry times; evidence references. Destination policies are “requester’s next local withdrawal” or “approved town/project storage,” never arbitrary peer coordinates.
>
> Deduplicate projects by `(project generation, item)`, not by builder. Personal requests use `(bot, job generation, item)`. Refresh from the owning job’s current requirement; do not accumulate repeated shortages. Initial TTL: 20 minutes, renewable only while the need remains real.
>
> “I need 40 iron” means 40 iron ingots. Raw iron is a possible production input, not 40 delivered ingots. Conversion rules belong to existing recipes.
>
> 2. Fulfilment and ownership
>
> Every bot decides locally whether it can help. Requests reorder eligible discretionary work; they never bypass admission, maintenance or safety.
>
> Use this order:
>
> - **Already available:** the requester uses its own allowed inventory or withdraws directly from town storage.
> - **Bag surplus:** another bot already visiting town deposits permitted surplus into appropriate storage.
> - **Production:** an eligible bot performs an existing gathering, smelting or crafting job that addresses the remaining shortage.
>
> Avoid moving something between chests merely to call it delivery. Builders already withdraw their own bills; preserve that path.
>
> Bag offers use the actual deposit planner’s transferable steps after keeps, withdrawal holds, allowances and other commitments. Inventory totals are not offers. In particular, `ironKeeps` can keep an entire iron stack, and peers’ pickaxes may be their working kits. Do not weaken those policies in this feature.
>
> Start with one active fulfilment tranche per request and one commitment per helper. A deterministic selector prefers an executable local withdrawal, then an eligible local donation, then production; ties use stable bot IDs. No auction delay or model calls.
>
> Keep REQUEST/OFFER/AWARD/DELIVER as typed accounting transitions:
>
> - OFFER describes fresh, locally executable work and reserves its quantity.
> - AWARD atomically claims the request’s current generation using the repository’s exclusive-create/link fencing pattern.
> - Before mutation, recheck demand, eligibility, source contents, destination room and the award.
> - DELIVER records actual verified quantity and operation ID. Partial delivery reduces the remainder; duplicate operation IDs count once.
>
> Request accounting references existing stock and project claims; it must not establish a second stock authority. Apply the owning job’s reserve policy, including the existing project-specific floor. Stock targets are banking caps, not interchangeable reserve floors.
>
> For donations, use verified town-deposit transfers. For withdrawals, add explicit verification: current town-index documentation says ordinary withdrawal visits can leave containers dirty. An `outcome=took` line alone is insufficient.
>
> Separate **staged**, **received**, and **used**. A donation into a public chest is staged; it does not prove the intended requester received it. If another bot consumes it, record that outcome and recompute need.
>
> Cancellation and expiry may defeat an award before mutation. Once execution begins, never let lease age alone authorize a second executor. Preserve the earlier design’s process-incarnation fence. After a crash, recover from attributable transfer evidence; otherwise record `unknown`, not success or an automatic replay. Recompute subsequent demand from fresh observations. Uncertain operations must remain visible and excluded from duplicate commitments.
>
> Nobody waits. Missing files, no offers, failed paths, full chests or expired awards return the bot to its normal decision path. Failed source attempts back off for 30 minutes locally. Requests expire independently of bots. A stalled project remains visible and reaches the owner within the existing three-hour rule.
>
> Production uses a small allowlist of existing producers. Keep `copperRunOrder`’s exposed-ore guards, cooldowns and fallback to expedition work. Preserve smelting, maker leases and recovery notes. Do not add general mining, recursive task planning or new charcoal uses. Gathered inputs remain “in production” until usable output is verified.
>
> 3. What chat says
>
> Render new typed telemetry through `showchat.mjs`; neither the bench brain nor another model writes messages.
>
> Examples:
>
> - “I need 4 iron ingots for my tools.”
> - “I took 4 iron ingots from the town chests.”
> - “I stored 12 spare iron ingots for the town’s tool work.”
> - “The copper hall needs more copper. I’m gathering nearby ore.”
> - “The hall has enough copper to start.”
>
> Only say “enough” after the owning job rechecks its requirement. Do not announce offers as promises or discoveries as deliveries. Preserve the output filter’s prohibition on addressing named players.
>
> Requests and verified receipts are tier 2: existing two-minute bot gap, 20-second town gap, 10 lines/bot/hour and 30/town/hour. Add a request-category cap of six lines/town/hour; deduplicate unchanged needs for 20 minutes. Routine partial donations remain tier 3, including the existing quiet-town requirement. Existing project-start/completion announcements retain tier 1.
>
> Drop and count suppressed speech; never queue it. State transitions remain durable regardless of speech limits.
>
> 4. Chest-index integration
>
> Define one source-query interface returning canonical container identity, item count, observation time, freshness state, reservation exclusions and source revision.
>
> Initially implement it with `townindex.readIndex`, `indexStateOf` and `indexHolding`. Preserve double-chest canonicalization and `sortstore` preferences. Known contents outrank category labels.
>
> The future chest index supplies the same interface. It improves source selection; it does not own requests or prove transfers. Do not sum both indexes and count stock twice.
>
> Dirty, stale, missing or unreadable information is unknown, not zero. Fall back to the existing bounded local chest search. Fresh opens settle quantities and room. A failed walk remains private evidence about that bot’s attempt.
>
> 5. First showcase shipment
>
> Ship **toolkit iron requests fulfilled by the existing chest withdrawal**, with verified receipts and plain chat.
>
> This is deliberately narrow: one requester, one item, no helper leases, no new travel and no production scheduler. Open the request from the toolkit’s calculated draw, carry its ID through the existing search, verify the actual withdrawal, then record the resulting craft. Failure leaves the existing fallback intact.
>
> Do not claim this introduces indexed search: the live code already has it. This release establishes trustworthy end-to-end request accounting and measures whether further distribution work is justified.
>
> Likely scope: a small `requests.mjs`, toolkit integration in the unprotected portion of `skills.mjs`, `showchat.mjs`, and feature installation if needed. Run `protected.py` on the actual diff. Aim for tier 2; unfamiliar transfer behaviour requires the stronger process.
>
> Tests cover quantity and generation changes, partial receipts, duplicate evidence, stale index fallback, another withdrawal between selection and open, cancellation, interruption after clicking, unchanged reserve enforcement, and failure returning to baseline. Test chat truthfulness and town-wide deduplication. Run `npm test`, lint and preflight.
>
> Within two live hours, require several complete natural chains: need → verified chest receipt → tool crafted, with quantities reconciled and request chat observed. Report all eligible toolkit attempts as the denominator. If unexposed, record “KEEP, goal unverified,” not success. Pin rollback and close the rollout ledger.
>
> 6. Risks and what to measure first
>
> First measure **executable surplus**, not carried stock: transferable quantity, town presence, destination room and donor eligibility at actual shortage moments.
>
> Then measure verified staged/received/used quantities; unfilled demand duration; project progress; chest opens and search seconds per successful withdrawal; delivery travel time; unknown transfers; duplicate commitments; and maintenance delay. Compare search cost with recent equivalent toolkit work, without claiming causal time savings from two hours.
>
> Peaceful worlds still have falls, drowning and lava. Keep existing movement guards, prohibit request-driven route digging, and report deaths and world edits associated with fulfilment. Maintenance always wins; cap discretionary request work initially at two minutes per bot-hour. Repeated walking failures must produce backoff, not persistent courier assignments.
>
> Dedicated couriers, rescue pickaxe sharing, coal bidding and a frontier assigner have little demonstrated headroom and should not be built now. Copper production already addressed the major measured shortage. Expand requests only when verified receipts and downstream progress identify a remaining bottleneck.

## 4. Reconciliation

| point | Claude | Codex | resolved |
|---|---|---|---|
| headroom of bag-to-bag hand-offs | small (copper bags p50 0; iron is the peers' keep) | small: "dedicated couriers, rescue pickaxe sharing, coal bidding and a frontier assigner ... should not be built now" | agreed: the bag hand-off waits on a measured executable surplus (piece 4) |
| first piece | a request board over the needs the bots already fill (project copper + kit iron), observe-and-say | toolkit iron requests fulfilled by the existing chest withdrawal, with an ID carried through the search, verified receipts and chat | **Claude's shape, Codex's scope inside it.** Codex wanted the request ID carried through the toolkit (a change in skills.mjs); the tap reads the toolkit's own rows instead, so nothing a bot does changes and no skills.mjs edit is needed. The cost: the kit request opens at the search's end, not its start (the search writes one row) |
| "40 iron" means | ingots for kits; copper counted as ingot units with raw 1:1 (the hall's gate counts raw toward its run) | ingots only; raw is a production input | journal keeps `units` and the chat says "copper", never "ingots", for a fill |
| verification | town_deposit's verified re-open for fills; kit draws are what the window gained | an `outcome=took` alone is insufficient | open: piece 1 records `src=chest` from the search's own row; piece 2 adds the townindex re-open evidence before anything relies on it |
| chat caps | showchat's tiers | add a request-category cap of 6 lines/town/hour | not needed yet: the 11-01..03 replay speaks 60 request lines in 68 h; revisit if a request category crowds the rest |
| maintenance | above every request | cap discretionary request work at 2 min per bot-hour | adopted for the production piece (piece 3) |
| chest index | one source interface | the same, "do not sum both indexes" | agreed |

## 5. Pieces, tiers and the queue

| # | piece | what | tier | lane |
|---|---|---|---|---|
| 0 | **chatfix-01** | plural rule; one stuck line per place per 3 h town-wide; "stuck in the mineshaft" | 1 (showcase chat only) | showcase, any time (fold with the next release) |
| 1 | **requests-01** | the board above: project copper + kit iron as `_request` rows, the town journal, the chat lines | 2 (new feature, no behaviour change; not protected) | showcase, folded with chatfix-01 |
| 2 | requests-02 | verified receipts: townindex `xfer`/re-open evidence on kit draws and fills; staged / received / used; the 30-min request read (fill time, sources, unknown) | 2 | showcase, after 1 has a 24 h read |
| 3 | requests-03 | production board: copperRunOrder generalised to any open project request whose item has an existing producer (gather / smelt / make_material), maintenance first, 2 min per bot-hour cap | 2 | showcase, when a project waits on an item again (the hall's cut copper, storehub's chests) |
| 4 | requests-04 | bag hand-off: at a town visit, a bot banks its surplus of an open request's item (after keeps, allowances and live offers) into the request's destination; award lease + incarnation fence | 3 if it touches the deposit's protected paths, else 2 + a Paper scene | only if requests-02's read shows executable surplus at need moments |
| 5 | storehub source | the source interface backed by the storehub chest index | with storehub | after storehub lands |
| fleet | requests-01 on the fleet | journal only (no showchat there); the fill-rate read for 16 towns | 2 owner-direct, 60-min tripwire | after the showcase pass; low priority (P lane, behind bagdiet/swimcentre/bundle) |

**Queue placement.** Claude: fold chatfix-01 + requests-01 into the next showcase release (they touch only showchat.mjs,
requests.mjs and features.mjs' install list; no protected file), ahead of storehub; their read is the generic 2-h showcase
read plus: `_request` rows present, the chat lines heard, 0 deaths or crashes linked. Codex: the same piece first ("within
two live hours, require several complete natural chains ... if unexposed, record KEEP, goal unverified"). Expected exposure
in 2 h: about 1.5 kit fills (51 in 68 h); the hall's copper is met, so the project request is unexposed until a project waits
again. A 2-h read can say "no harm"; the goal is seen within a day (about 18 kit lines a day).

## 6. What must be proven, and where

- Piece 0-1 rest on nothing new in Paper or mineflayer: they read rows the bots already write and speak through showchat's
  live path (chat-event probe and chatgate-01 proved the chat path 10-22).
- Piece 4 rests on the town deposit putting a named item into a **chosen** container and the re-open verifying it (the
  verified town deposit does this today for its own container order; a destination chosen by a request is new) -- a Paper
  scene with two bots, a request and a mid-delivery crash, before any canary.
- Piece 3 rests on the existing gather / smelt / make_material jobs; no new world actions.

## 7. Owner decisions

None needed for pieces 0-3 (inside the 11-03 approval and the 10-22 rules). Piece 4 (bags handing items over) is the first
time a peer's request moves another bot's items; it is inside "requests ... no trades", and it is built only if the read
shows it would help.

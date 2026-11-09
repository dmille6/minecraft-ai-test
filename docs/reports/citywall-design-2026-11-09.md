# City wall upgrade and town landmarks (2026-11-09)

Owner, 11-09: "Town wall upgrade. Re-face or rebuild the cobble walls in stone bricks: a crenellated top, corner towers, a gatehouse at
the main road, and lights. Retrofit in place, never leaving a gap." and "Landmarks. Have Claude and Codex each propose a catalogue
(clock tower, fountain, lighthouse, statue, park or plaza, well house, market square), then reconcile. Site each where it fits the town
plan. Use seeded variety and materials from town stock: stone bricks, glass, logs, lanterns. Render pictures for the owner before
building. Prove every style on Paper."

Code: branch `citywall-01show` on the showcase tip `b9fa002e` (glass-01show). Tier 2 (`protected.py`: not protected). Switches:
`CITYWALL=off` (the wall upgrade) and `CIVIC=off` (the landmarks); both on in the showcase pool only by default
(`CITYWALL_POOLS`, `CIVIC_POOLS`). Pictures: [`citywall-2026-11-09/`](citywall-2026-11-09/). The two proposals, verbatim:
[`proposal-codex.md`](citywall-2026-11-09/proposal-codex.md), [`proposal-claude.md`](citywall-2026-11-09/proposal-claude.md)
(an independent Claude subagent).

## 1. What was measured (showcase, read-only, 11-09)

- **The wall is two records.** `wall@1` (g6, ring x -46..35, z -20..39; its north side retired and demolished on 11-05) and `wallext@1`
  (g5, ring x -40..35, z -89..-20). Together **215 O columns, 843 O cells, 612 step cells**; 24 runs of 5-12 columns. Of 568 ring
  columns, 229 are wall, 153 gap (water, pits, cliffs, the ziggurat, other projects), 79 openings (sally ports and short runs), 30
  gateway.
- **Every cell stands.** Region-file copy of 11-09 12:45Z (the timelapse mirror, `townplan_blockdump.py`, positive control: the
  storehouse reads right): 843 of 843 O cells present.
- **The wall hangs.** 86 of the 215 O columns stand over a void two or more blocks high under their lowest cell (the ground graded or
  dug away since 10-30). The upgrade underpins them.
- **The "main road" gateway.** `wallext`'s only `road` gateway is the 18-wide east opening at x 35, z -38..-21. The Claude proposal
  found that the ring road runs *beside* it (x 33-34), not through it. Crossings from 793,156 bot positions over 3 days (15 bots): the
  south side is crossed most; the road opening's band ~60 per 3 days. The position samples are too sparse to say which opening (75
  crossings with samples under 8 s apart in 2 days), so the crossing count does not pick a gate. The default is the owner's words and
  the record's name (the road gateway, as an *inset* gatehouse: section 3); `CITYWALL_GATE=<why>` moves it (owner decision D1).
- **Stock** (27 town containers): stone bricks 582, deepslate bricks 288, cobbled deepslate 1,010 (deepslate bricks with no fuel),
  stone 312, cobblestone wall 576, lanterns 12, torches 63, iron 85, glass panes 15, logs 622 (owner reserve 512).

## 2. The two proposals and the reconciliation

| Question | Codex | Claude (independent) | Chosen |
|---|---|---|---|
| Re-face method | a new outer skin (v = -1), no digs | swap in place, one cell at a time | **swap in place** (the owner's "in place"; the skin needs a free outer column that 86 hanging columns and the gaps do not have, and doubles the footprint) with Codex's guard: never a hole while a dug cell stands open |
| Palette | deepslate base, stone face | deepslate plinth + band, stone body, moss rising | Claude's **grey** (showcase) and **dark** (fleet: deepslate body) |
| Towers | 5 x 5, tall | 3 x 3 projecting outward | **3 x 3** on the walls (cheap, one-way escape kept); the 5 x 5 kept for the belfry/lighthouse |
| Gatehouse | twin towers + an overhead gallery, 18 wide | towers + a 3-deep deck at g+4, haunches, keystone | deck at g+4 with towers; on the 18-wide road gate as an **inset** gate (towers on the gateway's end columns, a 12-wide passage), because the flank beyond it is another record |
| Lights | every 8 columns | both run ends | **both run ends** (+ tower tops, gate parapet); torch where the town has no lantern; none within 3 of ice |
| First landmarks | well pavilion, market court, park court | plaza + fountain, well house, market cross | **plaza (dry fountain), market cross, belfry** (the owner's clock tower, without a clock: no gold, item frames unproven) |
| Water / item frames / bells | later, after proofs | excluded | **excluded** (a dry fountain, no clock, no bell) |

What the code adds that neither proposal had: the **underpinning** (measured above), the **swap-first tower segments** (a tower's in-line
O cells are swapped before its outer rows enclose them: found on the fake server), and four Paper findings in the landmarks (section 5).

## 3. The wall upgrade (`bots/src/citywall.mjs`)

**Courses** (by height over the column's base b): `<= b` foot, `b+1` plinth, `b+2` body (seeded moss ~16 %), `b+3` band, `b+4` merlon
(the existing every-other-column rhythm, so the one-way escape over a crenel that `wallEscape` proves is unchanged). The steps stay
cobblestone (behind the wall).

| role | grey (showcase) | dark (fleet) |
|---|---|---|
| foot, plinth | deepslate bricks | deepslate bricks |
| body | stone bricks (mossy) | deepslate bricks |
| band | deepslate bricks | stone bricks |
| merlon | stone bricks | deepslate bricks |

**Underpinning**: a column hanging over air gets foot cells down to its ground (at most 6; water or deeper: left, counted).

**Towers**: at a ring corner that is wall (a square bastion), else at the run end nearest a gapped corner on each side (within 6).
3 x 3, the in-line row the wall's own three columns (swapped), two rows outward; courses to tb+5, merlons on the corners and the outer
middle at tb+6, a lantern there, an iron-bar slit at tb+3, a cobblestone core (the town's junk). Upper courses are placed by reach (the
roofs' Paper-proven blind click).

**Gatehouse**: over one gateway: a flank tower each side, a deck 3 deep at g+4 (g = the passage's highest ground: headroom 3 kept over
every column), merlons on its outer edge, a stone-brick-wall parapet on its inner edge with lanterns on its posts, a chiseled keystone,
haunch stairs at the two edge columns. When a flank is another record's (the road gate's south flank is the old wall's), the **inset**
form puts the towers on the gateway's own three end columns and leaves the middle open (18 -> 12 wide).

**Lamps**: a lantern (else a torch) on the merlon at each run's two ends, so every opening has a pair; none within 3 of ice.

**Never a gap.** Every replaced cell carries `sw: 1`. The wall visit runs with `swap` (`buildrun.mjs swapDigOk`): a swapped cell is dug
only while its segment has no hole (no dug cell standing open, no added cell a stand can fill now) and the bag holds its block, and the
visit places it before the next dig. At most one 1 x 1 hole per segment: never two high, never a passage. The tripwire needs no new rule
(a foreign dig of a head-record cell and a placement in one are already its own).

**Phases**: the gatehouse with the runs either side, each tower with its run, then the other runs nearest a tower; one generation per
phase, published by the planner plot `citywall` only when the last phase stands (every cell done in the bot's own world) and the town
holds the phase's bill above a keep (stone bricks 64, deepslate 32, lanterns 4). The ring stays `structure_complete`; the open cells are
read as damage by its own palette (`cottage.mjs recordPalette` now reads a `citywall` record's palette, without a `style`, so the
re-roof's one-at-a-time never waits on it) and built by the wall's own visit. Before the first phase the design passes the wall siting's
escape proof (`wallEscape`: nothing cut off, nobody trapped).

**The showcase design** (offline, the bots' own code on the 11-09 region copy):

| ring | swapped | added | underpin | towers | gate | lamps | bill | escape |
|---|---|---|---|---|---|---|---|---|
| wallext | 365 | 370 | 65 | 2 (NE run ends) | 12 wide (road, inset) | 27 | stone bricks 308, deepslate 330, lanterns 27, walls 12, stairs 4 | cut 0, trapped 0 |
| wall | 478 | 261 | 195 | 1 (SW corner) | none (its gateways were on the retired line) | 22 | stone bricks 207, deepslate 478, lanterns 22 | cut 0, trapped 0 |

Total about 515 stone bricks and 808 deepslate bricks: inside the town's 582 + 312 stone and 288 + 1,010 cobbled deepslate. Lanterns:
49 wanted, 12 held (the lamp role falls back to a torch; the stoneworks/lantern crafts top it up).

Pictures (drawn from the design cells over the region copy; trees left out):
[`wallext-sheet.png`](citywall-2026-11-09/wallext-sheet.png) (the road gatehouse, the NE towers, a north run),
[`wall-sheet.png`](citywall-2026-11-09/wall-sheet.png) (the SW corner tower, the south and east runs), and the singles
[`gatehouse-before.png`](citywall-2026-11-09/gatehouse-before.png) -> [`gatehouse-after.png`](citywall-2026-11-09/gatehouse-after.png),
[`run-north-before.png`](citywall-2026-11-09/run-north-before.png) -> [`run-north-after.png`](citywall-2026-11-09/run-north-after.png),
[`tower-ne-after.png`](citywall-2026-11-09/tower-ne-after.png).

## 4. The landmarks (`bots/src/civic.mjs`)

Every look is a blueprint generated from its id `civic@1-<kind><code>` (`buildsite.mjs loadBlueprint`), built by the ordinary build
visit, sited by the bots' own siting (`siteBlueprint`: the screen, the earthwork, the build proof) within 22 of its anchor, nearest
first, clear of every record, reservation and protected zone. One at a time (each plot `after` the last); the look is seeded from the
town; the siting waits (20 min) while the town's stock lacks the bill (each role takes its first block, else a later one: a lamp a torch,
a wall a cobblestone wall, a keystone a stone brick). Picture: [`civic-sheet.png`](citywall-2026-11-09/civic-sheet.png), the belfry's
inside [`belfry-cutaway.png`](citywall-2026-11-09/belfry-cutaway.png).

| order | kind | footprint | looks (code axes) | bill (first look) | anchor | effect metric |
|---|---|---|---|---|---|---|
| 1 | plaza (dry fountain) | 9 x 9 | paving checker/rings x rim blocks/seats | 77 bricks + 20 andesite, 10 walls, 5 lanterns | home | bots routed through it; owner verdict |
| 2 | market cross | 7 x 7 | stalls 0/2 x height 3/4 | 49 bricks, 8 stairs, 6 walls, 5 lanterns | storehouse | trades/requests within 8 per day |
| 3 | belfry | 5 x 5, 14 high | roof hip/merlons x quoins | 202 bricks, 24 stairs, 3 bars, 4 lanterns | town hall, else the extension | lookout climbs; owner verdict |
| 4 | well house | 5 x 5 | posts logs/walls | 29 bricks, 12 logs, 24 stairs, 3 lanterns | the junk well | junk deposits not below pre |
| 5 | pavilion | 5 x 5 | roof spruce/dark oak | 16 bricks, 12 logs, 31 stairs, 1 lantern | the park | bots idling in it |
| 6 | statue | 5 x 5 | arms down/up x stone/dark | 25 bricks, 8 stairs, 3 walls | half way home -> the gate | owner verdict (decorative) |
| 7 | lighthouse | 5 x 5, 15 high | bands 2/3 | 197 bricks, 18 panes, 1 lantern | the north road's end | expedition returns past it after dark |

The towers (belfry, lighthouse) have an INSIDE SPIRAL of full-block steps round a newel: the builders' stands as the shell rises, and a
way up for any bot.

## 5. Proofs

**Offline** (`bots/scripts/civic-offline.mjs`): every look (22) proven by `proveSite` on a flat field in all four orientations: 88/88.
**Fake server** (`bots/test/citywall.test.mjs`): a real `wall@1` record from `siteWall`, its design, every phase built by two fake builders
running `runVisit` with `swap`: complete, every swapped cell dug and replaced, **at most one hole per segment at every dig**, every
placement a record cell; the mutant without the swap rule opens more than one (killed). `bots/test/civic.test.mjs`: the catalogue, the
proofs, the rim-first pad, the enclosed cells, the spiral, the bills and the anchors.

**Paper** (sandbox4, a real bot, the bots' own visit, every cell and state read back by the server):

- Landmarks (`sandbox/civic/civic-e2e.mjs`): PAPER_CIVIC_RESULT
- Four fixes found on Paper and kept: a pad laid from the middle out walled its builder off its outside stands (the pad's rim is now its
  own first segment); the statue's top inside its ring of steps had no visible face (enclosed cells are reach-only); the well house's
  open shaft inside a 1.5-high curb was a pit the builder could not leave (the mouth is a dark floor with a lantern); the belfry's 2-high
  arches beside the spiral's top were a pocket a bot dropped into and could not jump out of (3 high now), and its square rim was a walk
  that boxed the builder in once the next course was open (chamfered corners, as the lighthouse). Hung lanterns were dropped: this base's
  solver never clicks the face above (`buildsite.mjs SUPPORTS`), so every lantern stands.
- The wall upgrade (`sandbox/citywall/wall-e2e.mjs`): a 25 x 19 cobble ring laid by /fill with a 5-wide gateway, a sally port, a gapped
  corner and three hanging columns; the bot builds every phase (gate, 5 towers, the runs) with `swap`. PAPER_WALL_RESULT

**Offline on the showcase** (`bots/scripts/citywall-offline.mjs --build`, fake builders over the region copy, every phase): OFFLINE_SHOW_RESULT

## 6. Owner decisions

- **D1 the gatehouse.** Default: the extension's ROAD gateway (east, x 35, z -38..-21), as an inset gatehouse (12-wide passage).
  Alternatives: the north road R1 (the stone-brick road with lamps to the lake; flanked by water and the cane farm, so no flank towers
  fit) or the south side (the most crossed side, no gateway on the record today). `CITYWALL_GATE=<why>|none`.
- **D2 the style.** Grey (stone face, dark plinth and band) on the showcase; dark on the fleet. `CITYWALL_STYLE=grey|dark`.
- **D3 lanterns.** 49 on the walls + ~20 in the landmarks against 12 held; torches stand in until the lantern crafts catch up.

## 7. Fleet port

The fleet's walls are the same `wall@1` design (no extension), so the same code applies with `CITYWALL_POOLS`/`CIVIC_POOLS` naming the
canary pool; the dark style comes from the fleet's cobbled deepslate (14k). The fleet branch is the same commits on the live fleet sha;
its registration reads `_build op=citywall`, swap digs (`op=clear kind=foreign` on a citywall record) and holes (any two `sw` cells of
one segment open at once from the canary's own rows: DEFECT), and the landmarks' `op=sited project=civic*`.

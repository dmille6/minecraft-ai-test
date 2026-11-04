**Design: a stepped northern extension, with four reserved plots.** This is a proposed geometry requiring an expanded terrain survey; the supplied maps do not cover its western closure. No files were changed.

1. **Shape and joins**

   Use this clockwise outer polygon, coordinates `(x,z)`:

   `(-30,-78) → (35,-78) → (35,39) → (-46,39) → (-46,-9) → (-61,-9) → (-61,-50) → (-30,-50) → close`.

   Retain existing wall cells on the southern/eastern/western portions that remain boundary. New work joins the old east boundary at `(35,-20)` and west boundary at `(-46,-9)`. These are geometric attachment columns: verify actual masonry and buildability there; do not mistake the recorded north-corner gaps for physical joins.

   The western detour encloses the monument without touching its reservation. It avoids the impossible passage between monument and hall reservations. Keep monument grounds protected, even though now geographically inside town.

   Generate gateways wherever actual path zones or `land:road` corridors intersect the boundary: notably the north spoke near `z=-78` and ring-road crossing on the east. Preserve existing sally-port rules. Water creates an explicit stop, never foundations across water.

2. **Siting and code**

   Add pure `wallext.mjs`: `extensionShape`, `boundaryColumns`, `extensionCandidate`, `extensionDelta`, and `interiorContains`.

   Refactor `wall.mjs` so `wallCandidate` delegates cross-section generation to a boundary-driven implementation. Preserve rectangular `ringLoop` behavior. Polygon offsets need explicit concave-corner handling; simply summing corner normals is insufficient.

   Reuse terrain sampling, Lipschitz base heights, palette, foundations, gates, sally ports, clearing guards, `wallReach`, and `wallEscape`. Prove reachability against **retained plus new** cells and the final removal overlay. Check every step, foundation, torch, clearing lane, and connected-log dig against reservations.

   Extend `wallInputs` with complete guarded record heads and generation stamps. Unknown terrain or unreadable records means no siting. Do not rerun `siteWall` over every project’s bounding extent.

3. **Record and execution order**

   Add `project-0_70_0.wallext`, blueprint `wallext@1`, containing:

   `sourceHeads`, `boundary`, `interior`, `plots`, `joins`, `cells`, `clear`, `remove`, `segments`, `zones`, `bom`, `phase`, and verification results.

   Each removal names its original wall cell, role, and allowed material. `zones` describe construction columns and explicit reservations—not the polygon’s bounding box.

   Register in `PROJECTS` after `storehub`; require both hall completion and a valid existing wall record. Wire `projectsOn`, permanent protection in `projectsGuarded`, dispatch, billing, leases, and bounded visits in `skills.mjs`.

   Phases: reserve → build perimeter → verify → retire shared cells → bot demolition → activate interior. Critical joins cannot pass through the existing deferred-cell waiver mechanism.

4. **Four plots**

   Reserve four 19×11 pads:

   | Plot | x | z |
   |---|---|---|
   | W1 | −23..−5 | −71..−61 |
   | W2 | −23..−5 | −89..−79 |
   | E1 | 10..28 | −71..−61 |
   | E2 | 10..28 | −53..−43 |

   **W2 is outside the proposed boundary and too close to northern water; reject it.** Replace it with a rotated 11×19 pad at `x=-49..-39, z=-72..-54`, inside the western shoulder only if that shoulder is extended north to `z=-78`.

   Therefore adopt that shoulder extension in the final polygon: replace the first vertex with `(-61,-78)` and omit the two `z=-50` vertices. This yields a simpler western closure.

   Reserve each pad plus three blocks, validate full blueprint envelopes and roads, and retain access lanes to the spoke. Future siting atomically claims a plot, exempts only its own reservation, and applies ordinary terrain/protection checks.

5. **Shared line and land plan**

   Remove recorded north-wall cells along `z=-20`, including associated steps and lights; preserve cells belonging to the retained eastern corner. This makes the expanded town visibly continuous.

   Publish retirement intent before digging so wall repair cannot rebuild removals. Keep demolition authorization until acknowledged completion.

   Add versioned interior and plot overlays to `landplan.mjs`, preserving roads and protected uses. Replace the single-box assumption in `terrace.wallInterior`, `tidy.inwallBox`, and `surveyInwall` with bounds plus a membership predicate. Activate and resurvey `inwall` after completion.

6. **Cost, tripwire, proof, risks**

   Estimate from deduplicated generated cells, subtracting retained blocks and reporting salvage separately: roughly **1,400–1,900 cobblestone**, **32–64 stone bricks**, plus optional torches.

   Update the shop reader before rollout: recognize extension placements, clears, generation-bound demolition, and retired cells. Never grant blanket permission inside the polygon.

   Test polygon offsets, reservations, gateways, water stops, deterministic records, plot claims, restart recovery, stale heads, repair suppression, and interior membership. Extend `wall-offline.mjs` with copied terrain covering the entire candidate, overlay maps, material counts, four-builder simulation, and intermediate/final escape proofs. Its fake `walkTo` does not prove live navigation.

   Main risks: unmeasured western terrain, expanded footprint, trees, and corner reachability. Do not bridge water, flatten the basin, weaken protections, or claim this unimplemented candidate has passed offline proof.

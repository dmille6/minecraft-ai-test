# EF1 review r1 (Claude, independent subagent, 11-04) -- VERDICT: APPROVE, no blockers

- Selftest ok; the mutants file at the time: 129/129 killed, including the 8 new ones. Each new mutant was re-run on its own; seven
  fail on the EF1 assertion they target.
- The logged `block` of a fit placement is the palette entry (`fitVisitRecord` palette `{fit_<item>: [item]}`; buildrun's main place
  logs `blockFor(palette, role, e.has)`), so it equals the slot's item. A chipped/damaged anvil is only read as placed by `slotState`; it
  is never the logged block. A bot holding only a chipped anvil stops `no_material` and places nothing.
- The one-cell visit gets only `domain` and `walkR` (`enchantVisitOpts`): no access, use, tidy or footing placements can fire, so the
  only placement path is the main place. Clears stay G2's (unchanged); the fitter only takes slots that read air.
- Signs land on `wall + face` = `signs[].at`; judged only on ok=1 / no_editor / text_not_read_back, as the hall signs.
- Notes (not blockers): the HUB_KINDS mutant dies on a KeyError rather than an assertion (it still shows the kind is wired); any
  generation of the chain counts (the yard's precedent).

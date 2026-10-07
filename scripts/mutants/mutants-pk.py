#!/usr/bin/env python3
# peacefulkit mutants (10-07): each anchor must be present and UNIQUE; the source is restored after each; a mutant counts
# as KILLED only when the named test files go red against a baseline proven green first.
#   python3 scripts/mutants/mutants-pk.py <bots dir of a COPY of the candidate> [name filter...]
# Run it on a copy (cp -R src test scripts package.json eslint.config.mjs + a node_modules symlink), never the live tree.
import subprocess, sys, os
ROOT = sys.argv[1]
only = sys.argv[2:]
PK, CO, OR = ['peacefulkit.test'], ['composter.test'], ['peacefulkit-order']
M = [
  # the craft
  ('craft: admission refusal deleted', 'src/admission.mjs', "      if (noSword) return { ok: false, reason: 'peaceful_no_sword', detail: noSword }\n", "", PK),
  ('craft: admission reads the switch as off', 'src/admission.mjs', "swordCraftRefusal(args.item, foodSkipNow(bot).active)", "swordCraftRefusal(args.item, false)", PK),
  ('craft: the skill-level refusal deleted', 'src/skills.mjs', "  if (noSword) return { status: 'no_effect', detail: noSword }\n", "", PK),
  ('craft: the refusal ignores the switch', 'src/peacefulkit.mjs', "  if (!active || !isSword(item)) return null", "  if (!isSword(item)) return null", PK),
  ('craft: the prompt still offers a sword', 'src/prompt.mjs', "      if (peaceful && isSword(name)) continue\n", "", PK),
  # the bank
  ('bank: the allowance keeps one sword', 'src/bankable.mjs', "if (m) avail = bankEveryCopy(name, swords) ? (usable[name] ?? 0)", "if (m) avail = false ? (usable[name] ?? 0)", PK),
  ('bank: the default allowance counts swords (a new trip)', 'src/bankable.mjs', "reserveScaffold = 8, swords = false } = {}) {", "reserveScaffold = 8, swords = true } = {}) {", PK),
  ('bank: the deposit plan forgets the switch', 'src/skills.mjs', "depositPlan(planItems, item, { wants: bot.currentWants ?? [], swords })", "depositPlan(planItems, item, { wants: bot.currentWants ?? [] })", PK),
  ('bank: the transfer keeps one sword', 'src/skills.mjs', "const keepOne = bankEveryCopy(name, swords) ? 0 : 1", "const keepOne = 1", PK),
  ('bank: every copy rule ignores the switch', 'src/peacefulkit.mjs', "export const bankEveryCopy = (name, active) => !!active && isSword(name)", "export const bankEveryCopy = (name, active) => isSword(name)", PK),
  ('bank: a spent sword is bankable', 'src/bankable.mjs', "bankEveryCopy(name, swords) ? (usable[name] ?? 0) :", "bankEveryCopy(name, swords) ? n :", PK),
  # the sweep
  ('sweep: the sword filter deleted', 'src/skills.mjs', "      !skipSwordDrop(e, food.active) &&                                // nor a sword (peacefulkit.mjs, the same switch)\n", "", PK),
  ('sweep: skipSwordDrop never skips', 'src/peacefulkit.mjs', "  try { return isSword(entity?.getDroppedItem?.()?.name) } catch { return false }", "  return false", PK),
  # the switch
  ('switch: the packet does not refresh the decision', 'src/foodskip.mjs', "if (d) { bot.serverDifficulty = d; setPeacefulFood(foodSkipActive(mode, d)) }", "if (d) { bot.serverDifficulty = d }", PK),
  ('switch: no decision at attach (on mode)', 'src/foodskip.mjs', "  setPeacefulFood(foodSkipActive(mode, difficultyOf(bot)))\n", "", PK),
  ('switch: the kit row is never written', 'src/skills.mjs', "    try { logEvent({ kind: 'peaceful_kit', status: 'success', detail: peacefulKitDetail({ mode: FOOD_SKIP.mode, difficulty, active }) }) } catch { /* never break a pickup */ }\n", "", PK),
  # the composter
  ('compost: the allowance drops the plants clause', 'src/composter.mjs', "(plants && isPeacefulCompost(it.name) && !NEVER_COMPOST.test(it.name))", "false", PK + CO),
  ('compost: the list loses wildflowers', 'src/peacefulkit.mjs', "  wildflowers: 0.3, pink_petals: 0.3, cactus_flower: 0.3,", "  pink_petals: 0.3, cactus_flower: 0.3,", PK + CO),
  ('compost: the list gains dried_kelp', 'src/peacefulkit.mjs', "  melon_slice: 0.5, kelp: 0.3,", "  melon_slice: 0.5, kelp: 0.3, dried_kelp: 0.3,", PK + CO),
  ('compost: the skill never passes plants', 'src/skills.mjs', "const apples = foodSkipNow(bot).active, plants = apples", "const apples = foodSkipNow(bot).active, plants = false", CO),
  ('compost: the insert loop drops plants', 'src/skills.mjs', "nextInsert(items(), { room, apples, plants })", "nextInsert(items(), { room, apples })", CO),
  ('compost: the skill composts plants while OFF', 'src/skills.mjs', "const apples = foodSkipNow(bot).active, plants = apples", "const apples = foodSkipNow(bot).active, plants = true", CO),
  ('compost: the row loses its complete map', 'src/skills.mjs', "args: { items: { ...(f?.items ?? {}) }, peaceful,", "args: { peaceful,", CO),
  ('compost: the kit plants lose their rank', 'src/composter.mjs', ": (peacefulRank(name) ?? 5)", ": 5", PK),
  ('compost: startable ignores a full bag', 'src/composter.mjs', "  if (!plan.junk || boneMealRoom(items)) return plan.junk\n", "  return plan.junk\n", PK),
  ('compost: startable counts a bag with nothing to start', 'src/composter.mjs', "  if (!nx) return 0\n", "  if (!nx) return plan.junk\n", PK),
  ('compost: the town order ignores startable', 'src/cognitive.mjs', "junk: peaceful ? startableJunk(", "junk: false ? startableJunk(", OR),
  ('compost: an interrupted visit writes no row', 'src/skills.mjs', "      row('aborted', { levelBefore,", "      void ({ levelBefore,", CO),
  ('compost: a death mid-insert is credited to the composter', 'src/skills.mjs', "      if (before - after > 1) {", "      if (false) {", CO),
  ('compost: the in-flight name is not written', 'src/skills.mjs', "inflight: inflight?.name ?? null,", "inflight: null,", CO),
  ('compost: startable ignores the level', 'src/composter.mjs', "  return fillDecision({ level: Number.isInteger(L) ? L : 0, room: false, smallest: nx.n }) === 'insert' ? plan.junk : 0", "  return nx.n <= 7 ? plan.junk : 0", PK),
  ('bank: a sword-only full chest starts the recovery', 'src/skills.mjs', "  if (eligible > 0 && eligible === kitOnly) {", "  if (false) {", PK),
  # (round 2: `compostPlan(items, { apples: peaceful })` in cognitive is now EQUIVALENT while the switch is on -- the
  #  order's junk comes from startableJunk then -- so the plants mutant moved to startableJunk's own argument.)
  ('compost: the town order drops plants', 'src/cognitive.mjs', "startableJunk(items, { apples: peaceful, plants: peaceful,", "startableJunk(items, { apples: peaceful, plants: false,", OR),
  ('compost: the town order counts plants while OFF', 'src/cognitive.mjs', "compostPlan(items, { apples: peaceful, plants: peaceful })", "compostPlan(items, { apples: peaceful, plants: true })", OR),
  ('compost: the classifier ignores lost plants', 'src/skills.mjs', "((k === 'apple' || isPeacefulCompost(k)) && peacefulFoodActive())", "(k === 'apple' && peacefulFoodActive())", PK),
  ('compost: the classifier counts plants while OFF', 'src/skills.mjs', "((k === 'apple' || isPeacefulCompost(k)) && peacefulFoodActive())", "(isPeacefulCompost(k) || (k === 'apple' && peacefulFoodActive()))", PK),
  ('compost: the sapling reserve halved', 'src/composter.mjs', "export const SAPLING_RESERVE = 16", "export const SAPLING_RESERVE = 8", PK + CO),
  ('compost: the apple reserve dropped', 'src/composter.mjs', "export const APPLE_RESERVE = 4", "export const APPLE_RESERVE = 0", PK + CO),
]
bad = 0
if ROOT == '--read-only':   # the read's mutants only (PK_READ): python3 mutants-pk.py --read-only
    M = []
for t in sorted({t for m in M for t in m[4]}):
    r = subprocess.run(['node', 'scripts/run-tests.mjs', t], cwd=ROOT, capture_output=True, text=True, timeout=1200)
    assert r.returncode == 0, f'BASELINE RED: {t} fails before any mutant -- every "killed" would be false\n{r.stdout[-800:]}'
print('baseline green:', sorted({t for m in M for t in m[4]}), flush=True)
for name, f, old, new, tests in M:
    if only and not any(o in name for o in only):
        continue
    p = os.path.join(ROOT, f)
    src = open(p).read()
    n = src.count(old)
    assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n}): {name}'
    open(p, 'w').write(src.replace(old, new, 1))
    try:
        reds = []
        for t in tests:
            r = subprocess.run(['node', 'scripts/run-tests.mjs', t], cwd=ROOT, capture_output=True, text=True, timeout=1200)
            reds.append((t, r.returncode))
        killed = any(rc != 0 for _, rc in reds)
        print(('KILLED  ' if killed else 'SURVIVED') + f'  {name}  ' + ' '.join(f'{t}:exit{rc}' for t, rc in reds), flush=True)
        if not killed:
            bad += 1
    finally:
        open(p, 'w').write(src)
        assert open(p).read() == src, 'source not restored'
# THE READ's predicates (Codex r1: none of the mutants exercised the read): each must turn --selftest red.
READ = os.environ.get('PK_READ')   # scripts/host/peacefulkitread.py (a copy: it is mutated in place and restored)
RM = [
  ('read: a cut detail keeps its last pair', "        if cut:\n            pairs = pairs[:-1]\n", "        if cut:\n            pass\n"),
  ('read: args.items ignored', "    if isinstance(a.get('items'), dict):\n        out = {k", "    if False:\n        out = {k"),
  ('read: crafted accepts any sword gain', "    return item if pat.search(item) and isinstance(d, (int, float)) and d > 0 else None",
   "    return item if pat.search(item) or any(pat.search(n) and v > 0 for n, v in (sk.get('inventory_delta') or {}).items()) else None"),
  ('read: took_last ignores the END snapshot', "and int(inv.get(n, 0) or 0) == 0)", ")"),
  ('read: the sapling reserve check off by one', "int(inv.get(n, 0) or 0) < SAPLING_RESERVE", "int(inv.get(n, 0) or 0) < SAPLING_RESERVE - 1"),
  ('read: the apple reserve dropped', "        if n == 'apple' and int(inv.get('apple', 0) or 0) < APPLE_RESERVE:", "        if False:"),
  ('read: off_list allows everything', "    return sorted(n for n, c in items.items() if c > 0 and not (n in allowed or SAPLING.search(n)))", "    return []"),
  ('read: the ledger never credits the bank', "k = min(left, p[2]); p[2] -= k; left -= k; self.n['banked'] += k", "k = 0; left = 0"),
  ('read: any later rise cancels a loss', "(t - p[0]).total_seconds() <= RESTORE_S", "True"),
  ('read: an empty bag is a fall', "        if not isinstance(inv, dict) or not inv:\n            return", "        if not isinstance(inv, dict):\n            return"),
  ('read: deaths explain nothing', "            if any(-DEATH_BEFORE_S <= (p[0] - d).total_seconds() <= DEATH_AFTER_S for d in self.deaths):", "            if False:"),
  ('read: skill rows timed at their start', "        return t, t + dt.timedelta(milliseconds=float(ms))", "        return t, t"),
  ('read: a respawn after 180 s is a loss', "                    self.n['death'] += -d   # a death since", "                    self.pending.append([t, name, -d]); 0   # a death since"),
  ('read: an interrupted row reads as complete', "            return out, False\n", "            return out, True\n"),
  ('read: the in-flight name is ignored', "                out[a['inflight']] = out.get(a['inflight'], 0) + 1\n", "                pass\n"),
  ('read: a reserve judged on an aborted visit', "complete and status != 'aborted' and inv", "complete and inv"),
  ('read: a reserve judged right after a death', "not (last_death is not None and (t - last_death).total_seconds() <= 120)", "True"),
  ('read: the calibration never fires', "                if any(nm == p[1] and 0 <= (p[0] - bt).total_seconds() <= 60 for bt, nm in self.banks):", "                if False:"),
  # (the main loop's own lines -- e.g. `ver = verified_items(sk)` -> `ver = items` -- are not reachable by --selftest,
  #  which tests the predicates; the loop calls them by name. Checked by the dry run and review, not by a mutant.)
  ('read: verified_items includes the in-flight name', "        return {k: int(v) for k, v in a['items'].items() if isinstance(v, (int, float)) and v > 0}\n    return compost_items(sk)[0]", "        return compost_items(sk)[0]\n    return compost_items(sk)[0]"),
  ('read: late falls count as lost', "            elif (end - p[0]).total_seconds() < LATE_S:", "            elif False:"),
]
if READ and not only:
    r = subprocess.run(['python3', READ, '--selftest'], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, 'READ BASELINE RED: ' + r.stderr[-400:]
    for name, old, new in RM:
        src = open(READ).read()
        n = src.count(old)
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n}): {name}'
        open(READ, 'w').write(src.replace(old, new, 1))
        try:
            r = subprocess.run(['python3', READ, '--selftest'], capture_output=True, text=True, timeout=120)
            killed = r.returncode != 0
            print(('KILLED  ' if killed else 'SURVIVED') + f'  {name}  selftest:exit{r.returncode}', flush=True)
            if not killed:
                bad += 1
        finally:
            open(READ, 'w').write(src)
            assert open(READ).read() == src, 'read not restored'
print('all killed' if not bad else f'{bad} survived')
sys.exit(1 if bad else 0)

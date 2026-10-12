#!/usr/bin/env python3
"""External anchored mutants for stocktarget-01 (per-town stock targets + chest pruning).

    python3 scripts/mutants/mutants-stocktarget.py <export-dir>

<export-dir> is a `git archive` export of the branch under test with bots/node_modules linked. Each mutant asserts its
anchor is present EXACTLY ONCE (a mutant that silently fails to apply reads as killed -- CLAUDE.md), applies it, runs the
named test files with the suite runner (scripts/run-tests.mjs, its env), and is KILLED only if a file fails. The file is
restored either way. The unmutated tree must pass each file first, or the mutant cannot be judged.
"""
import os, subprocess, sys

ENV = dict(os.environ, SKILL_TIMEOUT_MS='300', SKILL_HARD_STOP_GRACE_MS='300',
           OLLAMA_MODEL='qwen2.5:7b-instruct', OLLAMA_BASE_URL='http://127.0.0.1:11434')
J = ['stocktarget-journal']
T = ['stocktarget']
TD = ['towndeposit']
PY = ['py:scripts/host/stocktargetread.py']   # the read's --selftest (its gates and the journal audit's G4 fixtures)
CC = 'bots/src/cobblecap.mjs'
MUTANTS = [
    # ---- the journal (cobblecap.mjs)
    ('floor: counts older than an hour count', CC,
     '    if (now - obs[k].at < FLOOR_TTL_MS) floor += countOf(obs[k].lo ?? obs[k], group) ?? 0',
     '    floor += countOf(obs[k].lo ?? obs[k], group) ?? 0', J),
    ('floor: an equal capture keeps no smaller count', CC,
     '        state.obs[r.k] = { ...hiOf(o, next), at: r.cap, seq, lo: lowOf(prevLo, next) }',
     '        state.obs[r.k] = { ...hiOf(o, next), at: r.cap, seq }', J),
    ('take: live outgoing claims are not subtracted', CC,
     '  const after = (Number(view?.floor) || 0) - (Number(view?.taking) || 0) - (Number(n) || 0)',
     '  const after = (Number(view?.floor) || 0) - (Number(n) || 0)', J),
    ('a draw is not outgoing', CC,
     "      if (c.decision === 'take' || c.decision === 'draw') taking += Number(c.n) || 0",
     "      if (c.decision === 'take') taking += Number(c.n) || 0", J),
    ('an older releasing count replaces the standing one (Codex r4 1)', CC,
     '      const stale = releasing && !resolving && o && r.cap <= o.at',
     '      const stale = false', J),
    ('an EQUAL-time releasing count replaces it (Codex r5 1)', CC,
     '      const stale = releasing && !resolving && o && r.cap <= o.at',
     '      const stale = releasing && !resolving && o && r.cap < o.at', J),
    ('a legacy count counts every group', CC,
     '  if ((Number(o.v) || 1) >= 2) return Math.max(0, Number(o.m?.[group]) || 0)',
     '  return Math.max(0, Number(o.m?.[group]) || 0)', J),
    ('every group judged against the cobble cap', CC,
     'cobbleAdmit(view, r.n, targetOf(g))', 'cobbleAdmit(view, r.n)', J),
    ('another group\'s claims reserve', CC,
     "      if ((c.g ?? 'cobble') !== group) continue", '', J),
    ('the reset drops no count', CC,
     '      for (const [k, o] of Object.entries(state.obs)) if (!(o.at > r.at)) delete state.obs[k]', '', J),
    ('the hold admits takes', CC,
     "  if ((Number(view?.held) || 0) > 0) return 'held'", '', J),
    ('a cached generation two rotations old is trusted (storm)', CC,
     '  if (g == null || !fs.existsSync(g >= 1 ? sealFile(dir, key, g) : journalFile(dir, key, 0))) {',
     '  if (g == null) {', J),
    ('a claim whose generation moved is still decided', CC,
     '  if (currentGen(dir, key) !== g1) {', '  if (false) {', J),
    ('a deleted generation folds as empty', CC,
     '    if (gen != null && g < currentGen(dir, key)) return null\n', '', J),
    ('claim kinds other than take are not written (Codex code r1 P1)', CC,
     "...(kind !== 'bank' ? { kind } : {})", "...(kind === 'take' ? { kind } : {})", J),
    ('an equal-time tie takes the record with more cobble (Codex code r1 P1)', CC,
     '        state.obs[r.k] = { ...hiOf(o, next), at: r.cap, seq, lo: lowOf(prevLo, next) }',
     '        state.obs[r.k] = { ...(next.n > o.n ? next : o), at: r.cap, seq, lo: lowOf(prevLo, next) }', J),
    ('a count captured before a reset comes back', CC,
     ' && !(r.cap <= (Number(state.resetAt) || -Infinity))) {', ') {', J),
    ('the valve is claimed as a bank claim', 'bots/src/skills.mjs',
     "step.valve ? 'valve' : bankKind(groupOf(step.name))", 'bankKind(groupOf(step.name))', ['towndeposit']),
    ('no well: no nowell claim (a plain one, refused at target)', 'bots/src/skills.mjs',
     "export const bankKind = group => (isToolGroup(group) ? 'bank' : stockCapBinds() ? 'bank' : 'nowell')",
     "export const bankKind = group => 'bank'", ['towndeposit']),
    ('the count step never fires', 'bots/src/cognitive.mjs',
     '        count: () => stockCountKeys(bot, items, { floor: true }).length > 0,', '        count: () => false,', ['towndeposit']),
    ('the valve without the proof of nothing else', 'bots/src/cognitive.mjs',
     '        return valveProof(bot, items) ? townDepositPlan(items, { wanted, noSwords, valve: true }) : p',
     '        return townDepositPlan(items, { wanted, noSwords, valve: true })', ['towndeposit']),
    # ---- the plan (bankable.mjs)
    ('the bulk cap never binds', 'bots/src/bankable.mjs',
     '    if (sg && stockCapBinds()) {', '    if (false) {', T),
    ('the bulk cap binds without a well (no exit, still a stop)', 'bots/src/bankable.mjs',
     '  if (!STOCK_WELL) return true\n  try { return !!STOCK_WELL() } catch { return true }', '  return true', T),
    ('the ordinary deposit ignores the keeps', 'bots/src/bankable.mjs',
     '      avail = Math.min(avail, n - keep)\n', '', T),
    ('the tool cap never binds', 'bots/src/bankable.mjs',
     '    if (tg && isToolGroup(tg) && avail > 0 && STOCK_TOWN && !noToolCap) {', '    if (false) {', T),
    # ---- the town deposit (towndeposit.mjs)
    ('the valve without its proof', 'bots/src/towndeposit.mjs',
     '  if (!steps.length && valve) {', '  if (!steps.length) {', T),
    ('the valve banks the best copy', 'bots/src/towndeposit.mjs',
     '      const slot = toolSlotsToBank(list.filter(it => it.name === name), Math.min(1, count))[0]',
     '      const slot = list.filter(it => it.name === name).sort((a, b) => a.slot - b.slot)[0]?.slot', T),
    ('the count step fires whether or not a count is needed', 'bots/src/towndeposit.mjs',
     '    if (!lazy(count) || !lazy(container)) return none()', '    if (!lazy(container)) return none()', T),
    # ---- the well (well.mjs)
    ('the well takes a tool or a protected kind', 'bots/src/well.mjs',
     "gs.has(g) && !isToolGroup(g) && !isProtected(it.name) && !isCompostJunk(it.name)", 'gs.has(g)', T),
    ('the well ignores the keeps', 'bots/src/well.mjs',
     '    if (left < Math.max(0, Number(keeps[it.name]) || 0)) continue\n', '', T),
    ('the well ignores the 64 pillar blocks', 'bots/src/well.mjs',
     '    if (isPillarName(it.name) && pillar - it.count < STOCK_SCAFFOLD_MIN) continue\n', '', T),
    ('the well plan drops the stock stacks', 'bots/src/well.mjs',
     '  for (const st of (stock ? stockWellStacks(list, stock) : [])) cobble.push(st)\n', '', T),
    ('the well takes cobble by the stock path', 'bots/src/well.mjs',
     "g && g !== 'cobble' && gs.has(g)", 'g && gs.has(g)', T),
    # ---- pruning (prune.mjs)
    ('prune ignores the target', 'bots/src/prune.mjs',
     'Math.floor(((Number(avail[g]) || 0) - targetOf(g)) / PRUNE_STACK)',
     'Math.floor((Number(avail[g]) || 0) / PRUNE_STACK)', T),
    ('prune uses a count older than the floor\'s hour', 'bots/src/prune.mjs',
     ' || now - o.at >= FLOOR_TTL_MS) continue', ') continue', T),
    ('prune takes partial stacks', 'bots/src/prune.mjs',
     '(it.count ?? 0) === PRUNE_STACK', '(it.count ?? 0) > 0', T),
    ('prune fills the bag', 'bots/src/prune.mjs',
     '  const room = Math.min(max, Math.max(0, free - PRUNE_FREE_AFTER))', '  const room = Math.min(max, free)', T),
    ('prune without a usable well', 'bots/src/prune.mjs',
     '  if (!lazy(wellUsable)) return { order: null, state: s }', '', T),
    # ---- the deposit skill (skills.mjs)
    ('the deposit transfers a refused claim', 'bots/src/skills.mjs',
     "        if (sadm.decision !== 'bank') continue\n", '', T),
    ('the recovery qualifies anything (a chest at target)', 'bots/src/skills.mjs',
     '  const out = { any: false, names: {}, reserved: {}, untargeted: 0, nowell: 0 }', '  const out = { any: true, names: {}, reserved: {}, untargeted: 0, nowell: 0 }', T),
    # ---- round 3 (code r2 findings: Codex P1/P2, Claude P2/P3, Paper 10-10)
    ('the recovery banks the reserved count past the keeps (Codex code r2 P1)', 'bots/src/skills.mjs',
     '    const plan = depositPlan(planItems, item, { wants: bot.currentWants ?? [], noSwords, stockRoomFor })',
     '    const plan = depositPlan(planItems, item, { wants: bot.currentWants ?? [], noSwords }); for (const [rn, rv] of Object.entries(reserved ?? {})) if (!plan.some(e => e.name === rn) && planItems.some(x => x?.name === rn)) plan.push({ name: rn, count: rv.n })', T),
    ('a recovery abort leaves its reservation live (Codex code r2 P2)', 'bots/src/skills.mjs',
     '  } finally { releaseStock() }\n}', '  } finally { }\n}', T),
    ('prune takes what the well would keep (Claude code r2 P2-2)', 'bots/src/prune.mjs',
     '    if (gain >= tk.count) out.push(tk)', '    out.push(tk)', T),
    ('prune_town has no evidence of its own (Paper 10-10: unknown)', 'bots/src/skills.mjs',
     "  prune_town: { expects: ['prune_effect'], maxMs: 180_000 },", "  prune_town: { expects: ['well_effect', 'world_change'], maxMs: 180_000 },", T),
    ('the stale floor is never recounted (Codex code r2 P2-6)', 'bots/src/skills.mjs',
     '    if (floor && stockCapBinds()) {', '    if (false) {', TD),
    ('a bag at its keep recounts anyway (Claude code r2 P3)', 'bots/src/skills.mjs',
     '        if (isToolGroup(g) || !surplus(g)) continue', '        if (isToolGroup(g)) continue', TD),
    # ---- the read and the journal audit (their --selftest)
    ('G2 matches a stale same-site row of another recovery (no aid)', 'scripts/host/stocktargetread.py',
     "if not aid or fq.get('aid') != aid or fq.get('at') != site", "if fq.get('at') != site", PY),
    ('G2 accepts an empty qualification', 'scripts/host/stocktargetread.py',
     "                return num(fq, 'untargeted', 0) > 0 or num(fq, 'nowell', 0) > 0 or nclaims > 0", '                return True', PY),
    # ---- round 5 (stonecap-01 INCONCLUSIVE 10-12: the at-target refusal is a row)
    ('the deposit writes no refusal row', 'bots/src/skills.mjs',
     "    if (!noRecovery) stockRefusedRow(bot, 'deposit', planItems, { wants: bot.currentWants ?? [], noSwords, stockRoomFor })", '    if (false) stockRefusedRow(bot, \'deposit\', planItems, {})', T),
    ('the town deposit writes no refusal row', 'bots/src/skills.mjs',
     "  stockRefusedRow(bot, 'town_deposit', before, { wants: wanted, noSwords: foodSkipNow(bot).active })\n", '', TD),
    ('the cobble cap is not a refusal reason', 'bots/src/bankable.mjs',
     "'town_stock_unknown', 'town_cobble_cap', 'town_cobble_unknown'", "'town_stock_unknown', 'town_cobble_unknown'", T),
    ('admission writes no refusal row (fold-r1 P2)', 'bots/src/admission.mjs',
     "        stockRefusedRow(bot, 'admission', items, { wants, noSwords }, { throttleMs: 60_000 })\n", '', T),
    ('admission refusal rows are not throttled', 'bots/src/skills.mjs',
     '      if (now - (refusedSeen.get(k) ?? -Infinity) < throttleMs) return rf\n', '', T),
    ('an unknown-only refusal counts as liveness (Claude fold-r1 P2-1)', 'scripts/host/stocktargetread.py',
     "    proven = lambda r: ((r['name'] != '_stock_refused' or num(kv(r['detail']), 'at_cobble', 0) + num(kv(r['detail']), 'at_stock', 0) > 0)",
     "    proven = lambda r: ((True)", PY),
    ('C5: no cobble bank claim is admitted-counted (exposure)', 'scripts/host/stockjournal.mjs',
     " && c.decision === 'bank' && (c.g ?? 'cobble') === 'cobble') out.admitted_cobble_bank++", " && false) out.admitted_cobble_bank++", PY),
    ('the read does not count refusal rows as live', 'scripts/host/stocktargetread.py',
     "'_stock_recovery', '_stock_refused')", "'_stock_recovery')", PY),
    ('G4 sums every group into one batch (Codex code r2 P2)', 'scripts/host/stockjournal.mjs',
     '              ;(byG[takeAt[id].g] ??= []).push(id)', '              ;(byG[Object.keys(byG)[0] ?? takeAt[id].g] ??= []).push(id)', PY),
    ('the tripwire counts 64 to a slot (Codex code r2 P2)', 'scripts/host/stocktargetread.py',
     '        per = 1 if UNSTACKABLE.search(k) else 16 if STACK16.search(k) else 64', '        per = 64', PY),
    # ---- round 4 (code r3: Codex P2 x2)
    ('a refused prune group still spends the budget (Codex code r3 P2)', 'bots/src/prune.mjs',
     '        n = ok\n', '        left -= n - ok; n = ok\n', T),
    ('a reservation is written without its recovery\'s action id (Codex code r3 P2)', 'bots/src/cobblecap.mjs',
     ", ...(aid ? { aid } : {}) }", " }", T),
    ('G2 never checks the reservations against the journal', 'scripts/host/stocktargetread.py',
     'if bank_aids is not None and nclaims > 0 and bank_aids.get(aid, 0) < nclaims:', 'if False:', PY),
    ('the tripwire weighs rows, not bot-minutes (Codex code r2 P2)', 'scripts/host/stocktargetread.py',
     "        return sum(f / n for f, n in mins) / len(mins) if mins else float('nan')", "        return sum(f for f, n in mins) / sum(n for f, n in mins) if mins else float('nan')", PY),
]


def run(root, files):
    bad = []
    for f in files:
        if f.startswith('py:'):
            r = subprocess.run(['python3', f[3:], '--selftest'], cwd=root, env=dict(ENV, STOCK_CC=os.path.join(root, 'bots/src/cobblecap.mjs')), capture_output=True, text=True, timeout=600)
        else:
            r = subprocess.run(['node', 'scripts/run-tests.mjs', f'{f}.test.mjs'], cwd=os.path.join(root, 'bots'), env=ENV, capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            bad.append(f)
    return bad


def main():
    root = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    killed = survived = 0
    baseline = {}
    for name, rel, old, new, files in MUTANTS:
        if only and only not in name:
            continue
        path = os.path.join(root, rel)
        src = open(path).read()
        n = src.count(old)
        assert n == 1, f'ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE (%d)" % n}: {name}'
        for f in files:
            if f not in baseline:
                baseline[f] = not run(root, [f])
            assert baseline[f], f'baseline already fails {f}: the mutant cannot be judged'
        try:
            open(path, 'w').write(src.replace(old, new, 1))
            bad = run(root, files)
        finally:
            open(path, 'w').write(src)
        if bad:
            killed += 1; print(f'KILLED    {name}  ({", ".join(bad)})', flush=True)
        else:
            survived += 1; print(f'SURVIVED  {name}', flush=True)
    print(f'stocktarget: {killed} killed, {survived} survived')
    sys.exit(1 if survived else 0)


if __name__ == '__main__':
    main()

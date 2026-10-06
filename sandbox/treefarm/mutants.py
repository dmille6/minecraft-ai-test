#!/usr/bin/env python3
# Anchored mutants for the tree farm: each anchor must be present and UNIQUE (CLAUDE.md), the mutant applied to a COPY of
# bots/, and bots/test/treefarm.test.mjs must FAIL on it. Usage: bp-mutants.py <worktree> <outdir>
import os, sys, shutil, subprocess
WT, OUT = sys.argv[1], sys.argv[2]
M = [
 ('src/blueprint.mjs', "  if (!Array.isArray(seen) || !seen.length) return 'silent'\n", "  if (!Array.isArray(seen) || !seen.length) return 'confirmed'\n", 'witness: silence counts'),
 ('src/blueprint.mjs', "  if (lease.released || !(Number(lease.until) > now)) return", "  if (true) return", 'lease: never held'),
 ('src/blueprint.mjs', "    const why = refuse(cur.record)\n    if (!why) return { record: cur.record, gen: cur.gen, why: null, defer: false, replaced: null }", "    const why = null\n    if (!why) return { record: cur.record, gen: cur.gen, why: null, defer: false, replaced: null }", 'record: never replaced'),
 ('src/blueprint.mjs', "    fs.linkSync(tmp, file)\n", "    fs.writeFileSync(file, fs.readFileSync(tmp))\n", 'CAS: overwrite instead of link'),
 ('src/treefarm.mjs', "    if (isLeaves(b.name)) { leaves = true; continue }", "    if (isLeaves(b.name)) { if (!foreign) foreign = b.name; continue }", 'plot: leaves block'),
 ('src/treefarm.mjs', "    if (isLiquid(b) || b.waterlogged) return `${b.name} beside`\n", "", 'plot: liquid ignored'),
 ('src/treefarm.mjs', "  return idx.soil.has(cellKey(p.x, p.y, p.z)) ? 100 : 0\n}", "  return 0\n}", 'break exclusion off'),
 ('src/treefarm.mjs', "idx.torch.has(k) || idx.soil.has(k)) ? 100 : 0", "idx.torch.has(k)) ? 100 : 0", 'place exclusion: soil off'),
 ('src/treefarm.mjs', ".filter(l => l.y - s.plot.y <= MAX_DIG_UP)", "", 'dig: no reach cap'),
 ('src/treefarm.mjs', "  if (now - (s.lastTendAt ?? -Infinity) < TEND_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()\n", "", 'order: no cooldown'),
 ('src/treefarm.mjs', "    if (s === 'unknown') return { record: null, why: 'unknown' }\n    if (!s) { refused.no_surface", "    if (s === 'unknown') continue\n    if (!s) { refused.no_surface", 'fit: unknown skipped'),
 ('src/treefarm.mjs', "    if (isPlotCell(idx, x, y, z) && FARM_SPECIES.includes(item)) return null\n", "    return null\n", 'reservation: column takes anything'),
 ('src/skills.mjs', "    if (readRecord(dir, key).gen !== gen) { stop = 'farm record replaced'; return false }\n", "", 'fence: record generation'),
 ('src/skills.mjs', "    if (!holdsLease(dir, key, me, lease.gen)) { stop = 'lease lost'; return false }\n", "", 'fence: lease'),
 ('src/skills.mjs', "    block = logNow()\n    if (!block) return done(a, 'not_a_log_before_dig')\n", "", 'dig: no post-equip re-read'),
 ('src/skills.mjs', "return done(a, `hand_${held?.name ?? 'empty'}`)", "void 0", 'dig: hand unchecked'),
 ('src/skills.mjs', "      if (farmPlaceRefusal(farmIdx(bot), cellPos.x, cellPos.y, cellPos.z, item)) continue\n", "", 'make-room: farm column'),
 ('src/skills.mjs', "  if (why && why !== 'unknown') {\n    const saplings", "  if (false) {\n    const saplings", 'plan: no refound'),
 ('src/skills.mjs', "        if (!onFarmPlan(idx, a)) { f.offplan++; continue }\n", "", 'off-plan guard (expect survive: plan cells are on-plan by construction)'),
 ('src/skills.mjs', "    if (/^no farm site within/.test(farm.why ?? '')) {", "    if (false) {", 'no-site backoff'),
 ('src/skills.mjs', "    if (v !== 'confirmed') return done(a, v)\n    logEvent({ kind: 'farm_place', status: 'success', snapshot: snapshot(bot), detail: `role=${a.role} item=${a.item} at=", "    logEvent({ kind: 'farm_place', status: 'success', snapshot: snapshot(bot), detail: `role=${a.role} item=${a.item} at=", 'place: verdict ignored'),
 ('src/skills.mjs', "  if (farmNoDig(farmIdx(bot), p.x, p.y, p.z)) return 'town_structure'\n", "", 'roomVeto farm soil'),
 ('src/skills.mjs', "        { const fi = farmIdx(bot), q = cell.position; if (fi && q && inFarmBox(fi, q.x, q.z) && !isPlotCell(fi, q.x, q.y, q.z)) continue }\n", "", 'planting walkway guard'),
 ('src/skills.mjs', "  (idx && (inPlotColumn(idx, x, y, z) || idx.torch?.has(`${x},${y},${z}`) || idx.soil?.has(`${x},${y},${z}`)))", "  (false)", 'composter reservation read'),
]
os.makedirs(OUT, exist_ok=True)
src_bots = os.path.join(WT, 'bots')
res = []
ONLY = [x for x in os.environ.get('ONLY', '').split('|') if x]
for i, (f, old, new, name) in enumerate(M):
    if ONLY and not any(o in name for o in ONLY):
        continue
    d = os.path.join(OUT, 'm%02d' % i)
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(src_bots, os.path.join(d, 'bots'), symlinks=True, ignore=shutil.ignore_patterns('node_modules'))
    os.symlink(os.path.realpath(os.path.join(src_bots, 'node_modules')), os.path.join(d, 'bots', 'node_modules'))
    p = os.path.join(d, 'bots', f)
    s = open(p).read()
    n = s.count(old)
    if n != 1:
        res.append((name, 'ANCHOR %s' % ('MISSING' if n == 0 else 'NOT UNIQUE (%d)' % n))); continue
    open(p, 'w').write(s.replace(old, new))
    env = dict(os.environ, SKILL_TIMEOUT_MS='300', SKILL_HARD_STOP_GRACE_MS='300', OLLAMA_MODEL='x')
    try:
        r = subprocess.run(['node', 'test/treefarm.test.mjs'], cwd=os.path.join(d, 'bots'), env=env, capture_output=True, text=True, timeout=300)
        fails = [l.strip()[6:90] for l in r.stdout.splitlines() if l.strip().startswith('FAIL')]
        why = fails[0] if fails else 'exit %d without a FAIL line: %s' % (r.returncode, (r.stderr.strip().splitlines() or ['-'])[-1][:120])
        res.append((name, ('KILLED by %d: %s' % (len(fails), why)) if r.returncode != 0 else 'SURVIVED'))
    except subprocess.TimeoutExpired:
        res.append((name, 'KILLED (the suite file hung > 300 s)'))
    print('%-60s %s' % res[-1], flush=True)
    shutil.rmtree(d, ignore_errors=True)
print('killed %d / %d' % (sum(1 for _, v in res if v.startswith('KILLED')), len(res)))

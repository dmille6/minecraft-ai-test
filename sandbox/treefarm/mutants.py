#!/usr/bin/env python3
# Anchored mutants for the tree farm: each anchor must be present and UNIQUE (CLAUDE.md), the mutant applied to a COPY of
# bots/, and bots/test/treefarm.test.mjs OR bots/test/treefarm-compose.test.mjs must FAIL on it. Usage: mutants.py <worktree>
# <outdir>. REVIVAL 10-15: the mutants after the first 24 cover the rebase's composition and the bone meal arm.
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
 # ---- revival 10-15: composition ----
 ('src/skills.mjs', "    refuse: site => wellSiteRefusal(read, site, home, { avoid }),\n  })\n}\n/** The recorded site", "    refuse: site => wellSiteRefusal(read, site, home, { avoid: wellSearchAvoid(bot) }),\n  })\n}\n/** The recorded site", 'precedence: the farm refuses a recorded well'),
 ('src/skills.mjs', "  try { out.push(...farmWellAvoid(knownFarmRecord(bot))) } catch { /* no farm */ }\n  return out\n}", "  return out\n}", 'well search: farm ignored'),
 ('src/skills.mjs', "    refuse: rec => farmRecordRefusal(read, rec, { reserved: pastBorder }) ?? farmYields(rec, avoid),", "    refuse: rec => farmRecordRefusal(read, rec, { reserved: pastBorder }),", 'farm never yields (skill)'),
 ('src/treefarm.mjs', "    if (c) return `a ${a.what.replace('_', ' ')} at", "    if (false) return `a ${a.what.replace('_', ' ')} at", 'farmYields: never'),
 ('src/skills.mjs', "  try { for (const c of (bot ? liveChestClaims(bot) : [])) if (Number.isFinite(c.x) && Number.isFinite(c.z)) out.push({ x: c.x, y: c.y, z: c.z, r: FARM_CONTAINER_DISTANCE + 0.5, what: 'chest_claim' }) } catch { /* no ledger */ }\n", "", 'farm: chest claims ignored'),
 ('src/skills.mjs', "  try { for (const w of (bot ? findTownWells(bot) : [])) well(w.cap?.x, w.cap?.z, FARM_WELL_DISTANCE, 'junk_well') } catch { /* none found */ }\n", "", 'farm: found wells ignored (expect survive: the fakes find no built well)'),
 ('src/skills.mjs', "  try { const r = bot ? recordedWellSite(bot) : null; if (r) well(r.x, r.z, FARM_WELL_DISTANCE, 'junk_well') } catch { /* no record */ }\n", "", 'farm: recorded well ignored'),
 ('src/skills.mjs', "    return sameWorld(rec.world ?? null, bot?.worldId ?? null) ? rec : null\n  } catch { return null }\n}", "    return null\n  } catch { return null }\n}", 'farm: plinth plan ignored'),
 ('src/skills.mjs', "reserved: c => pastBorder(c) || inFloorBand(home, c) }),", "reserved: c => pastBorder(c) }),", 'farm: floor band ignored'),
 ('src/treefarm.mjs', "  if (farmPlaceRefusal(idx, x, y, z, 'chest')) return `a tree-farm cell at ${x},${y},${z}`\n", "", 'chest: farm cell allowed (expect survive: every farm cell is within 3 of a plot in the column span, so the distance rule refuses it too)'),
 ('src/treefarm.mjs', "    if (Math.hypot(px - x, pz - z) <= FARM_CONTAINER_DISTANCE && y >= span[0] - 2 && y <= span[1]) return", "    if (false) return", 'chest: plot distance ignored'),
 ('src/chestfull.mjs', "export const widensChestSearch = refused => Object.keys(refused ?? {}).some(k => /junk well|tree-farm/.test(k))", "export const widensChestSearch = refused => Object.keys(refused ?? {}).some(k => /junk well/.test(k))", 'chest: the farm does not widen'),
 ('src/skills.mjs', "    try { await withDigScope(bot, { purpose: 'target', by: 'tend_farm' }, () => g.bound(", "    try { await (() => g.bound(", 'digtown: no scope'),
 ('src/skills.mjs', " || idx.torch.has(`${c.x},${c.y},${c.z}`) || inWell(c)", " || idx.torch.has(`${c.x},${c.y},${c.z}`)", 'stand: well column allowed'),
 # ---- revival 10-15: bone meal ----
 ('src/treefarm.mjs', "  return typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim())\n}\n/** The farm itself", "  return true\n}\n/** The farm itself", 'bone meal: default on'),
 ('src/treefarm.mjs', "s.clear !== true || (left.bone_meal ?? 0) <= BONEMEAL_RESERVE", "(left.bone_meal ?? 0) <= BONEMEAL_RESERVE", 'bone meal: blocked sapling'),
 ('src/treefarm.mjs', "(left.bone_meal ?? 0) <= BONEMEAL_RESERVE || n >= BONEMEAL_PER_VISIT", "(left.bone_meal ?? 0) <= 0 || n >= BONEMEAL_PER_VISIT", 'bone meal: no reserve'),
 ('src/treefarm.mjs', "(left.bone_meal ?? 0) <= BONEMEAL_RESERVE || n >= BONEMEAL_PER_VISIT", "(left.bone_meal ?? 0) <= BONEMEAL_RESERVE", 'bone meal: no per-visit cap'),
 ('src/treefarm.mjs', "    if (s.state !== 'logs_above' && !(s.state === 'sapling' && s.logs?.length)) continue", "    if (s.state !== 'logs_above') continue", 'sapling: leftover logs kept'),
 ('src/skills.mjs', "    { const st = plotState(read, a.cell); if (st.state !== 'sapling' || st.clear !== true) return done(a, `column_now_${st.state === 'sapling' ? 'blocked' : st.state}`) }\n", "", 'bone meal: no column re-read (expect survive: the plan already excludes it)'),
 ('src/skills.mjs', "    if (grew) f.bmGrew++\n", "    f.bmGrew++\n", 'bone meal: grew without a log'),
 ('src/skills.mjs', "    const gone = c - (after[n] ?? 0), placed = Math.min(gone, walkPlaced.count(n))", "    const gone = c - (after[n] ?? 0), placed = 0", 'scaffold counted as lost'),
 ('src/skills.mjs', "    if (!att || nameOf(id) !== att.name) return\n    pending.delete(k)\n", "    if (!att || nameOf(id) !== att.name) return\n", 'scaffold: repeated update credited again'),
 ('src/skills.mjs', "    const k = `${x},${y},${z}`, att = pending.get(k)\n", "    const k = `${x},${y},${z}`, att = { name: nameOf(id) }\n", 'scaffold: any update credited'),
 ('src/skills.mjs', "        try { Promise.resolve(out).then(drop, drop) } catch { drop() }\n", "", 'scaffold: a failed attempt stays pending'),
 ('src/skills.mjs', "    // THE FENCE IS THE LAST THING BEFORE THE CLICK (Codex r5 P2: a structure recorded during the look was missed)\n    if (!fence()) return null\n    witness.watch(a.cell)", "    witness.watch(a.cell)", 'place: no fence after the look'),
 ('src/skills.mjs', "    if (farmYields(rec, farmAvoid(bot))) { stop = 'farm must yield'; return false }\n", "", 'fence: no yield check'),
 ('src/treefarm.mjs', "    if (a.what === 'plinth_cell' && Number.isFinite(a.y)) {", "    if (false) {", 'farmYields: plinth cell by radius'),
 ('src/treefarm.mjs', "  if (!(Math.abs(dy) <= FARM_ORDER_DY)) return none()\n", "", 'order: any level'),
 ('src/skills.mjs', "    for (const until = Date.now() + BONEMEAL_GROW_WAIT_MS; countItem(bot, 'bone_meal') >= n0 && Date.now() < until;) await ticks(2)\n", "", 'bone meal: no wait for the bag'),
 ('src/treefarm.mjs', "    const rOf = q => (q.role === 'torch' ? Math.min(r, FARM_TORCH_WELL_DISTANCE) : r)", "    const rOf = q => r", 'farmYields: torch distance 4'),
 ('src/treefarm.mjs', "    if (a.what === 'chest_claim' && Number.isFinite(a.y)) {", "    if (false) {", 'farmYields: chest by radius'),
]
os.makedirs(OUT, exist_ok=True)
src_bots = os.path.join(WT, 'bots')
res = []
ONLY = [x for x in os.environ.get('ONLY', '').split('|') if x]
for i, (f, old, new, name) in enumerate(M):
    if ONLY and not any(o in name for o in ONLY):
        continue
    SH = os.environ.get('SHARD')   # 'k/n': run every n-th mutant from k (parallel shards)
    if SH and i % int(SH.split('/')[1]) != int(SH.split('/')[0]):
        continue
    d = os.path.join(OUT, 'm%02d' % i)
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(src_bots, os.path.join(d, 'bots'), symlinks=True, ignore=shutil.ignore_patterns('node_modules'))
    os.symlink(os.path.realpath(os.path.join(src_bots, 'node_modules')), os.path.join(d, 'bots', 'node_modules'))
    p = os.path.join(d, 'bots', f)
    s = open(p).read()
    n = s.count(old)
    if n != 1:
        res.append((name, 'ANCHOR %s' % ('MISSING' if n == 0 else 'NOT UNIQUE (%d)' % n))); print('%-60s %s' % res[-1], flush=True); continue
    open(p, 'w').write(s.replace(old, new))
    env = dict(os.environ, SKILL_TIMEOUT_MS='300', SKILL_HARD_STOP_GRACE_MS='300', OLLAMA_MODEL='x', OLLAMA_BASE_URL='http://127.0.0.1:11434')
    try:
        r = subprocess.run(['node', 'test/treefarm.test.mjs'], cwd=os.path.join(d, 'bots'), env=env, capture_output=True, text=True, timeout=300)
        fails = [l.strip()[6:90] for l in r.stdout.splitlines() if l.strip().startswith('FAIL')]
        if r.returncode == 0:
            r = subprocess.run(['node', 'test/treefarm-compose.test.mjs'], cwd=os.path.join(d, 'bots'), env=env, capture_output=True, text=True, timeout=300)
            fails = ['compose: ' + l.strip()[6:90] for l in r.stdout.splitlines() if l.strip().startswith('FAIL')]
        why = fails[0] if fails else 'exit %d without a FAIL line: %s' % (r.returncode, (r.stderr.strip().splitlines() or ['-'])[-1][:120])
        res.append((name, ('KILLED by %d: %s' % (len(fails), why)) if r.returncode != 0 else 'SURVIVED'))
    except subprocess.TimeoutExpired:
        res.append((name, 'KILLED (the suite file hung > 300 s)'))
    print('%-60s %s' % res[-1], flush=True)
    shutil.rmtree(d, ignore_errors=True)
print('killed %d / %d' % (sum(1 for _, v in res if v.startswith('KILLED')), len(res)))

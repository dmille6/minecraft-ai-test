#!/usr/bin/env python3
"""Anchored mutants for smeltjob-01 (CLAUDE.md: a mutant must assert its anchor is present and UNIQUE, or a mutant that
silently fails to apply reads as killed). Each mutant is applied to a COPY of bots/ in a temp dir, the named test files
run there, and the mutant is KILLED only if a test fails. Run from bots/:  python3 scripts/smeltjob-mutants.py"""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # bots/
ENV = {**os.environ, 'SKILL_TIMEOUT_MS': '300', 'SKILL_HARD_STOP_GRACE_MS': '300',
       'OLLAMA_MODEL': 'qwen2.5:7b-instruct', 'OLLAMA_BASE_URL': 'http://127.0.0.1:11434'}
SJ = ['test/smeltjob.test.mjs']

MUTANTS = [
    ('the order ignores a ready milestone step', 'src/smeltjob.mjs',
     "  if (holds) return { order: null, state: s, skip: 'milestone' }\n  if (!atTown) return { order: null, state: s, skip: 'away' }\n  if (now < (s.pausedUntil ?? 0)) return { order: null, state: s, skip: 'paused' }\n  if (now - (s.lastIssuedAt ?? -Infinity) < SMELT_JOB_COOLDOWN_MS",
     "  if (!atTown) return { order: null, state: s, skip: 'away' }\n  if (now < (s.pausedUntil ?? 0)) return { order: null, state: s, skip: 'paused' }\n  if (now - (s.lastIssuedAt ?? -Infinity) < SMELT_JOB_COOLDOWN_MS", SJ),
    ('milestoneHolds forgets a rung waiting on room', 'src/smeltjob.mjs',
     'export const milestoneHolds = ({ order = null, ready = null } = {}) => !!order || !!ready?.noRoom',
     'export const milestoneHolds = ({ order = null, ready = null } = {}) => !!order', SJ),
    ('the loop does not wire holds into the order (a rung withheld for room)', 'src/cognitive.mjs',
     '          const holds = milestoneHolds({ order, ready })', '          const holds = false', SJ),
    ('the job burns the peaceful kit\'s swords', 'src/skills.mjs',
     "swordFuel: allowFuels && !allowFuels.has('wooden_sword') ? 0 : swordFuelCount(", 'swordFuel: swordFuelCount(', ['test/smelt-skill.test.mjs']),
    ('carried ingots never make the job eligible', 'src/smeltjob.mjs',
     '  if (!carried && !ingots && lazy(townMiss))', '  if (!carried && lazy(townMiss))', SJ),
    ('away from town still orders', 'src/smeltjob.mjs',
     "  if (!atTown) return { order: null, state: s, skip: 'away' }\n  if (now < (s.pausedUntil ?? 0)) return { order: null, state: s, skip: 'paused' }\n  if (now - (s.lastIssuedAt ?? -Infinity) < SMELT_JOB_COOLDOWN_MS",
     "  if (now < (s.pausedUntil ?? 0)) return { order: null, state: s, skip: 'paused' }\n  if (now - (s.lastIssuedAt ?? -Infinity) < SMELT_JOB_COOLDOWN_MS", SJ),
    ('the cooldown is not charged', 'src/smeltjob.mjs',
     '  // the scan (a town memory read) only after the cheap gates; the cooldown is charged for the LOOK\n  s.lastIssuedAt = now\n',
     '  // the scan (a town memory read) only after the cheap gates; the cooldown is charged for the LOOK\n', SJ),
    ('isolated pools are not switched off', 'src/smeltjob.mjs',
     "  if (scope === 'isolated') return { on: false,", "  if (scope === 'isolated-x') return { on: false,", SJ),
    ('the pause never comes', 'src/smeltjob.mjs',
     '  if (n >= SMELT_JOB_PAUSE_AFTER) {', '  if (n >= SMELT_JOB_PAUSE_AFTER * 100) {', SJ),
    ('the drain opens a lit furnace', 'src/smeltjob.mjs',
     '    if (!f?.k || f.lit) continue', '    if (!f?.k) continue', SJ),
    ('the drain opens a leased furnace', 'src/smeltjob.mjs',
     '    if (leased(f.k)) continue', '    if (false) continue', SJ),
    ('a gain is not a defect', 'src/smeltjob.mjs',
     "verdict: diff === 0 ? 'ok' : diff < 0 ? 'loss' : 'gain'", "verdict: diff <= 0 ? (diff === 0 ? 'ok' : 'loss') : 'ok'", SJ),
    ('uncertain counts as ok', 'src/smeltjob.mjs',
     "  if (uncertain) return { verdict: 'unreconciled', inUnits, outUnits, diff }\n", '', SJ),
    ('the lease ignores another holder', 'src/furnacelease.mjs',
     "    if (top && leaseLive({ ...top, now, ttl }) && top.rec?.holder !== holder) return",
     '    if (false) return', SJ),
    ('a loser to a higher generation keeps the furnace', 'src/furnacelease.mjs',
     '    if (higher.length) {', '    if (false) {', SJ),
    ('smelt takes a leased furnace anyway', 'src/skills.mjs',
     '    if (l.ok) return { block: b, lease: l, n: l.n, unleased: !!l.unleased }',
     '    return { block: b, lease: l, n: l.n, unleased: true }', SJ),
    ('furnace_busy is a failure that teaches', 'src/skills.mjs',
     "  'furnace_busy',\n])", '])', SJ),
    ('smelt never declares its stationary window', 'src/skills.mjs',
     '  bot.furnaceWindowUntil = stationary\n', '',
     ['test/smelt-skill.test.mjs']),
    ('smelt leaves the window declared', 'src/skills.mjs',
     '    if (bot.furnaceWindowUntil === stationary) bot.furnaceWindowUntil = 0\n', '',
     ['test/smelt-skill.test.mjs']),
    # NAMED, NOT SCORED: 'furnace samples count as busy' (the sample's `busy && !furnace`) is EQUIVALENT by construction --
    # activeSpanMs already subtracts every interval touching a furnace sample, and no judgement runs mid-session; the flag
    # is belt and braces. Both of those are mutants here (killed).
    ('D8 undone: stone_bricks back on the junk list', 'src/well.mjs',
     "export const SCAFFOLD_DECORATIONS = Object.freeze(['andesite', 'diorite', 'granite', 'mossy_cobblestone'])",
     "export const SCAFFOLD_DECORATIONS = Object.freeze(['andesite', 'diorite', 'granite', 'mossy_cobblestone', 'stone_bricks'])", SJ),
    ('the runner drops the job\'s own count', 'src/runner.mjs', '      smelted: Number(result.smelted ?? 0),\n', '', SJ),
    ('smelt never declares the stuck reflex\'s window', 'src/skills.mjs', '  const stationary = deadline + 1000\n  bot.stationaryUntil = stationary\n', '  const stationary = deadline + 1000\n', ['test/smelt-skill.test.mjs']),
    ('furnace_busy counts as an attempt at the rung', 'src/milestones.mjs', "'unknown_skill', 'superseded', 'furnace_busy'])", "'unknown_skill', 'superseded'])", SJ),
    ('furnace_busy is unknown again (the runner pause)', 'src/skills.mjs', "    return { status: 'no_effect', failClass: 'furnace_busy',", "    return { status: 'unknown', failClass: 'furnace_busy',", SJ),
    ('the job burns any fuel', 'src/skills.mjs', '    if (!allowFuels) return h\n', '    return h\n', SJ),
    ('the job shares a furnace without a lease', 'src/skills.mjs', "    if (pk.block && pk.unleased && session.opts?.requireLease) {", "    if (false) {", SJ),
    ('the drain walks to a deep furnace', 'src/skills.mjs', '      if (!depositTargetOk(home, p)) continue\n', '', SJ),
    ('the closing read calls anything empty', 'src/skills.mjs', '  out.empty = !out.unreadable && !Object.keys(out.items).length', '  out.empty = true', SJ),
    ('the watchdog judges mid-session', 'src/watchdog.mjs', '    if (furnaceWindow(this.bot)) return\n', '', SJ),
    ('furnace time counts as busy time', 'src/watchdog.mjs', '    if (a.furnace || b.furnace) ms -= Math.min(b.t, to) - Math.max(a.t, from)', '    if (false) ms -= 0', SJ),
    ('the job is not housekeeping', 'src/hygiene.mjs', "'count_town', 'smelt_town', 'furnace_drain'])", "'count_town', 'furnace_drain'])", SJ),
]


def run_tests(root, files):
    for f in files:
        p = subprocess.run(['node', f], cwd=root, env=ENV, capture_output=True, text=True, timeout=600)
        if p.returncode != 0:
            return True, f
    return False, None


def main():
    killed = 0; survivors = []
    for name, rel, old, new, files in MUTANTS:
        with tempfile.TemporaryDirectory(prefix='sjmut-') as tmp:
            root = os.path.join(tmp, 'bots')
            shutil.copytree(HERE, root, symlinks=True, ignore=shutil.ignore_patterns('node_modules'))
            os.symlink(os.path.realpath(os.path.join(HERE, 'node_modules')), os.path.join(root, 'node_modules'))
            path = os.path.join(root, rel)
            src = open(path).read()
            assert old in src, f'ANCHOR MISSING: {name}'
            assert src.count(old) == 1, f'ANCHOR NOT UNIQUE ({src.count(old)}): {name}'
            open(path, 'w').write(src.replace(old, new, 1))
            assert open(path).read() != src, f'MUTANT DID NOT APPLY: {name}'
            # A MUTANT THAT DOES NOT PARSE PROVES NOTHING (Codex code r1 P2-9): it must pass `node --check` first
            chk = subprocess.run(['node', '--check', path], capture_output=True, text=True)
            assert chk.returncode == 0, f'MUTANT DOES NOT PARSE: {name}: {chk.stderr[:200]}'
            k, by = run_tests(root, files)
            print(('KILLED  ' if k else 'SURVIVED') + f'  {name}' + (f'  (by {by})' if k else ''), flush=True)
            killed += k
            if not k:
                survivors.append(name)
    print(f'\n{killed}/{len(MUTANTS)} killed')
    if survivors:
        print('SURVIVORS:', survivors)
    sys.exit(0 if not survivors else 1)


if __name__ == '__main__':
    main()

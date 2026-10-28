#!/usr/bin/env python3
"""Showcase operations ON THE VM: the follower, the deploy (stage / activate), the start gate's checks.
Design: docs/reports/showcase-2026-10-20.md sections 3 and 9. Pure decisions live in followrule.py / make_env.py.

    showcase_ops.py follow                    hourly (timer): observe the bench, decide, act only if AUTO_FOLLOW
    showcase_ops.py stage <sha> [--bootstrap] build releases/<sha8>-<policy8>-<deps8>/ (never touches a bot)
    showcase_ops.py stage <sha> --piece <run>[,<run>...]
                                              the PROGRESS LANE: a stack of showcase-first pieces (each a PIECES.jsonl line)
                                              on top of the current release (docs/reports/showcase-progress-lane-2026-10-25.md 5)
    showcase_ops.py stage <sha> --main [--dry-run [--against <sha>]]
                                              FOLLOW MAIN (fun mode, owner 10-28): a sha on origin/main staged directly; needs
                                              a release-log line (record) with a passing test run + ONE named review; BOTH
                                              engines + a fleet KEEP only when the diff touches config/protected-paths.txt
    showcase_ops.py record --run R --sha S --tests PASS:<sha>:<summary> --review codex:APPROVE:<sha>[:who] [...]
                                              append a release-log line to PIECES.jsonl (append-only; the newest line speaks)
    showcase_ops.py activate <release-dir> [--no-snapshot WHY]
                                              WORLD SNAPSHOT first (snapshots/, newest 6 kept); then switch the harness
                                              symlink; restart+verify running bots 12 s apart; roll back on a failed verify
    showcase_ops.py world-edit --why "..."    the owner-direct one-off world fix: snapshot, then journal an
                                              `owner-direct-world-edit` event in ops/deploy.jsonl; the RCON edit follows by hand
    showcase_ops.py gate                      the start-bots gate: every check, each with its remedy; exit 1 if any fails
    showcase_ops.py status                    the newest follow decision and the current release

Everything that changes state runs under /srv/showcase/ops.lock.
"""
import argparse, datetime as dt, fcntl, glob, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import followrule as FR  # noqa: E402
import make_env as ME    # noqa: E402
import backup_stage as BS  # noqa: E402  (its EXCL: what a world copy leaves out)
import rcon as RC        # noqa: E402
# THE ONE protected-path decider (W1, scripts/lib/protected.py): installed beside this file on the VM, read from the repo here
sys.path.append(os.path.join(HERE, '..', '..', 'scripts', 'lib'))
import protected as PR   # noqa: E402

ROOT = '/srv/showcase'
REPO = f'{ROOT}/repo'
OPS = f'{ROOT}/ops'
LEDGER = f'{OPS}/follow-ledger.jsonl'
FOLLOW = f'{OPS}/follow.jsonl'
DEPLOY = f'{OPS}/deploy.jsonl'
HARNESS = f'{ROOT}/harness'
RELEASES = f'{ROOT}/releases'
ARTIFACTS = f'{ROOT}/artifacts'
SITE = f'{ROOT}/town-site.json'
REQUIRED = f'{ROOT}/REQUIRED_KEPT'
REVOKED = f'{ROOT}/REVOKED'
PIECES = f'{ROOT}/PIECES.jsonl'
AUTO = f'{ROOT}/AUTO_FOLLOW'
# THE PROGRESS LANE (docs/reports/showcase-progress-lane-2026-10-25.md): while this file exists the follower only observes,
# whatever AUTO_FOLLOW says and however it is run (re-review 10-25: the systemd drop-in covered the timer only), and
# start-bots.sh never creates AUTO_FOLLOW.
LANE = f'{ROOT}/LANE'
FEED_KEY = '/home/mike/.ssh/id_ed25519_showcase_feed'
MOD_KEY = '/home/mike/.ssh/id_ed25519_showcase_modules'
BENCH = 'mike@10.0.0.31'
# Runs as ROOT (it restarts units and owns /srv/showcase), with mike's restricted keys and known_hosts.
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'UserKnownHostsFile=/home/mike/.ssh/known_hosts']
NAMES = [ME.PREFIX + n for n in ME.NAMES]
REVERT_NOTE = re.compile(r'revert|back out|roll ?back', re.I)


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def append(path, row):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'a') as f:
        f.write(json.dumps(row) + '\n')


def git(*args, check=True):
    return subprocess.run(['git', '-C', REPO] + list(args), capture_output=True, text=True, check=check).stdout.strip()


def fetch():
    # bounded (re-review 10-25, Codex P2): the follower holds ops.lock across this, and stop-bots.sh waits for that lock
    try:
        subprocess.run(['git', '-C', REPO, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*'],
                       capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        pass


def resolve(h):
    r = subprocess.run(['git', '-C', REPO, 'rev-parse', '--verify', '--quiet', f'{h}^{{commit}}'],
                       capture_output=True, text=True)
    if r.returncode:
        return None
    full = r.stdout.strip()
    return full if full.startswith(h) else None


def is_anc(a, b):
    if a == b:
        return True
    return subprocess.run(['git', '-C', REPO, 'merge-base', '--is-ancestor', a, b], capture_output=True).returncode == 0


def merge_base(a, b):
    r = subprocess.run(['git', '-C', REPO, 'merge-base', a, b], capture_output=True, text=True)
    return r.stdout.strip() or None


def read_feed():
    r = subprocess.run(SSH + ['-i', FEED_KEY, BENCH, 'feed'], capture_output=True, text=True, timeout=180)
    if r.returncode:
        return None, f'feed ssh rc={r.returncode}: {r.stderr.strip()[:200]}'
    try:
        return json.loads(r.stdout), None
    except ValueError as e:
        return None, f'feed not JSON: {e}'


def control_policy(feed):
    ce = (feed or {}).get('control_env') or {}
    if not ce.get('text'):
        return None, None
    try:
        pol = ME.policy_of(ME.parse_env(ce['text']))
    except ValueError:
        # a control env missing a required key: no policy digest -> the observation is unverified (a HOLD row with
        # the reason), never a crash before the ledger row is written
        return None, None
    return pol, FR.digest(pol)


def current_release():
    try:
        r = os.path.realpath(HARNESS)
        return json.load(open(os.path.join(r, 'RELEASE.json'))) if os.path.isdir(r) else None
    except (OSError, ValueError):
        return None


def src_digest(src):
    """config.mjs srcDigest(): sha256 over the sorted top-level *.mjs (not dotfiles) names + bytes, 6 hex."""
    h = hashlib.sha256()
    for f in sorted(x for x in os.listdir(src) if x.endswith('.mjs') and not x.startswith('.')):
        h.update(f.encode())
        h.update(open(os.path.join(src, f), 'rb').read())
    return h.hexdigest()[:6]


def tree_digest(root):
    spec = __import__('importlib.util').util.spec_from_file_location('feed', os.path.join(HERE, 'showcase-feed.py'))
    m = __import__('importlib.util').util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.tree_digest(root)


def lock():
    f = open(f'{ROOT}/ops.lock', 'a')
    fcntl.flock(f, fcntl.LOCK_EX)
    return f


# ------------------------------------------------------------------------------------------------ follow
def cmd_follow(a):
    lk = lock()
    t = now_utc()
    fetch()
    feed, err = read_feed()
    pol, pdig = control_policy(feed) if feed else (None, None)
    ledger = FR.load_jsonl(LEDGER)
    prev_v = next((r['version'] for r in reversed(ledger) if r.get('verified')), None)
    row = FR.observe(dict(feed or {}, errors=(feed or {}).get('errors') or ([err] if err else [])), t, pdig,
                     (feed or {}).get('deps_digest'), prev_v)
    append(LEDGER, row)
    ledger.append(row)
    if feed:
        os.makedirs(OPS, exist_ok=True)
        with open(f'{OPS}/feed-last.json', 'w') as f:
            json.dump(feed, f)
        if row['verified'] and pol:
            # pin the control env of this (sha, policy) so a stage can use the env the fleet actually ran
            p = f'{OPS}/policy-{pdig}.env'
            if not os.path.exists(p):
                with open(p, 'w') as f:
                    f.write(feed['control_env']['text'])
    journal = (feed or {}).get('journal') or []
    promoted = FR.promotions(journal, resolve)
    revoked = [l.split()[0] for l in open(REVOKED).read().splitlines() if l.strip()] if os.path.exists(REVOKED) else []
    rel = current_release()
    d = FR.decide(ledger, promoted, (rel or {}).get('sha'), t, is_anc, merge_base, revoked)
    d['t'] = FR.iso(t)
    warn = [r for r in journal if r.get('phase') in ('promoted', 'owner-direct') and REVERT_NOTE.search(str(r.get('note')))
            and not any(x in str(r.get('note')) for x in revoked)]
    if warn:
        d['revert_notes_not_in_REVOKED'] = [f"{r.get('ts')} {r.get('run')}: {str(r.get('note'))[:100]}" for r in warn[-3:]]
    # a release staged through THIS gate (--main / --piece) runs ahead of the fleet by design: the fleet follower must never
    # act on it (it would judge it inadmissible and roll it back) -- observe only, whatever AUTO_FOLLOW says (Codex W2 r1)
    gated = bool((rel or {}).get('piece')) or (rel or {}).get('mode') == 'main'
    d['auto'] = os.path.exists(AUTO) and not os.path.exists(LANE) and not gated
    d['lane'] = os.path.exists(LANE)
    d['gated_release'] = gated
    append(FOLLOW, d)
    print(json.dumps(d))
    if not d['auto'] or getattr(a, 'observe_only', False) or os.path.exists(LANE) or gated:
        return 0
    if not feed:
        return 0      # no fresh feed this hour: never act on stale evidence (an empty journal would read as "not kept")
    if d['decision'] in ('DUE', 'ROLLBACK'):
        ok, missing = pieces_in(d['target'], (feed or {}).get('journal') or [])
        if not ok:
            # The town plan's required pieces are re-checked on EVERY deploy: a release that would lose one is not
            # run at all (design section 3) -- the bots stop instead.
            append(FOLLOW, dict(d, decision='STOP', reason=f'target {d["target"][:8]} lacks required pieces {missing}'))
            subprocess.run(['/srv/showcase/bin/stop-bots.sh', f'target lacks required pieces {missing}'],
                           env=dict(os.environ, SHOWCASE_LOCK_HELD='1'))
            return 1
        rc = stage(d['target'], d['policy'], (feed or {}).get('deps_digest'), bootstrap=False, why=d['reason'])
        if rc[0]:
            # On a ROLLBACK the release being left is INADMISSIBLE: a failed activation must stop the bots, never
            # restore it.
            return activate(rc[1], prev_admissible=d['decision'] != 'ROLLBACK')
        if d['decision'] == 'ROLLBACK':
            subprocess.run(['/srv/showcase/bin/stop-bots.sh', f'rollback target could not be staged: {rc[1][:150]}'],
                           env=dict(os.environ, SHOWCASE_LOCK_HELD='1'))
        return 1
    if d['decision'] == 'STOP':
        subprocess.run(['/srv/showcase/bin/stop-bots.sh', f"follow STOP: {d['reason'][:200]}"],
                       env=dict(os.environ, SHOWCASE_LOCK_HELD='1'))
    return 0


# ------------------------------------------------------------------------------------------------ stage
def capture_modules(want_digest):
    """The immutable dependency artifact for `want_digest`: rsync .31's installed tree (read-only rrsync key), check
    its content digest equals the observed one, keep it as a tar. -> path or raises."""
    os.makedirs(ARTIFACTS, exist_ok=True)
    art = f'{ARTIFACTS}/node_modules-{want_digest}.tar'
    if os.path.exists(art):
        return art
    tmp = tempfile.mkdtemp(dir=ARTIFACTS)
    try:
        r = subprocess.run(['rsync', '-a', '--delete', '-e', ' '.join(SSH + ['-i', MOD_KEY]),
                            f'{BENCH}:', f'{tmp}/node_modules/'], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(f'modules rsync rc={r.returncode}: {r.stderr.strip()[:200]}')
        got = tree_digest(f'{tmp}/node_modules')
        if got != want_digest:
            raise RuntimeError(f'copied node_modules digest {got} != observed {want_digest} (the bench changed its '
                               f'tree during the copy?); retry at the next run')
        subprocess.run(['tar', '-C', tmp, '-cf', art + '.part', 'node_modules'], check=True)
        os.replace(art + '.part', art)
        return art
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def stage(sha, policy_dig, deps_dig, bootstrap=False, why='', extra=None):
    if not (sha and re.fullmatch(r'[0-9a-f]{40}', sha)):
        return False, f'sha must be 40 hex: {sha!r}'
    if not policy_dig or not os.path.exists(f'{OPS}/policy-{policy_dig}.env'):
        return False, f'no pinned control env for policy {policy_dig}; run `showcase_ops.py follow` first'
    if not deps_dig:
        return False, 'no dependency digest observed; run `showcase_ops.py follow` first'
    name = f'{sha[:8]}-{policy_dig[:8]}-{deps_dig[:8]}'
    dst = f'{RELEASES}/{name}'
    if os.path.exists(f'{dst}/RELEASE.json'):
        # a PIECE release is never served from a cache that lacks its piece record (an earlier plain stage of the same sha)
        old = json.load(open(f'{dst}/RELEASE.json'))
        if extra and any(old.get(k) != v for k, v in extra.items() if k in ('piece', 'prev', 'prev_release', 'mode')):
            return False, f'{name} is already staged without (or with another) piece record {old.get("piece")}; remove it first'
        if not extra and old.get('piece'):
            return False, f'{name} is staged as the piece release {old.get("piece")}; a plain stage never reuses it (remove it first)'
        return True, dst
    tmp = tempfile.mkdtemp(dir=RELEASES, prefix='.stage-')
    try:
        arch = subprocess.run(['git', '-C', REPO, 'archive', sha, 'bots/src', 'bots/package.json'],
                              capture_output=True, check=True).stdout
        subprocess.run(['tar', '-C', tmp, '-xf', '-', '--strip-components=1'], input=arch, check=True)
        art = capture_modules(deps_dig)
        subprocess.run(['tar', '-C', tmp, '-xf', art], check=True)
        got = tree_digest(f'{tmp}/node_modules')
        if got != deps_dig:
            raise RuntimeError(f'unpacked node_modules digest {got} != {deps_dig}')
        shutil.copy(f'{OPS}/policy-{policy_dig}.env', f'{tmp}/control.env')
        os.makedirs(f'{tmp}/env', exist_ok=True)
        rel = {'sha': sha, 'policy': policy_dig, 'deps': deps_dig, 'expected_version': f'{sha}+{src_digest(tmp + "/src")}',
               'staged_at': FR.iso(now_utc()), 'bootstrap': bootstrap, 'why': why, **(extra or {})}
        if os.path.exists(SITE):
            write_envs(tmp, rel)
        with open(f'{tmp}/RELEASE.json', 'w') as f:
            json.dump(rel, f, indent=1)
        subprocess.run(['chmod', '-R', 'a+rX', tmp], check=True)
        os.rename(tmp, dst)
        append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'staged', 'release': name, **rel})
        return True, dst
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'stage-failed', 'sha': sha, 'error': str(e)[:300]})
        return False, str(e)


# ---- THE RELEASE GATE (fun mode, OWNER 2026-10-28; docs/PROCESS-fun-mode.md) --------------------------------------------
# A showcase release needs a PASSING TEST RECORD and ONE NAMED REVIEW (Codex or Claude, APPROVE) bound to its sha. Only a
# release whose diff touches a PROTECTED path (config/protected-paths.txt: movement, reflexes, mining depth, death handling,
# ...) also needs BOTH engines AND a fleet KEEP. Paper is optional evidence (an explicit Paper FAIL of the sha still refuses).
# Kept from the progress lane: ancestry (a release never steps back over the showcase's own commits), REVOKED (ancestry or
# patch equivalence), REQUIRED_KEPT, the version verify after activation, and rollback to the previous release.
PAPER_OK = ('CANDIDATE_PASS', 'PASS')
PAPER_FAIL = ('CANDIDATE_FAIL', 'FAIL')
TESTS_OK = ('PASS',)
TESTS_RUNNER = 'npm test'   # the canonical runner (CLAUDE.md); a PASS from anything else is no test record
ENGINES = ('codex', 'claude')
HEX40 = re.compile(r'[0-9a-f]{40}')
PROTECTED_LIST = 'config/protected-paths.txt'


def protected_hits(hits, patterns):
    """The protected hits of one diff, FAIL CLOSED -> [hit]. `hits`: scripts/lib/protected.py's hits() for the diff, or None
    when it could not be computed; `patterns`: the parsed list, None or empty when unreadable (protected.py's own CLI treats an
    empty list as "could not decide"). Either failure is ONE pseudo-hit naming why, so the release is judged as protected."""
    if not patterns:
        return [f'(no {PROTECTED_LIST} readable: every change counts as protected)']
    if hits is None:
        return ['(the protected decider could not read the diff: counts as protected)']
    return list(hits)


def make_covers(is_anc, docs_only):
    def covers(evidence_sha, psha):
        # the evidence names the release's sha, or an ancestor of it with nothing but docs/ changed since (an approval or a
        # test run never covers code that came after it)
        e = str(evidence_sha or '')
        return bool(HEX40.fullmatch(e)) and (e == psha or (is_anc(e, psha) and docs_only(e, psha)))
    return covers


def evidence_refusal(name, row, psha, hits, covers, fleet_kept):
    """ONE release-log line's evidence for the code at psha -> None | why. Pure.
      tests    {"result": "PASS", "sha": <40 hex>, "runner": "npm test", "summary": "..."} covering psha
      reviews  >= ONE {"engine": "codex"|"claude", "verdict": "APPROVE", "sha": <40 hex>} covering psha (free text never counts)
      hits     the protected paths the release changes: non-empty -> BOTH engines, and fleet_kept(psha) -> (True, why)
      paper    optional: an explicit FAIL covering psha refuses; a PASS or no record changes nothing."""
    t = row.get('tests')
    if not (isinstance(t, dict) and t.get('result') in TESTS_OK and t.get('runner') == TESTS_RUNNER and covers(t.get('sha'), psha)):
        return (f'{name}: no passing test record for {psha[:8]} (tests: {{"result": "PASS", "sha": <40 hex>, "runner": '
                f'"npm test", "summary": ...}}; got {str(t)[:80]!r})')
    engines = {str(x.get('engine') or '').lower() for x in (row.get('reviews') or [])
               if isinstance(x, dict) and x.get('verdict') == 'APPROVE' and covers(x.get('sha'), psha)} & set(ENGINES)
    if not engines:
        return (f'{name}: no named APPROVE of {psha[:8]} (reviews: [{{"engine": "codex"|"claude", "verdict": "APPROVE", '
                f'"sha": <40 hex>}}])')
    p = row.get('paper')
    if isinstance(p, dict) and p.get('result') in PAPER_FAIL and covers(p.get('sha'), psha):
        return f'{name}: its Paper record is a FAIL of {psha[:8]}'
    if hits:
        what = ', '.join(hits[:3]) + (f' +{len(hits) - 3}' if len(hits) > 3 else '')
        missing = [e for e in ENGINES if e not in engines]
        if missing:
            return f'{name}: touches protected paths ({what}) -- needs BOTH engines; no {missing[0].capitalize()} APPROVE of {psha[:8]}'
        ok, why = fleet_kept(psha)
        if not ok:
            return f'{name}: touches protected paths ({what}) -- needs a fleet KEEP first ({why})'
    return None


def revoked_refusal(sha, revoked, is_anc, revoked_in):
    for x in revoked or []:
        hit = is_anc(x, sha) or revoked_in(x, sha)
        if hit == 'unreadable':
            return f'the REVOKED line {x[:12]} is unreadable here (fetch it or fix the line): nothing stages until it is'
        if hit:
            return f'the release contains a REVOKED sha {x[:8]}'
    return None


def piece_stack_refusal(sha, release_sha, runs, rows, commits, is_anc, revoked_in, revoked, docs_only=None, protected=None,
                        patterns=None, fleet_kept=None):
    """`stage <sha> --piece <run>[,<run>...]`: a STACK of release-log lines on top of the current release -> None | why. Pure.
      sha         the stack's tip; release_sha the CURRENT showcase release; runs the stack's names (in any order)
      rows        PIECES.jsonl rows; the NEWEST row of a run speaks for it (rows without 'run' are log events, ignored)
      commits     every commit in release_sha..sha (git rev-list)
      protected   protected(a, b) -> [hit] | None (protected.py over the diff a..b); a piece's hits are its own range base..sha
      patterns    the parsed protected list (None / empty: unreadable -> fail closed, every piece counts as protected)
      fleet_kept  fleet_kept(run, psha) -> (ok, why), asked only for a piece that touches a protected path
      docs_only   docs_only(a, b) -> True when every path changed in a..b is under docs/
      revoked_in  revoked_in(x, sha) -> True when the revoked commit x's OWN patch is in the stack
    Refused unless: the current release is the tip's ancestor and the stack adds something; every named run's newest line
    passes evidence_refusal(); every piece's sha and base are ancestors of the tip (a re-stacked piece needs a line naming its
    re-stacked sha: patch equivalence is not membership); NOTHING in release..sha lies outside the named pieces' own ranges
    (base, sha]; no REVOKED sha is in the stack. `kind` is a label only (building / survival / ...): it no longer gates."""
    docs_only = docs_only or (lambda a, b: False)
    fleet_kept = fleet_kept or (lambda run, psha: (False, 'no fleet record'))
    if not (sha and HEX40.fullmatch(sha)):
        return f'sha must be 40 hex: {sha!r}'
    if not release_sha:
        return 'no current release: a piece stacks on a release (stage --bootstrap or --main first)'
    if sha == release_sha or not commits:
        return f'{sha[:8]} adds nothing to the current release {release_sha[:8]}'
    if not is_anc(release_sha, sha):
        return f'the current release {release_sha[:8]} is not an ancestor of {sha[:8]}: a piece stack builds ON the showcase release'
    if not runs:
        return 'no piece named (--piece <run>[,<run>...])'
    if len(set(runs)) != len(runs):
        return f'a piece named twice: {runs}'
    covers = make_covers(is_anc, docs_only)
    pieces = []
    for run in runs:
        mine = [r for r in rows if isinstance(r, dict) and r.get('run') == run]
        if not mine:
            return f'{run}: no PIECES.jsonl line (record it first: showcase_ops.py record)'
        r = mine[-1]
        psha, base = str(r.get('sha') or ''), str(r.get('base') or '')
        if not HEX40.fullmatch(psha) or not HEX40.fullmatch(base):
            return f'{run}: its line needs a 40-hex sha and base ({psha[:12]!r}, {base[:12]!r})'
        hits = protected_hits(protected(base, psha) if protected else None, patterns)
        why = evidence_refusal(run, r, psha, hits, covers, lambda s, run=run: fleet_kept(run, s))
        if why:
            return why
        if not is_anc(psha, sha):
            return f'{run}: its sha {psha[:8]} is not in the stack {sha[:8]} (a re-stacked piece needs a line naming its re-stacked sha)'
        if not is_anc(base, sha):
            return f'{run}: its base {base[:8]} is not an ancestor of the stack {sha[:8]}'
        pieces.append((psha, base))
    # a commit belongs to a piece when it lies in that piece's OWN range (base, sha]: the tip's ancestry alone would let every
    # commit below it ride along unnamed
    stray = [c for c in commits if not any(c != b and is_anc(b, c) and is_anc(c, p) for p, b in pieces)]
    if stray:
        return f'{len(stray)} commit(s) in {release_sha[:8]}..{sha[:8]} belong to no named piece (first {stray[0][:8]}): stage only reviewed pieces'
    return revoked_refusal(sha, revoked, is_anc, revoked_in)


def main_release_refusal(sha, release_sha, main_tip, rows, is_anc, carries, revoked_in, revoked, docs_only, protected, patterns,
                         fleet_kept):
    """`stage <sha> --main`: THE SHOWCASE FOLLOWS MAIN (owner 10-28) -- a sha on main, staged directly -> None | why. Pure.
      main_tip    origin/main; sha must be it or its ancestor
      release_sha the current showcase release (None: the first release); carries(release, sha) -> True when every commit
                  of the release is in sha (ancestry, or each one patch-equivalent): the showcase never steps BACK over its
                  own improvements -- merge them into main first
      rows        the release log (PIECES.jsonl): the NEWEST line whose sha is `sha`, or an ancestor of it with only docs/
                  changed since, is this release's evidence (evidence_refusal)
      protected   protected(a, b) -> [hit] | None over release..sha (the whole tree for a first release, a = None)
      fleet_kept  fleet_kept(sha) -> (ok, why), asked only when a protected path changed
    No stack rule here: main is the trunk and the release log names who reviewed and tested this exact sha."""
    if not (sha and HEX40.fullmatch(sha)):
        return f'sha must be 40 hex: {sha!r}'
    if not (main_tip and HEX40.fullmatch(main_tip)):
        return f'origin/main is not readable here ({main_tip!r}): fetch first'
    if not is_anc(sha, main_tip):
        return f'{sha[:8]} is not on main (origin/main {main_tip[:8]}): --main stages only a sha main contains'
    if release_sha:
        if sha == release_sha:
            return f'{sha[:8]} is already the current release'
        if not carries(release_sha, sha):
            return (f'{sha[:8]} does not contain the current release {release_sha[:8]} (by ancestry or patch equivalence): it would '
                    f'drop showcase commits -- merge them into main first')
    covers = make_covers(is_anc, docs_only)
    mine = [r for r in rows if isinstance(r, dict) and r.get('run') and covers(r.get('sha'), sha)]
    if not mine:
        return f'no release-log line (PIECES.jsonl) names {sha[:8]}: record its tests and review first (showcase_ops.py record)'
    r = mine[-1]
    hits = protected_hits(protected(release_sha, sha), patterns)
    why = evidence_refusal(r['run'], r, r['sha'], hits, covers, lambda s: fleet_kept(sha))
    if why:
        return why
    return revoked_refusal(sha, revoked, is_anc, revoked_in)


def survival_kept(journal, run, psha, resolve_hex):
    """A survival piece's fleet record, BOUND TO ITS SHA -> (ok, why). ok iff the journal has a `recorded` KEEP row for the run
    and a `promoted` row for it whose note names (resolves to) the piece's own sha. owner-direct does not count: a piece is
    a canary-kept change (lane doc 6), and followrule.kept_runs ignores the sha."""
    rows = [r for r in journal if r.get('run') == run]
    keep = any(r.get('phase') == 'recorded' and str(r.get('note', '')).strip().split(' ')[0].upper() == 'KEEP' for r in rows)
    named = any(r.get('phase') == 'promoted' and any(resolve_hex(h) == psha for h in FR.HEX.findall(str(r.get('note', ''))))
                for r in rows)
    if keep and named:
        return True, 'kept and promoted at its sha'
    return False, (f'{run}: KEEP {"yes" if keep else "no"}, a promotion naming {psha[:8]} {"yes" if named else "no"} '
                   f'(journal phases {sorted({str(r.get("phase")) for r in rows})})')


def docs_only_change(a, b, repo=None):
    """Every path changed between a and b is under docs/ -> bool. --no-renames (r2, both reviews P2: with rename detection a
    code file MOVED into docs/ lists only its docs/ destination), NUL-separated names, submodule (gitlink) changes shown; a
    failed diff is False (fail closed); identical trees are True."""
    out = subprocess.run(['git', '-C', repo or REPO, 'diff', '--no-renames', '--name-only', '-z', '--ignore-submodules=none', a, b],
                         capture_output=True)
    if out.returncode:
        return False
    names = [n for n in out.stdout.decode('utf-8', 'surrogateescape').split('\0') if n]
    return all(n.startswith('docs/') for n in names)


EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'


def _patch_ids(args, repo):
    """`git <args> | git patch-id --stable` -> ({patch id: commit}, ok)."""
    log = subprocess.run(['git', '-C', repo, *args], capture_output=True)
    if log.returncode:
        return {}, False
    pid = subprocess.run(['git', '-C', repo, 'patch-id', '--stable'], input=log.stdout, capture_output=True)
    if pid.returncode:
        return {}, False
    out = {}
    for line in pid.stdout.decode('utf-8', 'replace').splitlines():
        parts = line.split()
        if len(parts) == 2:
            out[parts[0]] = parts[1]
    return out, True


def revoked_patch_in(x, sha, repo=None):
    """The revoked commit x's OWN patch is in sha's history -> bool, by `git patch-id --stable`: x's change against its FIRST
    parent (a merge: what `cherry-pick -m 1` applies; a root: against the empty tree) compared with every commit reachable
    from sha and not from x, each against its first parent (r3, Codex P2 x2: `git cherry` skips merges and needs x^).
    FAILS CLOSED: an unreadable x or a git failure is True (the stack is refused, naming the REVOKED line)."""
    repo = repo or REPO
    par = subprocess.run(['git', '-C', repo, 'rev-list', '--parents', '-n', '1', x], capture_output=True, text=True)
    if par.returncode or not par.stdout.split():
        return 'unreadable'   # truthy: refused, and named as unreadable (Claude r4 P3)
    parents = par.stdout.split()[1:]
    base = [parents[0], x] if parents else ['--root', x]
    # --no-renames on BOTH sides (Codex r4 P2: diff-tree shows a rename as delete + add while log detects it: two patch ids)
    mine, ok = _patch_ids(['diff-tree', '-p', '--no-color', '--full-index', '--no-renames', *base], repo)
    if not ok:
        return True
    if not mine:
        return False   # an empty change (nothing to re-apply)
    want = set(mine)
    theirs, ok = _patch_ids(['log', '-p', '--no-color', '--full-index', '--no-renames', '--diff-merges=first-parent', '--format=commit %H', sha, f'^{x}'], repo)
    if not ok:
        return True
    return bool(want & set(theirs))


def write_envs(release_dir, rel):
    control = ME.parse_env(open(f'{release_dir}/control.env').read())
    site = json.load(open(SITE))
    os.makedirs(f'{release_dir}/env', exist_ok=True)
    for i, n in enumerate(ME.NAMES):
        rows = ME.build_env(control, i, site, rel['sha'])
        with open(f'{release_dir}/env/{ME.PREFIX}{n}.env', 'w') as f:
            f.write('\n'.join(f'{k}={v}' for k, v in rows) + '\n')


def cmd_stage(a):
    lk = lock()
    fetch()
    feed = json.load(open(f'{OPS}/feed-last.json')) if os.path.exists(f'{OPS}/feed-last.json') else None
    ledger = FR.load_jsonl(LEDGER)
    last = ledger[-1] if ledger else {}
    sha = resolve(a.sha) or a.sha
    if getattr(a, 'against', None) and not getattr(a, 'dry_run', False):
        print('REFUSED: --against only with --dry-run (a real stage always stacks on the CURRENT release)')
        return 1
    if getattr(a, 'main', False):
        return stage_main(a, sha, feed, last, ledger)
    if getattr(a, 'piece', None):
        return stage_piece(a, sha, feed, last)
    if getattr(a, 'dry_run', False):
        print('REFUSED: --dry-run is for --main or --piece')
        return 1
    if a.bootstrap:
        promoted = FR.promotions((feed or {}).get('journal') or [], resolve)
        if not last.get('verified'):
            print('REFUSED: the newest observation is not verified; run `showcase_ops.py follow`')
            return 1
        if not any(p[1] == sha for p in promoted) or not is_anc(sha, last['sha']):
            print(f'REFUSED: --bootstrap takes only a PROMOTED sha inside the current verified fleet build '
                  f'{last["sha"][:8]}; {sha[:8]} is not')
            return 1
    else:
        d = (FR.load_jsonl(FOLLOW) or [{}])[-1]
        if d.get('decision') not in ('DUE', 'ROLLBACK') or d.get('target') != sha:
            print(f'REFUSED: the follow rule does not name {sha[:8]} (newest decision: {d.get("decision")} '
                  f'{(d.get("target") or "")[:8]}); use --main for a sha on main, --bootstrap for the first release')
            return 1
    ok, out = stage(sha, last.get('policy'), last.get('deps'), bootstrap=a.bootstrap, why='operator stage')
    print(('STAGED ' if ok else 'FAILED ') + out)
    return 0 if ok else 1


# ---- the gate's git and journal inputs (impure; the decisions above are pure)
def read_protected(shas, repo=None):
    """The UNION of config/protected-paths.txt (protected.parse_patterns) at each of these shas -- the current release, the
    candidate, origin/main -- so a change can never shrink its own list. None when no copy is readable at any of them."""
    pats = None
    for s in dict.fromkeys(x for x in shas if x):
        r = subprocess.run(['git', '-C', repo or REPO, 'show', f'{s}:{PROTECTED_LIST}'], capture_output=True, text=True)
        if r.returncode == 0:
            pats = (pats or []) + [p for p in PR.parse_patterns(r.stdout) if p not in (pats or [])]
    return pats


def protected_diff(a, b, patterns, repo=None):
    """protected.py's decision for the diff a..b (a None: the whole tree of b) -> [hit] | None (could not decide). The same
    git call and reader as protected.py's CLI, on a two-dot diff: what the showcase would actually change."""
    repo = repo or REPO
    try:
        g = lambda *x: subprocess.run(['git', '-C', repo, *x], capture_output=True, text=True, check=True).stdout
        changes = PR.parse_diff(g('diff', '-U0', '-M', '--no-color', a or EMPTY_TREE, b))
        revs = {'old': a or EMPTY_TREE, 'new': b}

        def reader(side, path):
            try:
                return g('show', f'{revs[side]}:{path}')
            except subprocess.CalledProcessError:
                return None
        return PR.hits(changes, patterns or [], reader)
    except Exception:  # noqa: BLE001 -- could not decide = protected (protected_hits)
        return None


def kept_builds(journal, ledger, resolve_hex):
    """Fleet builds whose code counts as KEPT: every `promoted` sha of a run with a recorded KEEP, newest first, then the newest
    VERIFIED fleet control build (the fleet runs it fleet-wide under the tripwire and death breaker)."""
    keep_runs = {r.get('run') for r in journal
                 if r.get('phase') == 'recorded' and str(r.get('note', '')).strip().split(' ')[0].upper() == 'KEEP'}
    out = [p[1] for p in FR.promotions(journal, resolve_hex) if p[2] in keep_runs]
    ver = [r for r in ledger if r.get('verified') and HEX40.fullmatch(str(r.get('sha') or ''))]
    if ver:
        out.append(ver[-1]['sha'])
    return list(dict.fromkeys(out))


def make_fleet_kept(builds, patterns, protected):
    """-> fleet_kept(psha) -> (ok, why): ok when psha's PROTECTED code equals some kept fleet build's (protected(build, psha)
    decides and finds no hit). An unreadable list or an undecided diff never matches (fail closed)."""
    def fk(psha):
        for k in builds:
            if patterns:
                h = protected(k, psha)
                if h is not None and not h:
                    return True, f'protected code identical to the fleet-kept build {k[:8]}'
        return False, (f'its protected code matches none of the {len(builds)} fleet-kept builds (a KEEP+promotion, or the '
                       f'verified fleet build)' if patterns else f'no {PROTECTED_LIST} readable')
    return fk


def carries_release(release, sha):
    return is_anc(release, sha) or cherry_equivalent(release, sha)


def read_revoked():
    return [l.split()[0] for l in open(REVOKED).read().splitlines() if l.strip()] if os.path.exists(REVOKED) else []


def gate_record(row, mode, list_readable, hits):
    """What RELEASE.json and the release log carry about the evidence that let this release through."""
    rv = [x for x in (row.get('reviews') or []) if isinstance(x, dict) and x.get('verdict') == 'APPROVE']
    return {'mode': mode, 'evidence': row.get('run'), 'evidence_sha': row.get('sha'),
            'reviewers': sorted({f"{x.get('engine')}{':' + str(x['reviewer']) if x.get('reviewer') else ''}" for x in rv}),
            'tests': row.get('tests'), 'protected': hits[:10], 'protected_list': list_readable}


def stage_main(a, sha, feed, last, ledger):
    """`stage <sha> --main [--dry-run [--against <release sha>]]`: THE SHOWCASE FOLLOWS MAIN. AUTO_FOLLOW absent (the follower
    must not fight an operator release), the newest observation verified (its pinned policy and dependency digest are the
    release's), main_release_refusal None, REQUIRED_KEPT still passes. RELEASE.json carries mode: main, piece: [the evidence
    line's run], gate: gate_record(), prev, prev_release; the release log gets a `staged` event line. Every refusal is
    journalled `release-refused` (not on a dry run). Stages only: activation is `activate <release>`."""
    dry = bool(getattr(a, 'dry_run', False))

    def refuse(why):
        print(f'REFUSED{" (dry run)" if dry else ""}: {why}')
        if not dry:
            append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'release-refused', 'mode': 'main', 'sha': sha, 'why': why[:300]})
        return 1
    if a.bootstrap or getattr(a, 'piece', None):
        return refuse('--main is exclusive with --bootstrap and --piece')
    if os.path.exists(AUTO):
        return refuse(f'{AUTO} is on: the follower owns releases while it is (remove it to stage from main)')
    if not last.get('verified'):
        return refuse('the newest observation is not verified; run `showcase_ops.py follow --observe-only`')
    main_tip = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}', check=False) or None
    cur = current_release()
    rel_sha = getattr(a, 'against', None) and (resolve(a.against) or a.against) or (cur or {}).get('sha')
    rows = FR.load_jsonl(PIECES)
    journal = (feed or {}).get('journal') or []
    pats = read_protected([rel_sha, sha, main_tip])
    prot = lambda x, y: protected_diff(x, y, pats)
    fk = make_fleet_kept(kept_builds(journal, ledger, resolve), pats, prot)
    why = main_release_refusal(sha, rel_sha, main_tip, rows, is_anc, carries_release, revoked_patch_in, read_revoked(),
                               docs_only_change, prot, pats, fk)
    if why:
        return refuse(why)
    ok, missing = pieces_in(sha, journal)
    if not ok:
        return refuse(f'{sha[:8]} lacks the required pieces {missing} (REQUIRED_KEPT)')
    covers = make_covers(is_anc, docs_only_change)
    row = [r for r in rows if isinstance(r, dict) and r.get('run') and covers(r.get('sha'), sha)][-1]
    rec = gate_record(row, 'main', bool(pats), protected_hits(prot(rel_sha, sha), pats))
    if dry:
        print(f'DRY RUN -- WOULD STAGE {sha[:8]} on {str(rel_sha)[:8]}: {json.dumps(rec)}')
        return 0
    prev = os.path.basename(os.path.realpath(HARNESS)) if os.path.islink(HARNESS) else None
    ok, out = stage(sha, last.get('policy'), last.get('deps'), bootstrap=False, why=f'main release ({row.get("run")})',
                    extra={'mode': 'main', 'piece': [row.get('run')], 'gate': rec, 'prev': rel_sha, 'prev_release': prev})
    if not ok:
        return refuse(out)
    append(PIECES, {'event': 'staged', 't': FR.iso(now_utc()), 'sha': sha, 'release': os.path.basename(out), 'prev': rel_sha, **rec})
    print('STAGED ' + out)
    return 0


def stage_piece(a, sha, feed, last):
    """`stage <sha> --piece <runs> [--dry-run [--against <release sha>]]`: the lane only (LANE present, AUTO_FOLLOW absent),
    the newest observation verified (its pinned policy and dependency digest are the release's), piece_stack_refusal None,
    and REQUIRED_KEPT still passes against the stack (pieces_in). RELEASE.json carries piece: [runs, sorted], gate, prev: the
    release sha it stacks on, prev_release: the harness release dir. Every refusal is journalled `piece-refused` in
    ops/deploy.jsonl (not on a dry run). Stages only: activation is `showcase_ops.py activate <release>`."""
    runs = sorted(r.strip() for r in a.piece.split(',') if r.strip())
    dry = bool(getattr(a, 'dry_run', False))

    def refuse(why):
        print(f'REFUSED{" (dry run)" if dry else ""}: {why}')
        if not dry:
            append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'piece-refused', 'sha': sha, 'piece': runs, 'why': why[:300]})
        return 1
    if a.bootstrap:
        return refuse('--piece and --bootstrap are exclusive')
    if not os.path.exists(LANE) or os.path.exists(AUTO):
        return refuse(f'a piece stages only in the progress lane ({LANE} present, {AUTO} absent)')
    if not last.get('verified'):
        return refuse('the newest observation is not verified; run `showcase_ops.py follow --observe-only`')
    cur = current_release()
    rel_sha = getattr(a, 'against', None) and (resolve(a.against) or a.against) or (cur or {}).get('sha')
    rows = FR.load_jsonl(PIECES)
    commits = git('rev-list', f'{rel_sha}..{sha}', check=False).split() if rel_sha and resolve(sha) else []
    journal = (feed or {}).get('journal') or []
    main_tip = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}', check=False) or None
    pats = read_protected([rel_sha, sha, main_tip])
    prot = lambda x, y: protected_diff(x, y, pats)
    fk = make_fleet_kept(kept_builds(journal, FR.load_jsonl(LEDGER), resolve), pats, prot)

    def fleet_kept(run, psha):
        ok, why = survival_kept(journal, run, psha, resolve)
        return (ok, why) if ok else fk(psha)
    why = piece_stack_refusal(sha, rel_sha, runs, rows, commits, is_anc, revoked_patch_in, read_revoked(), docs_only_change,
                              prot, pats, fleet_kept)
    if why:
        return refuse(why)
    ok, missing = pieces_in(sha, journal)   # REQUIRED_KEPT against the stack
    if not ok:
        return refuse(f'{sha[:8]} lacks the required pieces {missing} (REQUIRED_KEPT)')
    newest = {r: [x for x in rows if isinstance(x, dict) and x.get('run') == r][-1] for r in runs}
    rec = {'mode': 'piece', 'pieces': {r: gate_record(newest[r], 'piece', bool(pats),
                                                      protected_hits(prot(newest[r]['base'], newest[r]['sha']), pats))
                                       for r in runs}}
    if dry:
        print(f'DRY RUN -- WOULD STAGE {sha[:8]} ({",".join(runs)}) on {str(rel_sha)[:8]}: {json.dumps(rec)}')
        return 0
    prev = os.path.basename(os.path.realpath(HARNESS)) if os.path.islink(HARNESS) else None
    ok, out = stage(sha, last.get('policy'), last.get('deps'), bootstrap=False, why=f'piece stack {",".join(runs)}',
                    extra={'piece': runs, 'gate': rec, 'prev': rel_sha, 'prev_release': prev})
    if not ok:
        return refuse(out)   # a conflicting cached release included (Codex r2 P3)
    append(PIECES, {'event': 'staged', 't': FR.iso(now_utc()), 'sha': sha, 'release': os.path.basename(out), 'prev': rel_sha,
                    'piece': runs})
    print('STAGED ' + out)
    return 0


# ------------------------------------------------------------------------------------------------ record (the release log)
def release_line(run, sha, tests, reviews, kind='release', base=None, paper=None, note=None, t=None):
    """A release-log line for PIECES.jsonl -> (row, None) | (None, why). Pure. tests 'PASS|FAIL:<40 hex>:<summary>'; each review
    '<engine>:<verdict>:<40 hex>[:<reviewer>]'. The log is APPEND-ONLY: a corrected record is a new line (the newest speaks)."""
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', run or ''):
        return None, f'run must be a short name: {run!r}'
    if not HEX40.fullmatch(sha or ''):
        return None, f'sha must be 40 hex: {sha!r}'
    if base is not None and not HEX40.fullmatch(base):
        return None, f'base must be 40 hex: {base!r}'
    tp = (tests or '').split(':', 2)
    if len(tp) < 2 or tp[0] not in ('PASS', 'FAIL') or not HEX40.fullmatch(tp[1]):
        return None, f'--tests is PASS|FAIL:<40 hex>[:<summary>], got {tests!r}'
    rv = []
    for x in reviews or []:
        p = x.split(':', 3)
        if len(p) < 3 or p[0].lower() not in ENGINES or not HEX40.fullmatch(p[2]) or not p[1]:
            return None, f'--review is <codex|claude>:<VERDICT>:<40 hex>[:<reviewer>], got {x!r}'
        rv.append(dict({'engine': p[0].lower(), 'verdict': p[1], 'sha': p[2]}, **({'reviewer': p[3]} if len(p) == 4 else {})))
    if not rv:
        return None, 'at least one --review'
    row = {'run': run, 'sha': sha, 'kind': kind,
           'tests': {'result': tp[0], 'sha': tp[1], 'runner': 'npm test', 'summary': tp[2] if len(tp) == 3 else ''},
           'reviews': rv, 'recorded_at': FR.iso(t or now_utc())}
    if base:
        row['base'] = base
    if paper:
        pp = paper.split(':', 2)
        if len(pp) < 2 or not HEX40.fullmatch(pp[1]):
            return None, f'--paper is <RESULT>:<40 hex>[:<record>], got {paper!r}'
        row['paper'] = {'result': pp[0], 'sha': pp[1], 'record': pp[2] if len(pp) == 3 else ''}
    if note:
        row['notes'] = note[:500]
    return row, None


def cmd_record(a):
    lk = lock()
    fetch()
    full = lambda h: resolve(h) or h if h else h
    row, why = release_line(a.run, full(a.sha), a.tests, a.review, kind=a.kind, base=full(a.base), paper=a.paper, note=a.note)
    if why:
        print(f'REFUSED: {why}')
        return 1
    for s in [row['sha'], row.get('base')] + [r['sha'] for r in row['reviews']] + [row['tests']['sha']]:
        if s and not resolve(s):
            print(f'REFUSED: {s[:12]} is not a commit in {REPO} (fetch it first)')
            return 1
    append(PIECES, row)
    print('RECORDED ' + json.dumps(row))
    return 0


# ------------------------------------------------------------------------------------------------ world snapshot
SNAPS = f'{ROOT}/snapshots'
SNAP_KEEP = 6                    # the newest N complete snapshots stay; older ones are pruned after each new one
SNAP_MIN_FREE = 10 * 2 ** 30     # refuse below 10 GiB free: a snapshot never fills the disk
SNAP_NAME = re.compile(r'^\d{8}T\d{6}Z-[0-9a-z]{1,8}$')
SERVER_DIR = f'{ROOT}/server'
STATE_DIR = '/var/lib/mcai'


def snapshots_to_prune(names, keep=SNAP_KEEP):
    """Complete snapshot dir names (SNAP_NAME, sorted = time order) -> the ones to delete: all but the newest `keep`. Pure."""
    done = sorted(n for n in names if SNAP_NAME.match(n))
    return done[:-keep] if keep > 0 and len(done) > keep else []


def paper_running():
    return subprocess.run(['systemctl', 'is-active', '--quiet', 'showcase-paper'], capture_output=True).returncode == 0


def snapshot_world(why, tag, hold=None, running=None, root=None, server=None, state=None):
    """A consistent copy of the world + bot state BEFORE a release switches or the owner edits the world -> (ok, dir | why).
    Fast and bounded: rsync --link-dest against the previous snapshot (unchanged region files are hard links), under the ONE
    save-pause lock (rcon.SaveHold, shared with the timelapse and the backup stage; skipped only when Paper is not running),
    the newest SNAP_KEEP kept, refused below SNAP_MIN_FREE. Restore (by hand, bots and Paper stopped):
      rsync -a --delete <snap>/server/ /srv/showcase/server/   and   rsync -a --delete <snap>/state/ /var/lib/mcai/"""
    root, server, state = root or SNAPS, server or SERVER_DIR, state or STATE_DIR
    os.makedirs(root, exist_ok=True)
    st = os.statvfs(root)
    if st.f_bavail * st.f_frsize < SNAP_MIN_FREE:
        return False, f'under {SNAP_MIN_FREE >> 30} GiB free on {root}'
    name = f'{now_utc().strftime("%Y%m%dT%H%M%SZ")}-{re.sub(r"[^0-9a-z]", "", str(tag).lower())[:8] or "x"}'
    prev = sorted(n for n in os.listdir(root) if SNAP_NAME.match(n))
    tmp, dst = os.path.join(root, '.' + name + '.part'), os.path.join(root, name)
    t0 = time.time()

    def copy():
        for src, sub, excl in ((server, 'server', getattr(BS, 'EXCL', [])), (state, 'state', [])):
            link = [f'--link-dest={os.path.join(root, prev[-1], sub)}'] if prev else []
            p = subprocess.run(['rsync', '-a', '--delete'] + excl + link + [src.rstrip('/') + '/', os.path.join(tmp, sub) + '/'],
                               capture_output=True, text=True)
            if p.returncode:
                raise RuntimeError(f'rsync {src} rc={p.returncode}: {p.stderr.strip()[:200]}')
    try:
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        live = paper_running() if running is None else running
        if live:
            with (hold or RC.SaveHold)(wait_s=600) as h:
                if not h.held:
                    raise RuntimeError('the save-pause lock was held for 10 min by another owner (timelapse / backup)')
                copy()
        else:
            copy()
        if not os.path.exists(os.path.join(tmp, 'server', 'world', 'level.dat')):
            raise RuntimeError('the copy has no server/world/level.dat')
        with open(os.path.join(tmp, 'SNAPSHOT.json'), 'w') as f:
            json.dump({'t': FR.iso(now_utc()), 'why': why, 'tag': tag, 'paper_running': live, 'secs': round(time.time() - t0, 1),
                       'link_dest': prev[-1] if prev else None}, f, indent=1)
        os.rename(tmp, dst)
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        return False, f'{type(e).__name__}: {str(e)[:200]}'
    for old in snapshots_to_prune(os.listdir(root)):
        shutil.rmtree(os.path.join(root, old), ignore_errors=True)
    return True, dst


def cmd_world_edit(a):
    """`world-edit --why "<what the owner asked for>"`: the OWNER-DIRECT ONE-OFF WORLD FIX (fun mode). Takes a snapshot, then
    journals {"event": "owner-direct-world-edit", "why", "snapshot"} in ops/deploy.jsonl. The edit itself (RCON) is done by
    hand right after; it is logged assistance, never counted as the bots' own success, and never a fix for a bot."""
    lk = lock()
    if not (a.why or '').strip():
        print('REFUSED: --why names the owner request and the edit')
        return 1
    ok, out = snapshot_world(a.why, 'worldedit')
    if not ok:
        print(f'REFUSED: no snapshot ({out}); nothing journalled -- fix and rerun before editing')
        return 1
    append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'owner-direct-world-edit', 'why': a.why[:300], 'snapshot': out})
    print(f'SNAPSHOT {out}; journalled owner-direct-world-edit -- make the edit now')
    return 0


# ------------------------------------------------------------------------------------------------ activate
def running_bots():
    out = subprocess.run(['systemctl', 'list-units', 'mcshow@*', '--state=active', '--no-legend', '--plain'],
                         capture_output=True, text=True).stdout
    return [l.split()[0][len('mcshow@'):-len('.service')] for l in out.splitlines() if l.strip()]


def newest_row(bot):
    p = f'/var/log/mcai/{bot}/skill-{bot}.jsonl'
    try:
        with open(p, 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 65536))
            for line in reversed(f.read().splitlines()):
                try:
                    return json.loads(line)
                except ValueError:
                    continue
    except OSError:
        return None


def activate(release_dir, verify_s=600, prev_admissible=True, snapshot=True, no_snapshot_why=None):
    rel = json.load(open(f'{release_dir}/RELEASE.json'))
    prev = os.path.realpath(HARNESS) if os.path.islink(HARNESS) else None
    # THE WORLD SNAPSHOT before anything switches (fun mode: code rollback does not undo what a release did to the world).
    # No snapshot -> no switch; skipping it takes an explicit, journalled reason.
    if snapshot:
        ok, snap = snapshot_world(f'before activating {os.path.basename(release_dir)}', rel.get('sha', '')[:8])
        if not ok:
            append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'activate-refused', 'release': os.path.basename(release_dir),
                            'why': f'world snapshot failed: {snap}'[:300]})
            print(f'REFUSED: world snapshot failed ({snap}); nothing switched (activate --no-snapshot "<why>" to override)')
            if not prev_admissible:
                subprocess.run(['/srv/showcase/bin/stop-bots.sh', 'rollback: world snapshot failed and the current release is inadmissible'],
                               env=dict(os.environ, SHOWCASE_LOCK_HELD='1'))
            return 1
        append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'snapshot', 'release': os.path.basename(release_dir), 'dir': snap})
    else:
        append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'snapshot-skipped', 'release': os.path.basename(release_dir),
                        'why': str(no_snapshot_why)[:300]})
    tmp = HARNESS + '.new'
    if os.path.lexists(tmp):
        os.remove(tmp)
    os.symlink(release_dir, tmp)
    os.replace(tmp, HARNESS)
    # With AUTO_FOLLOW on, the WHOLE roster is expected: a failed bot must not drop out of the denominator.
    bots = list(NAMES) if os.path.exists(AUTO) else running_bots()
    append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'activated', 'release': os.path.basename(release_dir),
                    'previous': os.path.basename(prev) if prev else None, 'running_bots': len(bots)})
    if not bots:
        print(f'ACTIVATED {os.path.basename(release_dir)} (no bot running: start-bots.sh verifies the ten)')
        return 0
    t0 = time.time()
    for b in bots:
        subprocess.run(['systemctl', 'restart', f'mcshow@{b}'])
        time.sleep(12)
    bad = verify(bots, rel['expected_version'], t0, verify_s)
    if not bad:
        print(f'ACTIVATED + VERIFIED {os.path.basename(release_dir)} on {len(bots)} bots')
        return 0
    if not prev_admissible:
        # the release being left was inadmissible (a follower ROLLBACK): stop, never go back to it
        append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'STOP', 'release': os.path.basename(release_dir), 'bad': bad,
                        'why': 'rollback target failed verification and the previous release is inadmissible'})
        subprocess.run(['/srv/showcase/bin/stop-bots.sh', 'rollback target failed verification'],
                       env=dict(os.environ, SHOWCASE_LOCK_HELD='1'))
        print(f'STOPPED: rollback target failed verification {bad}')
        return 1
    if prev:
        os.symlink(prev, tmp)
        os.replace(tmp, HARNESS)
        for b in bots:
            subprocess.run(['systemctl', 'restart', f'mcshow@{b}'])
            time.sleep(12)
    if os.path.exists(AUTO):
        os.remove(AUTO)
    append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'ROLLBACK', 'release': os.path.basename(release_dir),
                    'back_to': os.path.basename(prev) if prev else None, 'bad': bad})
    print(f'ROLLBACK: {bad}')
    return 1


def verify(bots, expected, since_epoch, wait_s):
    deadline = time.time() + wait_s
    while True:
        bad = {}
        for b in bots:
            r = newest_row(b)
            ts = FR.parse_ts((r or {}).get('@timestamp'))
            v = ((r or {}).get('code') or {}).get('version')
            if not r or not ts or ts.timestamp() < since_epoch or v != expected:
                bad[b] = v if r else 'no row'
        if not bad or time.time() > deadline:
            return bad
        time.sleep(15)


def cmd_activate(a):
    lk = lock()
    rel = json.load(open(os.path.join(os.path.abspath(a.release), 'RELEASE.json')))
    # EVERY activation, not only under AUTO_FOLLOW (re-review 10-25, Codex P1: in the lane AUTO_FOLLOW is off, so an older
    # cached release could be activated without the required pieces). No feed = no journal = every piece missing: refused.
    feed = json.load(open(f'{OPS}/feed-last.json')) if os.path.exists(f'{OPS}/feed-last.json') else {}
    ok, missing = pieces_in(rel['sha'], feed.get('journal') or [])
    if not ok:
        print(f'REFUSED: {rel["sha"][:8]} lacks the required pieces {missing} (REQUIRED_KEPT); nothing switched')
        return 1
    if getattr(a, 'no_snapshot', None) is not None and not a.no_snapshot.strip():
        print('REFUSED: --no-snapshot needs the reason it is skipped')
        return 1
    cur = current_release()
    return activate(os.path.abspath(a.release), prev_admissible=release_admissible(cur),
                    snapshot=getattr(a, 'no_snapshot', None) is None, no_snapshot_why=getattr(a, 'no_snapshot', None))


def release_admissible(rel):
    """Is the CURRENT release (its RELEASE.json) still one the showcase may go back to? Either it passed THIS gate when it was
    staged (a `piece` or `mode: main` record) or it lies inside the newest verified fleet build -- and it contains no REVOKED
    sha (by ancestry or patch equivalence). Unknown counts as NOT admissible: fail closed -> stop."""
    if isinstance(rel, str):
        rel = {'sha': rel}
    sha = (rel or {}).get('sha')
    if not sha:
        return False
    gated = bool(rel.get('piece')) or rel.get('mode') == 'main'
    if not gated:
        ver = [r for r in FR.load_jsonl(LEDGER) if r.get('verified')]
        if not ver or not is_anc(sha, ver[-1]['sha']):
            return False
    return not revoked_refusal(sha, read_revoked(), is_anc, revoked_patch_in)


# ------------------------------------------------------------------------------------------------ gate
def required_pieces():
    req = []
    if os.path.exists(REQUIRED):
        for l in open(REQUIRED).read().splitlines():
            if l.strip() and not l.startswith('#'):
                run, sha = l.split()[:2]
                req.append((run, resolve(sha) or sha))
    return req


def pieces_in(release_sha, journal):
    """-> (ok, missing): every REQUIRED_KEPT piece is kept on the bench AND inside release_sha (ancestry or patch-id
    equivalence). An empty list is ok here (the start gate refuses an empty list separately)."""
    req = required_pieces()
    if not req:
        return True, []
    kr = FR.kept_runs(journal, req)
    missing = [run for run, sha in req
               if not kr[run][0] or not (is_anc(sha, release_sha) or cherry_equivalent(sha, release_sha))]
    return not missing, missing


def filebeat_shipping():
    """filebeat's own 30-s metrics in the journal (last 15 min): -> (acked, dropped, failed)."""
    out = subprocess.run(['journalctl', '-u', 'filebeat', '--since', '-15min', '--no-pager', '-o', 'cat'],
                         capture_output=True, text=True).stdout
    acked = dropped = failed = 0
    for line in out.splitlines():
        if 'Non-zero metrics' not in line:
            continue
        try:
            d = json.loads(line)
            ev = ((d.get('monitoring') or {}).get('metrics') or {}).get('libbeat', {}).get('output', {}).get('events', {})
            acked += int(ev.get('acked') or 0)
            dropped += int(ev.get('dropped') or 0)
            failed += int(ev.get('failed') or 0)
        except (ValueError, AttributeError, TypeError):
            continue
    return acked, dropped, failed


def gate_checks():
    """-> list of (ok, check, detail-or-remedy). The start-bots gate (design section 9)."""
    out = []
    feed = json.load(open(f'{OPS}/feed-last.json')) if os.path.exists(f'{OPS}/feed-last.json') else {}
    rel = current_release()
    req = []
    if os.path.exists(REQUIRED):
        for l in open(REQUIRED).read().splitlines():
            if l.strip() and not l.startswith('#'):
                run, sha = l.split()[:2]
                req.append((run, resolve(sha) or sha))
    if not req:
        out.append((False, 'town-plan pieces KEPT', f'{REQUIRED} lists no `<run> <sha>` lines; remedy: fill it from '
                    f'the town plan (siting file, sorted deposits, station placement) once the bench keeps them'))
    else:
        kr = FR.kept_runs(feed.get('journal') or [], req)
        for run, sha in req:
            ok, why = kr[run]
            inrel = bool(rel) and (is_anc(sha, rel['sha']) or cherry_equivalent(sha, rel['sha']))
            out.append((ok and inrel, f'kept + in release: {run}',
                        why if not ok else ('in the release' if inrel else f'{sha[:8]} is not in the release '
                                            f'{(rel or {}).get("sha", "")[:8]}; remedy: wait for the follower')))
    out.append((bool(rel), 'a followed release is active',
                f"{(rel or {}).get('sha', '')[:8]} staged {(rel or {}).get('staged_at')}" if rel else
                'remedy: sudo /srv/showcase/bin/showcase_ops.py stage <promoted sha> --bootstrap, then activate'))
    site_ok, site_why = validate_site()
    out.append((site_ok, 'town-site.json (the town plan siting file)', site_why))
    out.append((os.path.exists(f'{ROOT}/server/TOWN-PLACED.json') or plan_builds_core(),
                'the town is stamped (or the plan builds its own core)',
                'remedy: stamp-town (after the siting file exists), or the plan declares "builds_core": true'))
    out.append((os.path.exists(f'{ROOT}/timelapse/FRAME0.json'), 'frame 0 captured', 'remedy: tl_showcase.py capture --frame0'))
    h = health()
    out.append((h.get('ok') is True, 'brain proxy healthy through the tunnel',
                str(h) if not h.get('ok') else 'gemma4 loaded, not paused'))
    fb = subprocess.run(['systemctl', 'is-active', 'filebeat'], capture_output=True, text=True).stdout.strip()
    acked, dropped, failed = filebeat_shipping()
    out.append((fb == 'active' and acked > 0 and dropped == 0,
                'filebeat active and shipping (15 min: acked > 0, dropped 0)',
                f'{fb}; acked {acked}, dropped {dropped}, failed {failed}'
                + ('' if dropped == 0 else ' -- a dropped event is a mapping rejection: fix before starting')))
    rep_ok, rep_why = replay_ok(replay_last(), (rel or {}).get('sha'), now_utc())
    out.append((rep_ok, 'brain replay passed on this release (< 24 h)', rep_why))
    return out


def replay_last():
    try:
        return json.load(open(f'{OPS}/replay-last.json'))
    except (OSError, ValueError):
        return None


def replay_ok(r, release_sha, now):
    """The start gate's brain replay -> (ok, why). Pure. ok: a PASS on THIS release under 24 h old. start-bots.sh refreshes a
    stale or other-release replay itself (fun mode 10-28: a restart never waits on a human for it); a FAILED fresh replay
    still refuses -- the brain path is broken."""
    remedy = 'remedy: sudo /srv/showcase/bin/replay-prompts.sh (50 real bench prompts through the brain path)'
    if not isinstance(r, dict) or not FR.parse_ts(r.get('t')):
        return False, remedy
    age_h = (now - FR.parse_ts(r['t'])).total_seconds() / 3600
    ok = r.get('pass') is True and age_h < 24 and bool(release_sha) and r.get('release') == release_sha
    return ok, (f"{r.get('valid')}/{r.get('n')} schema-valid, served {r.get('served')}, {age_h:.1f} h old, release "
                f"{str(r.get('release'))[:8]}" + ('' if ok else '; ' + remedy))


def cherry_equivalent(sha, release):
    base = merge_base(sha, release)
    if not base:
        return False
    out = subprocess.run(['git', '-C', REPO, 'cherry', release, sha, base], capture_output=True, text=True).stdout
    lines = [l for l in out.splitlines() if l.strip()]
    return bool(lines) and all(l.startswith('-') for l in lines)


def validate_site():
    if not os.path.exists(SITE):
        return False, f'{SITE} missing; remedy: the town plan writes it (fields: docs/reports/showcase-site-2026-10-20.md)'
    try:
        s = json.load(open(SITE))
        for k in ('home', 'board', 'border_radius'):
            if k not in s:
                return False, f'{SITE} lacks {k!r}'
        if len(s['home']) != 3 or len(s['board']) != 3:
            return False, 'home and board must be [x, y, z]'
        return True, f"home {s['home']}"
    except ValueError as e:
        return False, f'{SITE} is not JSON: {e}'


def plan_builds_core():
    try:
        return bool(json.load(open(SITE)).get('builds_core'))
    except (OSError, ValueError):
        return False


def health():
    import urllib.request, urllib.error
    try:
        return json.loads(urllib.request.urlopen('http://127.0.0.1:11612/healthz', timeout=8).read())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except ValueError:
            return {'ok': False, 'error': f'http {e.code}'}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:120]}


def cmd_gate(a):
    checks = gate_checks()
    for ok, name, why in checks:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {why}")
    n = sum(1 for c in checks if not c[0])
    print(f'gate: {len(checks) - n} of {len(checks)} pass' + ('' if not n else ' -- the bots do NOT start'))
    return 1 if n else 0


def cmd_replay_fresh(a):
    """exit 0 when the newest brain replay passes the start gate for the CURRENT release, else 1 (start-bots.sh then reruns it)."""
    ok, why = replay_ok(replay_last(), (current_release() or {}).get('sha'), now_utc())
    print(('FRESH ' if ok else 'STALE ') + why)
    return 0 if ok else 1


def cmd_status(a):
    d = (FR.load_jsonl(FOLLOW) or [{}])[-1]
    rel = current_release()
    print(json.dumps({'follow': d, 'release': rel, 'auto_follow': os.path.exists(AUTO), 'running': running_bots()},
                     indent=1))
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    fo = sub.add_parser('follow')
    fo.add_argument('--observe-only', action='store_true', help='ledger + feed + decision row; never act')
    s = sub.add_parser('stage')
    s.add_argument('sha')
    s.add_argument('--bootstrap', action='store_true')
    s.add_argument('--piece', default=None, help='the progress lane: <run>[,<run>...] -- PIECES.jsonl lines stacked on the current release')
    s.add_argument('--main', action='store_true', help='FOLLOW MAIN: a sha on origin/main, staged directly (release-log line needed)')
    s.add_argument('--dry-run', action='store_true', help='decide and print; stage nothing, journal nothing')
    s.add_argument('--against', default=None, help='with --dry-run: judge as if this sha were the current release')
    t = sub.add_parser('activate')
    t.add_argument('release')
    t.add_argument('--no-snapshot', default=None, metavar='WHY', help='skip the world snapshot (journalled with WHY)')
    r = sub.add_parser('record', help='append a release-log line (tests + reviews) to PIECES.jsonl')
    r.add_argument('--run', required=True)
    r.add_argument('--sha', required=True)
    r.add_argument('--tests', required=True, help='PASS|FAIL:<40 hex>[:<summary>]  (npm test, the canonical runner)')
    r.add_argument('--review', action='append', default=[], help='<codex|claude>:<VERDICT>:<40 hex>[:<reviewer>] (repeatable)')
    r.add_argument('--kind', default='release')
    r.add_argument('--base', default=None, help='the piece base (for --piece stacking)')
    r.add_argument('--paper', default=None, help='optional: <RESULT>:<40 hex>[:<record>]')
    r.add_argument('--note', default=None)
    w = sub.add_parser('world-edit', help='snapshot, then journal an owner-direct-world-edit')
    w.add_argument('--why', required=True)
    sub.add_parser('gate')
    sub.add_parser('replay-fresh')
    sub.add_parser('status')
    a = ap.parse_args()
    return {'follow': cmd_follow, 'stage': cmd_stage, 'activate': cmd_activate, 'gate': cmd_gate, 'record': cmd_record,
            'world-edit': cmd_world_edit, 'replay-fresh': cmd_replay_fresh, 'status': cmd_status}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())

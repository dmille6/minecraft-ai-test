#!/usr/bin/env python3
"""Showcase operations ON THE VM: the follower, the deploy (stage / activate), the start gate's checks.
Design: docs/reports/showcase-2026-10-20.md sections 3 and 9. Pure decisions live in followrule.py / make_env.py.

    showcase_ops.py follow                    hourly (timer): observe the bench, decide, act only if AUTO_FOLLOW
    showcase_ops.py stage <sha> [--bootstrap] build releases/<sha8>-<policy8>-<deps8>/ (never touches a bot)
    showcase_ops.py stage <sha> --piece <run>[,<run>...]
                                              the PROGRESS LANE: a stack of showcase-first pieces (each a PIECES.jsonl line)
                                              on top of the current release (docs/reports/showcase-progress-lane-2026-10-25.md 5)
    showcase_ops.py activate <release-dir>    switch the harness symlink; restart+verify running bots 12 s apart
    showcase_ops.py gate                      the start-bots gate: every check, each with its remedy; exit 1 if any fails
    showcase_ops.py status                    the newest follow decision and the current release

Everything that changes state runs under /srv/showcase/ops.lock.
"""
import argparse, datetime as dt, fcntl, glob, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import followrule as FR  # noqa: E402
import make_env as ME    # noqa: E402

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
    d['auto'] = os.path.exists(AUTO) and not os.path.exists(LANE)
    d['lane'] = os.path.exists(LANE)
    append(FOLLOW, d)
    print(json.dumps(d))
    if not d['auto'] or getattr(a, 'observe_only', False) or os.path.exists(LANE):
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
        if extra and any(old.get(k) != v for k, v in extra.items() if k in ('piece', 'prev', 'prev_release')):
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


PAPER_OK = ('CANDIDATE_PASS', 'PASS')
ENGINES = ('codex', 'claude')
HEX40 = re.compile(r'[0-9a-f]{40}')


def piece_stack_refusal(sha, release_sha, runs, rows, commits, is_anc, revoked_in, revoked, kept=None, docs_only=None):
    """THE PROGRESS LANE'S STAGE RULE (docs/reports/showcase-progress-lane-2026-10-25.md 5; owner 10-25: a STACK of pieces --
    e.g. matset-01 + mats-01 + shop-01 -- staged together) -> None (stage it) | the reason not to. Pure.
      sha         the stack's tip; release_sha the CURRENT showcase release; runs the stack's piece names (in any order)
      rows        PIECES.jsonl rows; the NEWEST row of a run speaks for it
      commits     every commit in release_sha..sha (git rev-list)
      kept        {run: (ok, why)} -- for a survival piece, survival_kept(): KEEP recorded and a `promoted` row naming ITS sha
      docs_only   docs_only(a, b) -> True when every path changed in a..b is under docs/ (a review record after the approval)
      revoked_in  revoked_in(x, sha) -> True when the revoked commit x's OWN patch is in the stack (a cherry-pick of it alone)
    Refused unless: the current release is the stack's ancestor and the stack adds something; every named run's newest row is
    kind building -- paper {"result": CANDIDATE_PASS|PASS, "sha"} and reviews [{"engine", "verdict": "APPROVE", "sha"}] from
    BOTH codex and claude, every one of those shas the piece's own or an ancestor of it with only docs/ changed since (an
    approval never covers code that came after it) -- or survival (kept); every piece's sha is an ANCESTOR of the tip (a
    re-stacked piece needs a line naming its re-stacked sha: patch equivalence is not membership) and its base is too;
    NOTHING in release..sha lies outside the named pieces' own ranges (base, sha]; no REVOKED sha is in the stack (by
    ancestry or patch equivalence)."""
    docs_only = docs_only or (lambda a, b: False)
    if not (sha and HEX40.fullmatch(sha)):
        return f'sha must be 40 hex: {sha!r}'
    if not release_sha:
        return 'no current release: a piece stacks on a release (stage --bootstrap first)'
    if sha == release_sha or not commits:
        return f'{sha[:8]} adds nothing to the current release {release_sha[:8]}'
    if not is_anc(release_sha, sha):
        return f'the current release {release_sha[:8]} is not an ancestor of {sha[:8]}: a piece stack builds ON the showcase release'
    if not runs:
        return 'no piece named (--piece <run>[,<run>...])'
    if len(set(runs)) != len(runs):
        return f'a piece named twice: {runs}'

    def covers(evidence_sha, psha):
        # the evidence names the piece's sha, or an ancestor of it with nothing but docs/ changed since
        e = str(evidence_sha or '')
        return bool(HEX40.fullmatch(e)) and (e == psha or (is_anc(e, psha) and docs_only(e, psha)))
    pieces = []
    for run in runs:
        mine = [r for r in rows if isinstance(r, dict) and r.get('run') == run]
        if not mine:
            return f'{run}: no PIECES.jsonl line (register the piece first: section 5 step 3)'
        r = mine[-1]
        psha, base, kind = str(r.get('sha') or ''), str(r.get('base') or ''), r.get('kind')
        if not HEX40.fullmatch(psha) or not HEX40.fullmatch(base):
            return f'{run}: its line needs a 40-hex sha and base ({psha[:12]!r}, {base[:12]!r})'
        if kind == 'building':
            p = r.get('paper')
            if not (isinstance(p, dict) and p.get('result') in PAPER_OK and covers(p.get('sha'), psha)):
                return f'{run}: no Paper PASS of {psha[:8]} (paper: {{"result": "CANDIDATE_PASS", "sha": <40 hex>, "record": ...}}; got {str(p)[:80]!r})'
            rv = [x for x in (r.get('reviews') or []) if isinstance(x, dict)]
            for eng in ENGINES:
                if not any(str(x.get('engine') or '').lower() == eng and x.get('verdict') == 'APPROVE' and covers(x.get('sha'), psha) for x in rv):
                    return f'{run}: no {eng.capitalize()} APPROVE of {psha[:8]} in its reviews (each {{"engine", "verdict", "sha"}})'
        elif kind == 'survival':
            ok, why = (kept or {}).get(run, (False, 'no journal record'))
            if not ok:
                return f'{run}: a survival piece must be KEPT on the fleet first ({why})'
        else:
            return f'{run}: kind must be building or survival, not {kind!r}'
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
    for x in revoked or []:
        hit = is_anc(x, sha) or revoked_in(x, sha)
        if hit == 'unreadable':
            return f'the REVOKED line {x[:12]} is unreadable here (fetch it or fix the line): no stack stages until it is'
        if hit:
            return f'the stack contains a REVOKED sha {x[:8]}'
    return None


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
    if getattr(a, 'piece', None):
        return stage_piece(a, sha, feed, last)
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
                  f'{(d.get("target") or "")[:8]}); use --bootstrap for the first release')
            return 1
    ok, out = stage(sha, last.get('policy'), last.get('deps'), bootstrap=a.bootstrap, why='operator stage')
    print(('STAGED ' if ok else 'FAILED ') + out)
    return 0 if ok else 1


def stage_piece(a, sha, feed, last):
    """`stage <sha> --piece <runs>`: the lane only (LANE present, AUTO_FOLLOW absent), the newest observation verified (its
    pinned policy and dependency digest are the release's), piece_stack_refusal None, and REQUIRED_KEPT still passes against
    the stack (pieces_in). RELEASE.json carries piece: [runs, sorted], prev: the release sha it stacks on, prev_release: the
    harness release dir. Every refusal is journalled `piece-refused` in ops/deploy.jsonl. Stages only: activation is
    `showcase_ops.py activate <release>` (with its own REQUIRED_KEPT check)."""
    runs = sorted(r.strip() for r in a.piece.split(',') if r.strip())

    def refuse(why):
        print(f'REFUSED: {why}')
        append(DEPLOY, {'t': FR.iso(now_utc()), 'event': 'piece-refused', 'sha': sha, 'piece': runs, 'why': why[:300]})
        return 1
    if a.bootstrap:
        return refuse('--piece and --bootstrap are exclusive')
    if not os.path.exists(LANE) or os.path.exists(AUTO):
        return refuse(f'a piece stages only in the progress lane ({LANE} present, {AUTO} absent)')
    if not last.get('verified'):
        return refuse('the newest observation is not verified; run `showcase_ops.py follow --observe-only`')
    cur = current_release()
    rel_sha = (cur or {}).get('sha')
    rows = FR.load_jsonl(PIECES)
    commits = git('rev-list', f'{rel_sha}..{sha}', check=False).split() if rel_sha and resolve(sha) else []
    revoked = [l.split()[0] for l in open(REVOKED).read().splitlines() if l.strip()] if os.path.exists(REVOKED) else []
    journal = (feed or {}).get('journal') or []
    newest = {r: next((x for x in reversed(rows) if isinstance(x, dict) and x.get('run') == r), {}) for r in runs}
    kept = {r: survival_kept(journal, r, str(newest[r].get('sha') or ''), resolve) for r in runs}
    why = piece_stack_refusal(sha, rel_sha, runs, rows, commits, is_anc, revoked_patch_in, revoked, kept, docs_only_change)
    if why:
        return refuse(why)
    ok, missing = pieces_in(sha, journal)
    if not ok:
        return refuse(f'{sha[:8]} lacks the required pieces {missing} (REQUIRED_KEPT)')
    prev = os.path.basename(os.path.realpath(HARNESS)) if os.path.islink(HARNESS) else None
    ok, out = stage(sha, last.get('policy'), last.get('deps'), bootstrap=False, why=f'piece stack {",".join(runs)}',
                    extra={'piece': runs, 'prev': rel_sha, 'prev_release': prev})
    if not ok:
        return refuse(out)   # a conflicting cached release included (Codex r2 P3)
    print('STAGED ' + out)
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


def activate(release_dir, verify_s=600, prev_admissible=True):
    rel = json.load(open(f'{release_dir}/RELEASE.json'))
    prev = os.path.realpath(HARNESS) if os.path.islink(HARNESS) else None
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
    cur = current_release()
    return activate(os.path.abspath(a.release), prev_admissible=release_admissible((cur or {}).get('sha')))


def release_admissible(sha):
    """Is the CURRENT release still one the showcase may go back to? Inside the newest verified fleet build, not
    containing a REVOKED sha. Unknown (no verified observation) counts as NOT admissible: fail closed -> stop."""
    if not sha:
        return False
    ver = [r for r in FR.load_jsonl(LEDGER) if r.get('verified')]
    if not ver or not is_anc(sha, ver[-1]['sha']):
        return False
    revoked = [l.split()[0] for l in open(REVOKED).read().splitlines() if l.strip()] if os.path.exists(REVOKED) else []
    return not any(is_anc(x, sha) for x in revoked)


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
    rp = f'{OPS}/replay-last.json'
    rep_ok = False
    rep_why = 'remedy: sudo /srv/showcase/bin/replay-prompts.sh (50 real bench prompts through the brain path)'
    if os.path.exists(rp):
        r = json.load(open(rp))
        age_h = (now_utc() - FR.parse_ts(r['t'])).total_seconds() / 3600
        rep_ok = r.get('pass') is True and age_h < 24 and r.get('release') == (rel or {}).get('sha')
        rep_why = (f"{r.get('valid')}/{r.get('n')} schema-valid, served {r.get('served')}, {age_h:.1f} h old, release "
                   f"{str(r.get('release'))[:8]}" + ('' if rep_ok else '; ' + rep_why))
    out.append((rep_ok, 'brain replay passed on this release (< 24 h)', rep_why))
    return out


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
    t = sub.add_parser('activate')
    t.add_argument('release')
    sub.add_parser('gate')
    sub.add_parser('status')
    a = ap.parse_args()
    return {'follow': cmd_follow, 'stage': cmd_stage, 'activate': cmd_activate, 'gate': cmd_gate,
            'status': cmd_status}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())

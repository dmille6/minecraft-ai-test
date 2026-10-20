#!/usr/bin/env python3
"""The showcase's follow rule: WHICH bench build the showcase may run, and when. Pure (tested in
infra/showcase/test_showcase.py). Design: docs/reports/showcase-2026-10-20.md section 3.

OBSERVATIONS. The follower reads the .31 feed hourly and appends one row to its own ledger:
  sha       manifest['declared_code_version'] (the control build; a canary only sets canary_* fields)
  verified  the census covers >= COVER_MIN of the expected non-canary roster with a fresh row, and >= CENSUS_MIN of
            those report ONE code.version whose sha part is the declared sha (the manifest alone is a claim:
            deploy-fleet.sh writes it before the deploy finishes)
  explained an UNVERIFIED reading that a deploy in progress accounts for: the manifest was declared < EXPLAIN_MIN
            ago, or every off-majority bot reports the previous verified version or the canary build
  policy    digest of the fleet's policy env (a control env minus the keys the showcase sets)
  deps      digest of .31's installed dependency tree (node_modules/.package-lock.json)

THE UNBROKEN RUN: the newest stretch of observations with one policy and one deps digest, no gap > GAP_H, in which
explained-unverified rows are neutral (they neither count nor break it) and two CONSECUTIVE unexplained-unverified
rows break it. A single unexplained one is tolerated once.

THE TARGET is a LAGGING POINTER: the newest PROMOTED sha P (a hex in a journal `promoted` note, resolved by a unique
prefix) that is an ancestor-or-equal of the declared sha in every VERIFIED observation covering the last HOLD_H hours
of an unbroken run that reaches back at least HOLD_H.

  DUE       target != the showcase sha
  ROLLBACK  the showcase sha S is no longer inside a VERIFIED fleet build F. The new target must itself have been
            inside F for HOLD_H (the same containment test), else the newest promoted common ancestor of S and F;
            if neither exists -> STOP (the showcase's bots stop; nothing admissible to run)
  REVOKED   a sha listed in /srv/showcase/REVOKED is never a target, and a showcase release containing one is handled
            like ROLLBACK (a bench REVERT that is a forward commit keeps ancestry, so it must be named)
  HOLD      anything unproven, fail closed, with the reason and, when only time is missing, when it becomes DUE
  NOOP      target == the showcase sha
"""
import datetime as dt
import hashlib
import json
import re

HOLD_H = 24.0
GAP_H = 2.5
CENSUS_MIN = 0.90
COVER_MIN = 0.85
CENSUS_FRESH_MIN = 30
EXPLAIN_MIN = 45
SHA = re.compile(r'^[0-9a-f]{40}$')
HEX = re.compile(r'\b[0-9a-f]{7,40}\b')


def parse_ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')) if s else None


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if t else None


def digest(items):
    return hashlib.sha256('\n'.join(f'{k}={v}' for k, v in sorted(items.items())).encode()).hexdigest()[:16]


def promotions(journal, resolve):
    """[(ts, full_sha, run)] newest first, from `promoted` rows. resolve(hex) -> full sha, or None when unknown or
    ambiguous in the clone. A note naming no resolvable hex contributes nothing."""
    out = []
    for r in journal:
        if r.get('phase') != 'promoted':
            continue
        for h in HEX.findall(str(r.get('note', ''))):
            full = resolve(h)
            if full:
                out.append((parse_ts(r.get('ts')), full, r.get('run')))
                break
    return sorted((p for p in out if p[0]), key=lambda p: p[0], reverse=True)


def canary_pools(manifest):
    return {p.strip() for p in str((manifest or {}).get('canary_pool') or '').split(',') if p.strip()}


def census(feed, now, fresh_min=CENSUS_FRESH_MIN):
    """-> (majority version, share of counted, n counted, n expected, versions seen {v: n}). Expected = the bench's
    env-file roster minus declared canary pools; counted = those with a row in the last fresh_min minutes."""
    cp = canary_pools(feed.get('manifest'))
    incanary = lambda b: any(str(b).startswith(p + '-') for p in cp)
    roster = [b for b in (feed.get('roster') or []) if not incanary(b)]
    counts, n = {}, 0
    for b in feed.get('census') or []:
        if incanary(b.get('bot')) or (roster and b.get('bot') not in roster):
            continue
        t = parse_ts(b.get('ts'))
        if not t or (now - t).total_seconds() > fresh_min * 60 or not b.get('version'):
            continue
        n += 1
        counts[b['version']] = counts.get(b['version'], 0) + 1
    if not n:
        return None, 0.0, 0, len(roster), counts
    v = max(counts, key=counts.get)
    return v, counts[v] / n, n, len(roster), counts


def observe(feed, now, policy_dig, deps_dig, prev_verified_version=None):
    """One ledger row from one feed reading. Pure."""
    feed = feed or {}
    m = feed.get('manifest') or {}
    F = m.get('declared_code_version')
    v, share, n, expected, seen = census(feed, now)
    cover = (n / expected) if expected else 0.0
    ok = bool(F and SHA.match(str(F)) and v and v.split('+')[0] == F and share >= CENSUS_MIN and cover >= COVER_MIN
              and policy_dig and deps_dig and not feed.get('errors'))
    explained = False
    if not ok:
        declared = parse_ts(m.get('declared_at'))
        if declared and (now - declared).total_seconds() < EXPLAIN_MIN * 60:
            explained = True
        else:
            canary = m.get('canary_code_version') or ''
            off = [x for x in seen if x != v]
            if F and v and v.split('+')[0] == F and off and all(
                    x == prev_verified_version or (canary and x.split('+')[0] == canary) for x in off):
                explained = True
    return {'t': iso(now), 'sha': F, 'version': v, 'policy': policy_dig, 'deps': deps_dig,
            'census_share': round(share, 3), 'census_n': n, 'roster_n': expected, 'verified': ok,
            'explained': explained, 'feed_errors': feed.get('errors') or None}


def unbroken_run(ledger):
    """-> (rows oldest-first incl. neutral ones, why it starts there)."""
    run, unexplained_streak, key = [], 0, None
    for r in reversed(ledger):
        if run and (parse_ts(run[0]['t']) - parse_ts(r['t'])).total_seconds() > GAP_H * 3600:
            return run, f"observation gap before {run[0]['t']}"
        if r.get('verified'):
            k = (r.get('policy'), r.get('deps'))
            if key is None:
                key = k
            elif k != key:
                return run, f"policy or dependencies changed after {r['t']}"
            unexplained_streak = 0
        elif not r.get('explained'):
            unexplained_streak += 1
            if unexplained_streak >= 2:
                run = run[1:]          # the newer of the two unexplained rows is not part of the run either
                return run, f"two consecutive unexplained unverified observations at {r['t']}"
        run.insert(0, r)
    return run, 'start of the ledger'


def inside_for(promoted, run, now, hold_h, is_ancestor, revoked=()):
    """Promoted shas (newest first) that are an ancestor-or-equal of the sha in every VERIFIED observation covering
    [now - hold_h, now], and contain no revoked sha. Requires the run to reach back hold_h."""
    if not run or parse_ts(run[0]['t']) > now - dt.timedelta(hours=hold_h):
        return []
    boundary = now - dt.timedelta(hours=hold_h)
    ver = [r for r in run if r.get('verified')]
    before = [r for r in ver if parse_ts(r['t']) <= boundary]
    if not before:
        # The hold must be WITNESSED: a verified observation at or before the boundary, inside the same run (same
        # policy and dependencies). An explained (neutral) row there proves nothing about what the fleet ran.
        return []
    cover = before[-1:] + [r for r in ver if parse_ts(r['t']) > boundary]
    return [p for p in promoted
            if all(is_ancestor(p[1], r['sha']) for r in cover) and not any(is_ancestor(x, p[1]) for x in revoked)]


def decide(ledger, promoted, showcase_sha, now, is_ancestor, merge_base=None, revoked=(), hold_h=HOLD_H):
    """-> dict(decision=DUE|ROLLBACK|STOP|HOLD|NOOP, target, reason, since, due_at, fleet, policy, deps).
    is_ancestor(a, b): a is an ancestor of b or a == b. merge_base(a, b): their newest common ancestor (or None)."""
    if not ledger:
        return {'decision': 'HOLD', 'target': None, 'reason': 'no observations yet; the hourly timer adds one'}
    ver = [r for r in ledger if r.get('verified')]
    last = ledger[-1]
    base = {'fleet': last.get('sha'), 'policy': last.get('policy'), 'deps': last.get('deps')}
    run, broke = unbroken_run(ledger)
    ok_targets = inside_for(promoted, run, now, hold_h, is_ancestor, revoked)
    since = parse_ts(run[0]['t']) if run else None

    # Is the showcase's release still admissible? Judged against the newest VERIFIED fleet build.
    if showcase_sha and ver:
        F = ver[-1]['sha']
        bad = None
        if not is_ancestor(showcase_sha, F):
            bad = f'the showcase {showcase_sha[:8]} is no longer inside the verified fleet build {F[:8]}'
        elif any(is_ancestor(x, showcase_sha) for x in revoked):
            bad = f'the showcase {showcase_sha[:8]} contains a REVOKED sha'
        if bad:
            if ok_targets:
                return dict(base, decision='ROLLBACK', target=ok_targets[0][1],
                            reason=f'{bad}; to {ok_targets[0][1][:8]} ({ok_targets[0][2]}), inside the fleet build '
                                   f'for {hold_h:g} h')
            mb = merge_base(showcase_sha, F) if merge_base else None
            anc = [p for p in promoted if mb and is_ancestor(p[1], mb)
                   and not any(is_ancestor(x, p[1]) for x in revoked)]
            if anc:
                return dict(base, decision='ROLLBACK', target=anc[0][1],
                            reason=f'{bad}; to the newest promoted common ancestor {anc[0][1][:8]} ({anc[0][2]})')
            return dict(base, decision='STOP', target=None,
                        reason=f'{bad}, and no promoted sha is admissible; the bots stop until one is '
                               f'(remedy: wait for the next promotion to stay inside the fleet for {hold_h:g} h)')
    if not last.get('verified') and not last.get('explained'):
        return dict(base, decision='HOLD', target=None,
                    reason=f"newest observation unverified and unexplained (census {last.get('census_share')} of "
                           f"{last.get('census_n')}/{last.get('roster_n')} bots, feed errors {last.get('feed_errors')});"
                           f" retried hourly. If coverage is low because bench bots are stopped on purpose, the roster "
                           f"is the bench's ENABLED mcbot@ units: a stopped pool should be disabled too")
    if not ok_targets:
        if since and since > now - dt.timedelta(hours=hold_h):
            due = since + dt.timedelta(hours=hold_h)
            return dict(base, decision='HOLD', target=None, since=iso(since), due_at=iso(due),
                        reason=f'the unbroken run starts {iso(since)} ({broke}); a release can be DUE from {iso(due)}')
        return dict(base, decision='HOLD', target=None,
                    reason=f'no promoted sha has been inside the fleet build for {hold_h:g} h')
    t = ok_targets[0]
    if t[1] == showcase_sha:
        return dict(base, decision='NOOP', target=t[1], reason=f'the showcase runs the target {t[1][:8]}')
    return dict(base, decision='DUE', target=t[1], since=iso(since),
                reason=f'{t[1][:8]} ({t[2]}, promoted {iso(t[0])}) has been inside every verified fleet build of '
                       f'the last {hold_h:g} h, one policy, one dependency tree')


def kept_runs(journal, required):
    """For the bot-start gate and every deploy. required: [(run, sha)]. -> {run: (ok, why)}. ok iff the journal has
    a `recorded` KEEP row and a `promoted` row for the run, or an `owner-direct` row for it. The caller checks that
    the change is in the release (ancestry or patch-id equivalence)."""
    out = {}
    for run, _sha in required:
        rows = [r for r in journal if r.get('run') == run]
        keep = any(r.get('phase') == 'recorded' and str(r.get('note', '')).strip().split(' ')[0].upper() == 'KEEP'
                   for r in rows)
        prom = any(r.get('phase') == 'promoted' for r in rows)
        direct = any(r.get('phase') == 'owner-direct' for r in rows)
        ok = (keep and prom) or direct
        out[run] = (ok, 'kept and promoted' if keep and prom else 'owner-direct rollout' if direct else
                    f'not kept yet: {run} (journal phases {sorted({str(r.get("phase")) for r in rows})}); the gate '
                    f'opens when the bench keeps and promotes it')
    return out


def load_jsonl(path):
    out = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        continue
    except FileNotFoundError:
        pass
    return out

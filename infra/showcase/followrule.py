#!/usr/bin/env python3
"""The showcase's follow rule: WHICH fleet RELEASE the showcase may run, and when. Pure (tested in
infra/showcase/test_showcase.py). Design: docs/reports/showcase-2026-10-20.md section 3.

A RELEASE is the triple the bench actually runs: (sha, the code.version string its bots report -- `sha+srcDigest`
-- and the digest of the fleet's policy env). The follower observes it every hour through the .31 feed and keeps
its own ledger of observations. Nothing here trusts a single reading:

  ELIGIBLE   the sha has a journal `promoted` row naming it (note's first token == the full sha), or the operator
             listed it in ALLOW_SHAS (owner-direct rollouts write no sha). Otherwise HOLD, fail closed.
  VERIFIED   an observation counts only if >= CENSUS_MIN of the bench bots whose newest row is recent report the
             release's exact code.version string (the census) -- the manifest alone is a claim deploy-fleet.sh
             writes BEFORE the deploy finishes.
  STABLE     the newest run of consecutive verified observations of the SAME release, no two more than GAP_H
             apart, spans >= HOLD_H. A different release, an unverified reading, or a gap ends the run: the clock
             restarts (F -> G -> F does not inherit F's old time).
  DUE        eligible + stable + differs from what the showcase runs.
  ROLLBACK   the stable-or-not, VERIFIED, ELIGIBLE fleet sha is a strict ancestor of the showcase's sha: the bench
             backed out of something the showcase runs. Deployed without the hold.

Every HOLD names its remedy or the time it becomes DUE.
"""
import datetime as dt
import hashlib
import json
import re

HOLD_H = 24.0
GAP_H = 2.5            # the follower runs hourly; one missed run is tolerated, two are a gap
CENSUS_MIN = 0.90      # of the NON-canary bench bots with a recent row (declared canary pools are left out)
CENSUS_FRESH_MIN = 30  # a bot's newest row must be this recent to count in the census
SHA = re.compile(r'^[0-9a-f]{40}$')


def parse_ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')) if s else None


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if t else None


def policy_digest(policy):
    """sha256 over the sorted policy key=value lines (make_env.policy_of output)."""
    return hashlib.sha256('\n'.join(f'{k}={v}' for k, v in sorted(policy.items())).encode()).hexdigest()[:16]


def eligible(sha, journal, allow):
    """-> (bool, why). `allow`: {sha: note} from ALLOW_SHAS."""
    for r in journal:
        if r.get('phase') == 'promoted' and str(r.get('note', '')).split(' ')[0] == sha:
            return True, f"promoted {r.get('ts')} ({r.get('run')})"
    if sha in allow:
        return True, f'ALLOW_SHAS: {allow[sha]}'
    return False, (f'{sha[:8]} has no journal `promoted` row naming it and is not in /srv/showcase/ALLOW_SHAS; '
                   f'remedy: if it was an owner-direct rollout, add "<sha> <journal ts + run>" to ALLOW_SHAS')


def census(feed, now, fresh_min=CENSUS_FRESH_MIN):
    """-> (version string held by the most bots, its share, n counted). Only bots with a row in the last
    fresh_min minutes count (a stopped bot is not evidence either way)."""
    counts, n = {}, 0
    cpools = {p.strip() for p in str((feed.get('manifest') or {}).get('canary_pool') or '').split(',') if p.strip()}
    for b in feed.get('census') or []:
        t = parse_ts(b.get('ts'))
        if not t or (now - t).total_seconds() > fresh_min * 60 or not b.get('version'):
            continue
        if any(str(b.get('bot', '')).startswith(p + '-') for p in cpools):
            continue                  # a declared canary bot is not evidence about the control build
        n += 1
        counts[b['version']] = counts.get(b['version'], 0) + 1
    if not n:
        return None, 0.0, 0
    v = max(counts, key=counts.get)
    return v, counts[v] / n, n


def observe(feed, now, policy_dig):
    """One ledger row from one feed reading. Pure."""
    F = ((feed.get('manifest') or {}).get('declared_code_version')) or None
    v, share, n = census(feed, now)
    verified = bool(F and SHA.match(F) and v and v.split('+')[0] == F and share >= CENSUS_MIN)
    return {'t': iso(now), 'sha': F, 'version': v if verified else None, 'policy': policy_dig,
            'census_share': round(share, 3), 'census_n': n, 'verified': verified}


def stable_run(ledger):
    """The newest run of consecutive verified observations of one release. -> (rows, why_broken)."""
    run = []
    for r in reversed(ledger):
        if not r.get('verified'):
            return run, f"unverified observation at {r['t']} (census {r.get('census_share')} of {r.get('census_n')})"
        key = (r['sha'], r['version'], r['policy'])
        if run:
            head = run[0]
            if (head['sha'], head['version'], head['policy']) != key:
                return run, f"release changed at {head['t']}"
            if (parse_ts(head['t']) - parse_ts(r['t'])).total_seconds() > GAP_H * 3600:
                return run, f"observation gap before {head['t']}"
        run.insert(0, r)
    return run, 'ledger start'


def decide(ledger, journal, allow, showcase_sha, now, is_ancestor, fetchable, hold_h=HOLD_H):
    """-> dict(decision=DUE|ROLLBACK|HOLD|NOOP, sha, version, policy, reason, since, due_at)."""
    if not ledger:
        return {'decision': 'HOLD', 'reason': 'no observations yet; the hourly timer adds one'}
    last = ledger[-1]
    F = last.get('sha')
    base = {'sha': F, 'version': last.get('version'), 'policy': last.get('policy')}
    if not last.get('verified'):
        return dict(base, decision='HOLD',
                    reason=f"newest observation unverified: census {last.get('census_share')} of "
                           f"{last.get('census_n')} bots on the declared build (need >= {CENSUS_MIN}); the bench "
                           f"is mid-deploy or the feed is short -- the next hourly reading retries")
    ok, why = eligible(F, journal, allow)
    if not ok:
        return dict(base, decision='HOLD', reason=why)
    if not fetchable(F):
        return dict(base, decision='HOLD', reason=f'{F[:8]} not in the local clone after a fetch; retried hourly')
    if F == showcase_sha:
        return dict(base, decision='NOOP', reason='the showcase runs the fleet release')
    if showcase_sha and is_ancestor(F, showcase_sha):
        return dict(base, decision='ROLLBACK',
                    reason=f'the fleet is verifiably back on {F[:8]}, an ancestor of the showcase {showcase_sha[:8]}')
    run, broke = stable_run(ledger)
    since = parse_ts(run[0]['t'])
    due = since + dt.timedelta(hours=hold_h)
    if now >= due:
        return dict(base, decision='DUE', since=iso(since), due_at=iso(due),
                    reason=f'release {F[:8]} verified continuously since {iso(since)} ({why})')
    return dict(base, decision='HOLD', since=iso(since), due_at=iso(due),
                reason=f'release {F[:8]} verified since {iso(since)} (run began: {broke}); DUE at {iso(due)} '
                       f'if it holds')


def kept_runs(journal, required):
    """For the bot-start gate. required: [(run, sha)]. -> {run: (ok, why)}: ok iff a `recorded` row with note
    KEEP exists for that run. Ancestry of the sha is checked by the caller (git)."""
    out = {}
    for run, sha in required:
        rows = [r for r in journal if r.get('run') == run and r.get('phase') == 'recorded']
        keep = [r for r in rows if str(r.get('note', '')).strip().split(' ')[0].upper() == 'KEEP']
        out[run] = (bool(keep), f"KEEP recorded {keep[-1]['ts']}" if keep else
                    f'no `recorded KEEP` row for {run} in the journal ({len(rows)} recorded rows) -- the town-plan '
                    f'piece is not kept yet; the gate opens when it is')
    return out


def load_jsonl(path):
    out = []
    try:
        for line in open(path):
            line = line.strip()
            if line:
                out.append(json.loads(line))
    except FileNotFoundError:
        pass
    return out

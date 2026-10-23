#!/usr/bin/env python3
"""replay_lookahead.py <snapshot> <scan.jsonl> <host mods> <patches> <queues dir> -- READ-ONLY. DESIGN 2 replay.

For every episode since --since in which the HEAD was draw-blocked for 30 min or more with the slot otherwise free --
its loop sat in `draw` (journal draw .. drawn), or the scheduler printed WAIT R10 for it -- this asks what the proposed
lookahead (patches/lookahead.py, the pure decision) would have done:
  1. the queue AT THAT TIME: the host keeps a backup before every queue edit (canary-queue.json.bak-<op>-<stamp>), so the
     queue at T is the earliest backup stamped after T (the state before the next edit), else today's file;
  2. each entry behind the head, as the scheduler would have classified it at T: done/cancelled (journal), HOLD,
     `after` unmet (journal: the run named is not closed at T), no variant for the fleet base at T (variant keys), class;
  3. lookahead.decide() on that classification (depth 1 and depth "first ready, stopping at any hard blocker");
  4. for a candidate, the DRAW it would have made 30 min into the episode (drawsim, today's rule) with the head's
     exposure-eligible pools RESERVED (excluded): does it reach its minimum pools?
  5. the consequence: when the candidate would have run (its own recorded duration), and when the head would then have
     started -- never before it was actually drawable, and never before the candidate closed (the head goes first at
     the next opening, never skipped twice in a row).
Every counterfactual run's verdict is REASONED (it would have run on other pools at another time): nothing here re-runs
a read. Output: one block per episode, then the totals."""
import argparse, bisect, datetime as dt, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'patches'))
import drawsim, lookahead

T, ISO = drawsim.T, drawsim.ISO
STAMP = re.compile(r'(\d{8}T\d{6}Z)')


def queue_at(qdir, t):
    snaps = []
    for f in glob.glob(os.path.join(qdir, 'canary-queue.json.bak-*')):
        m = STAMP.search(f)
        if m:
            snaps.append((dt.datetime.strptime(m.group(1), '%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc), f))
    snaps.sort()
    after = [f for s, f in snaps if s >= t]
    src = after[0] if after else os.path.join(qdir, 'canary-queue.json')
    return json.load(open(src)), os.path.basename(src)


def closed_at(sim, run):
    rs = sim.runs.get(run) or []
    cl = [T(r['ts']) for r in rs if r['phase'] == 'torn-down' or (r['phase'] == 'promoted' and 'fleet-wide' in str(r.get('note')))]
    rec = [T(r['ts']) for r in rs if r['phase'] == 'recorded']
    return max(cl) if (cl and rec) else None


def first_row(sim, run):
    rs = sim.runs.get(run) or []
    return T(rs[0]['ts']) if rs else None


AFTER_AS_ORDERING = False      # --after-ordering: the SENSITIVITY run (section 2.4), not the proposed rule


def classify(sim, e, t):
    """The scheduler's view of one entry at t -> lookahead.Entry. With --after-ordering, an `after` is treated as queue
    ORDER only (satisfied) when the entry already has a variant keyed by the fleet base -- i.e. it does not need the run
    it names to be built on: what the queue would look like if `after` were kept for real code dependencies."""
    run = e.get('run')
    c = closed_at(sim, run)
    if c is not None and c <= t:
        state = 'done'
    elif first_row(sim, run) is not None and first_row(sim, run) <= t:
        state = 'blocked'                 # it journalled before t and is not closed: refused or open (a human decides)
    else:
        state = 'ready'
    base = sim.base_at(t)
    after_unmet = [a for a in (e.get('after') or []) if not (closed_at(sim, a) and closed_at(sim, a) <= t)]
    has_v = bool(base and base in (e.get('variants') or {}))
    if AFTER_AS_ORDERING and has_v:
        after_unmet = []
    return lookahead.Entry(run=run, state=state, hold=bool(e.get('hold')), after_unmet=after_unmet,
                           has_variant=has_v,
                           klass=e.get('class') or '', other_blockers=[])


def episodes(sim, since, sched):
    out = []
    for run, rs in sim.runs.items():
        d = [T(r['ts']) for r in rs if r['phase'] == 'draw']
        dn = [T(r['ts']) for r in rs if r['phase'] == 'drawn']
        if d and dn and min(d) >= since and (min(dn) - min(d)).total_seconds() >= 30 * 60:
            out.append({'head': run, 'from': min(d), 'to': min(dn), 'kind': 'loop in draw'})
    # R10 waits from the scheduler log (consecutive WAIT R10 lines for one head)
    cur = None
    for t, kind, txt in sched:
        m = re.match(r'R10 (\S+): WAIT', txt) if kind == 'WAIT' else None
        if m and t >= since:
            if cur and cur['head'] == m.group(1) and (t - cur['to']).total_seconds() <= 600:
                cur['to'] = t
            else:
                if cur and (cur['to'] - cur['from']).total_seconds() >= 30 * 60:
                    out.append(cur)
                cur = {'head': m.group(1), 'from': t, 'to': t, 'kind': 'scheduler WAIT R10'}
    if cur and (cur['to'] - cur['from']).total_seconds() >= 30 * 60:
        out.append(cur)
    return sorted(out, key=lambda x: x['from'])


def duration(sim, run):
    rs = sim.runs.get(run) or []
    dep = [T(r['ts']) for r in rs if r['phase'] == 'deployed']
    c = closed_at(sim, run)
    rec = [r for r in rs if r['phase'] == 'recorded']
    return ((c - min(dep)) if (dep and c) else None), (rec[-1]['note'] if rec else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('snap'); ap.add_argument('scan'); ap.add_argument('hostmods'); ap.add_argument('patches')
    ap.add_argument('queues'); ap.add_argument('--since', default='2026-10-12T00:00:00Z')
    ap.add_argument('--after-ordering', action='store_true')
    a = ap.parse_args()
    global AFTER_AS_ORDERING
    AFTER_AS_ORDERING = a.after_ordering
    print('MODE: %s' % ('SENSITIVITY -- `after` read as ordering when a base variant exists' if a.after_ordering
                        else 'the proposed rule (every `after` binds)'))
    sim = drawsim.Sim(a.snap, a.scan, a.hostmods, a.patches)
    import lanetime
    sched = lanetime.sched_lines(os.path.join(a.snap, 'digest', 'sched.log'))
    eps = episodes(sim, T(a.since), sched)
    saved = {1: 0.0, 0: 0.0}
    # EVERY 10 MIN through each episode (Codex r1 P2: one sampled instant is screening, not a replay), with the queue
    # as it stood at that minute; the first launch ends the episode. Still a per-episode replay: the slot is taken as
    # free (the episode is defined by it), no R11 / NEXT-SLOT occurred in these windows (sched.log), and the episodes
    # are independent (no lookahead launched in any of them under the rule, so no skipped history to carry).
    import collections
    gone = {1: {}, 0: {}}     # depth -> {head: launch}: once a lookahead launched past a head, its later episodes are not
    #                           this world's (the slot was busy) -- Claude r2 P3: never counted again
    for ep in eps:
        print('\n%s: %s %s -> %s (%.1f h)' % (ep['head'], ep['kind'], ISO(ep['from']), ISO(ep['to']),
                                             (ep['to'] - ep['from']).total_seconds() / 3600))
        head = lookahead.Head(run=ep['head'], hard_blockers=[], draw_blocked_since=ep['from'], skipped_last=False)
        for depth in (1, 0):
            tag = 'depth 1' if depth == 1 else 'first ready'
            if ep['head'] in gone[depth]:
                print('   %-11s -> not this world: %s already launched past %s at %s (the slot was busy; unmodelled)'
                      % (tag, gone[depth][ep['head']][1], ep['head'], ISO(gone[depth][ep['head']][0])))
                continue
            why_no = collections.Counter()
            launched = None
            t = ep['from'] + dt.timedelta(minutes=30)
            steps = 0
            while t < ep['to'] and launched is None:
                steps += 1
                q, src = queue_at(a.queues, t)
                ents = q.get('entries') or []
                idx = next((i for i, e in enumerate(ents) if e.get('run') == ep['head']), None)
                if idx is None:
                    why_no['the head is not in the queue (an operator launch)'] += 1
                    t += dt.timedelta(minutes=10); continue
                behind = [x for x in (classify(sim, e, t) for e in ents[idx + 1:]) if x.state not in ('done', 'cancelled')]
                tg = t.replace(second=0, microsecond=0) - dt.timedelta(minutes=t.minute % 5)
                e_head, _ih = sim.eligible(tg, ep['head'])
                reserve = set(sim.allowed(ep['head'], tg) or []) | set(e_head)
                pool = list(behind)
                while True:
                    dec = lookahead.decide(head, pool, t, slot_free=True, death_hold=False, next_slot=False, depth=depth)
                    if dec[0] != 'lookahead':
                        why_no[dec[1].split(' -- ')[0][:110]] += 1; break
                    cand = dec[1]
                    e, _info = sim.eligible(tg, cand)
                    e2 = [p for p in e if p not in reserve]
                    kt, mk = sim.k_target(cand)
                    if len(e2) >= mk:
                        launched = (t, cand, e2[:kt], sorted(reserve), src); break
                    why_no['candidate %s draw-blocked too (reserve %s)' % (cand, sorted(reserve))] += 1
                    if depth == 1:
                        break
                    pool = [x for x in pool if x.run != cand]
                t += dt.timedelta(minutes=10)
            if launched is None:
                print('   %-11s -> no launch in %d checks: %s' % (tag, steps, '; '.join('%s x%d' % kv for kv in why_no.most_common(3))))
                continue
            t, cand, pools, reserve, src = launched
            gone[depth][ep['head']] = (t, cand)
            dur, verdict = duration(sim, cand)
            if dur is None:
                print('   %-11s -> LAUNCH %s at %s on %s (reserve %s) [queue %s] -- it has never run, so its duration and '
                      'verdict are unknown: any lane-time figure is HYPOTHETICAL' % (tag, cand, ISO(t), ','.join(pools), reserve, src))
                continue
            lclose = t + dt.timedelta(minutes=5) + dur
            head_start = max(ep['to'], lclose + dt.timedelta(minutes=5))
            fill = min((ep['to'] - t).total_seconds(), (lclose - t).total_seconds()) / 3600
            print('   %-11s -> LAUNCH %s at %s on %s (reserve %s); its recorded duration %.1f h -> closes ~%s; head starts '
                  '~%s (%+.1f h); idle filled %.1f h (HYPOTHETICAL: other pools, other time)' % (
                      tag, cand, ISO(t), ','.join(pools), reserve, dur.total_seconds() / 3600, ISO(lclose), ISO(head_start),
                      (head_start - ep['to']).total_seconds() / 3600, fill))
            saved[depth] += fill
    print('\nidle lane hours filled (only for candidates that ran later, so a duration exists): depth 1 %.1f h, '
          'first-ready %.1f h' % (saved[1], saved[0]))


if __name__ == '__main__':
    main()

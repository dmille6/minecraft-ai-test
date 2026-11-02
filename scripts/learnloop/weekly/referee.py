#!/usr/bin/env python3
"""learning loop weekly REFEREE (owner 11-01, vendor terms = A): paid Claude/GPT answers are EVALUATION ONLY.
Runs on the MAC MINI ONLY (the keys live there; teacher_pilot.mac_only refuses elsewhere). Light: a batch-API client.

    ~/learnloop/venv/bin/python referee.py tick [--dry-run]      # launchd every 6 h (com.mcai.learnloop-referee)

Per round on 10.0.0.31 that has rounds/<R>/referee-sample.jsonl and no referee-result.json:
  1. copy the sample (the round's blind items) + the LOCAL teacher's answers to ~/learnloop/referee/<R>/
  2. submit each arm ONCE (teacher_pilot.py submit: the shared ledger ~/learnloop/spend.jsonl, the $100/month/vendor
     cap at 80%, reservation before any call, no retries). REFUSED when the round's EXPECTED cost for an arm is above
     usd_cap_per_arm (default $6 on the planning estimate; 200 items cost ~$1.9 Claude / ~$0.8 GPT at the pilot's measured rate)
  3. fetch until both arms ended (or 72 h passed: the result says which arm is missing), answers into the quarantine
     ~/learnloop/teacher-paid/<arm>/ (provenance teacher-paid:..., which every builder refuses for training)
  4. pilot_agreement.py on the sample: local vs each paid arm, paid vs paid -> a SMALL summary (counts and shares only,
     never the paid answers) written to rounds/<R>/referee-result.json on .31. The round's report computes the drift
     flag against the pilot baseline (local vs Claude 58.9% / vs GPT 59.6% on 1,000 items).
Nothing paid ever leaves the Mac except those agreement counts.
"""
import argparse, datetime as dt, glob, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
TEACHER = os.path.join(os.path.dirname(HERE), 'teacher')
sys.path.insert(0, TEACHER)
BOTS = os.environ.get('LL_BOTS_HOST', '10.0.0.31')
HOME = os.path.expanduser('~/learnloop')
RDIR = os.path.join(HOME, 'referee')
PY = os.path.join(HOME, 'venv', 'bin', 'python')
ARMS = ('B', 'C')
# the cap is on teacher_pilot's EXPECTED figure (1,500 output tokens per item, the design's planning number): 200 items
# = $4.36 Claude / $2.18 GPT expected; measured in the pilot: $0.0096 / $0.0041 per item, i.e. ~$1.9 / ~$0.8
CAP_PER_ARM = float(os.environ.get('LL_REFEREE_CAP', '6.0'))
GIVE_UP_H = 72


def iso():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def ssh(cmd, **kw):
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', BOTS, cmd], capture_output=True, text=True, **kw)


def summarize(rep):
    """pilot_agreement's report -> counts only (no paid text): per arm local-vs-paid agreement + paid-vs-paid."""
    out = {'items': rep['items'], 'agreement': {}, 'arms': {}}
    for name, t in rep['arms'].items():
        out['arms'][name] = {k: t[k] for k in ('answered', 'schema_valid', 'hard', 'rep_logged_nontransient', 'surface_share')}
    for pair, a in rep['agreement'].items():
        x, y = pair.split(' vs ')
        rec = {'pair': pair, 'n': a['both_valid'], 'same_skill_pct': a['same_skill'], 'skill_kappa': a['skill_kappa'],
               'same_key_pct': a['same_key'], 'same_skill': round((a['same_skill'] or 0) * a['both_valid'] / 100.0)}
        if x.startswith('local:') and 'anthropic' in y:
            out['agreement']['B'] = rec
        elif x.startswith('local:') and 'openai' in y:
            out['agreement']['C'] = rec
        elif 'anthropic' in pair and 'openai' in pair:
            out['agreement']['B_vs_C'] = rec
    return out


def arm_batches(arm, ids_key):
    import teacher_pilot as T
    return [r for r in T.ledger_rows() if r.get('arm') == arm and r.get('kind') == 'reserve' and r.get('items_key') == ids_key]


def tick(dry):
    import teacher_pilot as T
    T.mac_only()
    r = ssh('ls -d ~/learnloop/rounds/*/ 2>/dev/null')
    for d in [x.strip().rstrip('/') for x in r.stdout.split() if x.strip()]:
        rid = os.path.basename(d)
        have = ssh('test -f %s/referee-sample.jsonl && ! test -f %s/referee-result.json && echo todo' % (d, d)).stdout.strip()
        if have != 'todo':
            continue
        L = os.path.join(RDIR, rid); os.makedirs(L, exist_ok=True)
        st_p = os.path.join(L, 'state.json')
        st = json.load(open(st_p)) if os.path.exists(st_p) else {'first_seen': iso(), 'submitted': {}}
        for f in ('referee-sample.jsonl', 'referee-local.jsonl'):
            if not os.path.exists(os.path.join(L, f)):
                subprocess.run(['scp', '-q', '%s:%s/%s' % (BOTS, d, f), os.path.join(L, f)], check=True)
        items = T.load(os.path.join(L, 'referee-sample.jsonl'))
        for arm in ARMS:
            if st['submitted'].get(arm):
                continue
            exp = sum(b['usd_expected'] for b in T.plan_batches(items, arm, 'blind'))
            if exp > CAP_PER_ARM:
                st.setdefault('refused', {})[arm] = 'expected $%.2f > cap $%.2f' % (exp, CAP_PER_ARM); continue
            print('%s round %s arm %s: %d items, expected $%.2f' % (iso(), rid, arm, len(items), exp))
            if dry:
                continue
            a = argparse.Namespace(i_will_spend=True, arm=arm, pilot=os.path.join(L, 'referee-sample.jsonl'), probe=False,
                                   probe_offset=0, condition='blind', resubmit=False)
            T.cmd_submit(a)
            st['submitted'][arm] = iso()
        json.dump(st, open(st_p, 'w'), indent=1)
        if dry or not st['submitted']:
            continue
        for arm in st['submitted']:
            T.cmd_fetch(argparse.Namespace(arm=arm))
        key = {arm: T.items_key(arm, 'blind', items) for arm in st['submitted']}
        rows = T.ledger_rows()
        res_ids = {arm: {x['reservation'] for x in arm_batches(arm, key[arm])} for arm in st['submitted']}
        done = {arm: bool(res_ids[arm]) and all(any(y['kind'] == 'actual' and y.get('reservation') == rid_ for y in rows) for rid_ in res_ids[arm])
                for arm in st['submitted']}
        age_h = (time.time() - dt.datetime.strptime(st['first_seen'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).timestamp()) / 3600
        if not all(done.values()) and age_h < GIVE_UP_H:
            print('%s round %s: waiting for %s' % (iso(), rid, [a for a, v in done.items() if not v])); continue
        out = os.path.join(L, 'agreement.json')
        subprocess.run([PY, os.path.join(TEACHER, 'pilot_agreement.py'), '--pilot', os.path.join(L, 'referee-sample.jsonl'),
                        '--local', os.path.join(L, 'referee-local.jsonl'), '--arms', ','.join(st['submitted']), '--json', out],
                       check=True, capture_output=True)
        s = summarize(json.load(open(out)))
        usd = {arm: round(sum(y['usd'] for y in rows if y['kind'] == 'actual' and y.get('reservation') in res_ids[arm]), 4) for arm in st['submitted']}
        for arm in ('B', 'C'):
            if arm in s['agreement']:
                s['agreement'][arm]['usd'] = usd.get(arm)
        s.update({'round': rid, 'at': iso(), 'arms_done': done, 'refused': st.get('refused'),
                  'note': 'paid answers stay in ~/learnloop/teacher-paid on the Mac (evaluation only); this file has counts only'})
        tmp = os.path.join(L, 'referee-result.json'); json.dump(s, open(tmp, 'w'), indent=1)
        subprocess.run(['scp', '-q', tmp, '%s:%s/referee-result.json' % (BOTS, d)], check=True)
        print('%s round %s: referee result sent (%s)' % (iso(), rid, {k: v.get('same_skill_pct') for k, v in s['agreement'].items()}))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('verb', choices=('tick',)); ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    os.makedirs(RDIR, exist_ok=True)
    import fcntl
    lk = open(os.path.join(RDIR, '.lock'), 'w')
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0
    tick(a.dry_run)
    return 0


if __name__ == '__main__':
    sys.exit(main())

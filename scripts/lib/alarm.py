"""alarm.py -- one way for a host-side watcher to reach the owner (W5, fun mode 2026-10-28; ONE PAGER, phase 1 11-06).

Three surfaces, every one attempted, none fatal:
  1. ~/digest/ALARMS.log      one line per NEW / STILL / CLEARED / EVENT (append-only, greppable; format unchanged: stategen,
                              stallcheck and the Grafana agent parse it)
  2. journald                 `logger -t mcai-alarm` (always; `journalctl -t mcai-alarm`)
  3. a push                   the transports of /etc/mcai-alert.conf, the SAME file and format the death tripper reads
                              (infra/guard/mcai-alert.conf.example): ALERT_WEBHOOK (ntfy / Discord / Slack / Home
                              Assistant) and ALERT_EMAIL (needs a local sendmail). No file = no push, and the header line
                              built from push_channel() says so in '!! ' form, so "nobody was told" is never silent.

Pushes are DEDUPLICATED by alarm key (plan_pushes, pure): a key pushes when it first appears, again every repush interval
while it stays active, and once more when it clears.

ONE PAGER (codeeval 11-06 phase 1 item 2; docs/reports/phase1-autopilot-design-2026-11-06.md):
  TIERS (tier_of, pure). 1 PAGE = progress stopped and no autopilot rule fixes it: pushed now, re-pushed every 2 h until
        acknowledged or cleared. 2 DIGEST = goal / flow / drift / effect state: logged, never pushed one by one; the daily
        digest (scripts/host/pager.py digest) pushes their summary. 3 LOG = ALARMS.log and journald only.
  ACKS  ~/digest/alarm-acks.json (pager.py ack <source> <key-glob> <why> [--for 6h]): an acknowledged tier-1 key is not
        re-pushed (its NEW still is, unless the ack was written before it; its CLEARED always is) until the ack expires.
  DELIVERY. A push counts only when a remote transport answered: curl exit 0 AND an HTTP 2xx (the old notify ignored both,
        so a dead ntfy read as sent). A push that was not delivered goes to ~/digest/alarm-outbox.jsonl and is retried by
        every later alarm run (backoff 5 min doubling to 60 min) for 24 h, then given up LOUDLY (journald, ALARMS-delivery.log
        and the fleetstatus header). ~/digest/alarm-delivery.json holds the last success and the last failure.
"""
import datetime as dt
import fcntl
import fnmatch
import json
import os
import subprocess

UTC = dt.timezone.utc
CONF = '/etc/mcai-alert.conf'
ALARMS_LOG = '~/digest/ALARMS.log'
REPUSH = dt.timedelta(hours=6)
REPUSH_PAGE = dt.timedelta(hours=2)        # OWNER 11-06: "re-page an unacked tier-1 after 2 h"
TIER_PAGE, TIER_DIGEST, TIER_LOG = 1, 2, 3
OUTBOX_BACKOFF = dt.timedelta(minutes=5)
OUTBOX_BACKOFF_MAX = dt.timedelta(minutes=60)
OUTBOX_GIVEUP = dt.timedelta(hours=24)
BODY_MAX = 3500                            # ntfy's message limit is 4,096 bytes


def _iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def _ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def _ts_or_none(s):
    try:
        t = _ts(s)
        return t if t.tzinfo else None
    except (TypeError, ValueError):
        return None


def read_conf(path=CONF):
    conf = {}
    try:
        for line in open(path):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                conf[k.strip()] = v.strip().strip('"\'')
    except OSError:
        return None
    return conf


def push_channel(path=CONF):
    """-> (configured: bool, description). Never names the webhook URL (it may carry a secret topic or token)."""
    conf = read_conf(path)
    if conf is None:
        return False, f'NO CHANNEL ({path} absent)'
    kinds = []
    url = conf.get('ALERT_WEBHOOK', '')
    if url:
        kinds.append('ntfy webhook' if 'ntfy' in url else 'webhook')
    if conf.get('ALERT_EMAIL') and os.path.exists('/usr/sbin/sendmail'):
        kinds.append('email')
    elif conf.get('ALERT_EMAIL'):
        kinds.append('email (NO /usr/sbin/sendmail: will not send)')
    if not [k for k in kinds if 'will not send' not in k]:
        return False, f'NO CHANNEL ({path} has no usable ALERT_WEBHOOK / ALERT_EMAIL)'
    return True, ', '.join(kinds)


# ------------------------------------------------------------------------------------------------ tiers (pure)
DIGEST_SOURCES = ('driftwatch', 'effectwatch', 'flowledger', 'stallcheck')


def tier_of(source, key=''):
    """PURE. The tier of one alarm key. goalwatch: a single stuck goal is DIGEST, a whole town blocked (key town:<pool>)
    PAGES. Unknown sources PAGE (fail loud: a new watcher is never silently demoted)."""
    s = str(source or '')
    if s.startswith('goalwatch'):     # its own crash key (goalwatch:<label>) pages too: a dead watcher is never digest
        return TIER_PAGE if str(key).startswith(('town:', 'goalwatch:')) else TIER_DIGEST
    if s.startswith('projectaudit'):  # projectaudit (11-06): a BROKEN or DORMANT finished project pages; UNDERUSED is digest
        return TIER_PAGE if str(key).startswith(('broken:', 'dormant:', 'projectaudit:')) else TIER_DIGEST
    if s in DIGEST_SOURCES:
        return TIER_DIGEST
    if str(key).startswith('blind:'):  # a check that could not judge (hourwatch): the digest says so daily
        return TIER_DIGEST
    return TIER_PAGE


def repush_for(tier, acked=False):
    """PURE. How long a still-active key waits before it is re-pushed (tier 1 unacked: 2 h). Acked keys still produce a STILL
    event every interval (logged), but push_plan suppresses its push."""
    return REPUSH_PAGE if tier == TIER_PAGE and not acked else REPUSH


# ------------------------------------------------------------------------------------------------ acks
def acks_path(digest_dir):
    return os.path.join(digest_dir, 'alarm-acks.json')


def load_acks(digest_dir):
    try:
        d = json.load(open(acks_path(digest_dir)))
        return [a for a in (d.get('acks') or []) if isinstance(a, dict)]
    except (OSError, ValueError, AttributeError):
        return []


def find_ack(acks, source, key, now):
    """PURE. The newest unexpired ack whose source and key globs match, or None."""
    best = None
    for a in acks:
        until = _ts_or_none(a.get('until'))
        if until is None or until <= now:
            continue
        if fnmatch.fnmatchcase(str(source), str(a.get('source') or '*')) and fnmatch.fnmatchcase(str(key), str(a.get('key') or '')):
            if best is None or str(a.get('at') or '') > str(best.get('at') or ''):
                best = a
    return best


def push_plan(events, source, now, acks=(), tier=None):
    """PURE. events [(kind, key, line)] -> (push [(kind, key, line)], held [(kind, key, line, why)]).
    tier: an int for every key, or None for tier_of(source, key). Tier 1: NEW and STILL push unless an unexpired ack
    covers the key; CLEARED always pushes (it closes what was pushed). Tier 2/3: nothing pushes (digest / log)."""
    push, held = [], []
    for kind, key, line in events:
        tr = tier if tier is not None else tier_of(source, key)
        if tr != TIER_PAGE:
            held.append((kind, key, line, 'digest' if tr == TIER_DIGEST else 'log'))
            continue
        a = find_ack(acks, source, key, now) if kind != 'CLEARED' else None
        if a is not None:
            held.append((kind, key, line, f'acked until {a.get("until")} ({str(a.get("why") or "")[:80]})'))
            continue
        push.append((kind, key, line))
    return push, held


def compose(source, push):
    """PURE. One message for every event of one run (a batch of 5 pins is ONE push, not five)."""
    if len(push) == 1:
        kind, key, line = push[0]
        return f'{source} {kind}: {key}'[:120], str(line)[:BODY_MAX]
    counts = {}
    for kind, _, _ in push:
        counts[kind] = counts.get(kind, 0) + 1
    subject = f'{source}: ' + ', '.join(f'{n} {k}' for k, n in sorted(counts.items()))
    body = '\n'.join(f'{kind} {key}: {str(line)[:400]}' for kind, key, line in push)
    return subject[:120], body[:BODY_MAX]


# ------------------------------------------------------------------------------------------------ dedup (pure)
def plan_pushes(prev, active, now, repush=REPUSH):
    """PURE. prev: {key: {'since': iso, 'last_push': iso, 'line': str}}; active: {key: line} for this run.
    repush: a timedelta, or a callable key -> timedelta.
    -> (events, state). events: [(kind, key, line)] with kind NEW (first seen), STILL (active and its last push is at
    least `repush` old) or CLEARED (in prev, not active now). state: the next prev."""
    events, state = [], {}
    for key, line in sorted(active.items()):
        p = prev.get(key)
        if p is None:
            events.append(('NEW', key, line))
            state[key] = {'since': _iso(now), 'last_push': _iso(now), 'line': line}
            continue
        try:
            last = _ts(p.get('last_push'))
        except (TypeError, ValueError):
            last = None
        rp = repush(key) if callable(repush) else repush
        if last is None or now - last >= rp:
            events.append(('STILL', key, line))
            state[key] = {'since': p.get('since') or _iso(now), 'last_push': _iso(now), 'line': line}
        else:
            state[key] = dict(p, line=line)
    for key in sorted(set(prev) - set(active)):
        events.append(('CLEARED', key, prev[key].get('line', '')))
    return events, state


# ------------------------------------------------------------------------------------------------ delivery
def curl_verdict(rc, out, need_id=False):
    """PURE. curl's exit code and stdout (the response body followed by the 3-digit code -w appends) -> (ok, detail).
    ok only when curl exited 0, the server answered 2xx and, for ntfy (need_id), the body is the published message (ntfy
    answers a publish with JSON carrying its "id"). A proxy's 200 page or a captive portal is not a delivery."""
    out = out or ''
    code, body = out[-3:], out[:-3]
    if rc != 0:
        return False, f'curl exit {rc}'
    if not (code.isdigit() and code.startswith('2')):
        return False, f'HTTP {code or "?"}'
    if need_id:
        try:
            if not json.loads(body.strip().splitlines()[-1]).get('id'):
                return False, f'HTTP {code} but no message id in the answer'
        except (ValueError, IndexError, AttributeError):
            return False, f'HTTP {code} but the answer is not ntfy JSON'
    return True, f'HTTP {code}'


def _curl(argv, data, timeout=20, need_id=False):
    """-> (ok, detail). Runs curl with the body on stdout and -w appending the HTTP code (never --fail: a 4xx must still
    print its code). Never prints the URL."""
    try:
        r = subprocess.run(argv + ['-w', '%{http_code}'], input=data, text=True, capture_output=True, timeout=timeout)
    except Exception as e:      # noqa: BLE001
        return False, f'curl did not run: {type(e).__name__}'
    ok, why = curl_verdict(r.returncode, r.stdout, need_id)
    if r.returncode != 0:
        why += f' ({(r.stderr or "").strip()[:120]})'
    return ok, why


def send(subject, body, conf_path=CONF, tag='mcai-alarm', priority='high'):
    """Push to every configured transport. -> {'webhook': True|False|None, 'email': True|False|None, 'detail': str}.
    None = that transport is not configured. Never raises; never prints the webhook URL."""
    res = {'webhook': None, 'email': None, 'detail': ''}
    try:
        subprocess.run(['logger', '-t', tag, '-p', 'user.warning', f'{subject} :: {body}'[:4000]], check=False, timeout=10)
    except Exception:
        pass
    conf = read_conf(conf_path) or {}
    url = conf.get('ALERT_WEBHOOK', '')
    details = []
    if url:
        base = ['curl', '-sS', '--max-time', '15']
        if 'ntfy' in url:      # ntfy wants a plain body with metadata in headers (death-tripper.py, same reason)
            ok, why = _curl(base + ['-H', f'Title: {subject}', '-H', f'Priority: {priority}', '-H', 'Tags: warning,robot',
                                    '--data-binary', '@-', url], body, need_id=True)
        else:
            payload = json.dumps({'content': f'**{subject}**\n{body}', 'text': f'{subject}\n{body}',
                                  'title': subject, 'body': body})
            ok, why = _curl(base + ['-X', 'POST', '-H', 'Content-Type: application/json', '--data-binary', '@-', url], payload)
        res['webhook'] = ok
        details.append(f'webhook {why}')
    to = conf.get('ALERT_EMAIL', '')
    if to and os.path.exists('/usr/sbin/sendmail'):
        try:
            r = subprocess.run(['/usr/sbin/sendmail', '-t'], text=True, timeout=20, capture_output=True,
                               input=f'To: {to}\nSubject: [mcai] {subject}\n\n{body}\n')
            res['email'] = r.returncode == 0
            details.append(f'email exit {r.returncode}')
        except Exception as e:      # noqa: BLE001
            res['email'] = False
            details.append(f'email {type(e).__name__}')
    res['detail'] = '; '.join(details) or 'no remote transport configured'
    return res


def delivered(res):
    """PURE. A push was delivered when at least one configured remote transport succeeded."""
    return bool(res) and any(res.get(k) is True for k in ('webhook', 'email'))


def _delivery_note(digest_dir, ok, subject, detail, now):
    _delivery_mark(digest_dir, 'last_ok' if ok else 'last_fail', {'at': _iso(now), 'subject': subject[:120], 'detail': detail[:200]})


def _delivery_mark(digest_dir, field, value):
    """Set one field of ~/digest/alarm-delivery.json under its own short lock (no network inside): concurrent watchers
    must not overwrite each other's fields (Codex review r1b: a give-up mark lost to a racing success note)."""
    p = os.path.join(digest_dir, 'alarm-delivery.json')
    try:
        os.makedirs(digest_dir, exist_ok=True)
        lk = os.open(os.path.join(digest_dir, '.alarm-delivery.lock'), os.O_RDWR | os.O_CREAT, 0o664)
    except OSError:
        return
    try:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            d = json.load(open(p))
            if not isinstance(d, dict):
                d = {}
        except (OSError, ValueError):
            d = {}
        d[field] = value
        try:
            write_json_atomic(p, d)
        except OSError:
            pass
    finally:
        fcntl.flock(lk, fcntl.LOCK_UN)
        os.close(lk)


def gaveup_recent(digest_dir, now, window=dt.timedelta(hours=24)):
    """-> (n, at) of the newest give-up inside `window`, else (0, None). For the fleetstatus header."""
    try:
        g = (json.load(open(os.path.join(digest_dir, 'alarm-delivery.json'))) or {}).get('last_gaveup') or {}
        t = _ts_or_none(g.get('at'))
        if t is not None and now - t <= window:
            return int(g.get('n') or 0), g.get('at')
    except (OSError, ValueError, AttributeError, TypeError):
        pass
    return 0, None


def _outbox_path(digest_dir):
    return os.path.join(digest_dir, 'alarm-outbox.jsonl')


def _with_outbox(digest_dir, fn, blocking=True):
    """Run fn(rows) -> rows' under the outbox lock and write the result. Only fast work under the lock (no network).
    blocking=False: return None at once when another process holds it."""
    os.makedirs(digest_dir, exist_ok=True)
    lk = os.open(os.path.join(digest_dir, '.alarm-outbox.lock'), os.O_RDWR | os.O_CREAT, 0o664)
    try:
        try:
            fcntl.flock(lk, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except OSError:
            return None
        p = _outbox_path(digest_dir)
        rows = []
        try:
            for line in open(p):
                try:
                    r = json.loads(line)
                    if isinstance(r, dict):
                        rows.append(r)
                except ValueError:
                    continue
        except OSError:
            pass
        rows2 = fn(rows)
        if rows2 != rows:
            tmp = '%s.%d.tmp' % (p, os.getpid())
            with open(tmp, 'w') as f:
                for r in rows2:
                    f.write(json.dumps(r, sort_keys=True) + '\n')
            os.replace(tmp, p)
        return rows2
    finally:
        fcntl.flock(lk, fcntl.LOCK_UN)
        os.close(lk)


def outbox_due(row, now):
    """PURE. Retry an undelivered push now? Backoff 5 min doubling per failed try, capped at 60 min."""
    last = _ts_or_none(row.get('last_try'))
    if last is None:
        return True
    wait = min(OUTBOX_BACKOFF * (2 ** max(0, int(row.get('tries') or 1) - 1)), OUTBOX_BACKOFF_MAX)
    return now - last >= wait


def deliver(subject, body, now, digest_dir, conf_path=CONF, sender=None, priority='high'):
    """Send one push; when it was NOT delivered, queue it in the outbox. -> (delivered, detail)."""
    sender = sender or send
    res = sender(subject, body, conf_path=conf_path, priority=priority)
    ok = delivered(res)
    _delivery_note(digest_dir, ok, subject, res.get('detail', ''), now)
    if not ok:
        row = {'at': _iso(now), 'last_try': _iso(now), 'tries': 1, 'subject': subject, 'body': body,
               'priority': priority, 'err': res.get('detail', '')}
        _with_outbox(digest_dir, lambda rows: rows + [row])
        _delivery_log(digest_dir, now, 'QUEUED', subject, res.get('detail', ''))
    return ok, res.get('detail', '')


def _delivery_log(digest_dir, now, what, subject, detail):
    try:
        with open(os.path.join(digest_dir, 'ALARMS-delivery.log'), 'a') as f:
            f.write(f'{_iso(now)} {what:<8} {subject[:120]} :: {detail[:200]}\n')
    except OSError:
        pass


def outbox_batch(rows, now):
    """PURE. -> (give_up [row], due [row], keep [row]). give_up: first queued >= OUTBOX_GIVEUP ago; due: outbox_due."""
    give, due, keep = [], [], []
    for r in rows:
        first = _ts_or_none(r.get('at')) or now
        if now - first >= OUTBOX_GIVEUP:
            give.append(r)
        elif outbox_due(r, now):
            due.append(r)
        else:
            keep.append(r)
    return give, due, keep


def _outbox_line(r):
    return f'[{str(r.get("at"))[5:16]}] {r.get("subject")}: {str(r.get("body"))[:300]}'


def outbox_fit(due, limit=BODY_MAX - 100):
    """PURE. -> (send now, leave for the next run): the oldest due rows whose lines fit ONE message. A row is never claimed
    without being in the message (Codex review r1b: 50 queued pushes, the last ones cut off and still deleted)."""
    if len(due) <= 1:
        return list(due), []
    take, n = [], 0
    for r in due:
        ln = len(_outbox_line(r)) + 1
        if take and n + ln > limit:
            break
        take.append(r)
        n += ln
    return take, due[len(take):]


def outbox_message(due):
    """PURE. The claimed due pushes as ONE message (the channel coming back must not flood the phone)."""
    if len(due) == 1:
        return str(due[0].get('subject')), str(due[0].get('body'))[:BODY_MAX]
    body = '\n'.join(_outbox_line(r) for r in due)
    return f'{len(due)} delayed alarm pushes (since {min(str(r.get("at")) for r in due)[5:16]})'[:120], body[:BODY_MAX]


def flush_outbox(now, digest_dir, conf_path=CONF, sender=None):
    """Retry the due undelivered pushes as ONE message. Never sends while holding the lock, and never waits for it: another
    process flushing means this run skips (it is retried next run). Rows queued 24 h ago are dropped LOUDLY.
    -> {'sent', 'queued', 'gaveup', 'skipped'}."""
    sender = sender or send
    stats = {'sent': 0, 'queued': 0, 'gaveup': 0, 'skipped': False}
    claimed = []

    def claim(rows):                  # under the lock: drop the given-up, mark the due as tried now (no network)
        give, due, keep = outbox_batch(rows, now)
        due, later = outbox_fit(due)
        keep = keep + later
        stats['gaveup'] = len(give)
        for r in give:
            _delivery_log(digest_dir, now, 'GAVEUP', str(r.get('subject')), f'{r.get("tries")} tries; {r.get("err")}')
        tried = [dict(r, tries=int(r.get('tries') or 1) + 1, last_try=_iso(now)) for r in due]
        claimed.extend(tried)
        return keep + tried
    try:
        if _with_outbox(digest_dir, claim, blocking=False) is None:
            stats['skipped'] = True
            return stats
    except OSError:
        return stats
    if stats['gaveup']:
        _delivery_mark(digest_dir, 'last_gaveup', {'at': _iso(now), 'n': stats['gaveup']})
        try:
            subprocess.run(['logger', '-t', 'mcai-alarm', '-p', 'user.err',
                            f'{stats["gaveup"]} alarm push(es) GIVEN UP after 24 h undelivered'], check=False, timeout=10)
        except Exception:
            pass
    if claimed:
        subject, body = outbox_message(claimed)
        res = sender(subject, body, conf_path=conf_path, priority='high')
        if delivered(res):
            stats['sent'] = len(claimed)
            _delivery_note(digest_dir, True, subject, res.get('detail', ''), now)
            _delivery_log(digest_dir, now, 'RETRIED', subject, f'{len(claimed)} delayed push(es) delivered as one')
            ids = {(r.get('at'), r.get('subject')) for r in claimed}
            try:
                _with_outbox(digest_dir, lambda rows: [r for r in rows if (r.get('at'), r.get('subject')) not in ids])
            except OSError:
                pass
        else:
            err = res.get('detail', '')
            _delivery_note(digest_dir, False, subject, err, now)
            try:
                _with_outbox(digest_dir, lambda rows: [dict(r, err=err) if r in claimed else r for r in rows])
            except OSError:
                pass
    stats['queued'] = outbox_status(digest_dir)[0]
    return stats


def outbox_status(digest_dir):
    """-> (queued count, oldest iso or None). For the fleetstatus header."""
    n, oldest = 0, None
    try:
        for line in open(_outbox_path(digest_dir)):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            n += 1
            if oldest is None or str(r.get('at')) < oldest:
                oldest = str(r.get('at'))
    except OSError:
        pass
    return n, oldest


def notify(subject, body, conf_path=CONF, tag='mcai-alarm'):
    """Best-effort push to every configured transport (no outbox). Returns the transports that DELIVERED (journald is always
    listed: the logger call is local). Kept for callers that push their own one-off messages (stallcheck's daily list)."""
    res = send(subject, body, conf_path=conf_path, tag=tag)
    return ['journald'] + [k for k in ('webhook', 'email') if res.get(k) is True]


# ------------------------------------------------------------------------------------------------ the two entry points
def raise_alarms(source, active, now, state_path, log_path=ALARMS_LOG, conf_path=CONF, push=True, repush=None, tier=None,
                 sender=None):
    """Dedup `active` ({key: line}) against the state file, append every event to ALARMS.log, push the tier-1 ones that are
    not acknowledged (ONE message per run), queue an undelivered push in the outbox. Returns the events.
    A broken state file is treated as empty (re-pushes everything once: loud, never silent).
    repush: None = by tier (tier 1 unacked 2 h, else 6 h); a timedelta = for every key. tier: None = tier_of(source, key)."""
    sp = os.path.expanduser(state_path)
    lp = os.path.expanduser(log_path)
    dd = os.path.dirname(lp) or '.'
    try:
        prev = json.load(open(sp))
        if not isinstance(prev, dict):
            prev = {}
    except (OSError, ValueError):
        prev = {}
    acks = load_acks(dd)

    def rp(key):
        if repush is not None:
            return repush
        tr = tier if tier is not None else tier_of(source, key)
        return repush_for(tr, acked=find_ack(acks, source, key, now) is not None)
    events, state = plan_pushes(prev, active, now, rp)
    os.makedirs(dd, exist_ok=True)
    with open(lp, 'a') as f:
        for kind, key, line in events:
            f.write(f'{_iso(now)} {kind:<7} {source} {key} :: {line}\n')
    if push:
        flush_outbox(now, dd, conf_path, sender)
        to_push, _ = push_plan(events, source, now, acks, tier)
        if to_push:
            deliver(*compose(source, to_push), now, dd, conf_path, sender)
    tmp = '%s.%d.tmp' % (sp, os.getpid())
    os.makedirs(os.path.dirname(sp) or '.', exist_ok=True)
    with open(tmp, 'w') as f:
        json.dump(state, f, indent=1, sort_keys=True)
    os.replace(tmp, sp)
    return events


def one_shot(source, active, now, log_path=ALARMS_LOG, conf_path=CONF, push=True, tier=None, sender=None):
    """For events that happen once (a rollout's 60-min check): log each (EVENT), push the tier-1 unacknowledged ones as ONE
    message (outbox on failure), no dedup state, no CLEARED."""
    lp = os.path.expanduser(log_path)
    dd = os.path.dirname(lp) or '.'
    os.makedirs(dd, exist_ok=True)
    with open(lp, 'a') as f:
        for key, line in sorted(active.items()):
            f.write(f'{_iso(now)} {"EVENT":<7} {source} {key} :: {line}\n')
    if push and active:
        flush_outbox(now, dd, conf_path, sender)
        to_push, _ = push_plan([('EVENT', k, v) for k, v in sorted(active.items())], source, now, load_acks(dd), tier)
        if len(to_push) == 1:
            _, key, line = to_push[0]
            deliver(f'{source}: {key}'[:120], str(line)[:BODY_MAX], now, dd, conf_path, sender)
        elif to_push:
            deliver(*compose(source, to_push), now, dd, conf_path, sender)


def write_json_atomic(path, obj):
    p = os.path.expanduser(path)
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    tmp = '%s.%d.tmp' % (p, os.getpid())
    with open(tmp, 'w') as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=str)
    os.replace(tmp, p)


def ship_row(path, row):
    """Append one JSON line to a filebeat-shipped file (the showcase VM's /var/log/showcase/heartbeat.jsonl, route ops
    -> mcai-showcase-ops). tl_showcase.py and fleetstatus both filter that stream on kind == 'showcase_timelapse', so a
    row with another kind is invisible to them. Never raises; returns True when written."""
    try:
        with open(path, 'a') as f:
            f.write(json.dumps(row, sort_keys=True, default=str) + '\n')
        return True
    except OSError:
        return False

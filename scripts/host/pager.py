#!/usr/bin/env python3
r"""pager.py -- the ONE PAGER's operator side (codeeval 11-06 phase 1 item 2; design:
docs/reports/phase1-autopilot-design-2026-11-06.md). lib/alarm.py decides tiers, acks and delivery for every watcher; this
CLI adds what no watcher owns:

  relay    (cron */5 on .31) ~/digest/page.jsonl -> the pager. canary-sched.py page(), canary-loop.sh, modelrollout.py,
           drawrec.sh and the servea waiter append there, and NOTHING pushed it (71 error pages in 14 days; 11-05 'ROLLBACK
           INCOMPLETE' waited 10.4 h). Reads from a saved (inode, offset); a rotated or truncated file restarts at 0 and
           skips rows at or before the last relayed timestamp; the FIRST run starts at the end (history is not paged).
           Each row gets a tier (page_tier, pure): error -> PAGE; a REVERT / ROLLBACK / STOPPED / INTERRUPTED / NOT
           PROMOTED verdict -> PAGE; a flag that says the slot waits ('has waited', 'no journal line yet') -> PAGE; other
           flags, verdicts and warns -> DIGEST; info -> LOG (not relayed: page.jsonl holds it). One push per run. The same
           (run, level, text shape) inside 2 h is not pushed twice (the scheduler already dedups its keys for 3 h).
  ack <source> <key-glob> <why> [--for 6h|2d|--until ISO] [--by NAME]
           acknowledge: a matching tier-1 key is not re-pushed until the ack expires (default 24 h). `pager.py acks` lists
           them, `unack <source> <key-glob>` removes them.
  digest   (cron daily 12:30Z = 06:30 CST, the owner's report time) ONE push: what is open now (tier 1, with acks), the
           digest-tier alarms of the last 24 h by source (opened / cleared / still open), the relayed digest-tier pages,
           and the delivery state (queued, given up). --print shows it without pushing.
  flush    retry the outbox now.   status   delivery state, outbox, acks.
  selftest [--push]   the pure checks on synthetic data; --push also sends ONE '[selftest]' push and reports whether the
           channel DELIVERED it (curl exit + HTTP 2xx).
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL  # noqa: E402

UTC = dt.timezone.utc
DIGEST = os.path.expanduser('~/digest')
PAGE = os.path.join(DIGEST, 'page.jsonl')
RELAY_DEDUP = dt.timedelta(hours=2)
ACK_MAX = dt.timedelta(days=7)
MAX_ROWS_PER_PUSH = 20
PAGE_WORDS = re.compile(r'\bREVERT|ROLLBACK|ROLLED BACK|STOPPED|INTERRUPTED|NOT PROMOTED|INCOMPLETE|\bFAIL', re.I)
WAIT_WORDS = ('has waited', 'no journal line yet')


# ------------------------------------------------------------------------------------------------ pure
def page_tier(row):
    """PURE. One page.jsonl row -> tier (1 page / 2 digest / 3 log)."""
    level = str(row.get('level') or '').lower()
    msg = str(row.get('msg') or '')
    if level == 'error':
        return AL.TIER_PAGE
    if level == 'verdict':
        return AL.TIER_PAGE if PAGE_WORDS.search(msg) else AL.TIER_DIGEST
    if level == 'flag':
        return AL.TIER_PAGE if any(w in msg for w in WAIT_WORDS) else AL.TIER_DIGEST
    if level in ('warn', 'warning'):
        return AL.TIER_PAGE if PAGE_WORDS.search(msg) else AL.TIER_DIGEST
    if level == 'info':
        return AL.TIER_PAGE if PAGE_WORDS.search(msg) else AL.TIER_LOG
    return AL.TIER_PAGE          # an unknown level is loud, never quiet


def page_key(row):
    """PURE. The dedup key of a page row: run | level | the message's shape (digits and shas collapsed, 80 chars)."""
    msg = re.sub(r'\b[0-9a-f]{7,40}\b', '<sha>', str(row.get('msg') or ''))
    msg = re.sub(r'\d+(\.\d+)?', '#', msg)
    return f"{row.get('run') or '-'}|{row.get('level') or '-'}|{msg[:80]}"


def read_new(path, st):
    """-> (rows [(row, raw_line)], state'). st: {'ino', 'off', 'last_ts'} or {} (first run: start at the end)."""
    try:
        s = os.stat(path)
    except OSError:
        return [], st
    if not st:
        return [], {'ino': s.st_ino, 'off': s.st_size, 'last_ts': None, 'init': True}
    off = st.get('off') or 0
    restart = st.get('ino') != s.st_ino or s.st_size < off
    if restart:
        off = 0
    rows = []
    with open(path, 'rb') as f:
        f.seek(off)
        data = f.read()
    end = data.rfind(b'\n') + 1          # a half-written last line waits for the next run
    for raw in data[:end].decode('utf-8', 'replace').splitlines():
        try:
            r = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(r, dict):
            continue
        if restart and st.get('last_ts') and str(r.get('ts') or '') <= st['last_ts']:
            continue
        rows.append(r)
    last = max([str(r.get('ts') or '') for r in rows] + [st.get('last_ts') or ''])
    return rows, {'ino': s.st_ino, 'off': off + end, 'last_ts': last or None}


def relay_plan(rows, sent, now, acks=(), dedup=RELAY_DEDUP):
    """PURE. rows: new page.jsonl rows; sent: {key: iso last pushed}. -> (push [(row, key)], digest [(row, key)],
    held [(row, key, why)], sent'). Tier-1 rows push unless acked (source 'pager') or pushed inside `dedup`."""
    push, dig, held = [], [], []
    sent = {k: v for k, v in sent.items() if (AL._ts_or_none(v) or now) > now - dedup * 6}
    for r in rows:
        tr, key = page_tier(r), page_key(r)
        if tr == AL.TIER_LOG:
            continue
        if tr == AL.TIER_DIGEST:
            dig.append((r, key))
            continue
        last = AL._ts_or_none(sent.get(key))
        a = AL.find_ack(acks, 'pager', key, now)
        if a is not None:
            held.append((r, key, f'acked until {a.get("until")}'))
        elif last is not None and now - last < dedup:
            held.append((r, key, f'pushed {AL._iso(last)}'))
        else:
            push.append((r, key))
            sent[key] = AL._iso(now)
    return push, dig, held, sent


def relay_message(push, limit=MAX_ROWS_PER_PUSH):
    """PURE. -> (subject, body) of ONE push for this run's tier-1 page rows."""
    if len(push) == 1:
        r = push[0][0]
        return (f"pager {r.get('level')}: {r.get('run')}"[:120], f"{r.get('ts')} {r.get('msg')}"[:AL.BODY_MAX])
    lines = [f"{r.get('ts', '')[11:16]} {r.get('level')} {r.get('run')}: {str(r.get('msg'))[:300]}" for r, _ in push[:limit]]
    if len(push) > limit:
        lines.append(f'... and {len(push) - limit} more (~/digest/page.jsonl)')
    return f'pager: {len(push)} pages'[:120], '\n'.join(lines)[:AL.BODY_MAX]


def parse_for(s):
    """PURE. '6h' / '2d' / '90m' -> timedelta."""
    m = re.match(r'^(\d+(?:\.\d+)?)([mhd])$', str(s).strip())
    if not m:
        raise ValueError(f'--for {s!r}: write 90m, 6h or 2d')
    n, u = float(m.group(1)), m.group(2)
    return dt.timedelta(minutes=n) if u == 'm' else dt.timedelta(hours=n) if u == 'h' else dt.timedelta(days=n)


def parse_alarms_log(lines):
    """PURE. ALARMS.log lines -> [(t, kind, source, key, text)]."""
    out = []
    for line in lines:
        m = re.match(r'^(\S+) (NEW|STILL|CLEARED|EVENT)\s+(\S+) (.*?) :: (.*)$', line.rstrip('\n'))
        if not m:
            continue
        t = AL._ts_or_none(m.group(1))
        if t is not None:
            out.append((t, m.group(2), m.group(3), m.group(4), m.group(5)))
    return out


def digest_text(events, now, acks=(), outbox=(0, None), gaveup=0, window=dt.timedelta(hours=24)):
    """PURE. events from parse_alarms_log (whole file or a recent tail). -> (subject, body)."""
    newest = {}
    for t, kind, src, key, text in events:
        if kind != 'EVENT':
            newest[(src, key)] = (t, kind, text)
    open_ = {k: v for k, v in newest.items() if v[1] in ('NEW', 'STILL')}
    page_open = sorted((k, v) for k, v in open_.items() if AL.tier_of(k[0], k[1]) == AL.TIER_PAGE)
    lo = now - window
    recent = [e for e in events if e[0] >= lo]
    by = {}
    for t, kind, src, key, text in recent:
        if src == 'pager' or AL.tier_of(src, key) != AL.TIER_DIGEST:
            continue
        d = by.setdefault(src, {'NEW': 0, 'CLEARED': 0, 'keys': set()})
        if kind in ('NEW', 'CLEARED'):
            d[kind] += 1
    for (src, key), v in open_.items():
        if AL.tier_of(src, key) == AL.TIER_DIGEST:
            by.setdefault(src, {'NEW': 0, 'CLEARED': 0, 'keys': set()})['keys'].add(key)
    pages = [e for e in recent if e[2] == 'pager' and e[1] == 'EVENT']
    lines = [f'OPEN, paging tier ({len(page_open)}):']
    for (src, key), (t, kind, text) in page_open[:15]:
        a = AL.find_ack(acks, src, key, now)
        lines.append(f'  {src} {key} since<={AL._iso(t)[5:16]}{" ACKED until " + str(a.get("until"))[5:16] if a else ""}: {text[:160]}')
    lines.append(f'DIGEST tier, last {window.total_seconds() / 3600:.0f} h (opened / cleared / open now):')
    for src in sorted(by):
        d = by[src]
        ks = sorted(d['keys'])
        lines.append(f'  {src}: {d["NEW"]} / {d["CLEARED"]} / {len(ks)}' + (f' -- {", ".join(ks[:6])}{" ..." if len(ks) > 6 else ""}' if ks else ''))
    if pages:
        lines.append(f'pages (digest tier) {len(pages)}:')
        for t, _, _, key, text in pages[-10:]:
            lines.append(f'  {AL._iso(t)[5:16]} {text[:200]}')
    nq, oldest = outbox
    lines.append(f'delivery: {nq} queued{" since " + str(oldest) if oldest else ""}, {gaveup} given up in {window.total_seconds() / 3600:.0f} h')
    subject = f'mcai daily digest {now:%m-%d}: {len(page_open)} open page(s), {sum(len(d["keys"]) for d in by.values())} digest alarm(s)'
    return subject[:120], '\n'.join(lines)[:AL.BODY_MAX]


# ------------------------------------------------------------------------------------------------ impure
def _now():
    return dt.datetime.now(UTC).replace(microsecond=0)


def cmd_relay(a):
    now = _now()
    sp = os.path.join(a.digest, 'pager-relay.json')
    try:
        st = json.load(open(sp))
    except (OSError, ValueError):
        st = {}
    rows, cur = read_new(a.page, st.get('cursor') or {})
    acks = AL.load_acks(a.digest)
    push, dig, held, sent = relay_plan(rows, st.get('sent') or {}, now, acks)
    log = os.path.join(a.digest, 'ALARMS.log')
    with open(log, 'a') as f:
        for r, key in push + dig:
            f.write(f'{AL._iso(now)} {"EVENT":<7} pager {key.split("|")[0]}|{r.get("level")} :: '
                    f'{r.get("ts")} {str(r.get("msg"))[:600]}\n')
    if not a.no_push:
        AL.flush_outbox(now, a.digest, a.conf)
        if push:
            AL.deliver(*relay_message(push), now, a.digest, a.conf)
    AL.write_json_atomic(sp, {'cursor': cur, 'sent': sent, 'at': AL._iso(now)})
    print(f'{AL._iso(now)} pager relay: {len(rows)} new row(s){" (first run: cursor set to the end)" if cur.get("init") else ""}; '
          f'{len(push)} paged, {len(dig)} digest, {len(held)} held' + (' (NO PUSH)' if a.no_push else ''))
    return 0


def _rw_acks(digest, fn):
    p = AL.acks_path(digest)
    acks = AL.load_acks(digest)
    acks = fn(acks)
    AL.write_json_atomic(p, {'acks': acks})
    return acks


def cmd_ack(a):
    now = _now()
    until = AL._ts_or_none(a.until) if a.until else now + parse_for(a.for_)
    if until is None:
        sys.exit(f'--until {a.until!r} is not an ISO time')
    if not now < until <= now + ACK_MAX:
        sys.exit(f'an ack must end in the future and within {ACK_MAX.days} days (re-ack to extend)')
    row = {'source': a.source, 'key': a.key, 'why': a.why, 'by': a.by, 'at': AL._iso(now), 'until': AL._iso(until)}
    _rw_acks(a.digest, lambda acks: [x for x in acks if (AL._ts_or_none(x.get('until')) or now) > now] + [row])
    with open(os.path.join(a.digest, 'ALARMS.log'), 'a') as f:
        f.write(f'{AL._iso(now)} {"EVENT":<7} pager ack:{a.source}:{a.key} :: acked by {a.by} until {AL._iso(until)}: {a.why}\n')
    print(f'acked {a.source} {a.key} until {AL._iso(until)}')
    return 0


def cmd_unack(a):
    left = _rw_acks(a.digest, lambda acks: [x for x in acks if not (x.get('source') == a.source and x.get('key') == a.key)])
    print(f'{len(left)} ack(s) left')
    return 0


def cmd_acks(a):
    now = _now()
    for x in AL.load_acks(a.digest):
        live = (AL._ts_or_none(x.get('until')) or now) > now
        print(f"{'LIVE   ' if live else 'expired'} {x.get('source')} {x.get('key')} until {x.get('until')} by {x.get('by')}: {x.get('why')}")
    return 0


def _gaveup(digest, now, window):
    n = 0
    try:
        for line in open(os.path.join(digest, 'ALARMS-delivery.log')):
            if ' GAVEUP ' in line and (AL._ts_or_none(line.split(' ', 1)[0]) or now) >= now - window:
                n += 1
    except OSError:
        pass
    return n


def cmd_digest(a):
    now = _now()
    try:
        with open(os.path.join(a.digest, 'ALARMS.log'), 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 8_000_000))
            lines = f.read().decode('utf-8', 'replace').splitlines()
    except OSError as e:
        lines = []
        print(f'!! ALARMS.log unreadable: {e}')
    subject, body = digest_text(parse_alarms_log(lines), now, AL.load_acks(a.digest), AL.outbox_status(a.digest),
                                _gaveup(a.digest, now, dt.timedelta(hours=24)))
    print(subject)
    print(body)
    if not a.print:
        with open(os.path.join(a.digest, 'pager-digest.txt'), 'w') as f:
            f.write(f'{AL._iso(now)} {subject}\n{body}\n')
        ok, detail = AL.deliver(subject, body, now, a.digest, a.conf, priority='default')
        print(f'digest push: {"DELIVERED" if ok else "NOT delivered (queued)"} ({detail})')
    return 0


def cmd_flush(a):
    print(AL.flush_outbox(_now(), a.digest, a.conf))
    return 0


def cmd_status(a):
    ok, desc = AL.push_channel(a.conf)
    print(f'channel: {desc}')
    try:
        print('delivery:', json.dumps(json.load(open(os.path.join(a.digest, 'alarm-delivery.json'))), sort_keys=True))
    except (OSError, ValueError):
        print('delivery: no record yet')
    print('outbox: %d queued (oldest %s)' % AL.outbox_status(a.digest))
    return cmd_acks(a)


def cmd_selftest(a):
    import tempfile
    T = dt.datetime(2026, 11, 6, 12, 0, tzinfo=UTC)
    fails = []
    ck = lambda n, c: c or fails.append(n)
    ck('error pages', page_tier({'level': 'error', 'msg': 'x'}) == 1)
    ck('KEEP verdict digests', page_tier({'level': 'verdict', 'msg': 'VERDICT KEEP (+180)'}) == 2)
    ck('REVERT verdict pages', page_tier({'level': 'verdict', 'msg': 'VERDICT REVERT (+90)'}) == 1)
    ck('info logs', page_tier({'level': 'info', 'msg': 'launched x'}) == 3)
    rows = [{'ts': '2026-11-06T11:59:00Z', 'run': 'r', 'level': 'error', 'msg': 'BLOCKED H3 r 12'}]
    p1, _, _, sent = relay_plan(rows, {}, T)
    p2, _, h2, _ = relay_plan([dict(rows[0], msg='BLOCKED H3 r 13')], sent, T + dt.timedelta(minutes=5))
    ck('relay pushes, then dedups the same shape', len(p1) == 1 and not p2 and len(h2) == 1)
    with tempfile.TemporaryDirectory() as d:
        calls = []
        fake_bad = lambda s, b, conf_path=None, priority=None: (calls.append(s), {'webhook': False, 'detail': 'HTTP 500'})[1]
        fake_ok = lambda s, b, conf_path=None, priority=None: (calls.append(s), {'webhook': True, 'detail': 'HTTP 200'})[1]
        AL.raise_alarms('slotwatch', {'slot:x': 'idle'}, T, os.path.join(d, 's.json'), log_path=os.path.join(d, 'A.log'),
                        sender=fake_bad)
        ck('undelivered push is queued', AL.outbox_status(d)[0] == 1)
        st = AL.flush_outbox(T + dt.timedelta(minutes=6), d, sender=fake_ok)
        ck('outbox retried and delivered', st['sent'] == 1 and AL.outbox_status(d)[0] == 0)
    if a.push:
        now = _now()
        ok, detail = AL.deliver('[selftest] mcai pager delivery check',
                                f'{AL._iso(now)} pager.py selftest --push on {os.uname().nodename}: if you read this, '
                                f'the pager reaches you. No action needed.', now, a.digest, a.conf, priority='low')
        print(f'selftest push: {"DELIVERED" if ok else "NOT DELIVERED (queued in the outbox)"} ({detail})')
        if not ok:
            fails.append('push not delivered')
    print(f'pager selftest: {"FAIL " + "; ".join(fails) if fails else "ok"}')
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--digest', default=DIGEST)
    ap.add_argument('--conf', default=AL.CONF)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('relay'); r.add_argument('--page', default=PAGE); r.add_argument('--no-push', action='store_true')
    k = sub.add_parser('ack'); k.add_argument('source'); k.add_argument('key'); k.add_argument('why')
    k.add_argument('--for', dest='for_', default='24h'); k.add_argument('--until'); k.add_argument('--by', default='owner')
    u = sub.add_parser('unack'); u.add_argument('source'); u.add_argument('key')
    sub.add_parser('acks')
    g = sub.add_parser('digest'); g.add_argument('--print', action='store_true')
    sub.add_parser('flush')
    sub.add_parser('status')
    s = sub.add_parser('selftest'); s.add_argument('--push', action='store_true')
    a = ap.parse_args(argv)
    a.digest = os.path.expanduser(a.digest)
    return {'relay': cmd_relay, 'ack': cmd_ack, 'unack': cmd_unack, 'acks': cmd_acks, 'digest': cmd_digest,
            'flush': cmd_flush, 'status': cmd_status, 'selftest': cmd_selftest}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())

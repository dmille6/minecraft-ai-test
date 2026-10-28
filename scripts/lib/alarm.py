"""alarm.py -- one way for a host-side watcher to reach the owner (W5, fun mode 2026-10-28).

Three surfaces, every one attempted, none fatal:
  1. ~/digest/ALARMS.log      one line per NEW / STILL / CLEARED event (append-only, greppable)
  2. journald                 `logger -t mcai-alarm` (always; `journalctl -t mcai-alarm`)
  3. a push                   the transports of /etc/mcai-alert.conf, the SAME file and format the death tripper reads
                              (infra/guard/mcai-alert.conf.example): ALERT_WEBHOOK (ntfy / Discord / Slack / Home
                              Assistant) and ALERT_EMAIL (needs a local sendmail). No file = no push, and the header line
                              built from push_channel() says so in '!! ' form, so "nobody was told" is never silent.

Pushes are DEDUPLICATED by alarm key (plan_pushes, pure): a key pushes when it first appears, again every REPUSH while it
stays active, and once more when it clears. A watcher that runs every 15 min must not page 96 times a day for one stuck
goal (the 10-20 lesson: an alarm repeated hourly into a log nobody reads is no alarm), and must not stay quiet either.
"""
import datetime as dt
import json
import os
import subprocess

UTC = dt.timezone.utc
CONF = '/etc/mcai-alert.conf'
ALARMS_LOG = '~/digest/ALARMS.log'
REPUSH = dt.timedelta(hours=6)


def _iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def _ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


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


def plan_pushes(prev, active, now, repush=REPUSH):
    """PURE. prev: {key: {'since': iso, 'last_push': iso, 'line': str}}; active: {key: line} for this run.
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
        if last is None or now - last >= repush:
            events.append(('STILL', key, line))
            state[key] = {'since': p.get('since') or _iso(now), 'last_push': _iso(now), 'line': line}
        else:
            state[key] = dict(p, line=line)
    for key in sorted(set(prev) - set(active)):
        events.append(('CLEARED', key, prev[key].get('line', '')))
    return events, state


def notify(subject, body, conf_path=CONF, tag='mcai-alarm'):
    """Best-effort push to every configured transport. Returns the transports attempted (never raises)."""
    tried = []
    try:
        subprocess.run(['logger', '-t', tag, '-p', 'user.warning', f'{subject} :: {body}'[:4000]], check=False,
                       timeout=10)
        tried.append('journald')
    except Exception:
        pass
    conf = read_conf(conf_path) or {}
    url = conf.get('ALERT_WEBHOOK', '')
    if url:
        try:
            if 'ntfy' in url:      # ntfy wants a plain body with metadata in headers (death-tripper.py, same reason)
                subprocess.run(['curl', '-s', '-o', '/dev/null', '--max-time', '15', '-H', f'Title: {subject}',
                                '-H', 'Priority: high', '-H', 'Tags: warning,robot', '--data-binary', '@-', url],
                               input=body, text=True, timeout=20)
            else:
                payload = json.dumps({'content': f'**{subject}**\n{body}', 'text': f'{subject}\n{body}',
                                      'title': subject, 'body': body})
                subprocess.run(['curl', '-s', '-o', '/dev/null', '--max-time', '15', '-X', 'POST', '-H',
                                'Content-Type: application/json', '--data-binary', '@-', url],
                               input=payload, text=True, timeout=20)
            tried.append('webhook')
        except Exception:
            pass
    to = conf.get('ALERT_EMAIL', '')
    if to and os.path.exists('/usr/sbin/sendmail'):
        try:
            subprocess.run(['/usr/sbin/sendmail', '-t'], text=True, timeout=20,
                           input=f'To: {to}\nSubject: [mcai] {subject}\n\n{body}\n')
            tried.append('email')
        except Exception:
            pass
    return tried


def raise_alarms(source, active, now, state_path, log_path=ALARMS_LOG, conf_path=CONF, push=True, repush=REPUSH):
    """Dedup `active` ({key: line}) against the state file, append every event to ALARMS.log, push NEW/STILL/CLEARED.
    Returns the events. A broken state file is treated as empty (re-pushes everything once: loud, never silent)."""
    sp = os.path.expanduser(state_path)
    try:
        prev = json.load(open(sp))
        if not isinstance(prev, dict):
            prev = {}
    except (OSError, ValueError):
        prev = {}
    events, state = plan_pushes(prev, active, now, repush)
    lp = os.path.expanduser(log_path)
    os.makedirs(os.path.dirname(lp) or '.', exist_ok=True)
    with open(lp, 'a') as f:
        for kind, key, line in events:
            f.write(f'{_iso(now)} {kind:<7} {source} {key} :: {line}\n')
    if push:
        for kind, key, line in events:
            notify(f'{source} {kind}: {key}'[:120], line, conf_path)
    tmp = sp + '.tmp'
    os.makedirs(os.path.dirname(sp) or '.', exist_ok=True)
    with open(tmp, 'w') as f:
        json.dump(state, f, indent=1, sort_keys=True)
    os.replace(tmp, sp)
    return events


def one_shot(source, active, now, log_path=ALARMS_LOG, conf_path=CONF, push=True):
    """For events that happen once (a rollout's 60-min check): log and push each, no dedup state, no CLEARED."""
    lp = os.path.expanduser(log_path)
    os.makedirs(os.path.dirname(lp) or '.', exist_ok=True)
    with open(lp, 'a') as f:
        for key, line in sorted(active.items()):
            f.write(f'{_iso(now)} {"EVENT":<7} {source} {key} :: {line}\n')
    if push:
        for key, line in sorted(active.items()):
            notify(f'{source}: {key}'[:120], line, conf_path)


def write_json_atomic(path, obj):
    p = os.path.expanduser(path)
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    with open(p + '.tmp', 'w') as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=str)
    os.replace(p + '.tmp', p)


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

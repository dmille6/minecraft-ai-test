#!/usr/bin/env python3
"""ON THE BENCH BOT HOST (10.0.0.31, ~mike/showcase-feed.py). READ-ONLY. The only thing the showcase VM can run
here: its key sits in ~mike/.ssh/authorized_keys as
    restrict,from="10.0.0.40",command="/usr/bin/python3 /home/mike/showcase-feed.py" ssh-ed25519 ... showcase-feed
so it can read this one JSON document and nothing else (a forced command ignores what the client asks to run; this
script never reads SSH_ORIGINAL_COMMAND). It writes nothing, restarts nothing, and takes no lock.

Prints: the trial manifest; the journal rows that decide a release (promoted, owner-direct, recorded, poll-revert,
contained, torn-down) from the WHOLE journal; a census (each bench bot's newest skill row: bot, ts, code.version);
the expected roster (env files); the installed dependency digest; ONE control bot's env file -- a board bot outside
every declared canary pool whose newest row reports the majority control build -- so the showcase copies the fleet's
policy knobs from a bot verifiably running them; and up to 60 of that bot's newest whole llm prompts (the brain replay).
Design: docs/reports/showcase-2026-10-20.md section 3.
"""
import glob, hashlib, json, os, re, sys

SENTINEL = re.compile(r'saw_end: (END-[A-Z0-9]+)')
HARNESS = '/srv/mcbots/harness'
MANIFEST = '/srv/mcbots/trial-manifest.json'
JOURNAL = os.path.expanduser('~mike/canary-journal.jsonl')
ENV_DIR = '/srv/mcbots/harness/env'
PHASES = {'promoted', 'owner-direct', 'recorded', 'poll-revert', 'contained', 'torn-down'}


def newest_row(path, chunk=65536):
    """The last complete JSON line of a log file, read from the end (never the whole file)."""
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - chunk))
            lines = f.read().splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        try:
            return json.loads(line)
        except ValueError:
            continue
    return None


def recent_prompts(bot, n=60, chunk=4_000_000):
    """Up to n of the bot's newest llm prompts that are WHOLE: prompt.text under the logger's 6000-char cut and still
    carrying its `saw_end: END-...` sentinel line. For the showcase's brain replay (design section 2)."""
    path = os.path.join('/var/log/mcai', bot, f'llm-{bot}.jsonl')
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - chunk))
            lines = f.read().splitlines()[1:]
    except OSError:
        return []
    out = []
    for line in reversed(lines):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        p = r.get('prompt') or {}
        text = p.get('text') or ''
        m = SENTINEL.search(text)
        if m and len(text) < 6000:
            out.append({'ts': r.get('@timestamp'), 'system_hash': p.get('system_hash'), 'text': text,
                        'sentinel': m.group(1)})
        if len(out) >= n:
            break
    return out


def main():
    out = {'feed': 'showcase-feed 1', 'errors': []}
    try:
        out['manifest'] = json.load(open(MANIFEST))
    except (OSError, ValueError) as e:
        out['manifest'], _ = None, out['errors'].append(f'manifest: {e}')
    rows = []
    try:
        for line in open(JOURNAL):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get('phase') in PHASES:
                rows.append({k: r.get(k) for k in ('ts', 'run', 'phase', 'note')})
    except OSError as e:
        out['errors'].append(f'journal: {e}')
    out['journal'] = rows
    census = []
    for d in sorted(glob.glob('/var/log/mcai/*-*/')):
        bot = os.path.basename(d.rstrip('/'))
        r = newest_row(os.path.join(d, f'skill-{bot}.jsonl'))
        if r:
            census.append({'bot': bot, 'ts': r.get('@timestamp') or r.get('ts'),
                           'version': (r.get('code') or {}).get('version')})
    out['census'] = census
    m = out.get('manifest') or {}
    cpools = [p.strip() for p in str(m.get('canary_pool') or '').split(',') if p.strip()]
    ctrl = [c for c in census if c.get('version') and not any(c['bot'].startswith(p + '-') for p in cpools)]
    counts = {}
    for c in ctrl:
        counts[c['version']] = counts.get(c['version'], 0) + 1
    out['control_env'] = None
    out['prompts'] = []
    if counts:
        major = max(counts, key=counts.get)
        for c in sorted(ctrl, key=lambda c: c['bot']):
            p = os.path.join(ENV_DIR, c['bot'] + '.env')
            if c['version'] == major and c['bot'].startswith('board-') and os.path.isfile(p):
                out['control_env'] = {'bot': c['bot'], 'version': major, 'text': open(p).read()}
                out['prompts'] = recent_prompts(c['bot'])
                break
    # the expected roster: every bench bot with an env file (a stopped bot is still expected)
    out['roster'] = sorted(f[:-4] for f in os.listdir(ENV_DIR) if f.endswith('.env') and '-' in f and not f.startswith('.')
                           and not f.startswith('block2')) if os.path.isdir(ENV_DIR) else []
    # the installed dependency tree (what fleet bots actually load; fleet deploys never run npm ci)
    lock = os.path.join(HARNESS, 'node_modules', '.package-lock.json')
    try:
        out['deps_digest'] = hashlib.sha256(open(lock, 'rb').read()).hexdigest()[:16]
    except OSError as e:
        out['deps_digest'] = None
        out['errors'].append(f'deps: {e}')
    json.dump(out, sys.stdout)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()

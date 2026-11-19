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
import glob, gzip, hashlib, json, os, re, sys

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


def rotated_newest_row(path):
    """The last complete JSON line of the NEWEST rotated copy of a log (path-YYYYMMDD or path-YYYYMMDD.gz), or None.
    Used only to name the control bot while the fleet is stopped: the nightly rotation (~23:59Z) leaves every live log
    empty, so the live census finds no bot, no control env and no policy (11-19: piece stages refused for policy None)."""
    for p in sorted(glob.glob(path + '-*'), reverse=True)[:1]:
        if not p.endswith('.gz'):
            return newest_row(p)
        last = None
        try:
            with gzip.open(p, 'rb') as f:
                for line in f:
                    if line.strip():
                        last = line
        except (OSError, EOFError):
            return None
        try:
            return json.loads(last) if last else None
        except ValueError:
            return None
    return None


def pick_control(ctrl, env_dir):
    """ctrl: [{'bot', 'version'}] outside every canary pool -> (bot, majority version, env path) of the first board bot
    on the majority build that has an env file, or None. Pure but for isfile."""
    counts = {}
    for c in ctrl:
        if c.get('version'):
            counts[c['version']] = counts.get(c['version'], 0) + 1
    if not counts:
        return None
    major = max(counts, key=counts.get)
    for c in sorted(ctrl, key=lambda c: c['bot']):
        p = os.path.join(env_dir, c['bot'] + '.env')
        if c.get('version') == major and c['bot'].startswith('board-') and os.path.isfile(p):
            return c['bot'], major, p
    return None


def tree_digest(root):
    """CONTENT identity of the installed tree: sha256 over every entry's relative path and either its bytes (files)
    or its target (symlinks, directory symlinks included -- os.walk does not follow them). The same function runs on
    the showcase VM against the unpacked artifact, so 'the tree the bench runs' and 'the tree the showcase runs' are
    compared by content. ~1 GB read hourly at idle I/O priority."""
    h = hashlib.sha256()
    n = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        names = sorted(filenames + [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))])
        for fn in names:
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, root)
            if os.path.islink(p):
                h.update(f'L\0{rel}\0{os.readlink(p)}\n'.encode())
            else:
                fh = hashlib.sha256()
                with open(p, 'rb') as f:
                    for chunk in iter(lambda: f.read(1 << 20), b''):
                        fh.update(chunk)
                h.update(f'F\0{rel}\0{fh.hexdigest()}\n'.encode())
            n += 1
    if not n:
        raise OSError(f'{root} is empty')
    return h.hexdigest()[:16]


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
    out['control_env'] = None
    out['prompts'] = []
    pick = pick_control(ctrl, ENV_DIR)
    if pick is None and not census:
        # every live log is empty (the fleet stopped, then the nightly rotation): name the control bot from the build
        # each board bot last logged before the stop. The census itself stays empty (the stopped-fleet stage rule needs
        # census 0), and the control env marks where its version came from.
        last = []
        for d in sorted(glob.glob('/var/log/mcai/board-*-*/')):
            bot = os.path.basename(d.rstrip('/'))
            if any(bot.startswith(p + '-') for p in cpools):
                continue
            r = rotated_newest_row(os.path.join(d, f'skill-{bot}.jsonl'))
            if r:
                last.append({'bot': bot, 'version': (r.get('code') or {}).get('version')})
        pick = pick_control(last, ENV_DIR)
        if pick:
            pick = pick + ('rotated',)
    if pick:
        out['control_env'] = {'bot': pick[0], 'version': pick[1], 'text': open(pick[2]).read()}
        if len(pick) > 3:
            out['control_env']['from'] = 'rotated log (live logs empty)'
        out['prompts'] = recent_prompts(pick[0])
    # the expected roster: the bench's ENABLED bot units (what boots), not env files -- a pool stopped and disabled
    # for days (the owner's fleet reshape) is then not "expected" and cannot hold the follower forever
    wants = glob.glob('/etc/systemd/system/multi-user.target.wants/mcbot@*.service')
    out['roster'] = sorted(os.path.basename(w)[len('mcbot@'):-len('.service')] for w in wants)
    if not out['roster']:
        out['errors'].append('roster: no enabled mcbot@ units found')
    # the installed dependency tree (what fleet bots actually load; fleet deploys never run npm ci)
    # CONTENT identity of the installed TREE (not a lock file): tree_digest() hashes every file's bytes and every
    # symlink's target (~4 s hourly at idle priority). The showcase runs the same function on its copy and on every
    # unpack, which must reproduce this digest.
    try:
        out['deps_digest'] = tree_digest(os.path.join(HARNESS, 'node_modules'))
    except OSError as e:
        out['deps_digest'] = None
        out['errors'].append(f'deps: {e}')
    json.dump(out, sys.stdout)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()

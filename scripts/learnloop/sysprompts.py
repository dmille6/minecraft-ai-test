#!/usr/bin/env python3
"""Rebuild the fleet's system-prompt templates per code version and match them to the day's hashes (learning loop M1).

    python3 sysprompts.py --versions 9e7d9980,adbec4f4 [--repo /opt/minecraft-ai] [--cache ~/learnloop/sysprompts]

A decision row carries prompt.system_hash and code.version; the template text is rebuilt from that version's own
src/prompt.mjs (sysprompt.mjs, design s.1.1), once per (version, MEMORY_SCOPE), and cached by full sha. READ-ONLY on
the deploy checkout: `git rev-parse` and `git archive` only (the checkout is never reset, fetched or checked out), the
archive is unpacked into a private temp dir, and node_modules is a symlink to the harness's (prompt building needs no
dependency at a particular version; a version whose import fails is reported, never guessed).

match(day_pairs, rebuilt) is the positive control the nightly records: every (version, hash) pair seen in the day's
model decisions must be rebuilt from THAT version; anything else is listed as unmatched, with its decision count.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile

SCOPES = ('board', 'checkpoint', 'shared', 'isolated', 'private')
HERE = os.path.dirname(os.path.abspath(__file__))


def _git(repo, *args, **kw):
    return subprocess.run(['git', '-C', repo] + list(args), capture_output=True, timeout=120, **kw)


def resolve(repo, prefix):
    r = _git(repo, 'rev-parse', '--verify', '--quiet', prefix + '^{commit}', text=True)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def rebuild_version(repo, sha, node_modules, scopes=SCOPES, node=None):
    """-> ({hash: entry}, [errors]). One node run per scope; identical hashes from two scopes merge (scope list)."""
    out, errs = {}, []
    node = node or shutil.which('node') or '/usr/bin/node'     # absolute: cron's PATH is /usr/bin:/bin
    td = tempfile.mkdtemp(prefix='learnloop-sp-')
    try:
        arc = subprocess.run(['git', '-C', repo, 'archive', sha, 'bots/src', 'bots/package.json'], capture_output=True, timeout=120)
        if arc.returncode != 0:
            return {}, ['git archive %s: %s' % (sha[:8], arc.stderr.decode(errors='replace')[:200])]
        tx = subprocess.run(['tar', '-x', '-C', td], input=arc.stdout, capture_output=True, timeout=120)
        if tx.returncode != 0:
            return {}, ['tar: %s' % tx.stderr.decode(errors='replace')[:200]]
        bots = os.path.join(td, 'bots')
        if node_modules and os.path.isdir(node_modules):
            os.symlink(node_modules, os.path.join(bots, 'node_modules'))
        for sc in scopes:
            env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': td, 'MEMORY_SCOPE': sc,
                   'BOT_NAME': 'Learnloopbot', 'BOT_ROLE': 'gatherer', 'OLLAMA_MODEL': 'qwen2.5:7b-instruct',
                   'LOG_DIR': os.path.join(td, 'logs')}
            r = subprocess.run([node, os.path.join(HERE, 'sysprompt.mjs'), bots], capture_output=True, text=True,
                               timeout=90, env=env, cwd=bots)
            if r.returncode != 0 or not r.stdout.strip():
                errs.append('%s/%s: rc=%s %s' % (sha[:8], sc, r.returncode, (r.stderr or '')[-300:].replace('\n', ' ')))
                continue
            try:
                d = json.loads(r.stdout.strip().splitlines()[-1])
            except ValueError as e:
                errs.append('%s/%s: unparseable output (%s)' % (sha[:8], sc, e)); continue
            for h, e in d.items():
                if h in out:
                    out[h]['scopes'] = sorted(set(out[h]['scopes']) | {sc})
                else:
                    e = dict(e); e['scopes'] = [sc]; e.pop('scope', None); out[h] = e
        return out, errs
    finally:
        shutil.rmtree(td, ignore_errors=True)


def rebuild(versions, repo='/opt/minecraft-ai', cache='~/learnloop/sysprompts', node_modules='/srv/mcbots/harness/node_modules'):
    """versions: 8-char prefixes (as the triples carry them). -> {prefix: {'sha', 'hashes': {hash: entry}, 'errors'}}"""
    cache = os.path.expanduser(cache)
    os.makedirs(cache, exist_ok=True)
    res = {}
    for v in sorted(set(x for x in versions if x)):
        sha = resolve(repo, v)
        if not sha:
            res[v] = {'sha': None, 'hashes': {}, 'errors': ['version %s not found in %s' % (v, repo)]}; continue
        cp = os.path.join(cache, sha + '.json')
        if os.path.exists(cp):
            with open(cp) as fh:
                res[v] = json.load(fh); continue
        hashes, errs = rebuild_version(repo, sha, node_modules)
        res[v] = {'sha': sha, 'hashes': hashes, 'errors': errs}
        if hashes and not errs:            # only a complete rebuild is cached; a partial one is retried next night
            tmp = cp + '.tmp'
            with open(tmp, 'w') as fh:
                json.dump(res[v], fh)
            os.replace(tmp, cp)
    return res


def match(day_pairs, rebuilt):
    """day_pairs: {version: {hash: n_decisions}} (summary.system_hash_by_version). -> control dict."""
    tot = ok = 0
    unmatched = []
    for v, hs in sorted(day_pairs.items()):
        have = (rebuilt.get(v) or {}).get('hashes') or {}
        for h, n in sorted(hs.items()):
            tot += n
            if h in have:
                ok += n
            else:
                unmatched.append({'version': v, 'hash': h, 'decisions': n})
    pairs = sum(len(hs) for hs in day_pairs.values())
    return {'pairs': pairs, 'pairs_rebuilt': pairs - len(unmatched), 'decisions': tot, 'decisions_rebuilt': ok,
            'unmatched': unmatched, 'ok': not unmatched}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--versions', required=True)
    ap.add_argument('--repo', default='/opt/minecraft-ai')
    ap.add_argument('--cache', default='~/learnloop/sysprompts')
    a = ap.parse_args()
    r = rebuild(a.versions.split(','), a.repo, a.cache)
    for v, e in r.items():
        print(v, (e.get('sha') or '-')[:12], {h: x['scopes'] for h, x in e['hashes'].items()}, e['errors'] or '')


if __name__ == '__main__':
    sys.exit(main())

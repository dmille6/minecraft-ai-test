"""Read-only Elasticsearch client for the fleet's own archive.

WHY THIS DID NOT EXIST. `scripts/lib/telemetry.py` reads the JSONL FILES on the bots host.
Its own docstring points at Elasticsearch as "the authoritative archive" for anything wider
than a few days, and there was no code anywhere in the repo to query it. Meanwhile the
cluster holds ~30M skill documents, ~4M LLM documents and ~6.7M journal documents that
nothing has ever aggregated.

CREDENTIALS. `mcai_ship` is WRITE-ONLY (role mcai_writer) -- it returns 403 on
indices:monitor/stats, so it cannot even list indices. The read account is `mcai_ro`, whose
password lives at /root/.mcai_ro_password on the ELK host. This module never embeds a
secret; it reads one of them at call time.

NETWORK. The ELK host is 10.0.0.186. Several older scripts default to 192.168.192.194 /
192.168.193.30, which are on a network the owner has forbidden; those defaults are stale
pointers at the retired instance #2 and must not be revived.
"""
import json
import os
import subprocess

ES_URL = os.environ.get('MCAI_ES_URL', 'http://10.0.0.186:9200')
ES_USER = os.environ.get('MCAI_ES_USER', 'mcai_ro')
PW_FILE = os.environ.get('MCAI_ES_PWFILE', '/root/.mcai_ro_password')


class EsError(RuntimeError):
    pass


def _password():
    pw = os.environ.get('MCAI_ES_PASSWORD')
    if pw:
        return pw.strip()
    try:
        return open(PW_FILE).read().strip()
    except PermissionError:
        out = subprocess.run(['sudo', '-n', 'cat', PW_FILE],
                             capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
        raise EsError(f'cannot read {PW_FILE}; set MCAI_ES_PASSWORD or run with sudo')
    except FileNotFoundError:
        raise EsError(f'{PW_FILE} not found — run this on the ELK host, or set MCAI_ES_PASSWORD')


def request(path, body=None, method=None):
    """One request. Raises on a non-JSON reply or an ES `error` object -- never returns
    a partial or an error dict as if it were data."""
    url = f'{ES_URL}/{path.lstrip("/")}'
    cmd = ['curl', '-s', '-m', '60', '-u', f'{ES_USER}:{_password()}']
    if method:
        cmd += ['-X', method]
    if body is not None:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(body)]
    cmd.append(url)
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise EsError(f'curl failed ({out.returncode}): {out.stderr[:200]}')
    try:
        d = json.loads(out.stdout)
    except Exception:
        raise EsError(f'non-JSON reply from {path}: {out.stdout[:200]}')
    if isinstance(d, dict) and 'error' in d:
        e = d['error']
        reason = e.get('reason') if isinstance(e, dict) else str(e)
        raise EsError(f'{path}: {reason}')
    # A PARTIAL ANSWER IS NOT AN ANSWER. Verified by an independent review that mocked this
    # client: a response carrying `timed_out: true` or failed shards was accepted and its
    # aggregation used as if complete. That is the project's worst failure mode -- a number
    # that looks whole and is not -- implemented inside the client written to prevent it.
    if isinstance(d, dict):
        if d.get('timed_out'):
            raise EsError(f'{path}: the search TIMED OUT; the result is partial and must '
                          f'not be read as a count. Narrow the window or raise the timeout.')
        sh = d.get('_shards') or {}
        if sh.get('failed'):
            raise EsError(f'{path}: {sh["failed"]} of {sh.get("total")} shards FAILED; '
                          f'this answer covers only {sh.get("successful")} shards. '
                          f'Partial coverage is not a measurement.')
        if d.get('terminated_early'):
            raise EsError(f'{path}: terminated_early -- the search stopped before scanning '
                          f'the whole window.')
    return d


def count(index, query=None):
    body = {'query': query} if query else None
    return request(f'{index}/_count', body).get('count')


def agg(index, aggs, query=None, size=0):
    body = {'size': size, 'aggs': aggs}
    if query:
        body['query'] = query
    return request(f'{index}/_search', body).get('aggregations', {})


def last24h(lte='now'):
    """A CLOSED window. The first version had no upper bound, so two calls a minute apart
    counted different populations -- and a 17-document difference between this and the file
    count was reported as evidence of completeness when it is 1.6 seconds of fleet output."""
    return {'range': {'@timestamp': {'gte': 'now-24h', 'lte': lte}}}


def window(gte, lte):
    """An explicitly closed window, for any reconciliation that must be reproducible."""
    return {'range': {'@timestamp': {'gte': gte, 'lte': lte}}}


def newest(index):
    d = request(f'{index}/_search', {'size': 1, 'sort': [{'@timestamp': 'desc'}],
                                     '_source': ['@timestamp']})
    h = d.get('hits', {}).get('hits', [])
    return h[0]['_source']['@timestamp'] if h else None


def fields(index, all_indices=True):
    """Flattened mapping: {dotted.name: type}, INCLUDING multifields.

    Two defects the first version had, both found by an independent review:
      * it never walked `fields`, where multifields live -- so it could not tell
        `text` from `text` + `.keyword`, and was used to claim skill.detail had no
        keyword subfield. That claim was unprovable with this tool.
      * it read only the lexicographically last backing index, so a mapping that
        differs across the data stream's history was invisible.
    """
    d = request(f'{index}/_mapping')
    out = {}

    def walk(props, pre=''):
        for name, v in (props or {}).items():
            if 'properties' in v:
                walk(v['properties'], pre + name + '.')
            else:
                out.setdefault(pre + name, v.get('type', '?'))
                for sub, sv in (v.get('fields') or {}).items():
                    out.setdefault(f'{pre}{name}.{sub}', sv.get('type', '?'))
    keys = sorted(d) if all_indices else [sorted(d)[-1]]
    for k in keys:
        walk(d[k]['mappings'].get('properties', {}))
    return out


def mapping_differs(index):
    """Do the backing indices of this data stream disagree about any field?"""
    d = request(f'{index}/_mapping')
    per = {}
    for k in sorted(d):
        f = {}

        def walk(props, pre='', acc=f):
            for name, v in (props or {}).items():
                if 'properties' in v:
                    walk(v['properties'], pre + name + '.', acc)
                else:
                    acc[pre + name] = v.get('type', '?')
                    for sub, sv in (v.get('fields') or {}).items():
                        acc[f'{pre}{name}.{sub}'] = sv.get('type', '?')
        walk(d[k]['mappings'].get('properties', {}))
        per[k] = f
    names = sorted({n for f in per.values() for n in f})
    diffs = {}
    for n in names:
        seen = {f.get(n) for f in per.values()}
        if len(seen) > 1:
            diffs[n] = {k: per[k].get(n) for k in per}
    return len(per), diffs

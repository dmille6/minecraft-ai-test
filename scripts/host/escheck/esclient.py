"""escheck/esclient.py -- read-only Elasticsearch client that authenticates with an API KEY FILE.

CREDENTIALS. The only credential this uses is the owner-issued read-only API key at
/home/mike/.config/mcai/es-readonly.key on 10.0.0.31 (mode 600; privileges read +
view_index_metadata on mcai-*). It is read at call time, sent only as
`Authorization: ApiKey <key>` to the cluster, and never printed, logged, written or
passed on a command line (urllib, not curl -H, so it never appears in `ps`).
Do NOT point this at filebeat's credentials or the mcai_ro password: scripts/lib/es.py is
the password-based client and is deliberately not reused here.

A PARTIAL ANSWER IS NOT AN ANSWER. Every response is checked for an `error` object,
`timed_out`, failed shards and `terminated_early` (the guards scripts/lib/es.py earned).
"""
import base64
import json
import os
import stat
import urllib.error
import urllib.request

ES_URL = os.environ.get('MCAI_ES_URL', 'http://10.0.0.186:9200')
KEY_FILE = os.environ.get('MCAI_ES_KEYFILE', os.path.expanduser('~/.config/mcai/es-readonly.key'))


class EsError(RuntimeError):
    pass


def _auth_header():
    try:
        st = os.stat(KEY_FILE)
    except FileNotFoundError:
        raise EsError(f'{KEY_FILE} does not exist yet')
    if st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise EsError(f'{KEY_FILE} is readable by group/other; refusing to use it (expected mode 600)')
    raw = open(KEY_FILE).read().strip()
    if not raw:
        raise EsError(f'{KEY_FILE} is empty')
    # An Elasticsearch API key is sent as base64("id:api_key"). Accept either form on disk.
    if ':' in raw:
        raw = base64.b64encode(raw.encode()).decode()
    return 'ApiKey ' + raw


def request(path, body=None, method=None, timeout=120):
    url = f'{ES_URL}/{path.lstrip("/")}'
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'))
    req.add_header('Authorization', _auth_header())
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode()
    except urllib.error.HTTPError as e:
        txt = e.read().decode(errors='replace')
        raise EsError(f'{path}: HTTP {e.code}: {txt[:300]}')
    except urllib.error.URLError as e:
        raise EsError(f'{path}: {e.reason}')
    try:
        d = json.loads(txt)
    except Exception:
        raise EsError(f'non-JSON reply from {path}: {txt[:200]}')
    if isinstance(d, dict):
        if 'error' in d:
            e = d['error']
            raise EsError(f'{path}: {e.get("reason") if isinstance(e, dict) else e}')
        if d.get('timed_out'):
            raise EsError(f'{path}: TIMED OUT -- partial result, not a count')
        sh = d.get('_shards') or {}
        if sh.get('failed'):
            raise EsError(f'{path}: {sh["failed"]} of {sh.get("total")} shards FAILED')
        if d.get('terminated_early'):
            raise EsError(f'{path}: terminated_early')
    return d


def count(index, query=None):
    return request(f'{index}/_count', {'query': query} if query else None)['count']


def search(index, body):
    return request(f'{index}/_search', body)


def window(gte, lt):
    """Half-open [gte, lt) -- the file side buckets the same way."""
    return {'range': {'@timestamp': {'gte': gte, 'lt': lt, 'format': 'strict_date_optional_time'}}}

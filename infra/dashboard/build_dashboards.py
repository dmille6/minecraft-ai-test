#!/usr/bin/env python3
"""Generate the Grafana dashboards in stack/grafana/dashboards/ from code.

    python3 infra/dashboard/build_dashboards.py      # then ./deploy.sh (or just scp the json)

Hand-edited dashboard JSON drifts and cannot be reviewed; this file is the source of truth and the
JSON is a build product (committed so the stack can be installed without running this).
Grafana provisions the folder read-only (allowUiUpdates: false): change a panel here, not in the UI.
"""
import json
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stack', 'grafana', 'dashboards')
FLEET = 'http://10.0.0.31:9188'
WORLDS = 'http://10.0.0.30:9188'
SHOW = 'http://10.0.0.40:9188'
STATUS = '/status/'     # same origin: nginx proxies it to the fleet agent on 10.0.0.31 (~/digest/statusreport)
GALLERY = '/videos/'   # same origin: nginx on :80 serves Grafana at / and the gallery here

PROM = {'type': 'prometheus', 'uid': 'mcai-prom'}
ES = {'type': 'elasticsearch', 'uid': 'mcai-es'}
INF = {'type': 'yesoreyeram-infinity-datasource', 'uid': 'mcai-infinity'}
EXPR = {'type': '__expr__', 'uid': '__expr__'}

GREEN, YELLOW, ORANGE, RED, BLUE, PURPLE, GREY = 'green', 'yellow', 'orange', 'red', 'blue', 'purple', 'text'
NOT_INTERNAL = 'NOT skill.name:_*'      # rows whose skill.name starts with _ are reflexes and bookkeeping, not actions


# ------------------------------------------------------------------------------------------ queries
def prom(expr, legend='', ref='A', instant=False, fmt=None):
    t = {'refId': ref, 'datasource': PROM, 'expr': expr, 'legendFormat': legend or '__auto',
         'range': not instant, 'instant': instant, 'editorMode': 'code'}
    if fmt:
        t['format'] = fmt
    return t


def inf(url, cols, ref='A', root=''):
    """Infinity JSON table. cols: [(selector, title, type)] with type string|number|timestamp."""
    return {'refId': ref, 'datasource': INF, 'type': 'json', 'source': 'url', 'format': 'table',
            'url': url, 'url_options': {'method': 'GET', 'data': ''}, 'parser': 'backend',
            'root_selector': root, 'filters': [],
            'columns': [{'selector': s, 'text': t, 'type': ty} for s, t, ty in cols]}


def es(query, metrics=None, buckets=None, ref='A', alias=''):
    return {'refId': ref, 'datasource': ES, 'query': query, 'alias': alias, 'timeField': '@timestamp',
            'metrics': metrics or [{'type': 'count', 'id': '1'}], 'bucketAggs': buckets or []}


def hist(interval='1h', bid='2'):
    return {'type': 'date_histogram', 'id': bid, 'field': '@timestamp',
            'settings': {'interval': interval, 'min_doc_count': '0', 'trimEdges': '0'}}


def terms(field, size=10, bid='3', order_by='_count'):
    return {'type': 'terms', 'id': bid, 'field': field,
            'settings': {'size': str(size), 'order': 'desc', 'orderBy': order_by, 'min_doc_count': '1'}}


def math(expr, ref):
    return {'refId': ref, 'datasource': EXPR, 'type': 'math', 'expression': expr}


def reduce(of, ref, fn='sum'):
    return {'refId': ref, 'datasource': EXPR, 'type': 'reduce', 'expression': of, 'reducer': fn,
            'settings': {'mode': 'replaceNN', 'replaceWithValue': 0}}


# ------------------------------------------------------------------------------------------ panels
_ids = [0]


def _panel(ptype, title, pos, targets, desc='', ds=None, **kw):
    _ids[0] += 1
    p = {'id': _ids[0], 'type': ptype, 'title': title, 'gridPos': dict(zip('xywh', pos)),
         'description': desc, 'targets': targets}
    if ds or targets:
        p['datasource'] = ds or targets[0]['datasource']
    p.update(kw)
    return p


def steps(*pairs):
    """steps(GREEN, (RED, 5)) -> green below 5, red from 5."""
    out = [{'color': pairs[0], 'value': None}]
    out += [{'color': c, 'value': v} for c, v in pairs[1:]]
    return {'mode': 'absolute', 'steps': out}


def vmap(d):
    """{'KEEP': GREEN, ...} -> a value mapping that colours (and keeps) each text."""
    return [{'type': 'value', 'options': {k: {'color': c, 'index': i, 'text': k} for i, (k, c) in enumerate(d.items())}}]


def null_text(text):
    """A value mapping for 'nothing here' -- null and empty string both (Infinity hands back either)."""
    return [{'type': 'special', 'options': {'match': m, 'result': {'text': text, 'color': GREY, 'index': 98 + i}}}
            for i, m in enumerate(('null+nan', 'empty'))]


def stat(title, pos, targets, unit='none', th=None, mappings=None, calc='lastNotNull', fields='', desc='',
         color_mode='background', decimals=None, text_size=None, no_value=None, **kw):
    d = {'unit': unit, 'thresholds': th or steps(BLUE), 'mappings': mappings or [], 'color': {'mode': 'thresholds'}}
    if no_value is not None:   # shown when the series is absent, e.g. no canary declared
        d['noValue'] = no_value
    if decimals is not None:
        d['decimals'] = decimals
    opts = {'reduceOptions': {'calcs': [calc], 'fields': fields, 'values': False}, 'colorMode': color_mode,
            'graphMode': 'none', 'textMode': 'value', 'justifyMode': 'center', 'orientation': 'auto',
            'wideLayout': True, 'showPercentChange': False}
    if text_size:
        opts['text'] = {'valueSize': text_size}
    if pos[2] <= 3:   # the (i) icon costs a narrow tile its title ("Death..."); the README describes these instead
        desc = ''
    return _panel('stat', title, pos, targets, desc, fieldConfig={'defaults': d, 'overrides': []}, options=opts, **kw)


def timeseries(title, pos, targets, unit='none', stack=False, bars=False, desc='', th=None, legend='list',
               calcs=None, min_=None, max_=None, overrides=None, fill=10, **kw):
    custom = {'drawStyle': 'bars' if bars else 'line', 'lineWidth': 1 if bars else 2, 'fillOpacity': 80 if bars else fill,
              'gradientMode': 'opacity' if not bars else 'none', 'showPoints': 'never', 'spanNulls': True,
              'stacking': {'mode': 'normal' if stack else 'none', 'group': 'A'}, 'axisSoftMin': 0,
              'thresholdsStyle': {'mode': 'dashed' if th else 'off'}}
    d = {'unit': unit, 'custom': custom, 'color': {'mode': 'palette-classic'}}
    if th:
        d['thresholds'] = th
    if min_ is not None:
        d['min'] = min_
    if max_ is not None:
        d['max'] = max_
    opts = {'legend': {'displayMode': legend, 'placement': 'bottom', 'showLegend': True, 'calcs': calcs or []},
            'tooltip': {'mode': 'multi', 'sort': 'desc'}}
    return _panel('timeseries', title, pos, targets, desc,
                  fieldConfig={'defaults': d, 'overrides': overrides or []}, options=opts, **kw)


def col(name, *props):
    return {'matcher': {'id': 'byName', 'options': name}, 'properties': list(props)}


def width(w):
    return {'id': 'custom.width', 'value': w}


def unit(u):
    return {'id': 'unit', 'value': u}


def colored(mapping, mode='color-background'):
    return [{'id': 'mappings', 'value': vmap(mapping)},
            {'id': 'custom.cellOptions', 'value': {'type': mode, 'mode': 'basic'}}]


def gauge_cell(th, mx):
    return [{'id': 'custom.cellOptions', 'value': {'type': 'gauge', 'mode': 'basic', 'valueDisplayMode': 'text'}},
            {'id': 'thresholds', 'value': th}, {'id': 'min', 'value': 0}, {'id': 'max', 'value': mx},
            {'id': 'color', 'value': {'mode': 'thresholds'}}]


def table(title, pos, targets, overrides=None, sort=None, desc='', transformations=None, footer=False, **kw):
    cols = [c['text'] for c in targets[0].get('columns', [])] if targets else []
    if cols:   # Infinity hands columns back in alphabetical order; keep the order they were declared in
        transformations = (transformations or []) + [{'id': 'organize', 'options': {
            'indexByName': {c: i for i, c in enumerate(cols)}, 'excludeByName': {}, 'renameByName': {}}}]
    opts = {'showHeader': True, 'cellHeight': 'sm', 'footer': {'show': footer, 'reducer': ['sum'], 'countRows': False}}
    if sort:
        opts['sortBy'] = [{'displayName': sort[0], 'desc': sort[1]}]
    return _panel('table', title, pos, targets, desc,
                  fieldConfig={'defaults': {'custom': {'align': 'auto', 'filterable': True, 'inspect': True,
                                                       'cellOptions': {'type': 'auto'}},
                                            'mappings': [], 'thresholds': steps(GREEN)},
                               'overrides': overrides or []},
                  options=opts, transformations=transformations or [], **kw)


def bargauge(title, pos, targets, unit='percent', th=None, mx=100, desc='', **kw):
    return _panel('bargauge', title, pos, targets, desc,
                  fieldConfig={'defaults': {'unit': unit, 'min': 0, 'max': mx, 'thresholds': th or steps(GREEN, (ORANGE, 75), (RED, 90)),
                                            'color': {'mode': 'thresholds'}}, 'overrides': []},
                  options={'displayMode': 'gradient', 'orientation': 'horizontal', 'showUnfilled': True,
                           'valueMode': 'color', 'namePlacement': 'left', 'sizing': 'auto', 'minVizHeight': 16,
                           'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False}}, **kw)


def barchart(title, pos, targets, x, desc='', color=BLUE, **kw):
    return _panel('barchart', title, pos, targets, desc,
                  fieldConfig={'defaults': {'color': {'mode': 'fixed', 'fixedColor': color},
                                            'custom': {'fillOpacity': 80, 'lineWidth': 0, 'gradientMode': 'hue'}},
                               'overrides': []},
                  options={'xField': x, 'orientation': 'auto', 'showValue': 'always', 'barWidth': 0.7,
                           'legend': {'showLegend': False, 'displayMode': 'list', 'placement': 'bottom'},
                           'tooltip': {'mode': 'single'}}, **kw)


def piechart(title, pos, targets, desc='', overrides=None, **kw):
    return _panel('piechart', title, pos, targets, desc,
                  fieldConfig={'defaults': {'color': {'mode': 'palette-classic'}}, 'overrides': overrides or []},
                  options={'pieType': 'donut', 'displayLabels': ['value'],
                           'legend': {'showLegend': True, 'displayMode': 'table', 'placement': 'right', 'values': ['value']},
                           'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False},
                           'tooltip': {'mode': 'single'}}, **kw)


def alertlist(title, pos, desc=''):
    return _panel('alertlist', title, pos, [], desc,
                  options={'viewMode': 'list', 'groupMode': 'default', 'groupBy': [], 'maxItems': 30, 'sortOrder': 1,
                           'dashboardAlerts': False, 'alertName': '', 'alertInstanceLabelFilter': '',
                           'showInstances': True,
                           'stateFilter': {'firing': True, 'pending': True, 'noData': False, 'normal': False,
                                           'error': True, 'recovering': True}})


def text(title, pos, html, transparent=False, desc=''):
    return _panel('text', title, pos, [], desc=desc, options={'mode': 'html', 'content': html}, transparent=transparent)


def row(title, y, collapsed=False):
    _ids[0] += 1
    return {'id': _ids[0], 'type': 'row', 'title': title, 'gridPos': {'x': 0, 'y': y, 'w': 24, 'h': 1},
            'collapsed': collapsed, 'panels': []}


def dashboard(uid, title, panels, desc, time_from='now-24h', refresh='1m', tags=()):
    return {'uid': uid, 'title': title, 'description': desc, 'tags': ['mcai', *tags], 'timezone': 'browser',
            'editable': False, 'graphTooltip': 1, 'refresh': refresh, 'schemaVersion': 41, 'version': 1,
            'time': {'from': time_from, 'to': 'now'},
            'timepicker': {'refresh_intervals': ['30s', '1m', '5m', '15m', '1h']},
            'links': [{'title': 'Dashboards', 'type': 'dashboards', 'tags': ['mcai'], 'asDropdown': False,
                       'includeVars': False, 'keepTime': True, 'targetBlank': False, 'icon': 'external link'}],
            'templating': {'list': []}, 'annotations': {'list': [canary_annotation()]}, 'panels': panels}


def canary_annotation():
    """Canary decisions as vertical markers on every time series (from the journal via the agent)."""
    return {'name': 'Canary decisions', 'enable': True, 'iconColor': 'purple', 'datasource': INF,
            'target': inf(FLEET + '/canaries.json', [('decided', 'time', 'timestamp'), ('run', 'title', 'string'),
                                                     ('status', 'text', 'string')])}


# ------------------------------------------------------------------------------------------ shared pieces
CANARY_COLORS = {'PROMOTED': GREEN, 'KEEP': GREEN, 'IN TEST': BLUE, 'INCONCLUSIVE': YELLOW, 'CLOSED': GREY,
                 'ENDED': GREY, 'REVERT': RED, 'ROLLED BACK': RED}
QUEUE_COLORS = {'running': BLUE, 'ready': GREEN, 'blocked': RED, 'held': ORANGE, 'waiting': YELLOW}
SEV_COLORS = {'critical': RED, 'warning': ORANGE, 'info': BLUE}
GOAL_COLORS = {'STUCK': RED, 'OPEN': GREEN}

canary_cols = [('run', 'Change', 'string'), ('status', 'Result', 'string'), ('pools', 'Test pools', 'string'),
               ('deployed', 'Deployed', 'timestamp'), ('decided', 'Decided', 'timestamp'),
               ('hours', 'Hours', 'number'), ('last_phase', 'Last step', 'string'), ('note', 'Verdict', 'string')]
canary_over = [col('Result', *colored(CANARY_COLORS), width(120)), col('Change', width(170)), col('Hours', width(70)),
               col('Test pools', width(190)), col('Last step', width(120))]
queue_cols = [('run', 'Change', 'string'), ('state', 'State', 'string'), ('class', 'Class', 'string'),
              ('after', 'After', 'string'), ('not_before', 'Not before', 'string'), ('hold', 'Hold', 'string')]
queue_over = [col('State', *colored(QUEUE_COLORS, 'color-text'), width(90)), col('Change', width(170)), col('Class', width(130))]
alarm_cols = [('severity', 'Severity', 'string'), ('source', 'Source', 'string'), ('since', 'Since', 'timestamp'),
              ('ts', 'Last seen', 'timestamp'), ('text', 'Alarm', 'string')]
alarm_over = [col('Severity', *colored(SEV_COLORS), width(90)), col('Source', width(150)),
              col('Since', width(150)), col('Last seen', unit('dateTimeFromNow'), width(110))]
goal_cols = [('state', 'State', 'string'), ('town', 'Town', 'string'), ('project', 'Project', 'string'),
             ('hours_since_progress', 'Hours since progress', 'number'), ('visits_4h', 'Visits (4 h)', 'number'),
             ('last_visitor', 'Last visitor', 'string'), ('last_outcome', 'Last outcome', 'string'),
             ('why', 'Why', 'string'), ('site', 'Site', 'string')]
goal_over = [col('State', *colored(GOAL_COLORS), width(80)), col('Town', width(100)), col('Project', width(100)),
             col('Hours since progress', *gauge_cell(steps(GREEN, (ORANGE, 3), (RED, 12)), 48), width(170)),
             col('Visits (4 h)', width(90)), col('Last visitor', width(140)), col('Last outcome', width(120))]
bot_cols = [('bot', 'Bot', 'string'), ('pool', 'Town', 'string'), ('role', 'Role', 'string'),
            ('health', 'Health', 'number'), ('hunger', 'Food', 'number'), ('bag_slots', 'Bag slots', 'number'),
            ('top_items', 'Carrying most', 'string'), ('held', 'Held', 'string'), ('y', 'Y', 'number'),
            ('last_skill', 'Doing', 'string'), ('last_status', 'Status', 'string'),
            ('version', 'Build', 'string'), ('last_seen', 'Last row', 'timestamp')]
bot_over = [col('Bag slots', *gauge_cell(steps(GREEN, (YELLOW, 30), (RED, 34)), 36), width(140)),
            col('Health', *gauge_cell(steps(RED, (ORANGE, 8), (GREEN, 14)), 20), width(110)),
            col('Food', *gauge_cell(steps(RED, (ORANGE, 8), (GREEN, 14)), 20), width(110)),
            col('Bot', width(150)), col('Town', width(90)), col('Role', width(90)), col('Y', width(60)),
            col('Build', width(90)), col('Status', *colored({'success': GREEN, 'failure': RED, 'fail': RED}, 'color-text'), width(80)),
            col('Last row', unit('dateTimeFromNow'), width(110))]
world_cols = [('world', 'World', 'string'), ('kind', 'Kind', 'string'), ('up', 'Up', 'number'),
              ('tps_1m', 'TPS 1m', 'number'), ('tps_5m', 'TPS 5m', 'number'), ('mspt', 'MSPT', 'number'),
              ('players', 'Bots online', 'number'), ('rss_gb', 'Memory GB', 'number'), ('error', 'Error', 'string')]
world_over = [col('Up', {'id': 'mappings', 'value': [
                  {'type': 'value', 'options': {'1': {'text': 'UP', 'color': GREEN, 'index': 0}, '0': {'text': 'DOWN', 'color': RED, 'index': 1}}}]},
                  {'id': 'custom.cellOptions', 'value': {'type': 'color-background', 'mode': 'basic'}}, width(70)),
              col('TPS 1m', *gauge_cell(steps(RED, (ORANGE, 15), (GREEN, 19)), 20)),
              col('MSPT', *gauge_cell(steps(GREEN, (ORANGE, 35), (RED, 50)), 50), unit('ms'))]


def merge():
    return [{'id': 'merge', 'options': {}}]


# ------------------------------------------------------------------------------------------ dashboards
def overview():
    _ids[0] = 0
    p = []
    p.append(stat('Fleet bots', (0, 0, 3, 4), [prom('sum(mcai_bot_units_running{scope="fleet"})', instant=True)],
                  th=steps(RED, (ORANGE, 70), (GREEN, 80)), desc='mcbot@ units in state running on 10.0.0.31 (of 80).'))
    p.append(stat('Showcase', (3, 0, 3, 4), [prom('sum(mcai_bot_units_running{scope="showcase"})', instant=True)],
                  th=steps(RED, (GREEN, 1)), desc='mcshow@ units running on 10.0.0.40.'))
    p.append(stat('Fleet build', (6, 0, 3, 4), [inf(FLEET + '/manifest.json', [('fleet_build', 'Fleet build', 'string')])],
                  fields='/.*/', color_mode='value', text_size=24, desc='Declared fleet sha from the trial manifest.'))
    p.append(stat('In test now', (9, 0, 3, 4), [inf(FLEET + '/manifest.json', [('canary_run', 'In test', 'string')])],
                  fields='/.*/', color_mode='background', th=steps(PURPLE), mappings=null_text('nothing in test'),
                  text_size=22, desc='The canary declared in the trial manifest, if any.'))
    p.append(stat('Alarms', (12, 0, 3, 4), [prom('sum(mcai_alarms_active_total)', instant=True)],
                  th=steps(GREEN, (ORANGE, 1)), desc='NEW/STILL alarms in ALARMS.log on .31 and .40 (7 h window). Mostly warnings: the severities are in the table below.'))
    p.append(stat('Deaths 24h', (15, 0, 3, 4), [es('skill.name:_death', buckets=[hist('1h')])], calc='sum',
                  th=steps(GREEN, (ORANGE, 40), (RED, 80)), timeFrom='24h', hideTimeOverride=True,
                  desc='_death rows across the fleet in Elasticsearch, last 24 h. Baseline 10-19: 30/day.'))
    p.append(stat('Worlds OK', (18, 0, 3, 4),
                  [prom('count(mcai_world_tps_5m{kind!="sandbox"} >= 19) or vector(0)', instant=True)],
                  th=steps(RED, (ORANGE, 15), (GREEN, 17)), desc='Fleet + showcase worlds with 5-minute TPS >= 19 (of 17).'))
    p.append(stat('Bags full', (21, 0, 3, 4), [prom('sum(mcai_bots_bag_full)', instant=True)],
                  th=steps(GREEN, (ORANGE, 5), (RED, 15)), desc='Bots at >= 34 of 36 estimated inventory slots (fleet + showcase).'))

    p.append(alertlist('Firing alerts', (0, 4, 8, 10), desc='Grafana alert rules (folder Minecraft AI). Dashboard-only: no notifications are sent.'))
    p.append(table('Active alarms (fleet watchers)', (8, 4, 16, 10),
                   [inf(FLEET + '/alarms-fleet.json', alarm_cols, 'A'), inf(SHOW + '/alarms-showcase.json', alarm_cols, 'B')],
                   alarm_over, transformations=merge(), sort=('Since', False),
                   desc='The fleet\'s own watchers (goalwatch, flowledger, haltwatch, stallcheck, effectwatch...) via ALARMS.log.'))

    p.append(table('What was tested and how it went', (0, 14, 14, 11), [inf(FLEET + '/canaries.json', canary_cols)],
                   canary_over, sort=('Deployed', True), desc='One row per canary run from ~/canary-journal.jsonl.'))
    p.append(table('Up next in the test queue', (14, 14, 10, 11), [inf(FLEET + '/queue.json', queue_cols)], queue_over,
                   desc='canary-sched.py status: entries not done or cancelled, in queue order.'))

    p.append(timeseries('Bot actions per hour', (0, 25, 12, 8),
                        [es(NOT_INTERNAL, buckets=[terms('skill.status', 5), hist('1h')])], stack=True, bars=True,
                        desc='Every non-internal skill row, by status.',
                        overrides=[col('success', {'id': 'color', 'value': {'mode': 'fixed', 'fixedColor': 'green'}}),
                                   col('failure', {'id': 'color', 'value': {'mode': 'fixed', 'fixedColor': 'red'}})]))
    p.append(timeseries('Deaths by cause', (12, 25, 12, 8),
                        [es('skill.name:_death', buckets=[terms('skill.fail_class', 10), hist('1h')])], stack=True, bars=True,
                        desc='_death rows by fail_class, hourly.'))

    p.append(bargauge('CPU', (0, 33, 8, 7), [prom('100 * (1 - avg by (host) (rate(node_cpu_seconds_total{mode="idle"}[5m])))', '{{host}}', instant=True)]))
    p.append(bargauge('Memory used', (8, 33, 8, 7), [prom('100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)', '{{host}}', instant=True)]))
    p.append(bargauge('Root disk used', (16, 33, 8, 7), [prom('100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})', '{{host}}', instant=True)],
                      th=steps(GREEN, (ORANGE, 80), (RED, 90))))

    p.append(text('Latest world videos', (0, 40, 24, 22),
                  f'<iframe src="{GALLERY}" style="width:100%;height:100%;border:0;display:block" loading="lazy"></iframe>'))
    # The owner's status report headline on top (statusreport.py writes headline.html 4x a day); everything else moves
    # down by its height (gridPos y is absolute).
    for q in p:
        q['gridPos']['y'] += 4
    p.insert(0, text('Status report (12 AM / 6 AM / 12 PM / 6 PM Central)', (0, 0, 24, 4),
                     f'<iframe src="{STATUS}headline.html" style="width:100%;height:100%;border:0;display:block"></iframe>',
                     desc='scripts/host/statusreport.py on .31: the plain-language report. Full report: the Status Report '
                          'dashboard, or /status/ on this host.'))
    return dashboard('mcai-overview', 'Minecraft AI — Overview', p,
                     'Fleet, showcase, tests, alerts, servers and videos at a glance.', tags=['home'])


def bots():
    _ids[0] = 0
    p = []
    p.append(stat('Fleet bots reporting', (0, 0, 4, 4), [prom('sum(mcai_bots_reporting{scope="fleet"})', instant=True)],
                  th=steps(RED, (ORANGE, 70), (GREEN, 78)), desc='Bots with a log row in the last 10 minutes.'))
    p.append(stat('Showcase bots reporting', (4, 0, 4, 4), [prom('sum(mcai_bots_reporting{scope="showcase"})', instant=True)],
                  th=steps(RED, (GREEN, 1))))
    p.append(stat('Median bag (fleet)', (8, 0, 4, 4), [prom('quantile(0.5, mcai_bot_bag_slots{scope="fleet"})', instant=True)],
                  unit='none', decimals=0, th=steps(GREEN, (YELLOW, 30), (RED, 34)), desc='Estimated slots in use, of 36.'))
    p.append(stat('Bags full (fleet)', (12, 0, 4, 4), [prom('sum(mcai_bots_bag_full{scope="fleet"})', instant=True)],
                  th=steps(GREEN, (ORANGE, 5), (RED, 15)), desc='>= 34 of 36 slots. 10-19 census: 41 of 80.'))
    p.append(stat('Builds live', (16, 0, 4, 4), [prom('max(mcai_builds_live{scope="fleet"})', instant=True)],
                  th=steps(GREEN, (ORANGE, 3), (RED, 4)), desc='Distinct builds among fleet bots seen in the last hour. Two while a canary runs.'))
    p.append(stat('Action success (24 h)', (20, 0, 4, 4),
                  [es(NOT_INTERNAL + ' AND skill.status:success', buckets=[hist('1h')], ref='A'),
                   es(NOT_INTERNAL, buckets=[hist('1h')], ref='B'), reduce('$A', 'SA'), reduce('$B', 'SB'),
                   math('$SA / $SB * 100', 'C')],
                  unit='percent', decimals=1, th=steps(BLUE), timeFrom='24h', hideTimeOverride=True,
                  fields='', desc='Successful / all non-internal skill rows, last 24 h. Neutral colour: no baseline has been measured to judge it against.'))
    for t in p[-1]['targets'][:4]:
        t['hide'] = True

    p.append(barchart('Bag fullness (fleet)', (0, 4, 8, 8), [inf(FLEET + '/bagbands-fleet.json',
                                                                  [('band', 'Slots used', 'string'), ('bots', 'Bots', 'number')])],
                      x='Slots used', color=ORANGE, desc='Estimated slots in use per bot (36 = completely full).'))
    p.append(table('Towns (fleet pools)', (8, 4, 16, 8),
                   [inf(FLEET + '/pools-fleet.json', [('pool', 'Town', 'string'), ('bots', 'Bots', 'number'),
                                                      ('reporting', 'Reporting', 'number'), ('avg_bag_slots', 'Avg bag slots', 'number'),
                                                      ('bag_full', 'Bags full', 'number'), ('avg_health', 'Avg health', 'number'),
                                                      ('tail_deaths', 'Recent deaths', 'number')])],
                   [col('Avg bag slots', *gauge_cell(steps(GREEN, (YELLOW, 30), (RED, 34)), 36)),
                    col('Avg health', *gauge_cell(steps(RED, (ORANGE, 8), (GREEN, 14)), 20))]))

    p.append(timeseries('Average bag slots by town', (0, 12, 12, 8), [prom('avg by (pool) (mcai_bot_bag_slots)', '{{pool}}')],
                        min_=0, max_=36, th=steps(GREEN, (RED, 34)), legend='table', calcs=['lastNotNull', 'max'], fill=0))
    p.append(timeseries('Action success rate', (12, 12, 12, 8),
                        [es(NOT_INTERNAL + ' AND skill.status:success', buckets=[hist('1h')], ref='A'),
                         es(NOT_INTERNAL, buckets=[hist('1h')], ref='B'), math('$A / $B * 100', 'C')],
                        unit='percent', min_=0, max_=100, desc='Hourly successful / all non-internal skill rows.'))
    p[-1]['targets'][0]['hide'] = True
    p[-1]['targets'][1]['hide'] = True

    p.append(table('Top failing actions', (0, 20, 8, 9),
                   [es(NOT_INTERNAL + ' AND NOT skill.status:success', buckets=[terms('skill.name', 15)])],
                   [col('Count', *gauge_cell(steps(ORANGE), 1000))], sort=('Count', True), desc='Failed skill rows by skill, current time range.'))
    p.append(table('Top failure reasons', (8, 20, 8, 9),
                   [es(NOT_INTERNAL + ' AND NOT skill.status:success', buckets=[terms('skill.fail_class', 15)])],
                   sort=('Count', True)))
    p.append(timeseries('Most-used actions (successes / h)', (16, 20, 8, 9),
                        [es(NOT_INTERNAL + ' AND skill.status:success', buckets=[terms('skill.name', 8), hist('1h')])],
                        stack=True, bars=True))

    p.append(table('Fleet bots', (0, 29, 24, 18), [inf(FLEET + '/bots-fleet.json', bot_cols)], bot_over, sort=('Bag slots', True),
                   desc='Newest row of each bot\'s live log on 10.0.0.31 (refreshed every minute). Bag slots are estimated from counts.'))
    p.append(table('Showcase bots', (0, 47, 24, 12), [inf(SHOW + '/bots-showcase.json', bot_cols)], bot_over, sort=('Bot', False)))
    p.append(timeseries('Deaths by town', (0, 59, 12, 8), [es('skill.name:_death', buckets=[terms('exp.pool', 16), hist('6h')])],
                        stack=True, bars=True))
    p.append(timeseries('Town deposits', (12, 59, 12, 8),
                        [es('skill.name:town_deposit', buckets=[terms('skill.status', 4), hist('1h')])], stack=True, bars=True,
                        desc='town_deposit rows by status: bots banking into town chests.'))
    return dashboard('mcai-bots', 'Minecraft AI — Bots & Bags', p, 'Every bot: health, bags, what it is doing, what fails.')


def servers():
    _ids[0] = 0
    p = []
    node = '{job="node"}'
    p.append(stat('Hosts up', (0, 0, 4, 4), [prom(f'sum(up{node})', instant=True)], th=steps(RED, (ORANGE, 4), (GREEN, 5))))
    p.append(stat('Agents up', (4, 0, 4, 4), [prom('sum(up{job="mcai-agent"})', instant=True)], th=steps(RED, (ORANGE, 2), (GREEN, 3))))
    p.append(stat('Worlds up', (8, 0, 4, 4), [prom('sum(mcai_world_up{kind!="sandbox"})', instant=True)], th=steps(RED, (ORANGE, 16), (GREEN, 17))))
    p.append(stat('Slowest world TPS', (12, 0, 4, 4), [prom('min(mcai_world_tps{kind!="sandbox"})', instant=True)],
                  decimals=1, th=steps(RED, (ORANGE, 15), (GREEN, 19))))
    p.append(stat('Worst MSPT', (16, 0, 4, 4), [prom('max(mcai_world_mspt{kind!="sandbox"})', instant=True)], unit='ms',
                  decimals=1, th=steps(GREEN, (ORANGE, 35), (RED, 50)), desc='50 ms per tick = the server cannot keep 20 TPS.'))
    p.append(stat('Bots in worlds', (20, 0, 4, 4), [prom('sum(mcai_world_players)', instant=True)], th=steps(BLUE)))

    p.append(timeseries('CPU used', (0, 4, 12, 8), [prom('100 * (1 - avg by (host) (rate(node_cpu_seconds_total{mode="idle"}[5m])))', '{{host}}')],
                        unit='percent', min_=0, max_=100, legend='table', calcs=['mean', 'max', 'lastNotNull'], fill=0))
    p.append(timeseries('Memory used', (12, 4, 12, 8), [prom('100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)', '{{host}}')],
                        unit='percent', min_=0, max_=100, legend='table', calcs=['mean', 'max', 'lastNotNull'], fill=0))
    p.append(timeseries('Load per core (5 m)', (0, 12, 8, 8),
                        [prom('node_load5 / on(instance) group_left count by (instance) (node_cpu_seconds_total{mode="idle"})', '{{host}}')],
                        th=steps(GREEN, (RED, 1)), fill=0))
    p.append(timeseries('Network in + out', (8, 12, 8, 8),
                        [prom('sum by (host) (rate(node_network_receive_bytes_total{device!~"lo|docker.*|veth.*|br-.*"}[5m]) + rate(node_network_transmit_bytes_total{device!~"lo|docker.*|veth.*|br-.*"}[5m]))', '{{host}}')],
                        unit='Bps', fill=0))
    p.append(bargauge('Root disk used', (16, 12, 8, 8),
                      [prom('100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})', '{{host}}', instant=True)],
                      th=steps(GREEN, (ORANGE, 80), (RED, 90))))

    p.append(timeseries('World TPS', (0, 20, 12, 9), [prom('mcai_world_tps{kind!="sandbox"}', '{{world}}')],
                        min_=0, max_=20, th=steps(RED, (ORANGE, 15), (GREEN, 19)), fill=0, legend='table', calcs=['min', 'mean']))
    p.append(timeseries('World MSPT', (12, 20, 12, 9), [prom('mcai_world_mspt{kind!="sandbox"}', '{{world}}')],
                        unit='ms', th=steps(GREEN, (ORANGE, 35), (RED, 50)), fill=0, legend='table', calcs=['mean', 'max']))
    p.append(table('Worlds now', (0, 29, 14, 14),
                   [inf(WORLDS + '/worlds.json', world_cols, 'A'), inf(SHOW + '/worlds.json', world_cols, 'B')],
                   world_over, transformations=merge(), sort=('World', False),
                   desc='RCON tps/mspt/list each minute (read-only commands). Sandboxes are test servers.'))
    p.append(timeseries('World memory', (14, 29, 10, 14), [prom('mcai_world_rss_bytes', '{{world}}')], unit='bytes',
                        fill=0, legend='table', calcs=['lastNotNull']))
    p.append(table('Agent collectors', (0, 43, 12, 9), [prom('mcai_agent_collector_ok', '', instant=True, fmt='table')],
                   [col('Value', {'id': 'mappings', 'value': [{'type': 'value', 'options': {
                       '1': {'text': 'OK', 'color': GREEN, 'index': 0}, '0': {'text': 'FAILING', 'color': RED, 'index': 1}}}]},
                        {'id': 'custom.cellOptions', 'value': {'type': 'color-background', 'mode': 'basic'}},
                        {'id': 'displayName', 'value': 'Status'}, width(100))],
                   transformations=[{'id': 'organize', 'options': {'excludeByName': {'Time': True, '__name__': True, 'job': True,
                                                                                    'instance': True, 'role': True},
                                                                   'renameByName': {'agent_role': 'Agent', 'collector': 'Collector', 'host': 'Host'}}}],
                   sort=('Host', False),
                   desc='Each collector in mcai-dash-agent; 0 = its last run failed (see http://<host>:9188/health).'))
    p.append(stat('Host uptime', (12, 43, 12, 9), [prom('time() - node_boot_time_seconds', '{{host}}', instant=True)], unit='dtdurations',
                  color_mode='value', th=steps(ORANGE, (GREEN, 3600)), text_size=20))
    return dashboard('mcai-servers', 'Minecraft AI — Servers & Worlds', p, 'Lab hosts (node_exporter) and every Paper world (RCON).',
                     time_from='now-6h')


def testing():
    _ids[0] = 0
    p = []
    p.append(stat('Fleet build', (0, 0, 3, 4), [inf(FLEET + '/manifest.json', [('fleet_build', 'Fleet build', 'string')])],
                  fields='/.*/', color_mode='value', text_size=26))
    p.append(stat('In test', (3, 0, 4, 4), [inf(FLEET + '/manifest.json', [('canary_run', 'In test', 'string')])],
                  fields='/.*/', th=steps(PURPLE), mappings=null_text('nothing in test'), text_size=24))
    p.append(stat('Test build', (7, 0, 3, 4), [inf(FLEET + '/manifest.json', [('canary_build', 'Test build', 'string')])],
                  fields='/.*/', color_mode='value', mappings=null_text('-'), text_size=22))
    p.append(stat('Test pools', (10, 0, 4, 4), [inf(FLEET + '/manifest.json', [('canary_pools', 'Pools', 'string')])],
                  fields='/.*/', color_mode='value', mappings=null_text('-'), text_size=18))
    p.append(stat('Age', (14, 0, 2, 4), [prom('max(mcai_canary_age_seconds)', instant=True)],
                  unit='s', decimals=1, color_mode='value', no_value='-'))
    p.append(stat('Kept (30 d)', (16, 0, 3, 4), [prom('sum(mcai_canary_outcomes{window="30d",outcome=~"PROMOTED|KEEP"}) or vector(0)', instant=True)],
                  th=steps(GREEN)))
    p.append(stat('Reverted (30 d)', (19, 0, 3, 4), [prom('sum(mcai_canary_outcomes{window="30d",outcome=~"REVERT|ROLLED BACK"}) or vector(0)', instant=True)],
                  th=steps(GREEN, (RED, 1))))
    p.append(stat('Queue', (22, 0, 2, 4), [prom('sum(mcai_queue_entries{state="ready"}) or vector(0)', instant=True)], th=steps(BLUE)))

    p.append(table('Scheduler and watchers right now', (0, 4, 24, 7),
                   [inf(FLEET + '/digest.json', [('watch', 'Watch', 'string'), ('line', 'Latest line', 'string')])],
                   [col('Watch', width(140))], desc='Newest line of each watcher log in ~/digest on 10.0.0.31.'))
    p.append(table('Test history', (0, 11, 16, 16), [inf(FLEET + '/canaries.json', canary_cols)], canary_over, sort=('Deployed', True)))
    p.append(piechart('Outcomes (30 d)', (16, 11, 8, 8), [prom('sum by (outcome) (mcai_canary_outcomes{window="30d"})', '{{outcome}}', instant=True)],
                      overrides=[col(k, {'id': 'color', 'value': {'mode': 'fixed', 'fixedColor': c}}) for k, c in CANARY_COLORS.items()]))
    p.append(piechart('Outcomes (7 d)', (16, 19, 8, 8), [prom('sum by (outcome) (mcai_canary_outcomes{window="7d"})', '{{outcome}}', instant=True)],
                      overrides=[col(k, {'id': 'color', 'value': {'mode': 'fixed', 'fixedColor': c}}) for k, c in CANARY_COLORS.items()]))
    p.append(table('Queue (in order)', (0, 27, 24, 12), [inf(FLEET + '/queue.json', queue_cols)], queue_over))
    p.append(table('Showcase releases', (0, 39, 14, 12),
                   [inf(SHOW + '/releases.json', [('t', 'Time', 'timestamp'), ('event', 'Event', 'string'),
                                                  ('release', 'Release', 'string'), ('bots', 'Bots', 'number'),
                                                  ('why', 'What changed', 'string')])],
                   [col('Event', *colored({'activated': GREEN, 'rollout': BLUE, 'staged': PURPLE, 'stop-bots': ORANGE,
                                           'rollback': RED, 'rolled-back': RED}, 'color-text'), width(100)),
                    col('Time', width(160)), col('Release', width(220)), col('Bots', width(60))], sort=('Time', True)))
    p.append(table('Showcase pieces (tested before release)', (14, 39, 10, 12),
                   [inf(SHOW + '/pieces.json', [('piece', 'Piece', 'string'), ('kind', 'Kind', 'string'),
                                                ('tests', 'Tests', 'string'), ('sha', 'Sha', 'string'),
                                                ('summary', 'Test summary', 'string')])],
                   [col('Tests', *colored({'PASS': GREEN, 'FAIL': RED}), width(70)), col('Piece', width(160)),
                    col('Kind', width(90)), col('Sha', width(80))]))
    return dashboard('mcai-testing', 'Minecraft AI — Testing & Releases', p,
                     'What is in test, what passed, what failed, what is next.', time_from='now-7d')


def towns():
    _ids[0] = 0
    p = []
    p.append(stat('Open projects (fleet)', (0, 0, 4, 4), [prom('sum(mcai_goals_open{scope="fleet"})', instant=True)], th=steps(BLUE)))
    p.append(stat('Stuck projects (fleet)', (4, 0, 4, 4), [prom('sum(mcai_goals_stuck{scope="fleet"})', instant=True)],
                  th=steps(GREEN, (ORANGE, 1), (RED, 6)), desc='No progress for >= 3 h (goalwatch).'))
    p.append(stat('Open projects (showcase)', (8, 0, 4, 4), [prom('sum(mcai_goals_open{scope="showcase"})', instant=True)], th=steps(BLUE)))
    p.append(stat('Stuck projects (showcase)', (12, 0, 4, 4), [prom('sum(mcai_goals_stuck{scope="showcase"})', instant=True)],
                  th=steps(GREEN, (ORANGE, 1), (RED, 3))))
    p.append(stat('Town deposits (24 h)', (16, 0, 4, 4), [es('skill.name:town_deposit AND skill.status:success', buckets=[hist('1h')])],
                  calc='sum', th=steps(BLUE), timeFrom='24h', hideTimeOverride=True))
    p.append(stat('Wells used (24 h)', (20, 0, 4, 4), [es('skill.name:_well_dispose AND skill.status:success', buckets=[hist('1h')])],
                  calc='sum', th=steps(BLUE), timeFrom='24h', hideTimeOverride=True, desc='Junk dispose runs at town wells.'))

    p.append(table('Town projects (fleet)', (0, 4, 24, 12), [inf(FLEET + '/goals-fleet.json', goal_cols)], goal_over,
                   desc='Open town projects from goalwatch: STUCK = no placement for >= 3 h.'))
    p.append(table('Showcase projects', (0, 16, 24, 8), [inf(SHOW + '/goals-showcase.json', goal_cols)], goal_over))
    p.append(timeseries('Stuck projects over time', (0, 24, 12, 8), [prom('sum by (scope) (mcai_goals_stuck)', '{{scope}}')],
                        fill=20))
    p.append(timeseries('Building activity', (12, 24, 12, 8),
                        [es('skill.name:(_build_visit OR build_shop OR _plinth) AND skill.status:success', buckets=[terms('skill.name', 6), hist('1h')])],
                        stack=True, bars=True, desc='Successful build rows per hour.'))
    p.append(table('Daily scoreboard (goalboard, yesterday)', (0, 32, 24, 16),
                   [inf(FLEET + '/goalboard.json', [('section', 'Goal', 'string'), ('metric', 'Measure', 'string'),
                                                    ('value', 'Amount', 'number'), ('unit', 'Unit', 'string'),
                                                    ('rate', 'Rate', 'number'), ('out_of', 'Out of', 'string'),
                                                    ('day', 'Day', 'string')])],
                   [col('Goal', *colored({'build': BLUE, 'survive': GREEN, 'together': PURPLE, 'health': ORANGE}, 'color-text'), width(90)),
                    col('Measure', width(260)), col('Amount', width(110)), col('Unit', width(220)), col('Day', width(100))],
                   desc='scripts/host/goalboard.py, run nightly at 01:40Z on .31: the owner\'s build / survive / together goals.'))
    return dashboard('mcai-towns', 'Minecraft AI — Towns & Projects', p, 'Town projects, what is stuck, and the daily goal scoreboard.')


def status():
    _ids[0] = 0
    p = [text('', (0, 0, 24, 60), f'<iframe src="{STATUS}" style="width:100%;height:100%;border:0;display:block"></iframe>',
              transparent=True)]
    return dashboard('mcai-status', 'Minecraft AI — Status Report', p,
                     "The owner's plain-language report, 4 times a day; the previous four are one click away at the top.",
                     refresh='15m', tags=['home'])


def videos():
    _ids[0] = 0
    p = [text('', (0, 0, 24, 40), f'<iframe src="{GALLERY}" style="width:100%;height:100%;border:0;display:block"></iframe>', transparent=True)]
    return dashboard('mcai-videos', 'Minecraft AI — World Videos', p, 'Timelapses and highlight reels of the worlds.', refresh='15m')


# ------------------------------------------------------------------------------------------ alert rules
# Grafana-managed rules, shown on the Overview's "Firing alerts" panel. The owner chose dashboard-only
# alerting (11-04): no contact point is configured, so nothing is pushed anywhere.
def _rule(uid, title, expr, op, value, for_, severity, summary, window=300, nodata='OK'):
    return {'uid': uid, 'title': title, 'condition': 'C', 'for': for_, 'noDataState': nodata, 'execErrState': 'Error',
            'labels': {'severity': severity}, 'annotations': {'summary': summary},
            'data': [{'refId': 'A', 'relativeTimeRange': {'from': window, 'to': 0}, 'datasourceUid': 'mcai-prom',
                      'model': {'refId': 'A', 'expr': expr, 'instant': True, 'range': False}},
                     {'refId': 'C', 'datasourceUid': '__expr__', 'relativeTimeRange': {'from': 0, 'to': 0},
                      'model': {'refId': 'C', 'type': 'threshold', 'expression': 'A',
                                'conditions': [{'evaluator': {'type': op, 'params': [value]}}]}}]}


def _es_rule(uid, title, query, op, value, for_, severity, summary, window=3600):
    return {'uid': uid, 'title': title, 'condition': 'C', 'for': for_, 'noDataState': 'OK', 'execErrState': 'Error',
            'labels': {'severity': severity}, 'annotations': {'summary': summary},
            'data': [{'refId': 'A', 'relativeTimeRange': {'from': window, 'to': 0}, 'datasourceUid': 'mcai-es',
                      'model': dict(es(query, buckets=[hist('5m')]), datasource={'type': 'elasticsearch', 'uid': 'mcai-es'})},
                     {'refId': 'B', 'datasourceUid': '__expr__', 'relativeTimeRange': {'from': 0, 'to': 0},
                      'model': {'refId': 'B', 'type': 'reduce', 'expression': 'A', 'reducer': 'sum', 'settings': {'mode': 'replaceNN', 'replaceWithValue': 0}}},
                     {'refId': 'C', 'datasourceUid': '__expr__', 'relativeTimeRange': {'from': 0, 'to': 0},
                      'model': {'refId': 'C', 'type': 'threshold', 'expression': 'B',
                                'conditions': [{'evaluator': {'type': op, 'params': [value]}}]}}]}


def alert_rules():
    disk = '100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})'
    groups = [
        ('servers', [
            _rule('mcai-host-down', 'Host down', 'up{job="node"}', 'lt', 1, '3m', 'critical',
                  '{{ $labels.host }} ({{ $labels.instance }}) is not answering node_exporter'),
            _rule('mcai-disk', 'Root disk above 85%', disk, 'gt', 85, '30m', 'warning',
                  '{{ $labels.host }} root disk is {{ humanize $values.A.Value }}% full'),
            _rule('mcai-memory', 'Memory nearly exhausted', '100 * node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes',
                  'lt', 8, '10m', 'warning', '{{ $labels.host }} has {{ humanize $values.A.Value }}% memory available'),
            _rule('mcai-world-down', 'World not answering', 'mcai_world_up{kind!="sandbox"}', 'lt', 1, '3m', 'critical',
                  'Paper world {{ $labels.world }} did not answer RCON'),
            _rule('mcai-world-lag', 'World lagging', 'mcai_world_tps_5m{kind!="sandbox"}', 'lt', 18, '10m', 'warning',
                  '{{ $labels.world }} is at {{ humanize $values.A.Value }} TPS (5 m)'),
        ]),
        ('bots', [
            _rule('mcai-fleet-units', 'Fleet bots not running',
                  'max(mcai_bot_units_expected{scope="fleet"}) - sum(mcai_bot_units_running{scope="fleet"})', 'gt', 0, '15m',
                  'critical', '{{ humanize $values.A.Value }} of 80 fleet bot units are not running'),
            _rule('mcai-bots-silent', 'Bots running but not logging',
                  'sum by (scope) (mcai_bot_units_running) - sum by (scope) (mcai_bots_reporting)', 'gt', 2, '15m', 'warning',
                  '{{ humanize $values.A.Value }} {{ $labels.scope }} bots are running with no log row for 10 min'),
            _rule('mcai-bags-full', 'Many bags full', 'sum(mcai_bots_bag_full{scope="fleet"})', 'gt', 15, '1h', 'warning',
                  '{{ humanize $values.A.Value }} fleet bots are at >= 34 of 36 slots'),
            _es_rule('mcai-death-spike', 'Death spike', 'skill.name:_death', 'gt', 8, '0s', 'warning',
                     '{{ humanize $values.B.Value }} fleet deaths in the last hour (baseline ~1.3/h)'),
        ]),
        ('watchers', [
            _rule('mcai-watch-critical', 'Critical fleet alarm', 'sum by (source) (mcai_alarms_active{severity="critical"})',
                  'gt', 0, '5m', 'critical', '{{ $labels.source }} raised a critical alarm: see Active alarms'),
            _rule('mcai-canary-overdue', 'Canary running over 30 h', 'max(mcai_canary_age_seconds)', 'gt', 30 * 3600, '10m',
                  'warning', 'The canary has been declared for {{ humanizeDuration $values.A.Value }}: reads go to +1680 min at most'),
            _rule('mcai-agent-down', 'Dashboard agent down', 'up{job="mcai-agent"}', 'lt', 1, '5m', 'warning',
                  'mcai-dash-agent on {{ $labels.host }} is not answering: its panels are stale'),
            _rule('mcai-collector-failing', 'Dashboard collector failing', 'mcai_agent_collector_ok', 'lt', 1, '15m', 'warning',
                  'Collector {{ $labels.collector }} on {{ $labels.host }} is failing: http://{{ $labels.instance }}/health'),
        ]),
    ]
    return {'apiVersion': 1, 'groups': [{'orgId': 1, 'name': n, 'folder': 'Minecraft AI', 'interval': '1m', 'rules': rs}
                                        for n, rs in groups]}


def main():
    alerts = os.path.join(os.path.dirname(OUT), 'provisioning', 'alerting', 'rules.json')
    os.makedirs(os.path.dirname(alerts), exist_ok=True)
    with open(alerts, 'w') as f:
        json.dump(alert_rules(), f, indent=1)
    print('wrote alert rules')
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (('overview', overview), ('bots', bots), ('servers', servers), ('testing', testing),
                     ('towns', towns), ('videos', videos), ('status', status)):
        with open(os.path.join(OUT, f'{name}.json'), 'w') as f:
            json.dump(fn(), f, indent=1)
        print('wrote', name)


if __name__ == '__main__':
    main()

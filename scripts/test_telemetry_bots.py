#!/usr/bin/env python3
"""Events.rate(bots='auto') must count bot NAMES: rows carry `bot` as the log's whole bot object.
On the fleet host (2026-09-16) the blessed rate helper raised `unhashable type: 'dict'`."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from telemetry import Events

rows = [
    {'t': 1, 'name': '_death', 'detail': '', 'bot': {'name': 'hive-a-Alpha', 'pos': {'x': 1}}, 'raw': {}},
    {'t': 2, 'name': '_death', 'detail': '', 'bot': {'name': 'hive-a-Bravo', 'pos': {'x': 2}}, 'raw': {}},
    {'t': 3, 'name': 'gather', 'detail': '', 'bot': {'name': 'hive-a-Alpha', 'pos': {'x': 3}}, 'raw': {}},
    {'t': 4, 'name': 'gather', 'detail': '', 'bot': {}, 'raw': {}},          # unnamed: not a bot
]
ev = Events(rows, since=None, until=None, span=2.0)   # 2 bot-hours of span
assert ev.bots() == {'hive-a-Alpha', 'hive-a-Bravo'}, ev.bots()
r = ev.rate('_death', bots='auto')
assert abs(r - 2 / (2 * 2.0)) < 1e-9, r                 # 2 deaths / (2 bots * 2 h)
# a string bot (older normalisation) still counts
ev2 = Events([{'t': 1, 'name': 'x', 'detail': '', 'bot': 'B1', 'raw': {}}], since=None, until=None, span=1.0)
assert ev2.bots() == {'B1'}
try:
    ev.rate('_death')
    raise SystemExit('FAIL: rate() without bots= must raise')
except TypeError:
    pass
print('ok  4 assertions')

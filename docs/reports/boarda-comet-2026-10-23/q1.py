import sys; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
ev = EsEvents.load('skill', since='2026-10-08T00:00:00Z', until='2026-10-23T21:00:00Z', pools=['board-a'])
print('total docs board-a', ev.total())
for k in ['_water_no_air_route', '_water_no_air_route_ended']:
    try:
        print(k, dict(ev.by_bot(k)))
    except Exception as e: print(k, 'ERR', e)
evall = EsEvents.load('skill', since='2026-10-08T00:00:00Z', until='2026-10-23T21:00:00Z')
for k in ['_water_no_air_route', '_water_no_air_route_ended']:
    print('ALL', k, dict(evall.by_bot(k)))

import sys;sys.path.insert(0,'/home/mike/estel/scripts/lib')
from estelemetry import EsEvents
ev=EsEvents.load(since='2026-10-20T00:00:00Z',until='2026-10-27T23:00:00Z',bots=['placebo-c-Bravo'])
prev=None;n=0
for r in ev.where('home',lambda r:'by hand' in (r['skill'].get('detail') or ''),fields=['@timestamp','bot.pos','bot.tools','bot.inventory','skill.detail']):
    n+=1
    if n in(1,10,20): print(r['@timestamp'],r['bot']['pos'],r['bot'].get('tools'),{k:v for k,v in (r['bot'].get('inventory') or {}).items() if 'cobble' in k or 'log' in k or 'plank' in k or 'stick' in k or 'table' in k})
print('rows',n)
ev2=EsEvents.load(since='2026-10-26T18:00:00Z',until='2026-10-27T23:00:00Z',bots=['placebo-c-Bravo'])
last=None
for r in ev2.rows(fields=['@timestamp','bot.pos','skill.name','skill.status','skill.detail'],max_rows=20000):
    p=r['bot'].get('pos') or {}
    if last and abs((p.get('x') or 0)-559)>20 and abs((last['bot'].get('pos') or {}).get('x',0)-559)<=20:
        print('LEFT',last['@timestamp'],last['skill'],'->',r['@timestamp'],r['skill']['name'],r['skill'].get('status'),(r['skill'].get('detail') or '')[:160]);break
    last=r

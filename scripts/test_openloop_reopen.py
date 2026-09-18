import sys; sys.path.insert(0,'scripts/lib')
from openloop import open_loop

SHA='aa44514'
def man(declared='2026-09-18T13:04:27.533856Z', pool='board-b,hive-a'):
    return {'canary_pool':pool,'canary_code_version':SHA,'declared_at':declared}
def dec(ts, sha=SHA, v='INCONCLUSIVE'):
    return {'canary_sha':sha,'decision':v,'ts':ts}

T=[]
def t(name, got, want_open):
    ok = (got is not None) == want_open
    T.append(ok); print(f"{'PASS' if ok else 'FAIL'}  {name}\n        -> {got!r}")

# THE LIVE BUG
t("verdict recorded BEFORE this deployment must NOT close it",
  open_loop(man(), [dec('2026-09-18T12:59:51.819308+00:00')]), True)
# the ordinary close still works
t("verdict recorded AFTER this deployment closes it",
  open_loop(man(), [dec('2026-09-18T14:00:00+00:00')]), False)
t("verdict exactly AT declared_at closes it",
  open_loop(man(), [dec('2026-09-18T13:04:27.533856+00:00')]), False)
# positive control: the guard still fires for its original reason
t("no decision at all is open",
  open_loop(man(), []), True)
t("no canary declared is closed",
  open_loop(man(pool=''), []), False)
t("unreadable ledger is open",
  open_loop(man(), None), True)
# fail-closed details
t("decision with NO ts cannot close (cannot prove ordering)",
  open_loop(man(), [{'canary_sha':SHA,'decision':'KEEP'}]), True)
t("declared_at present but garbage is open",
  open_loop(man(declared='not-a-date'), [dec('2026-09-18T14:00:00+00:00')]), True)
t("declared_at ABSENT falls back to sha match (legacy manifest)",
  open_loop({'canary_pool':'p','canary_code_version':SHA}, [dec('2026-09-18T12:00:00+00:00')]), False)
t("a decision for a DIFFERENT sha never closes",
  open_loop(man(), [dec('2026-09-18T14:00:00+00:00', sha='deadbee')]), True)
t("naive ledger stamp is read as UTC and still closes",
  open_loop(man(), [dec('2026-09-18T14:00:00')]), False)
t("naive stamp BEFORE declared_at still does not close",
  open_loop(man(), [dec('2026-09-18T12:00:00')]), True)

print(f"\n{sum(T)}/{len(T)} passed")
sys.exit(0 if all(T) else 1)

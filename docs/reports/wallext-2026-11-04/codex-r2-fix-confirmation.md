BLOCKER — `bots/src/wall.mjs:1211,1219`: `demoMissing` skips unread cells, allowing `demoDone` to permanently complete while an unlisted late repair block remains in an unloaded chunk. Reproduced: empty clear list, one retired cell, `read => null`, retirement five minutes old → `demoDone === true`.

Fix: require every eligible retired cell to be readable before completing; unread must defer completion. Add a regression covering an unread, unlisted retired cell.

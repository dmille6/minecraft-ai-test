// voyager-01: the pilot's own telemetry, one JSON line per event, size-capped (design §12 B5: 200 MB a file, 2 GB an arm).

import fs from 'node:fs'
import path from 'node:path'

const MAX_FILE = 200 * 1024 * 1024
const KEEP = 9

export function makeLog (dir, name, { arm = null, code = null } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.jsonl`)
  let size = 0
  try { size = fs.statSync(file).size } catch { size = 0 }
  const rotate = () => {
    for (let i = KEEP - 1; i >= 1; i--) { try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`) } catch { /* gap */ } }
    try { fs.renameSync(file, `${file}.1`) } catch { /* none */ }
    try { fs.rmSync(`${file}.${KEEP + 1}`, { force: true }) } catch { /* none */ }
    size = 0
  }
  return (kind, fields = {}) => {
    try {
      const line = JSON.stringify({ t: new Date().toISOString(), arm, code, kind, ...fields }) + '\n'
      if (size + line.length > MAX_FILE) rotate()
      fs.appendFileSync(file, line)
      size += line.length
    } catch { /* telemetry must never take the bot down */ }
  }
}

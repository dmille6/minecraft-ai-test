// townstyle-02: writes the re-roofed generations of the standing blueprints and the town hall from bots/src/townstyle.mjs
// (restyleRoof, townhallBlueprint) into bots/src/blueprints/. `node bots/scripts/make-townstyle.mjs [--check]` (--check: exit 1 when a
// written file differs from the generator; the test suite compares the same way).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { restyleRoof, townhallBlueprint } from '../src/townstyle.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, '..', 'src', 'blueprints')
const load = id => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'))
/** id -> the generated blueprint (the @1 files are the inputs: never rewritten here). */
export const TOWNSTYLE_BLUEPRINTS = {
  'workshop@2': () => restyleRoof(load('workshop@1'), { id: 'workshop@2', form: 'gable' }),
  'hall@2': () => restyleRoof(load('hall@1'), { id: 'hall@2', form: 'slab' }),
  'storehub@2': () => restyleRoof(load('storehub@1'), { id: 'storehub@2', form: 'slab' }),
  'enchantshop@2': () => restyleRoof(load('enchantshop@1'), { id: 'enchantshop@2', form: 'slab' }),
  'townhall@1': () => townhallBlueprint(),
}
const text = id => JSON.stringify(TOWNSTYLE_BLUEPRINTS[id](), null, 1) + '\n'
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bad = 0
  for (const id of Object.keys(TOWNSTYLE_BLUEPRINTS)) {
    const f = path.join(dir, `${id}.json`)
    if (process.argv.includes('--check')) { if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text(id)) { console.log(`STALE ${f}`); bad++ } } else { fs.writeFileSync(f, text(id)); console.log(`wrote ${f}`) }
  }
  process.exit(bad ? 1 : 0)
}

import { classifyOutcome } from '../src/skills.mjs'
let pass=0, fail=0
const t=(n,g,w)=>{const ok=g===w;ok?pass++:fail++;console.log(`  ${ok?'PASS':'FAIL'}  ${n}${ok?'':`  (got ${g}, want ${w})`}`)}

const wants = new Set(['wooden_pickaxe','oak_planks','stick'])

console.log('gain is only progress when it is what the milestone needs')
t('crafting the target item is valuable',
  classifyOutcome('craft','success',{inventory:{oak_planks:4}}, wants).value, 'valuable')
t('an ingredient of the target counts too',
  classifyOutcome('craft','success',{inventory:{stick:4}}, wants).value, 'valuable')
t('off-target gain is neutral, not a win',
  classifyOutcome('gather','success',{inventory:{dirt:8}}, wants).value, 'neutral')
t('off-target gain claims no evidence',
  classifyOutcome('gather','success',{inventory:{dirt:8}}, wants).because.length, 0)

console.log('\nan unknown goal must not mark real work useless')
t('null wanted stays permissive',
  classifyOutcome('gather','success',{inventory:{dirt:8}}, null).value, 'valuable')

console.log('\nunrelated contracts are unaffected')
t('position still scores on distance',
  classifyOutcome('goto','success',{distance:20}, wants).value, 'valuable')
t('status still achieves nothing',
  classifyOutcome('status','success',{}, wants).value, 'neutral')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)

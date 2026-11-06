// voyager-01: THE STATIC FILTER in front of the sandbox (design §3.3). NOT the security boundary -- the isolate is.
// It gives the coder precise errors and refuses the obvious: modules, host names, reflection, and loops that can never
// yield. Pure: text in, verdict out.

import * as acorn from 'acorn'

export const BANNED_IDENTIFIERS = Object.freeze(new Set(['require', 'process', 'module', 'exports', 'eval', 'Function',
  'globalThis', 'global', 'window', 'self', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Buffer', 'Atomics',
  'SharedArrayBuffer', 'WebAssembly', 'Proxy', 'Reflect', 'setTimeout', 'setInterval', 'setImmediate', 'importScripts',
  'ivm', '__vy_call', '__vy_violation', 'AsyncFunction', 'GeneratorFunction']))
export const BANNED_PROPERTIES = Object.freeze(new Set(['constructor', '__proto__', 'prototype', '__defineGetter__',
  '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'caller', 'callee', 'arguments']))
export const MAX_CODE_CHARS = 12_000

const NAME_RE = /^[a-z][a-zA-Z0-9]{2,47}$/

function walk (node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parents)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
    const v = node[key]
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, [...parents, node]) }
    else if (v && typeof v.type === 'string') walk(v, visit, [...parents, node])
  }
}

function containsAwait (node) {
  let found = false
  walk(node, n => {
    if (found) return
    if (n.type === 'AwaitExpression' || (n.type === 'ForOfStatement' && n.await)) found = true
  })
  return found
}

const literallyTrue = t => t == null || (t.type === 'Literal' && !!t.value)

/**
 * Lint one generated skill.
 * @param {string} code
 * @param {{known?: string[]}} [o]  library skill names the code may call
 * @returns {{ok:boolean, errors:string[], fnName:string|null, calls:string[], facadeCalls:string[]}}
 */
export function lintSkill (code, { known = [] } = {}) {
  const errors = []
  const out = { ok: false, errors, fnName: null, calls: [], facadeCalls: [] }
  if (typeof code !== 'string' || !code.trim()) { errors.push('no code'); return out }
  if (code.length > MAX_CODE_CHARS) { errors.push(`the skill is ${code.length} characters; keep it under ${MAX_CODE_CHARS}`); return out }
  let ast
  try { ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'script', allowAwaitOutsideFunction: false }) }
  catch (e) { errors.push(`syntax error: ${e.message}`); return out }

  const top = ast.body
  if (top.length !== 1 || top[0].type !== 'FunctionDeclaration' || !top[0].async) {
    errors.push('the code must be exactly ONE top-level `async function name(bot) { ... }` and nothing else')
  } else {
    out.fnName = top[0].id.name
    if (!NAME_RE.test(out.fnName)) errors.push(`name the function in camelCase, 3-48 letters/digits (got "${out.fnName}")`)
    if (top[0].params.length !== 1 || top[0].params[0].type !== 'Identifier' || top[0].params[0].name !== 'bot') {
      errors.push('the function takes exactly one parameter named `bot`')
    }
  }

  const knownSet = new Set(known)
  const calls = new Set(), facade = new Set()
  walk(ast, (n, parents) => {
    switch (n.type) {
      case 'ImportExpression': case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration':
      case 'ExportAllDeclaration': case 'MetaProperty':
        errors.push('no import/export: everything the skill can use is on `bot`'); break
      case 'WithStatement': errors.push('no `with`'); break
      case 'Identifier': {
        const p = parents[parents.length - 1]
        const isPropKey = p && ((p.type === 'MemberExpression' && p.property === n && !p.computed) ||
                                (p.type === 'Property' && p.key === n && !p.computed && !p.shorthand))
        if (!isPropKey && BANNED_IDENTIFIERS.has(n.name)) errors.push(`\`${n.name}\` does not exist here; use only \`bot\``)
        if (isPropKey && p.type === 'MemberExpression' && BANNED_PROPERTIES.has(n.name)) errors.push(`no \`.${n.name}\``)
        break
      }
      case 'MemberExpression':
        if (n.computed && n.property.type === 'Literal' && BANNED_PROPERTIES.has(String(n.property.value))) errors.push(`no \`["${n.property.value}"]\``)
        if (n.computed && n.property.type === 'TemplateLiteral') errors.push('no computed property names built from templates')
        if (!n.computed && n.object.type === 'Identifier' && n.object.name === 'bot' && n.property.type === 'Identifier') facade.add(n.property.name)
        break
      case 'Literal':
        if (typeof n.value === 'string' && BANNED_PROPERTIES.has(n.value)) errors.push(`no "${n.value}" string`)
        break
      case 'CallExpression':
        if (n.callee.type === 'Identifier' && knownSet.has(n.callee.name)) calls.add(n.callee.name)
        break
      case 'WhileStatement': case 'DoWhileStatement':
        if (literallyTrue(n.test) && !containsAwait(n.body)) errors.push('a `while(true)` loop must `await` a bot call inside it')
        break
      case 'ForStatement':
        if (literallyTrue(n.test) && !containsAwait(n.body)) errors.push('a `for(;;)` loop must `await` a bot call inside it')
        break
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        if (n.generator) errors.push('no generators')
        break
      default: break
    }
  })
  out.calls = [...calls].sort()
  out.facadeCalls = [...facade].sort()
  out.errors.splice(0, out.errors.length, ...[...new Set(errors)])
  out.ok = out.errors.length === 0
  return out
}

/** Pull the first ```js / ```javascript fenced block (or the whole text if none) out of a model reply. Pure. */
export function extractCode (text) {
  const s = String(text ?? '')
  const m = /```(?:javascript|js)?[ \t]*\n([\s\S]*?)```/i.exec(s)
  return (m ? m[1] : s).trim()
}

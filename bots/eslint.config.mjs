// Lint config with exactly one job: catch identifiers that were used and never
// declared.
//
// This exists because of a specific outage. 3073a9f referenced lastEscapeAt,
// escapeFailures, ESCAPE_MIN_INTERVAL_MS and ESCAPE_GIVE_UP_AFTER without
// declaring any of them. `node --check` passed -- an undeclared identifier is a
// runtime ReferenceError, not a parse error -- so the harness deployed, the
// bots connected, and the entombment escape threw on every tick it was reached
// for an hour and a half before anyone noticed.
//
// The rule set is deliberately tiny. This is a gate, not a style opinion: it
// should never fail for a reason someone is tempted to ignore, because a gate
// people learn to skip is worse than no gate. Adding stylistic rules here is
// how that happens.
//
//   npm run lint     -- from bots/
//
// Deploys run it and refuse to install a harness that fails.

export default [
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Node built-ins the harness actually uses. Anything not listed here
        // and not declared is, by definition, the bug this config is for.
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
]

// Flat config (ESLint v9+) for the enrichment service. This is a SEPARATE
// project from the gallery (own package.json / lockfile / node_modules /
// Dockerfile), so it carries its own lint config rather than sharing the root's.
//
// Lint-only (no Prettier): unlike the gallery, this service was never formatted
// with Prettier and has its own consistent style (semicolons, double quotes).
// We catch real problems — unused vars, undefined refs, parse errors — without
// reformatting working code. CommonJS + modern syntax (optional chaining etc.).

const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Mirror the gallery's allowances: ignored callback/promise params and the
      // soft-fail `catch (err) {}` idiom (ESLint v9 flags unused caught errors).
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^(next|reject)$', caughtErrors: 'none' },
      ],
    },
  },
]

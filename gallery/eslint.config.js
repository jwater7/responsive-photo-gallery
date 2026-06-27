// Flat config (ESLint v9+). Replaces the legacy `eslintConfig` block that used
// to live in package.json — v9 no longer reads that format. CommonJS module
// because the project is CommonJS (no "type":"module" in package.json).

const js = require('@eslint/js')
const prettier = require('eslint-plugin-prettier/recommended')
const globals = require('globals')

module.exports = [
  {
    // Not our code to lint: the built/owned-elsewhere frontend. (The enrichment
    // service and the shared packages are sibling workspaces with their own lint;
    // this config now lives in gallery/ and only lints the gallery member.)
    ignores: [
      'frontend/**',
      'lib/passport-jwt-cookiecombo.js', // vendored verbatim from upstream
    ],
  },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2018, // was parserOptions.ecmaVersion: 9
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      // The codebase leans on the soft-fail `catch (err) {/* ignore */}` idiom
      // throughout. ESLint v8 (which this code was written under) ignored unused
      // caught errors by default; v9 flags them. Restore the v8 behavior rather
      // than rename dozens of catch bindings.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^(next|reject)$', caughtErrors: 'none' },
      ],
      'prettier/prettier': [
        'error',
        { singleQuote: true, semi: false, trailingComma: 'es5' },
      ],
    },
  },
]

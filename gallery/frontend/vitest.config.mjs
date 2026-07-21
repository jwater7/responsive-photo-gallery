// vim: tabstop=2 shiftwidth=2 expandtab
//
// Frontend unit-test harness (vitest + jsdom + @testing-library/react).
// Deliberately minimal for now: plain-JS modules (lib/api-base), hooks via
// renderHook (data/use-on-demand-fetch), and component rendering. The oxc
// block teaches vitest's transform that this app's components are .js files
// CONTAINING JSX (Next transpiles them the same way); Next itself never reads
// this config.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vite's oxc transform EXCLUDES .js by default (its `exclude` falls back to
  // /\.js$/), so both knobs are needed: include .js and override the exclude.
  oxc: {
    include: /\.jsx?$/,
    exclude: [/node_modules/],
    lang: 'jsx',
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
  },
})

// vim: tabstop=2 shiftwidth=2 expandtab
'use strict'

// resolveWithin contract tests. The end-to-end proof (over HTTP, through the
// gallery routes) lives in gallery/test/path-traversal.test.js; these pin the
// primitive itself, including the edge semantics the five original copies
// relied on. Run: npm test  (from packages/path-safety/)

const path = require('path')
const test = require('node:test')
const assert = require('node:assert')

const { resolveWithin } = require('../index.js')

const root = path.resolve('/data/cache')

test('legit sub-paths resolve inside the root', () => {
  assert.equal(resolveWithin(root, 'summer-2024'), path.join(root, 'summer-2024'))
  assert.equal(resolveWithin(root, 'a/b/c.jpg'), path.join(root, 'a/b/c.jpg'))
  // The root itself (e.g. via "a/..") is within bounds.
  assert.equal(resolveWithin(root, 'a/..'), root)
})

test('parent-dir traversal is rejected', () => {
  assert.equal(resolveWithin(root, '../../etc'), '')
  assert.equal(resolveWithin(root, 'a/../../../etc/passwd'), '')
})

test('sibling-prefix escape is rejected (separator boundary, not startsWith)', () => {
  // "../<root>-evil" resolves to "<root>-evil": a bare startsWith(root) check
  // would WRONGLY accept it.
  assert.equal(resolveWithin(root, '../' + path.basename(root) + '-evil'), '')
})

test('absolute sub is joined under the root, not obeyed', () => {
  assert.equal(resolveWithin(root, '/etc/passwd'), path.join(root, 'etc/passwd'))
})

test('missing/non-string sub returns "" (caller error, never a throw)', () => {
  assert.equal(resolveWithin(root, undefined), '')
  assert.equal(resolveWithin(root, null), '')
  assert.equal(resolveWithin(root, ''), '')
  assert.equal(resolveWithin(root, 42), '')
})

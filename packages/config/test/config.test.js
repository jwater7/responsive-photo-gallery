// vim: tabstop=2 shiftwidth=2 expandtab
//
// rpg-config: normalize/isExcluded, the node-json-db exclude round-trip, and the
// one-time legacy-auth migration. Run: npm test (from packages/config/)

const os = require('os')
const fs = require('fs')
const path = require('path')

// Hermetic CONFIG_PATH / LEGACY_AUTH_PATH (read at module load).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-config-test-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
const CONFIG_PATH = path.join(tmp, 'config') // created on demand by setExcludes
const LEGACY_AUTH = mk('legacy-auth')
process.env.CONFIG_PATH = CONFIG_PATH
process.env.LEGACY_AUTH_PATH = LEGACY_AUTH
delete process.env.AUTH_PATH

const test = require('node:test')
const assert = require('node:assert')

const rc = require('../index')

test('normalize: POSIX, strips slashes/dots, dedupes, drops junk', () => {
  assert.deepStrictEqual(rc.normalize(['private']), ['private'])
  assert.deepStrictEqual(rc.normalize(['/work/scans/']), ['work/scans'])
  assert.deepStrictEqual(rc.normalize(['a\\b\\c']), ['a/b/c'])
  // '.' and '..' segments are DROPPED (not resolved) — no traversal can survive.
  assert.deepStrictEqual(rc.normalize(['a/./b/../c']), ['a/b/c'])
  assert.deepStrictEqual(rc.normalize(['x', 'x', '/x/']), ['x'])
  assert.deepStrictEqual(rc.normalize(['', '.', '..', '/', null, 5]), [])
  assert.deepStrictEqual(rc.normalize('not-an-array'), [])
})

test('isExcluded: directory-prefix match, not substring', () => {
  const ex = ['private', 'work/scans']
  assert.strictEqual(rc.isExcluded('private', ex), true)
  assert.strictEqual(rc.isExcluded('private/2024/a.jpg', ex), true)
  assert.strictEqual(rc.isExcluded('work/scans/x.jpg', ex), true)
  assert.strictEqual(rc.isExcluded('work', ex), false)
  assert.strictEqual(rc.isExcluded('workshop', ex), false) // partial-name: NOT a match
  assert.strictEqual(rc.isExcluded('work/scanned', ex), false)
  assert.strictEqual(rc.isExcluded('anything', []), false)
})

test('setExcludes (writer) round-trips; loadExcludes (reader) sees the same file', async () => {
  const saved = await rc.setExcludes(['/foo/', 'bar', 'bar', 'baz/./qux'])
  assert.deepStrictEqual(saved, ['foo', 'bar', 'baz/qux'])
  // Writer-side read (node-json-db, in-memory).
  assert.deepStrictEqual(await rc.getExcludes(), ['foo', 'bar', 'baz/qux'])
  // Reader-side raw read (the cross-process path the enricher uses).
  assert.deepStrictEqual(rc.loadExcludes(), ['foo', 'bar', 'baz/qux'])
  // The on-disk shape is the shared contract: { excludes: [...] }.
  const onDisk = JSON.parse(fs.readFileSync(rc.EXCLUDES_FILE, 'utf8'))
  assert.deepStrictEqual(onDisk.excludes, ['foo', 'bar', 'baz/qux'])
})

test('loadExcludes is [] (fail-open) on a missing/garbage file', () => {
  const missing = path.join(tmp, 'nope', 'x.json')
  assert.deepStrictEqual(rc.readConfigFile(missing, []), [])
  fs.writeFileSync(rc.EXCLUDES_FILE, '{ not json')
  assert.deepStrictEqual(rc.loadExcludes(), [])
})

test('migrateLegacyAuth copies a legacy config.json once, idempotently', async () => {
  fs.writeFileSync(
    path.join(LEGACY_AUTH, 'config.json'),
    JSON.stringify({ privateKey: 'legacy-key' })
  )
  const target = rc.authPath()
  assert.strictEqual(target, path.join(CONFIG_PATH, 'auth'))

  await rc.migrateLegacyAuth()
  const migrated = JSON.parse(
    fs.readFileSync(path.join(target, 'config.json'), 'utf8')
  )
  assert.strictEqual(migrated.privateKey, 'legacy-key')

  // Idempotent: a second run must not overwrite an existing target config.
  fs.writeFileSync(
    path.join(target, 'config.json'),
    JSON.stringify({ privateKey: 'current' })
  )
  await rc.migrateLegacyAuth()
  const after = JSON.parse(
    fs.readFileSync(path.join(target, 'config.json'), 'utf8')
  )
  assert.strictEqual(after.privateKey, 'current')
})

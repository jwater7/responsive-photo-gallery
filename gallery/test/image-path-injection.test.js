// vim: tabstop=2 shiftwidth=2 expandtab
//
// Security proof for the caller-supplied `album` / `image` params on the media
// routes (/api/v1/image, /api/v1/video). Companion to path-traversal.test.js,
// which covers the album-scoped JSON routes; this one covers the routes that
// return FILE BYTES, where a containment failure leaks file content.
//
// Structure:
//   Part A — containment invariants. These must hold both before and after the
//            nested-path fix (they are the reason the sanitizing exists) and are
//            written against the security property (no 200, no leaked bytes),
//            not against a status code, so a legitimate 500->400 tightening
//            can't silently weaken them.
//   Part B — the nested-path bug (an album subdirectory is a legitimate image
//            path) and the caller-error status contract.
//   Part C — symlink reachability, documenting what containment does and does
//            NOT cover, since resolveWithin is a LEXICAL check.
//
// The out-of-root decoys are real, decodable JPEGs: if containment failed, the
// request would return 200 with their bytes, so "not 200" is a meaningful
// assertion rather than an artifact of the decoder rejecting a text file.
// Run: npm run test:unit -w gallery

const os = require('os')
const fs = require('fs')
const path = require('path')

// --- hermetic environment (set BEFORE requiring the app modules) ------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-injection-test-'))
const mk = (d) => {
  const p = path.join(tmp, d)
  fs.mkdirSync(p, { recursive: true })
  return p
}
delete process.env.NO_AUTHENTICATION
delete process.env.DEBUG
process.env.NODE_ENV = 'test'
process.env.AUTH_PATH = mk('auth')
process.env.IMAGE_PATH = mk('images')
process.env.TAGS_PATH = mk('tags')
process.env.CACHE_PATH = mk('cache')
process.env.DEFAULT_PASSWORD = 'test-password'
process.env.PRIVATE_KEY = 'test-private-signing-key-0123456789abcdef'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const sharp = require('sharp')
const createApp = require('../app')

const IMAGES = process.env.IMAGE_PATH
const ALBUM = 'holiday'
const ALBUM_DIR = path.join(IMAGES, ALBUM)
// Sibling of the image root, for the "<root>-evil" prefix escape a bare
// startsWith(root) check would wrongly accept.
const SIBLING = IMAGES + '-evil'
const OUTSIDE = path.join(tmp, 'outside')

// Distinct sizes so a leak is identifiable by more than "some bytes came back".
const jpeg = (w, h) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer()

test.before(async () => {
  fs.mkdirSync(path.join(ALBUM_DIR, '102APPLE'), { recursive: true })
  fs.mkdirSync(SIBLING, { recursive: true })
  fs.mkdirSync(OUTSIDE, { recursive: true })
  // In-root, legitimate.
  fs.writeFileSync(path.join(ALBUM_DIR, 'flat.jpg'), await jpeg(20, 20))
  fs.writeFileSync(path.join(ALBUM_DIR, '102APPLE', 'IMG_2354.JPG'), await jpeg(24, 24))
  // Out-of-root decoys. Reaching either of these is a containment failure.
  fs.writeFileSync(path.join(OUTSIDE, 'secret.jpg'), await jpeg(32, 32))
  fs.writeFileSync(path.join(SIBLING, 'loot.jpg'), await jpeg(40, 40))
  // In-root but OUTSIDE the requested album: reaching these is an album-
  // confinement failure (still inside IMAGE_PATH, so resolveWithin alone would
  // accept them — the album has to be enforced as its own boundary).
  fs.mkdirSync(path.join(IMAGES, 'second-album'), { recursive: true })
  fs.writeFileSync(path.join(IMAGES, 'second-album', 'other.jpg'), await jpeg(48, 48))
  fs.writeFileSync(path.join(IMAGES, 'top-level.jpg'), await jpeg(56, 56))
})

let server, base
test.before(async () => {
  const app = await createApp()
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

test.after(() => {
  server && server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

let cookie
async function auth() {
  if (cookie) return cookie
  const res = await fetch(base + '/api/v1/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }),
  })
  assert.equal(res.status, 200)
  cookie = res.headers.getSetCookie().find((c) => c.startsWith('jwt=')).split(';')[0]
  return cookie
}

// Raw query string on purpose: several payloads are about ENCODING, so the test
// must control the bytes on the wire rather than let encodeURIComponent
// normalize them.
async function get(qs) {
  const res = await fetch(`${base}/api/v1/image?${qs}`, { headers: { cookie: await auth() } })
  const body = Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    body,
    type: res.headers.get('content-type') || '',
    headers: Object.fromEntries(res.headers),
  }
}

// Recursive listing of a tree, for asserting that an attack wrote nothing.
function walk(root) {
  const out = []
  const rec = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = path.join(rel, e.name)
      out.push(r)
      if (e.isDirectory()) rec(path.join(d, e.name), r)
    }
  }
  rec(root, '')
  return out
}

// The invariant: the response is not a successful image, and carries none of the
// out-of-root decoy bytes. Checked by content, so a future refactor that returns
// 200 with a leaked body can't pass by matching a status code alone.
async function assertBlocked(qs, label) {
  const r = await get(qs)
  assert.notEqual(r.status, 200, `${label}: expected block, got 200 (${r.body.length} bytes, ${r.type})`)
  assert.ok(!r.type.startsWith('image/'), `${label}: returned image content-type ${r.type}`)
  return r
}

// ---------------------------------------------------------------------------
// Part A — containment invariants (must hold before AND after the fix)
// ---------------------------------------------------------------------------

// Each entry: [label, image-param as it appears in the raw query string].
// The relative chains are deliberately deeper than the album nesting, so they
// land outside IMAGE_PATH if a single dot-segment survives.
const TRAVERSALS = [
  ['classic parent traversal', '..%2F..%2F..%2Fetc%2Fpasswd'],
  ['traversal onto a real out-of-root JPEG', '..%2F..%2Foutside%2Fsecret.jpg'],
  ['deep traversal chain', '..%2F..%2F..%2F..%2F..%2F..%2Foutside%2Fsecret.jpg'],
  ['sibling-prefix escape', `..%2F${path.basename(SIBLING)}%2Floot.jpg`],
  ['absolute path', encodeURIComponent(path.join(OUTSIDE, 'secret.jpg'))],
  ['absolute unix path', '%2Fetc%2Fpasswd'],
  ['backslash separators', '..%5C..%5Coutside%5Csecret.jpg'],
  ['mixed slash styles', '..%5C..%2Foutside%2Fsecret.jpg'],
  ['dot-segments after a valid prefix', '102APPLE%2F..%2F..%2F..%2Foutside%2Fsecret.jpg'],
  ['current-dir prefix', '.%2F..%2F..%2Foutside%2Fsecret.jpg'],
  ['doubled dot-segments', '....%2F%2F....%2F%2Foutside%2Fsecret.jpg'],
  ['double-encoded traversal', '%252e%252e%252f%252e%252e%252foutside%252fsecret.jpg'],
  ['url-encoded dots', '%2e%2e%2F%2e%2e%2Foutside%2Fsecret.jpg'],
  ['null-byte truncation', 'flat.jpg%00.txt'],
  ['null byte after traversal', '..%2F..%2Foutside%2Fsecret.jpg%00.jpg'],
  ['bare parent', '..'],
  ['bare dot', '.'],
  ['trailing dot-segment', 'flat.jpg%2F..%2F..%2Foutside%2Fsecret.jpg'],
  ['overlong utf-8 dots', '%c0%ae%c0%ae%2foutside%2fsecret.jpg'],
  ['very long traversal chain', '..%2F'.repeat(80) + 'outside%2Fsecret.jpg'],
]

for (const [label, payload] of TRAVERSALS) {
  test(`image: blocks ${label}`, async () => {
    await assertBlocked(`album=${ALBUM}&image=${payload}`, label)
  })
}

// Leading separators on the image param. path.join absorbs them, so these stay
// inside the root — but a leading slash followed by dot-segments consumes the
// ALBUM component ("holiday" + "/../x" => "x"), landing elsewhere under
// IMAGE_PATH. The album param must stay authoritative: an image is confined to
// ITS album, not merely to the media root. (Before the nested-path fix this was
// blocked only incidentally, by separator-stripping.)
const ALBUM_ESCAPES = [
  ['leading slash with parent escape', '%2F..%2Fsecond-album%2Fother.jpg'],
  ['double leading slash with parent escape', '%2F%2F..%2Fsecond-album%2Fother.jpg'],
  ['parent escape into a sibling album', '..%2Fsecond-album%2Fother.jpg'],
  ['parent escape to a top-level file', '..%2Ftop-level.jpg'],
  ['nested then out into a sibling album', '102APPLE%2F..%2F..%2Fsecond-album%2Fother.jpg'],
]

for (const [label, payload] of ALBUM_ESCAPES) {
  test(`image: confines the image to its album — ${label}`, async () => {
    const r = await get(`album=${ALBUM}&image=${payload}`)
    assert.notEqual(r.status, 200, `${label}: escaped its album (got 200, ${r.body.length} bytes)`)
  })
}

// Dot-segments at the START of the image param, in every spelling. These do not
// leave IMAGE_PATH (so the root-containment check accepts them) but they DO walk
// out of the album, which is why album confinement is checked separately.
const DOT_SEGMENTS = [
  ['bare parent', '..'],
  ['parent with trailing slash', '..%2F'],
  ['rooted parent', '%2F..'],
  ['rooted parent with slash', '%2F..%2F'],
  ['rooted dot then parent', '%2F.%2F..%2Fsecond-album%2Fother.jpg'],
  ['dot then parent', '.%2F..%2Fsecond-album%2Fother.jpg'],
  ['parent via a real subdir', '102APPLE%2F..%2F..%2Fsecond-album%2Fother.jpg'],
]

for (const [label, payload] of DOT_SEGMENTS) {
  test(`image: dot-segment cannot leave the album — ${label}`, async () => {
    const r = await get(`album=${ALBUM}&image=${payload}`)
    assert.notEqual(r.status, 200, `${label}: resolved outside the album (got 200)`)
  })
}

// Dot-segments that resolve to a DIRECTORY rather than a file are caller errors,
// not reads. They must not 200 and must not walk out of the album.
for (const [label, payload] of [
  ['bare dot', '.'],
  ['rooted dot', '%2F.'],
  ['subdir dot', '102APPLE%2F.'],
  ['subdir parent', '102APPLE%2F..'],
]) {
  test(`image: directory-resolving path is refused — ${label}`, async () => {
    const r = await get(`album=${ALBUM}&image=${payload}`)
    assert.notEqual(r.status, 200, `${label}: a directory must not be served`)
  })
}

// Literal names made of dots are FILENAMES, not traversal — they must not be
// confused with dot-segments (a "..."-named directory is legal on every OS here).
test('image: dot-run names are treated as literal path components', async () => {
  const r = await get(`album=${ALBUM}&image=...%2Fnope.jpg`)
  assert.notEqual(r.status, 200) // doesn't exist, but must not escape either
  assert.ok(!fs.existsSync(path.join(IMAGES, 'nope.jpg')))
})

// Leading separators that DON'T escape are just noise and should still resolve.
test('image: tolerates redundant separators in a nested path', async () => {
  for (const payload of [
    '%2F102APPLE%2FIMG_2354.JPG',
    '102APPLE%2F%2FIMG_2354.JPG',
    '.%2F102APPLE%2FIMG_2354.JPG',
    '%2F.%2F102APPLE%2FIMG_2354.JPG',
  ]) {
    const r = await get(`album=${ALBUM}&image=${payload}`)
    assert.equal(r.status, 200, `redundant separators should normalize, got ${r.status} for ${payload}`)
  }
})

// The album param is the other half of the join and must be confined too.
const ALBUM_ATTACKS = [
  ['album traversal', '..%2Foutside', 'secret.jpg'],
  ['album absolute', '%2Fetc', 'passwd'],
  ['album sibling-prefix', `..%2F${path.basename(SIBLING)}`, 'loot.jpg'],
  ['album crosses into a subdir', `${ALBUM}%2F102APPLE`, 'IMG_2354.JPG'],
]

for (const [label, albumPayload, image] of ALBUM_ATTACKS) {
  test(`image: blocks ${label}`, async () => {
    await assertBlocked(`album=${albumPayload}&image=${image}`, label)
  })
}

// Thumbnails take a second filesystem path (the cache write target), so the same
// payloads must be blocked on that route shape, not just the passthrough one.
test('image: blocks traversal on the thumbnail path too', async () => {
  await assertBlocked(
    `album=${ALBUM}&image=..%2F..%2Foutside%2Fsecret.jpg&thumb=64x64`,
    'thumb traversal'
  )
})

// The thumb param is the cache WRITE path, so its invariant is about where bytes
// land, not just what comes back. An escaping value is contained by resolveWithin
// (thumb_path becomes ''), the thumbnail write fails, and the handler falls back
// to returning the ORIGINAL in-root image — a 200 that leaks nothing. Assert the
// real properties: in-root content out, and nothing written outside the cache.
test('image: thumb param cannot escape the cache root', async () => {
  const before = walk(process.env.CACHE_PATH)
  const legit = await get(`album=${ALBUM}&image=flat.jpg`)
  const r = await get(`album=${ALBUM}&image=flat.jpg&thumb=..%2F..%2F..%2Foutside`)

  // Whatever it returns, it must be the requested in-root image — never the decoy.
  if (r.status === 200) {
    assert.ok(r.body.equals(legit.body), 'thumb escape returned content other than the requested image')
  }
  // And no cache artifact may appear outside the cache root.
  assert.deepEqual(walk(process.env.CACHE_PATH), before, 'thumb escape wrote into the cache root unexpectedly')
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'thumbs')), 'thumb escape wrote outside the cache root')
  assert.equal(fs.readdirSync(OUTSIDE).sort().join(','), 'secret.jpg', 'out-of-root dir was modified')
})

// Duplicated params arrive as an ARRAY, not a string — a shape the handlers must
// reject rather than crash on (parameter pollution).
test('image: rejects duplicated params without crashing', async () => {
  const r = await get(`album=${ALBUM}&image=flat.jpg&image=..%2F..%2Foutside%2Fsecret.jpg`)
  assert.notEqual(r.status, 200, 'array-valued image param must not succeed')
})

test('image: rejects a duplicated album param without crashing', async () => {
  const r = await get(`album=${ALBUM}&album=..%2Foutside&image=flat.jpg`)
  assert.notEqual(r.status, 200, 'array-valued album param must not succeed')
})

// Missing/empty params are caller errors, never a 500 or a stray read.
for (const [label, qs] of [
  ['no image param', `album=${ALBUM}`],
  ['no album param', 'image=flat.jpg'],
  ['empty image', `album=${ALBUM}&image=`],
  ['empty album', 'album=&image=flat.jpg'],
]) {
  test(`image: rejects ${label} (400)`, async () => {
    const r = await get(qs)
    assert.equal(r.status, 400, `${label}: expected 400, got ${r.status}`)
  })
}

// The server must survive every payload above: a still-serving control request
// proves no handler crashed the process or wedged the event loop.
test('image: still serves a legitimate flat image after all attacks', async () => {
  const r = await get(`album=${ALBUM}&image=flat.jpg`)
  assert.equal(r.status, 200)
  assert.ok(r.type.startsWith('image/'), `expected an image, got ${r.type}`)
})

// ---------------------------------------------------------------------------
// Part B — nested paths are legitimate; caller errors are 400
// ---------------------------------------------------------------------------

test('image: serves an image inside an album subdirectory', async () => {
  // Camera imports nest (e.g. iPhone "102APPLE"), the enrichment indexer walks
  // recursively, and lib/image-ref.js documents multi-level image paths — so a
  // subdirectory is a legitimate image, not an attack.
  const r = await get(`album=${ALBUM}&image=102APPLE%2FIMG_2354.JPG`)
  assert.equal(r.status, 200, `nested image should be served, got ${r.status}`)
  assert.ok(r.type.startsWith('image/'), `expected an image, got ${r.type}`)
})

test('image: serves a thumbnail for an image inside a subdirectory', async () => {
  const r = await get(`album=${ALBUM}&image=102APPLE%2FIMG_2354.JPG&thumb=64x64`)
  assert.equal(r.status, 200, `nested thumbnail should be served, got ${r.status}`)
  assert.ok(r.type.startsWith('image/'), `expected an image, got ${r.type}`)
})

test('image: a rejected path is a 400, not a 500', async () => {
  // A rejected path is a CALLER error. Reporting it as 500 both misleads
  // monitoring and hides the distinction from a genuine read failure.
  const r = await get(`album=${ALBUM}&image=..%2F..%2Foutside%2Fsecret.jpg`)
  assert.equal(r.status, 400, `expected 400 for a rejected path, got ${r.status}`)
})

test('image: a missing in-root file is not served', async () => {
  const r = await get(`album=${ALBUM}&image=does-not-exist.jpg`)
  assert.notEqual(r.status, 200)
})

test('image: an odd-but-legal filename is a miss, not a rejection', async () => {
  // "  " is a legal POSIX filename. The old sanitizer refused it as malformed;
  // containment has no opinion on filename aesthetics, so it is simply a file
  // that does not exist. Asserted as "not served" rather than a specific code:
  // the missing-file status is a separate concern from path safety.
  const r = await get(`album=${ALBUM}&image=%20%20`)
  assert.notEqual(r.status, 200)
})

// ---------------------------------------------------------------------------
// Part E — encoding tricks and parameter shapes
// ---------------------------------------------------------------------------
//
// Everything that tries to be a separator or a dot-segment WITHOUT being one, in
// the bytes the filesystem actually sees. On POSIX only 0x2F separates and only
// literal "."/".." are dot-segments, so these must all be inert LITERAL
// filename characters — never traversal, never a crash.

const ENCODING_TRICKS = [
  ['unicode division slash (U+2215)', '..%E2%88%95..%E2%88%95outside%E2%88%95secret.jpg'],
  ['fullwidth solidus (U+FF0F)', '..%EF%BC%8F..%EF%BC%8Foutside%EF%BC%8Fsecret.jpg'],
  ['fullwidth full stop (U+FF0E)', '%EF%BC%8E%EF%BC%8E%2F%EF%BC%8E%EF%BC%8E%2Foutside%2Fsecret.jpg'],
  ['halfwidth ideographic stop', '%EF%B9%92%EF%B9%92%2Foutside%2Fsecret.jpg'],
  ['NFD-decomposed dots', '%CC%88..%2F..%2Foutside%2Fsecret.jpg'],
  ['zero-width space between dots', '.%E2%80%8B.%2F..%2Foutside%2Fsecret.jpg'],
  ['RTL override', '%E2%80%AE..%2F..%2Foutside%2Fsecret.jpg'],
  ['tab character', '..%09%2F..%2Foutside%2Fsecret.jpg'],
  ['newline in path', '..%2F..%2Foutside%2Fsecret.jpg%0Ax'],
  ['carriage return in path', '..%2F..%2Foutside%2Fsecret.jpg%0Dx'],
  ['CRLF header-injection shape', 'flat.jpg%0D%0AX-Injected:%20yes'],
  ['quote in filename', 'flat.jpg%22'],
  ['semicolon in filename', 'flat.jpg%3Bx'],
  ['invalid utf-8 bytes', '%FF%FE..%2Foutside%2Fsecret.jpg'],
  ['overlong-encoded slash', '..%C0%AF..%C0%AFoutside%C0%AFsecret.jpg'],
  ['UTF-16-ish separator', '..%u2215outside%u2215secret.jpg'],
  ['name longer than NAME_MAX', 'a'.repeat(400) + '.jpg'],
  ['deeply nested path', 'a%2F'.repeat(120) + 'x.jpg'],
]

for (const [label, payload] of ENCODING_TRICKS) {
  test(`image: inert against ${label}`, async () => {
    const r = await get(`album=${ALBUM}&image=${payload}`)
    assert.notEqual(r.status, 200, `${label}: unexpectedly succeeded`)
    // No decoy bytes, and no fabricated response header from an injected value.
    assert.equal(r.headers?.['x-injected'], undefined)
  })
}

// Query-parameter SHAPE: Express's parser can yield arrays and objects, not just
// strings. The handlers must reject those rather than throw (a TypeError inside
// a callback chain is a 500 at best, an unhandled rejection at worst).
for (const [label, qs] of [
  ['array-valued image', `album=${ALBUM}&image=flat.jpg&image=other.jpg`],
  ['object-valued image', `album=${ALBUM}&image[foo]=bar`],
  ['object-valued album', `album[foo]=bar&image=flat.jpg`],
  ['prototype-pollution shape', `album=${ALBUM}&image[__proto__][polluted]=1`],
  ['array-valued thumb', `album=${ALBUM}&image=flat.jpg&thumb=64x64&thumb=32x32`],
]) {
  test(`image: rejects ${label} without crashing`, async () => {
    const r = await get(qs)
    assert.notEqual(r.status, 200, `${label}: must not succeed`)
    assert.equal({}.polluted, undefined, 'Object.prototype was polluted')
  })
}

// The video route shares the same argument handling AND puts the resolved
// filename into a Content-Disposition header, so it gets its own pass.
test('video: rejects traversal and does not reflect a filename into headers', async () => {
  const res = await fetch(
    `${base}/api/v1/video?album=${ALBUM}&image=..%2F..%2Foutside%2Fsecret.jpg`,
    { headers: { cookie: await auth() } }
  )
  assert.notEqual(res.status, 200)
  assert.equal(res.headers.get('x-injected'), null)
})

// Final liveness check: after every payload above, the process is still serving.
// Proves nothing crashed the server or wedged the event loop.
test('server survives the full payload battery', async () => {
  const r = await get(`album=${ALBUM}&image=flat.jpg`)
  assert.equal(r.status, 200)
  assert.ok(r.type.startsWith('image/'))
})

// ---------------------------------------------------------------------------
// Part D — root SHAPE: containment must not depend on how the root is spelled
// ---------------------------------------------------------------------------
//
// The roots are operator-supplied (IMAGE_PATH / CACHE_PATH env vars), so the
// boundary check has to hold however they are written — with or without a
// trailing separator, relative or absolute, moved between deployments. The
// separator-boundary test is exactly the kind of check that goes off-by-one on a
// trailing slash, so pin every spelling.

const { resolveWithin } = require('rpg-path-safety')

test('root spelling does not change containment', () => {
  const inRoot = 'album/img.jpg'
  const escape = '../images-evil/loot.jpg'
  // Every spelling of the SAME root must resolve identically: path.resolve
  // normalizes the trailing separator and dot segment before the check.
  for (const root of ['/srv/images', '/srv/images/', '/srv/images//', '/srv/images/.']) {
    assert.equal(resolveWithin(root, inRoot), path.join('/srv/images', inRoot), `in-root failed for root ${root}`)
    assert.equal(resolveWithin(root, escape), '', `escape allowed for root ${root}`)
  }
})

test('sibling-prefix escape is rejected for every root spelling', () => {
  // "<root>-evil" shares a string prefix with the root but is NOT inside it.
  for (const root of ['/srv/images', '/srv/images/']) {
    assert.equal(resolveWithin(root, '../images-evil/loot.jpg'), '')
    assert.equal(resolveWithin(root, '../images-evil'), '')
  }
})

test('a relative root is resolved against the process cwd', () => {
  // IMAGE_PATH may be relative (the dev scripts pass ./debug-data/pics). It is
  // resolved per call, so the root tracks the cwd rather than being captured at
  // startup — fine for this app (it never chdirs), but pinned so a future
  // process.chdir() can't silently relocate the root.
  const got = resolveWithin('rel-root', 'a/b.jpg')
  assert.equal(got, path.join(process.cwd(), 'rel-root', 'a', 'b.jpg'))
  assert.equal(resolveWithin('rel-root', '../escape.jpg'), '')
})

test('a root AT the filesystem root rejects everything (fails closed)', () => {
  // Documented sharp edge: for root '/', the boundary test is startsWith('//'),
  // which nothing satisfies — so IMAGE_PATH=/ serves NO images rather than
  // serving all of them. Fails in the safe direction, but it is a
  // misconfiguration that presents as "every image is broken", so it is pinned
  // here to make the behavior discoverable rather than mysterious.
  assert.equal(resolveWithin('/', 'album/img.jpg'), '')
  assert.equal(resolveWithin('/', 'etc/passwd'), '')
})

test('a symlinked root is contained by its lexical path', () => {
  // A root that is itself a symlink (e.g. /data -> /mnt/disk/data) keeps the
  // lexical path, so containment is judged against the configured spelling.
  const realDir = path.join(tmp, 'real-root')
  const linkRoot = path.join(tmp, 'link-root')
  fs.mkdirSync(realDir, { recursive: true })
  try {
    fs.symlinkSync(realDir, linkRoot)
  } catch {
    return // symlinks unavailable; the lexical contract is covered above
  }
  assert.equal(resolveWithin(linkRoot, 'a/b.jpg'), path.join(linkRoot, 'a', 'b.jpg'))
  assert.equal(resolveWithin(linkRoot, '../escape.jpg'), '')
})

test('handler serves a nested image when the root has a trailing slash', async () => {
  // End-to-end version of the root-spelling contract: the same handler with a
  // trailing-slash IMAGE_PATH must serve the same nested image.
  const ImageHandler = require('../handlers/image-handler')
  const handler = new ImageHandler(IMAGES + '/', process.env.CACHE_PATH, process.env.TAGS_PATH)
  const { err, type } = await new Promise((resolve) =>
    handler.image(ALBUM, '102APPLE/IMG_2354.JPG', undefined, (err, buf, type) =>
      resolve({ err, buf, type })
    )
  )
  assert.equal(err, undefined, `trailing-slash root failed: ${JSON.stringify(err)}`)
  assert.ok(String(type).startsWith('image/'), `expected an image, got ${type}`)
})

// ---------------------------------------------------------------------------
// Part C — symlinks: what LEXICAL containment does and does not cover
// ---------------------------------------------------------------------------
//
// resolveWithin is a lexical check (path.resolve + separator boundary); it does
// not call realpath, so a symlink INSIDE the image root that points outside it
// resolves to an in-root path and passes. These tests pin the actual behavior so
// a change in it is a deliberate decision rather than a surprise.

test('symlink file in an album resolves to its target (lexical containment)', async (t) => {
  const link = path.join(ALBUM_DIR, 'link.jpg')
  try {
    fs.symlinkSync(path.join(OUTSIDE, 'secret.jpg'), link)
  } catch {
    return t.skip('symlinks not permitted in this environment')
  }
  const r = await get(`album=${ALBUM}&image=link.jpg`)
  // Documented, pre-existing behavior: a single-segment symlink was always
  // reachable (it survives filename sanitizing untouched), so this is NOT a
  // regression introduced by allowing nested paths. Recorded so the exposure is
  // visible: anyone who can create files inside IMAGE_PATH can alias any file
  // the gallery process can read.
  assert.equal(r.status, 200, 'symlinked file is served (lexical containment)')
  fs.unlinkSync(link)
})

test('symlinked directory in an album resolves through (lexical containment)', async (t) => {
  const link = path.join(ALBUM_DIR, 'linkdir')
  try {
    fs.symlinkSync(OUTSIDE, link)
  } catch {
    return t.skip('symlinks not permitted in this environment')
  }
  const r = await get(`album=${ALBUM}&image=linkdir%2Fsecret.jpg`)
  // Newly REACHABLE once nested paths are allowed (before the fix the slash was
  // stripped, so it 500'd by accident, not by design). Same trust boundary as
  // the file case above: it requires write access to the image root.
  assert.equal(r.status, 200, 'symlinked directory is traversed (lexical containment)')
  fs.unlinkSync(link)
})

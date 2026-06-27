// vim: tabstop=2 shiftwidth=2 expandtab
//

var express = require('express')
var cors = require('cors')
const path = require('path')
const fsp = require('fs').promises

const requireAuth = require('../lib/require-auth')
const imageHandler = require('../handlers/image-handler')
const albumBuild = require('../handlers/album-build')
const runtimeConfig = require('rpg-config')

// Enrichment feature flags, folded into /ping so the client bootstraps auth +
// flags in one request. Guarded require: the gallery still pings fine if the
// enrichment proxy (routes/enrich.js) is removed, and this never imports an
// enrichment library — computeFeatures is a fail-soft HTTP health probe.
let enrichComputeFeatures = null
let enrichTriggerReap = null
try {
  const enrich = require('./enrich')
  enrichComputeFeatures = enrich.computeFeatures
  enrichTriggerReap = enrich.triggerReap
} catch (_) {
  /* enrichment proxy not present */
}
const image_path = process.env.IMAGE_PATH || '/images'
// The album build cache (sprite sheets, collage covers, manifests) AND the
// on-demand thumbnail cache share one tree; thumbnails are written per-album
// under it (<album>/thumbs, <album>/video-thumbs). No separate THUMB_PATH.
const cache_path = process.env.CACHE_PATH || '/data/cache'
const tags_path = process.env.TAGS_PATH || '/data/tags'
var handler = new imageHandler(image_path, cache_path, tags_path)

const debug = require('debug')('responsive-photo-gallery:server')
const debugErr = require('debug')('responsive-photo-gallery:server:error')
debugErr.enabled = true // errors are always-on, not gated by DEBUG

const responseHandler = (res) => (args) => {
  if (!args || args.error || !args.result) {
    res.status(args && args.error && args.error.code ? args.error.code : 500)
  } else {
    res.status(200)
  }
  res.json(args)
  res.end()
}

module.exports = ({ passport, auth }) => {
  var router = express.Router()

  const required = requireAuth(passport)

  const getCommonCookieOptions = ({
    cookie_domain,
    cookie_path,
    cookie_max_age_sec,
    secure,
  }) => {
    const domain =
      process.env.API_FORCE_COOKIE_DOMAIN || cookie_domain || undefined
    const path = process.env.API_FORCE_COOKIE_PATH || cookie_path || undefined
    const maxAge =
      (process.env.API_FORCE_COOKIE_MAX_AGE_SEC
        ? Number(process.env.API_FORCE_COOKIE_MAX_AGE_SEC) * 1000
        : undefined) ||
      (cookie_max_age_sec ? Number(cookie_max_age_sec) * 1000 : undefined)
    return {
      ...(domain && { domain }),
      ...(path && { path }),
      ...(maxAge && { maxAge }),
      httpOnly: true,
      sameSite: true,
      signed: true, // passport cookie middleware requires
      secure,
    }
  }

  // Enable CORS routes for debug only
  if (debug.enabled) {
    router.use(cors())
    // router.use(function (req, res, next) {
    //   //res.header("Access-Control-Allow-Origin", "*");
    //   res.header('Access-Control-Allow-Origin', 'http://localhost:3000')
    //   res.header(
    //     'Access-Control-Allow-Headers',
    //     'Origin, X-Requested-With, Content-Type, Accept, X-API-Key'
    //   )
    //   res.header(
    //     'Access-Control-Allow-Methods',
    //     '*'
    //   )
    //   res.header('Access-Control-Allow-Credentials', 'true')
    //   next()
    // })
    //router.options(function (req, res, next) {
    //  res.status(200).end()
    //})
  }

  // Authenticate if data is available
  // router.use(auth.authenticate.bind(auth));

  /**
   * @swagger
   * /ping:
   *   get:
   *     description: Check login status
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: token
   *         in: query
   *         description: auth token
   *         schema:
   *           type: string
   *           required: true
   *     responses:
   *       200:
   *         description: Returns auth token
   *       403:
   *         description: Logged out
   *     security:
   *       - ApiKeyAuth: []
   */
  router.all('/ping', required, async function (req, res, next) {
    // TODO this uses a cookie now
    const body = req.body || {}
    var token = body.token || req.query.token || req.headers['x-api-key']
    const payload = { result: token }
    // Fold in enrichment feature flags (one bootstrap request for the client).
    // Fail-soft: a probe error just reports degraded, never breaks the heartbeat.
    if (enrichComputeFeatures) {
      try {
        Object.assign(payload, await enrichComputeFeatures())
      } catch (_) {
        payload.features = { map: false, search: false }
        payload.degraded = true
      }
    }
    res.status(200).json(payload)
  })

  /**
   * @swagger
   * /logout:
   *   post:
   *     description: Log out
   *     produces:
   *       - application/json
   *     consumes:
   *       - application/json
   *     parameters:
   *       - name: body
   *         in: body
   *         description: Auth token
   *         schema:
   *           type: object
   *           properties:
   *             token:
   *               type: string
   *             cookie_path:
   *               type: string
   *               example: /
   *
   *     responses:
   *       200:
   *         description: Returns auth token
   *       403:
   *         description: Already logged out
   *       500:
   *         description: Logout failure
   *     security:
   *       - ApiKeyAuth: []
   */
  router.post('/logout', required, function (req, res, next) {
    const body = req.body || {}
    const jwt = req.user.jwt || body.jwt
    const cookieOptions = getCommonCookieOptions({
      cookie_domain: body.cookie_domain,
      cookie_path: body.cookie_path,
      cookie_max_age_sec: body.cookie_max_age_sec,
      secure: req.secure,
    })
    res.clearCookie('jwt', cookieOptions)
    res.json({ result: jwt })
  })

  /**
   * @swagger
   * /login:
   *   post:
   *     description: Authenticate
   *     produces:
   *       - application/json
   *     consumes:
   *       - application/json
   *     parameters:
   *       - name: body
   *         in: body
   *         description: Auth object
   *         schema:
   *           type: object
   *           required:
   *             - username
   *             - password
   *           properties:
   *             username:
   *               type: string
   *               example: admin
   *             password:
   *               type: string
   *               example: pw
   *             cookie_path:
   *               type: string
   *               example: /
   *     responses:
   *       200:
   *         description: Returns auth token
   *       401:
   *         description: Authentication Failure
   */
  router.post('/login', function (req, res, next) {
    const body = req.body || {}
    const expiresIn =
      (process.env.API_FORCE_JWT_EXPIRE_SEC
        ? Number(process.env.API_FORCE_JWT_EXPIRE_SEC)
        : undefined) ||
      (body.jwt_expire_sec ? Number(body.jwt_expire_sec) : undefined) ||
      (body.cookie_max_age_sec ? Number(body.cookie_max_age_sec) : '1d') //default to about the life of a cookie

    var token = auth.login(body.username, body.password, {
      ...(expiresIn && { expiresIn }),
    })
    if (token) {
      const cookieOptions = getCommonCookieOptions({
        cookie_domain: body.cookie_domain,
        cookie_path: body.cookie_path,
        cookie_max_age_sec: body.cookie_max_age_sec,
        secure: req.secure,
      })
      res.cookie('jwt', token, cookieOptions)

      // Set up a cookie so client can easily send it with the header
      //res.cookie('authtoken', token, { secure: true });
      //res.cookie('authtoken', token);

      res.status(200).json({
        result: token,
      })
    } else {
      res.status(403).json({
        error: {
          code: 403,
          message: 'Incorrect',
        },
      })
    }
    res.end()
  })

  /**
   * @swagger
   * /albums:
   *   get:
   *     description: Returns the list of albums
   *       Authentication token for requested info is required
   *     consumes:
   *       - application/json
   *     produces:
   *       - application/json
   *     responses:
   *       200:
   *         description: Returns JSON list
   *       401:
   *         description: Authentication Required
   *       500:
   *         description: Internal server error
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/albums', required, function (req, res, next) {
    handler.albums(responseHandler(res))
  })

  /**
   * @swagger
   * /list:
   *   get:
   *     description: Returns list of files
   *       Authentication token for requested info is required
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: album
   *         in: query
   *         description: Album name to list
   *         schema:
   *           type: string
   *           required: true
   *       - name: num_results
   *         in: query
   *         description: an optional max number of files to return (e.g. "25")
   *         schema:
   *           type: integer
   *           required: false
   *       - name: distributed
   *         in: query
   *         description: an optional flag if num_results should be spread out (e.g. true)
   *         schema:
   *           type: boolean
   *           required: false
   *       - name: withMetadata
   *         in: query
   *         description: an optional obj to include extra params (e.g. list of tags)
   *         schema:
   *           type: object
   *     responses:
   *       200:
   *         description: Returns JSON list
   *       401:
   *         description: Authentication Required
   *       500:
   *         description: Internal server error
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/list', required, function (req, res, next) {
    handler.list(
      req.query.album,
      req.query.num_results,
      req.query.distributed,
      { withMetadata: req.query.withMetadata },
      responseHandler(res)
    )
  })

  /**
   * @swagger
   * /image:
   *   get:
   *     description: Download the image
   *       Authentication token for requested info is required
   *     parameters:
   *       - name: album
   *         in: query
   *         description: Album name
   *         schema:
   *           type: string
   *           required: true
   *       - name: image
   *         in: query
   *         description: image name
   *         schema:
   *           type: string
   *           required: true
   *       - name: thumb
   *         in: query
   *         description: an optional thumb dimension (e.g. "50x50")
   *         schema:
   *           type: string
   *           required: false
   *     responses:
   *       200:
   *         description: Returns the download
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/image', required, function (req, res, next) {
    let album = req.query.album
    let image = req.query.image
    let thumb = req.query.thumb

    handler.image(album, image, thumb, (err, image_buffer, content_type) => {
      if (err) {
        res.status(500)
        res.json(err)
        res.end()
        return
      }
      res.set('Content-Type', content_type)
      res.set('Cache-Control', 'public, max-age=31557600')
      res.send(image_buffer)
      res.end()
    })
  })

  /**
   * @swagger
   * /image-data:
   *   patch:
   *     description: Update image properties
   *     produces:
   *       - application/json
   *     consumes:
   *       - application/json
   *     parameters:
   *       - name: body
   *         in: body
   *         description: Image object
   *         schema:
   *           type: object
   *           required:
   *             - album
   *             - image
   *           properties:
   *             album:
   *               type: string
   *             image:
   *               type: string
   *             tags:
   *               type: array
   *               items:
   *                 type: string
   *                 example: favorite
   *     responses:
   *       200:
   *         description: Returns auth token
   *       401:
   *         description: Authentication Failure
   */
  router.patch('/image-data', required, async (req, res, next) => {
    try {
      const body = req.body || {}
      responseHandler(res)(
        await handler.updateImageData(body.album, body.image, {
          tags: body.tags,
        })
      )
    } catch (err) {
      debugErr('Error: ', err)
      responseHandler(res)()
    }
  })

  /**
   * @swagger
   * /video:
   *   get:
   *     description: Download
   *       Authentication token for requested info is required
   *     parameters:
   *       - name: album
   *         in: query
   *         description: Album name
   *         schema:
   *           type: string
   *           required: true
   *       - name: image
   *         in: query
   *         description: image name
   *         schema:
   *           type: string
   *           required: true
   *     responses:
   *       200:
   *         description: Returns the download
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/video', required, function (req, res, next) {
    let album = req.query.album
    //TODO probably rename to video or something instead of image
    let image = req.query.image

    handler.video(album, image, (err, video_file) => {
      if (err) {
        res.status(500)
        res.json(err)
        res.end()
        return
      }
      res.download(video_file)
    })
  })

  /**
   * @swagger
   * /thumbnails:
   *   get:
   *     description: Get base64 encoded images in json format for thumbnails
   *       Authentication token for requested info is required
   *     produces:
   *       - application/json
   *     parameters:
   *       - name: album
   *         in: query
   *         description: Album name
   *         schema:
   *           type: string
   *           required: true
   *       - name: thumb
   *         in: query
   *         description: A thumb dimension (e.g. "50x50")
   *         schema:
   *           type: string
   *           required: true
   *       - name: image
   *         in: query
   *         description: an optional image name to limit to single one
   *         schema:
   *           type: string
   *           required: false
   *       - name: num_results
   *         in: query
   *         description: an optional max number of files to return (e.g. "25")
   *         schema:
   *           type: integer
   *           required: false
   *       - name: distributed
   *         in: query
   *         description: an optional flag if num_results should be spread out (e.g. true)
   *         schema:
   *           type: boolean
   *           required: false
   *     responses:
   *       200:
   *         description: Returns JSON list
   *       401:
   *         description: Authentication Required
   *       500:
   *         description: Internal server error
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/thumbnails', required, function (req, res, next) {
    handler.thumbnails(
      req.query.album,
      req.query.thumb,
      req.query.image,
      req.query.num_results,
      req.query.distributed,
      responseHandler(res)
    )
  })

  // --- Album build cache (sprite sheets / collage cover / manifest) ---------
  // New endpoints (async/await) serving the scalable album view. All sit behind
  // the same auth gate as the rest of /api/v1/*.

  // Serve a cached JPEG artifact (cover / sprite sheet) from an album's cache.
  // Long-cached; the client versions the URL (e.g. &v=<albumHash>) to bust.
  const serveCacheFile = async (res, album, relPath) => {
    const dir = albumBuild.albumCacheDir(album)
    if (!dir) {
      return res
        .status(400)
        .json({ error: { code: 400, message: 'Invalid album' } })
    }
    const base = path.resolve(dir)
    const file = path.resolve(path.join(base, relPath))
    // Boundary test, not a string prefix (a bare startsWith would also accept a
    // sibling like "<base>-evil"): require the separator or an exact root match.
    if (file !== base && !file.startsWith(base + path.sep)) {
      return res
        .status(400)
        .json({ error: { code: 400, message: 'Invalid path' } })
    }
    try {
      const data = await fsp.readFile(file)
      res.set('Content-Type', 'image/jpeg')
      res.set('Cache-Control', 'public, max-age=31557600')
      return res.send(data)
    } catch (err) {
      return res
        .status(404)
        .json({ error: { code: 404, message: 'Not found' } })
    }
  }

  /**
   * @swagger
   * /album-manifest:
   *   get:
   *     description: Album sprite/collage manifest. Returns 200 with the manifest
   *       when the cache is current, or 202 (and triggers a single-flight build)
   *       when the album is cold or stale.
   *     parameters:
   *       - name: album
   *         in: query
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Manifest }
   *       202: { description: Build in progress }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/album-manifest', required, async (req, res) => {
    try {
      const result = await albumBuild.ensureAlbum(req.query.album)
      if (result.state === 'ready') {
        return res.status(200).json({ result: result.manifest })
      }
      return res
        .status(202)
        .json({ result: { state: result.state, status: result.status } })
    } catch (err) {
      const code = err.code || 500
      return res.status(code).json({ error: { code, message: err.message } })
    }
  })

  /**
   * @swagger
   * /album-status:
   *   get:
   *     description: Build progress for an album ({ state, done, total, sheetsReady }).
   *     parameters:
   *       - name: album
   *         in: query
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Status }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/album-status', required, async (req, res) => {
    try {
      const album = req.query.album
      let status = albumBuild.getStatus(album)
      if (status.state === 'unknown') {
        // Not tracked in memory (e.g. after a restart) — report ready off disk.
        const manifest = await albumBuild.readManifest(album)
        if (manifest) {
          status = {
            state: 'ready',
            done: manifest.total,
            total: manifest.total,
            sheetsReady: manifest.sheets.length,
          }
        }
      }
      return res.status(200).json({ result: status })
    } catch (err) {
      return res
        .status(500)
        .json({ error: { code: 500, message: err.message } })
    }
  })

  /**
   * @swagger
   * /album-cover:
   *   get:
   *     description: The album's cached collage cover (JPEG).
   *     parameters:
   *       - name: album
   *         in: query
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: JPEG }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/album-cover', required, async (req, res) => {
    await serveCacheFile(res, req.query.album, 'cover.jpg')
  })

  /**
   * @swagger
   * /album-activity:
   *   get:
   *     description: In-progress album builds (which albums are building/queued,
   *       with progress) and build-slot usage. For the admin dashboard.
   *     responses:
   *       200: { description: Activity snapshot }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/album-activity', required, (req, res) => {
    res.status(200).json({ result: albumBuild.getActivity() })
  })

  /**
   * @swagger
   * /album-sprite:
   *   get:
   *     description: A cached sprite sheet (JPEG) by file name from the manifest.
   *     parameters:
   *       - name: album
   *         in: query
   *         required: true
   *         schema: { type: string }
   *       - name: sheet
   *         in: query
   *         required: true
   *         description: sheet file name (e.g. 2026-04-0.jpg)
   *         schema: { type: string }
   *     responses:
   *       200: { description: JPEG }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/album-sprite', required, async (req, res) => {
    const sheet = path.basename(req.query.sheet || '') // strip any path component
    await serveCacheFile(res, req.query.album, path.join('sprites', sheet))
  })

  /**
   * @swagger
   * /album-tags:
   *   get:
   *     description: List the image names carrying a tag (default "favorite") in an
   *       album. Cheap symlink listing, decoupled from the sprite manifest so tag
   *       changes (favoriting) reflect immediately without a rebuild.
   *     parameters:
   *       - name: album
   *         in: query
   *         required: true
   *         schema: { type: string }
   *       - name: tag
   *         in: query
   *         description: tag name (default "favorite")
   *         schema: { type: string }
   *     responses:
   *       200: { description: Array of image names }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/album-tags', required, async (req, res) => {
    const album = req.query.album
    const tag = req.query.tag || 'favorite'
    const base = path.resolve(tags_path)
    const dir = path.resolve(path.join(tags_path, album || '', tag))
    // Boundary test, not a string prefix (a bare startsWith would also accept a
    // sibling like "<base>-evil"): require the separator or an exact root match.
    if (dir !== base && !dir.startsWith(base + path.sep)) {
      return res
        .status(400)
        .json({ error: { code: 400, message: 'Invalid path' } })
    }
    try {
      const names = await fsp.readdir(dir)
      return res.status(200).json({ result: names })
    } catch (err) {
      // No tag dir yet = no tagged images.
      return res.status(200).json({ result: [] })
    }
  })

  /**
   * @swagger
   * /excludes:
   *   get:
   *     description: The Admin-managed list of directories (POSIX paths relative to
   *       IMAGE_PATH) hidden from the album list, the build cache, and enrichment.
   *     responses:
   *       200: { description: "{ excludes: [...] }" }
   *     security:
   *       - ApiKeyAuth: []
   *   put:
   *     description: Replace the exclude list. Normalizes + persists, reaps the
   *       build cache of newly-excluded top-level albums, and fires a background
   *       enrichment reap. Returns immediately (non-blocking).
   *     consumes:
   *       - application/json
   *     parameters:
   *       - name: body
   *         in: body
   *         schema:
   *           type: object
   *           properties:
   *             excludes:
   *               type: array
   *               items: { type: string }
   *     responses:
   *       200: { description: "{ excludes: [...] } (normalized)" }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/excludes', required, async (req, res) => {
    try {
      res.status(200).json({ excludes: await runtimeConfig.getExcludes() })
    } catch (err) {
      debugErr('excludes read failed: ', err)
      res.status(500).json({ error: { code: 500, message: err.message } })
    }
  })

  router.put('/excludes', required, async (req, res) => {
    try {
      const body = req.body || {}
      const before = new Set(await runtimeConfig.getExcludes())
      const after = await runtimeConfig.setExcludes(body.excludes)

      // Newly-excluded entries drive the side effects (removing an exclude needs
      // neither a cache wipe nor a reap — a re-sync/rebuild restores it).
      const newlyExcluded = after.filter((e) => !before.has(e))

      // 1. Reap the build cache of each newly-excluded *top-level* album so its
      //    sprites/cover/manifest stop being served. Nested excludes don't map to
      //    a cache dir of their own (the cache is per-album), so they're left to a
      //    later rebuild. Fire-and-forget — never block the response.
      for (const entry of newlyExcluded) {
        if (entry.includes('/')) continue // top-level only
        const dir = albumBuild.albumCacheDir(entry)
        if (!dir) continue
        fsp
          .rm(dir, { recursive: true, force: true })
          .catch((err) =>
            debugErr('cache reap failed for %s: %s', entry, err.message)
          )
      }

      // 2. Fire-and-forget an enrichment reap: once the worker's walk skips the
      //    excluded paths, their files leave reap's `present` set and their Meili
      //    docs are removed as orphans — no new enricher endpoint needed.
      if (newlyExcluded.length && enrichTriggerReap) {
        enrichTriggerReap().catch(() => {
          /* enrichment down — the daily reap/sync reconciles later */
        })
      }

      res.status(200).json({ excludes: after })
    } catch (err) {
      debugErr('excludes update failed: ', err)
      res.status(500).json({ error: { code: 500, message: err.message } })
    }
  })

  // --- User management ------------------------------------------------------
  // Minimal admin CRUD over the auth store: list users, create a user, reset a
  // password, delete a user. Behind the same auth gate as the rest of /api/v1.
  // No role enforcement is wired in yet (any logged-in user reaches the admin
  // surface — the app's existing single-trust model), so this deliberately
  // exposes no role editing; new users get a plain `user` role for display only.

  /**
   * @swagger
   * /users:
   *   get:
   *     description: List user accounts (usernames + roles; never passwords).
   *     responses:
   *       200: { description: "{ result: [{ username, roles }] }" }
   *     security:
   *       - ApiKeyAuth: []
   *   post:
   *     description: Create a user account with a password.
   *     consumes:
   *       - application/json
   *     parameters:
   *       - name: body
   *         in: body
   *         schema:
   *           type: object
   *           required: [username, password]
   *           properties:
   *             username: { type: string }
   *             password: { type: string }
   *     responses:
   *       200: { description: Created }
   *       400: { description: Invalid input / user exists }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.get('/users', required, async (req, res) => {
    try {
      res.status(200).json({ result: auth.listUsers() })
    } catch (err) {
      debugErr('list users failed: ', err)
      res.status(500).json({ error: { code: 500, message: err.message } })
    }
  })

  router.post('/users', required, async (req, res) => {
    const body = req.body || {}
    try {
      const result = await auth.addUser(body.username, body.password)
      res.status(200).json({ result })
    } catch (err) {
      res.status(400).json({ error: { code: 400, message: err.message } })
    }
  })

  /**
   * @swagger
   * /users/{username}/password:
   *   put:
   *     description: Reset a user's password.
   *     consumes:
   *       - application/json
   *     parameters:
   *       - name: username
   *         in: path
   *         required: true
   *         schema: { type: string }
   *       - name: body
   *         in: body
   *         schema:
   *           type: object
   *           required: [password]
   *           properties:
   *             password: { type: string }
   *     responses:
   *       200: { description: Updated }
   *       400: { description: Invalid input / no such user }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.put('/users/:username/password', required, async (req, res) => {
    const body = req.body || {}
    try {
      const result = await auth.setPassword(req.params.username, body.password)
      res.status(200).json({ result })
    } catch (err) {
      res.status(400).json({ error: { code: 400, message: err.message } })
    }
  })

  /**
   * @swagger
   * /users/{username}:
   *   delete:
   *     description: Delete a user account. Refuses to delete the caller's own
   *       account or the last remaining account.
   *     parameters:
   *       - name: username
   *         in: path
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Deleted }
   *       400: { description: Refused (self / last account) }
   *       404: { description: No such user }
   *     security:
   *       - ApiKeyAuth: []
   */
  router.delete('/users/:username', required, async (req, res) => {
    const target = req.params.username
    const me = req.user && req.user.user
    if (target === me) {
      return res.status(400).json({
        error: { code: 400, message: 'You cannot delete your own account' },
      })
    }
    // Guard against locking everyone out — the auth store has no recovery path.
    if (auth.listUsers().length <= 1) {
      return res.status(400).json({
        error: { code: 400, message: 'Cannot delete the last remaining user' },
      })
    }
    try {
      const result = await auth.deleteUser(target)
      res.status(200).json({ result })
    } catch (err) {
      res.status(404).json({ error: { code: 404, message: err.message } })
    }
  })

  return router
}

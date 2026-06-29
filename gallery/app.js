// vim: tabstop=2 shiftwidth=2 expandtab
//

// Node >= 24 removed `buffer.SlowBuffer`, but jsonwebtoken's transitive
// `buffer-equal-constant-time` still references it at module load (it would throw
// `Cannot read properties of undefined (reading 'prototype')`). Alias SlowBuffer to
// Buffer before any JWT code loads. No-op on Node LTS (the Docker runtime), where
// SlowBuffer still exists. Must stay above the jsonwebtoken-pulling requires below.
const nodeBuffer = require('buffer')
if (!nodeBuffer.SlowBuffer) nodeBuffer.SlowBuffer = nodeBuffer.Buffer

const crypto = require('crypto')
const express = require('express')
const createError = require('http-errors')
const path = require('path')
//const favicon = require('serve-favicon')
const logger = require('morgan')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const swaggerUi = require('swagger-ui-express')
const swaggerJSDoc = require('swagger-jsdoc')
const passport = require('passport')
const {
  Strategy: JwtCookieComboStrategy,
} = require('./lib/passport-jwt-cookiecombo')
const requireAuth = require('./lib/require-auth')

const runtimeConfig = require('rpg-config')
const jwtAuth = require('jwt-user-auth')
const auth = new jwtAuth(runtimeConfig.authPath())

const pjson = require('./package.json')

const api = require('./routes/api')

const createApp = async () => {
  // One-time, idempotent copy of a legacy /data/auth config into the new
  // CONFIG_PATH/auth location (no-op once migrated). Must run BEFORE auth.init()
  // so jwt-user-auth opens the migrated DB rather than generating a fresh one.
  await runtimeConfig.migrateLegacyAuth()
  await auth.init()

  // Cookie-signing secret. Generated once (strong random) and persisted alongside
  // the other auth secrets in the jwt-user-auth config DB — the same way the JWT
  // signing key is — so it survives restarts without being supplied insecurely via
  // the environment. No operator action and no placeholder default.
  let cookieSecret
  try {
    cookieSecret = await auth.db.getData('/cookieSecret')
  } catch (_) {
    cookieSecret = crypto.randomBytes(32).toString('base64')
    await auth.db.push('/cookieSecret', cookieSecret)
  }

  // Defense-in-depth shared secret for the enrichment API (:8080). Generated
  // once and persisted in the shared CONFIG_PATH store (NOT an env var); the
  // enrichment service reads it read-only to verify our proxied requests. Awaited
  // here (before listen) so getEnrichSecret() is populated for the enrich proxy.
  await runtimeConfig.ensureEnrichSecret()

  const app = express()

  // Behind a TLS-terminating reverse proxy (see deployment docs), trust the
  // proxy so `req.secure` reflects X-Forwarded-Proto and auth cookies are sent
  // with the Secure attribute. TRUST_PROXY: 'true'/'false', a hop count, or an
  // express trust-proxy expression (e.g. 'loopback', a subnet). Default off.
  const trustProxy = process.env.TRUST_PROXY
  if (trustProxy !== undefined) {
    if (trustProxy === 'true' || trustProxy === 'false') {
      app.set('trust proxy', trustProxy === 'true')
    } else if (/^\d+$/.test(trustProxy)) {
      app.set('trust proxy', parseInt(trustProxy, 10))
    } else {
      app.set('trust proxy', trustProxy)
    }
  }

  // view engine setup
  app.set('views', path.join(__dirname, 'views'))
  app.set('view engine', 'pug')

  app.use(logger('dev'))
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: false }))
  app.use(cookieParser(cookieSecret))
  // TODO uncomment after placing your favicon in /public
  //app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
  //app.use(express.static(path.join(__dirname, 'public')));

  // Passport.js
  // passport.use(jwtStrategy());
  passport.use(
    new JwtCookieComboStrategy(
      {
        // jwtCookieName: 'jwt',
        // jwtHeaderKey: 'Authorization',
        // Read the JWT from the *signed* cookie (set with signed:true at login),
        // not an unsigned one. This is the strategy's default; pinned explicitly.
        jwtCookieSecure: true,
        secretOrPublicKey: process.env.JWT_KEY_PUB || auth.privateKey,
      },
      // If we get here then we have a verified jwt signed correctly so just return decoded jwt
      // (jwt_payload, done) => done(null, jwt_payload, { info: "success" })
      (jwt_payload, done) => done(null, jwt_payload)
    )
  )

  // routes
  app.use('/api/v1/', api({ passport, auth }))

  // Image-enrichment map/search feature, behind the same auth gate as the API,
  // so it flows through the single /api/* surface (and the Next dev wildcard
  // rewrite). Additive: remove this line + routes/enrich.js to disable.
  app.use('/api/v1/enrich', requireAuth(passport), require('./routes/enrich'))

  // swagger
  // Strip any trailing slash so SWAGGER_ROOT_PATH='/' (root deploy) doesn't
  // produce a double-slash basePath like '//api/v1/'. The double slash makes
  // swagger-ui's "Try it out" request '//api/v1//ping', which misses the API
  // mount and falls through to the SPA (HTML response instead of JSON).
  const rootpath = (process.env.SWAGGER_ROOT_PATH || '').replace(/\/+$/, '')
  const basepath = rootpath + '/api/v1/'

  const options = {
    swaggerDefinition: {
      swagger: '2.0',
      info: {
        title: pjson.name, // Title (required)
        version: pjson.version, // Version (required)
      },
      basePath: basepath,
      securityDefinitions: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
    apis: ['./routes/api*'], // Path to the API docs
  }
  const swaggerSpec = swaggerJSDoc(options)

  app.get('/api/v1/swagger.json', function (req, res) {
    res.setHeader('Content-Type', 'application/json')
    res.send(swaggerSpec)
    res.end()
  })
  app.use(
    '/api-docs/',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec),
    function (req, res, next) {
      res.end()
    }
  )

  // Any other paths, assume they are the frontend
  app.use(express.static(path.join(__dirname, 'frontend/build')))
  // SPA fallback. Express 5 (path-to-regexp v8) no longer accepts a bare '*';
  // '/{*splat}' is the named-wildcard equivalent that still matches '/' and any
  // deep link, and stays GET-only so other methods fall through to the 404.
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build/index.html'))
  })

  // catch 404 and forward to error handler
  app.use(function (req, res, next) {
    const err = new Error('Not Found')
    err.status = 404
    next(err)
  })

  // error handler
  app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message
    res.locals.error = req.app.get('env') === 'development' ? err : {}

    let sanErr = err
    if (err.name === 'AuthenticationError') {
      sanErr = createError(401, 'Unauthorized', {
        expose: true,
      })
    }

    // render the error page
    res.status(sanErr.status || 500)
    // TODO handle errors with more info
    res.json({
      error: {
        status: sanErr.status || 500,
      },
    })
  })

  return app
}

module.exports = createApp

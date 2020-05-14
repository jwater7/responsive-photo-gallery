// vim: tabstop=2 shiftwidth=2 expandtab
//

var express = require('express');

const imageHandler = require('../handlers/image-handler');
const image_path = process.env.IMAGE_PATH || '/images';
const thumb_path = process.env.THUMB_PATH || '/data/thumbs';
var handler = new imageHandler(image_path, thumb_path);

const debug = require('debug')('responsive-photo-gallery:server');

module.exports = ({passport, auth}) => {

  var router = express.Router();

  const required = process.env.NO_AUTHENTICATION === 'yes' ? [] : passport.authenticate('jwt-cookiecombo', {
    session: false,
    failWithError: true,
  })

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
    router.use(function(req, res, next) {
      //res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Origin", "http://localhost:3000");
      res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, X-API-Key");
      res.header("Access-Control-Allow-Credentials", "true");
      next();
    });
    router.options(function(req, res, next) {
      res.status(200).end();
    });
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
  router.all('/ping', required, function(req, res, next) {
    // TODO this uses a cookie now
    var token = req.body.token || req.query.token || req.headers['x-api-key'];
    res.status(200).json({
      result: token,
    });
    res.end();
  });

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
  router.post('/logout', required, function(req, res, next) {

    const jwt = req.user.jwt || req.body.jwt
    const cookieOptions = getCommonCookieOptions({
      cookie_domain: req.body.cookie_domain,
      cookie_path: req.body.cookie_path,
      cookie_max_age_sec: req.body.cookie_max_age_sec,
      secure: req.secure,
    })
    res.clearCookie('jwt', cookieOptions)
    res.json({ result: jwt })

  });

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
  router.post('/login', function(req, res, next) {

    const expiresIn =
      (process.env.API_FORCE_JWT_EXPIRE_SEC
        ? Number(process.env.API_FORCE_JWT_EXPIRE_SEC)
        : undefined) ||
      (req.body.jwt_expire_sec
        ? Number(req.body.jwt_expire_sec)
        : undefined) ||
      (req.body.cookie_max_age_sec
        ? Number(req.body.cookie_max_age_sec)
        : '1d') //default to about the life of a cookie

    var token = auth.login(req.body.username, req.body.password, {
      ...(expiresIn && { expiresIn }),
    });
    if (token) {
      const cookieOptions = getCommonCookieOptions({
        cookie_domain: req.body.cookie_domain,
        cookie_path: req.body.cookie_path,
        cookie_max_age_sec: req.body.cookie_max_age_sec,
        secure: req.secure,
      })
      res.cookie('jwt', token, cookieOptions)

      // Set up a cookie so client can easily send it with the header
      //res.cookie('authtoken', token, { secure: true });
      //res.cookie('authtoken', token);

      res.status(200).json({
        result: token,
      });
    } else {
      res.status(403).json({
        error: {
          code: 403,
          message: 'Incorrect',
        }
      });
    }
    res.end();
  });

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
  router.get('/albums', required, function(req, res, next) {

    function cb(args) {
      if (args.error || !args.result) {
        res.status(500);
      } else {
        res.status(200);
      }
      res.json(args);
      res.end();
    }
    handler.albums(cb);
  });

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
  router.get('/list', required, function(req, res, next) {
    handler.list(req.query.album, req.query.num_results, req.query.distributed, function cb(args) {
      if (args.error || !args.result) {
        res.status(500);
      } else {
        res.status(200);
      }
      res.json(args);
      res.end();
    });
  });

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
  router.get('/image', required, function(req, res, next) {

    let album = req.query.album;
    let image = req.query.image;
    let thumb = req.query.thumb;

    handler.image(album, image, thumb, (err, image_buffer, content_type) => {
      if (err) {
        res.status(500);
        res.json(err);
        res.end();
        return;
      }
      res.set('Content-Type', content_type);
      res.send(image_buffer);
      res.end();
    });

  });

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
  router.get('/video', required, function(req, res, next) {

    let album = req.query.album;
    //TODO probably rename to video or something instead of image
    let image = req.query.image;

    handler.video(album, image, (err, video_file) => {
      if (err) {
        res.status(500);
        res.json(err);
        res.end();
        return;
      }
      res.download(video_file);
    });

  });

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
  router.get('/thumbnails', required, function(req, res, next) {
    handler.thumbnails(req.query.album, req.query.thumb, req.query.image, req.query.num_results, req.query.distributed, function cb(args) {
      if (args.error || !args.result) {
        res.status(500);
      } else {
        res.status(200);
      }
      res.json(args);
      res.end();
    });
  });

  return router;
}


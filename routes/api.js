// vim: tabstop=2 shiftwidth=2 expandtab
//

var express = require('express');
var router = express.Router();

const jwtAuth = require('../jwt-user-auth/index');
const auth_path = process.env.AUTH_PATH || '/data/auth';
var auth = new jwtAuth(auth_path);

const imageHandler = require('../handlers/image-handler');
const image_path = process.env.IMAGE_PATH || '/images';
const thumb_path = process.env.THUMB_PATH || '/data/thumbs';
var handler = new imageHandler(image_path, thumb_path);

const debug = require('debug')('responsive-photo-gallery:server');

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
router.use(auth.authenticate.bind(auth));

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
router.post('/logout', auth.required, function(req, res, next) {

  var token = req.body.token || req.query.token || req.headers['x-api-key'];
  auth.logout(token);
  res.status(200).json({
    result: token,
  });
  res.end();
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
 *             password:
 *               type: string
 *     responses:
 *       200:
 *         description: Returns auth token
 *       401:
 *         description: Authentication Failure
 */
router.post('/login', function(req, res, next) {

  var token = auth.login(req.body.username, req.body.password);
  if (token) {

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
router.get('/albums', auth.required, function(req, res, next) {

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
router.get('/list', auth.required, function(req, res, next) {

  var album = req.query.album;

  function cb(args) {
    if (args.error || !args.result) {
      res.status(500);
    } else {
      res.status(200);
    }
    res.json(args);
    res.end();
  }
  handler.list(album, cb);
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
router.get('/image', auth.required, function(req, res, next) {

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
 *         description: an optional thumb dimension (e.g. "50x50")
 *         schema:
 *           type: string
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
router.get('/thumbnails', auth.required, function(req, res, next) {

  var album = req.query.album;
  let thumb = req.query.thumb;

  function cb(args) {
    if (args.error || !args.result) {
      res.status(500);
    } else {
      res.status(200);
    }
    res.json(args);
    res.end();
  }
  handler.thumbnails(album, thumb, cb);

});

module.exports = router;


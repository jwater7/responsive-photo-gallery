var express = require('express');
var router = express.Router();

var jwtAuth = require('../jwt-user-auth/index');
var data_path = process.env.DATA_PATH || '/data/auth';
const crypto = require("crypto");
var private_key = process.env.PRIVATE_KEY || crypto.randomBytes(3*4).toString('base64')
var auth = new jwtAuth(data_path, private_key);

var imageHandler = require('../handlers/image-handler');
var image_path = process.env.IMAGE_PATH || '/images';
var handler = new imageHandler(image_path);

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
    res.json(args);
    if (args.error || !args.result) {
      //res.status(500);
    } else {
      res.status(200);
    }
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
 *     consumes:
 *       - application/json
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
    res.json(args);
    if (args.error || !args.result) {
      //res.status(500);
    } else {
      res.status(200);
    }
    res.end();
  }
  handler.list(album, cb);
});

module.exports = router;


var express = require('express');
var router = express.Router();

var jwtAuth = require('../jwt-user-auth/index');
var data_path = process.env.DATA_PATH || '/data/auth';
var private_key = process.env.PRIVATE_KEY || Math.floor(Math.random()*(10000)).toString();
var auth = new jwtAuth(data_path, private_key);

var imageHandler = require('../handlers/image-handler');
var image_path = process.env.IMAGE_PATH || '/images';
var handler = new imageHandler(image_path);

const debug = require('debug')('responsive-photo-gallery:server');

router.use(auth.authenticate.bind(auth));

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

  // TODO if debug for all routes
  if (debug.enabled) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  }

  var token = auth.login(req.body.username, req.body.password);
  if (token) {
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
 * /list:
 *   get:
 *     description: Returns homepage
 *     consumes:
 *       - application/json
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: token
 *         in: query
 *         description: auth token
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Returns JSON list
 *       500:
 *         description: Internal server error
 */
router.get('/list', auth.required, function(req, res, next) {

  // TODO if debug for all routes
  if (debug.enabled) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  }

  function cb(args) {
    res.json(args);
    if (args.error || !args.result) {
      //res.status(500);
    } else {
      res.status(200);
    }
    res.end();
  }
  handler.list(cb);
});

module.exports = router;


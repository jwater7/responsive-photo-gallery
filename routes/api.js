var express = require('express');
var router = express.Router();
var imageHandler = require('../handlers/image-handler');

var image_path = process.env.IMAGE_PATH || '/images';
var handler = new imageHandler(image_path);

/**
 * @swagger
 * /list:
 *   get:
 *     description: Returns homepage
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: Returns JSON list
 *       500:
 *         description: Internal server error
 */
router.get('/list', function(req, res, next) {
  function cb(args) {
    if (args.error || !args.result) {
      res.status(500).end();
      return;
    }
    res.json(args);
  }
  handler.list(cb);
});

module.exports = router;


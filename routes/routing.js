var express = require('express');
var router = express.Router();
var imageHandler = require('../handlers/image-handler')
// TODO make image file path configurable
var handler = new imageHandler('/images')

/**
 * @swagger
 * /:
 *   get:
 *     description: Returns homepage
 *     respones:
 *       200:
 *         description: Returns HTML
 */
/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

/**
 * @swagger
 * /list:
 *   get:
 *     description: Returns homepage
 *     produces:
 *       - application/json
 *     respones:
 *       200:
 *         description: Returns HTML
 *       500:
 *         description: Internal server error
 */
router.get('/list', function(req, res, next) {
  function cb(args) {
    if (args.error || !args.result) {
      res.status(500).end()
      return
    }
    res.json(args)
  }
  handler.list(cb)
});

module.exports = router;


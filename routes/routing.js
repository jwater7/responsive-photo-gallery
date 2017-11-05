var express = require('express');
var router = express.Router();

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

module.exports = router;

var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var swaggerUi = require('swagger-ui-express');
var swaggerJSDoc = require('swagger-jsdoc');
var pjson = require('./package.json');

var api = require('./routes/api');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
// TODO uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
//app.use(express.static(path.join(__dirname, 'public')));

// routes
app.use('/api/v1/', api);

// swagger
var rootpath = process.env.SWAGGER_ROOT_PATH || '';
var basepath = rootpath + '/api/v1/';

var options = {
  swaggerDefinition: {
    swagger: '2.0',
    info: {
      title: pjson.name, // Title (required)
      version: pjson.version, // Version (required)
    },
    basePath: basepath,
  },
  apis: ['./routes/api*'], // Path to the API docs
};
var swaggerSpec = swaggerJSDoc(options);

app.get('/api/v1/swagger.json', function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
  res.end();
});
app.use('/api-docs/', swaggerUi.serve, swaggerUi.setup(swaggerSpec), function(req, res, next) {
  res.end();
});

// Any other paths, assume they are the frontend
app.use(express.static(path.join(__dirname, 'frontend/build')));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;

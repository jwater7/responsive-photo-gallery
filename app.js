// vim: tabstop=2 shiftwidth=2 expandtab
//

var express = require('express');
const createError = require('http-errors')
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var swaggerUi = require('swagger-ui-express');
var swaggerJSDoc = require('swagger-jsdoc');
const passport = require('passport')
const { Strategy: JwtCookieComboStrategy } = require('passport-jwt-cookiecombo')

const jwtAuth = require('jwt-user-auth');
const auth_path = process.env.AUTH_PATH || '/data/auth';
var auth = new jwtAuth(auth_path);

var pjson = require('./package.json');

var api = require('./routes/api');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser('TODO Needs a Secret'));
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
      // jwtCookieSecure: true,
      secretOrPublicKey: process.env.JWT_KEY_PUB || auth.privateKey,
    },
    // If we get here then we have a verified jwt signed correctly so just return decoded jwt
    // (jwt_payload, done) => done(null, jwt_payload, { info: "success" })
    (jwt_payload, done) => done(null, jwt_payload)
  )
)

// routes
app.use('/api/v1/', api({passport, auth}));

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
    securityDefinitions: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
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
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'frontend/build/index.html')) });

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

  let sanErr = err
  if (err.name === 'AuthenticationError') {
    sanErr = createError(401, 'Unauthorized', {
      expose: true,
    })
  }

  // render the error page
  res.status(sanErr.status || 500);
  // TODO handle errors with more info
  res.json({
    error: {
      status: sanErr.status || 500,
    },
  })
});

module.exports = app;

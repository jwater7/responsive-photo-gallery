'use strict'

// Inspired by:
// https://medium.freecodecamp.org/how-to-make-authentication-easier-with-json-web-token-cc15df3f2228
// https://github.com/louischatriot/nedb
// https://github.com/scotch-io/node-token-authentication/blob/master/server.js
// https://scotch.io/tutorials/authenticate-a-node-js-api-with-json-web-tokens
// https://gist.github.com/smebberson/1581536

var Datastore = require('nedb');
var jwt = require('jsonwebtoken');

const debug = require('debug')('responsive-photo-gallery:server');

class jwtUserAuth {
  constructor(dbPath, privateKey) {
    this.dbPath = dbPath;
    this.privateKey = privateKey;
    this.db = new Datastore({ filename: dbPath + '/db', autoload: true });
  }

  login(username, password) {
    if (username == 'username' && password == 'password') {
      return jwt.sign({ user: username }, this.privateKey, {
        expiresIn: 86400 // expires in 24 hours
      });
    }
    return false;
  }

  authenticate(req, res, next) {
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    if (token) {
      jwt.verify(token, this.privateKey, function(err, decoded) {
        if (!err) {
          req.decoded = decoded;
        }
      });
    }
    next();
  }

  required(req, res, next) {
    if(req.decoded) {
      next();
      return;
    }
    
    res.status(403).json({
      error: {
        code: 403,
        message: 'Not Authenticated',
      }
    });
    res.end();
  }

}

module.exports = jwtUserAuth;


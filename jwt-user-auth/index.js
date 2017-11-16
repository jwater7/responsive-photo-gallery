// vim: tabstop=2 shiftwidth=2 expandtab
//

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
    this.keyBlackList = {};

    // retain "this"
    this.checkBlackList = this.checkBlackList.bind(this);
  }

  addToBlackList(token, expiretime) {
    this.keyBlackList[token] = {
      'expiretime': expiretime,
    };
  }

  checkBlackList(token) {
    // Auto clean the list
    for (var key in this.keyBlackList) {
      if ('expiretime' in this.keyBlackList[key]) {
        // Delete if its expired anyway
        if (this.keyBlackList[key].expiretime <= Math.round(Date.now()/1000)) {
          delete this.keyBlackList[key];
        }
      }
    }
    // If in the blacklist return bad
    if (this.keyBlackList[token]) {
      return false;
    }
    return true;
  }

  logout(token) {
    if (token) {
      jwt.verify(token, this.privateKey, function(err, decoded) {
        if (!err) {
          this.addToBlackList(token, decoded.exp);
        }
      }.bind(this));
    }
  }

  login(username, password) {
    if (username == 'TODOadmin' && password == 'TODOpassword') {
      return jwt.sign({ 'user': username, 'admin': true }, this.privateKey, {
        expiresIn: 86400 // expires in 24 hours
      });
    }
    return false;
  }

  authenticate(req, res, next) {
    var token = req.body.token || req.query.token || req.headers['x-api-key'];
    if (token) {
      jwt.verify(token, this.privateKey, function(err, decoded) {
        if (!err) {
          if (this.checkBlackList(token)) {
            req.decoded = decoded;
          }
        }
      }.bind(this));
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


// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

var jwt = require('jsonwebtoken');
const JsonDB = require('node-json-db');
const crypto = require("crypto");

const debug = require('debug')('responsive-photo-gallery:server');

class jwtUserAuth {

  constructor(dbPath) {

    this.dbPath = dbPath;
    // Save after each push = true, save in human readable format = true
    this.db = new JsonDB(dbPath + '/config.json', true, true);

    // Check DB Version
    try {
      let ver = this.db.getData('/dbVersion');
      if (ver !== '0') {
        throw (new Error('version mismatch'))
      }
    } catch(e) {
      //this.db.delete('/');
      // Initialize Database
      let password = process.env.DEFAULT_PASSWORD || crypto.randomBytes(3*4).toString('base64');
    // TODO need to hash to keep safe
      this.db.push('/dbVersion', '0');
      this.db.push('/users', {
        'admin': {
          password,
          'hashed': false,
          'admin': true,
        }
      });
    }

    this.users = [];
    try { this.users = this.db.getData('/users'); } catch(e) {}

    // Autogenerate each instance, but save in text for reference
    this.privateKey = process.env.PRIVATE_KEY || crypto.randomBytes(3*4).toString('base64')
    // TODO need to keep safe
    try { this.db.push('/privateKey', this.privateKey); } catch(e) {}

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
    if (this.users[username].password == password) {
      //console.log("login: " + username);
      return jwt.sign({ 'user': username, 'admin': this.users[username].admin }, this.privateKey, {
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


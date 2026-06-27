// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

var jwt = require('jsonwebtoken');
const { openDb } = require('rpg-config');
const crypto = require("crypto");

// scrypt is in core crypto, so password hashing adds no dependency. 64-byte
// derived key with a per-user 16-byte salt, stored as "salt:hash" (both hex).
// scryptSync's default cost is deliberately slow; fine for an occasional admin
// login, and it keeps login() synchronous (passport's verify path is sync).
const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyHashed(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  // Length check first: timingSafeEqual throws on a length mismatch.
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// A user record verifies either way: hashed records (everything the user manager
// creates) go through scrypt; the seeded legacy admin (hashed:false) stays a
// plaintext compare so an existing deployment keeps working without a reset.
function verifyPassword(password, user) {
  if (!user) return false;
  if (user.hashed) return verifyHashed(password, user.password);
  return user.password === password;
}

// Usernames become node-json-db key segments (separator '/'), so they must not
// carry the separator or other path-significant characters. Keep it to a plain,
// predictable identifier set.
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

class jwtUserAuth {

  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    // Config persistence comes from rpg-config (the shared node-json-db store
    // convention: saveOnPush + humanReadable), so node-json-db is centralized
    // there rather than required independently here.
    this.db = openDb(this.dbPath + '/config.json');

    // Check DB Version
    try {
      let ver = await this.db.getData('/dbVersion');
      if (ver !== '0') {
        throw (new Error('version mismatch'))
      }
    } catch (e) {
      //this.db.delete('/');
      // Initialize Database
      await this.db.push('/dbVersion', '0');
      // TODO need to hash to keep safe
      let password = process.env.DEFAULT_PASSWORD || crypto.randomBytes(32).toString('base64');
      await this.db.push('/users', {
        'admin': {
          password,
          'hashed': false,
          'roles': ['admin'],
        }
      });
      // 256-bit signing key (was randomBytes(3*4) = 96-bit). Widened on fold-in.
      let privateKey = process.env.DEFAULT_PRIVATE_KEY || crypto.randomBytes(32).toString('base64');
      // TODO need to keep safe
      await this.db.push('/privateKey', privateKey);
    }

    this.privateKey = crypto.randomBytes(32).toString('base64');
    // If we passed in the private key then use it instead
    if (process.env.PRIVATE_KEY) {
      this.privateKey = process.env.PRIVATE_KEY;
    }
    // Override any generated or passed in keys if there's one in the DB
    try {
      const dbPrivateKey = await this.db.getData('/privateKey');
      // if no exception so far then we use it here
      this.privateKey = dbPrivateKey;
    } catch (e) { }

    this.users = [];
    try { this.users = await this.db.getData('/users'); } catch (e) { }

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
        if (this.keyBlackList[key].expiretime <= Math.round(Date.now() / 1000)) {
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
      jwt.verify(token, this.privateKey, function (err, decoded) {
        if (!err) {
          this.addToBlackList(token, decoded.exp);
        }
      }.bind(this));
    }
  }

  login(username, password, options) {
    const user = this.users[username];
    if (user && verifyPassword(password, user)) {
      //console.log("login: " + username);
      return jwt.sign({
        'user': username,
        'roles': user.roles,
      }, this.privateKey, {
        expiresIn: 60 * 60 * 24, // default expires in 24 hours
        ...options,
      });
    }
    return false;
  }

  // --- User management ------------------------------------------------------
  // Minimal create/delete/set-password over the same node-json-db `/users`
  // store login reads. `this.users` is the in-memory mirror loaded at init();
  // each mutation writes through to the DB and updates the mirror so login()
  // sees the change without a re-init. Passwords are never returned.

  listUsers() {
    return Object.keys(this.users || {}).map((username) => ({
      username,
      roles: this.users[username].roles || [],
    }));
  }

  async addUser(username, password, roles = ['user']) {
    username = String(username == null ? '' : username).trim();
    if (!USERNAME_RE.test(username)) {
      throw new Error('Username must be letters, numbers, dot, dash or underscore');
    }
    if (!password) {
      throw new Error('A password is required');
    }
    if (this.users[username]) {
      throw new Error('A user with that name already exists');
    }
    const entry = { password: hashPassword(password), hashed: true, roles };
    await this.db.push('/users/' + username, entry);
    this.users[username] = entry;
    return { username, roles: entry.roles };
  }

  async setPassword(username, password) {
    if (!this.users[username]) {
      throw new Error('No such user');
    }
    if (!password) {
      throw new Error('A password is required');
    }
    const entry = { ...this.users[username], password: hashPassword(password), hashed: true };
    await this.db.push('/users/' + username, entry);
    this.users[username] = entry;
    return { username };
  }

  async deleteUser(username) {
    if (!this.users[username]) {
      throw new Error('No such user');
    }
    await this.db.delete('/users/' + username);
    delete this.users[username];
    return { username };
  }

  authenticate(req, res, next) {
    var token = req.body.token || req.query.token || req.headers['x-api-key'];
    if (token) {
      jwt.verify(token, this.privateKey, function (err, decoded) {
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
    if (req.decoded) {
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


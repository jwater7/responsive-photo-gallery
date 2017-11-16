// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
var sharp = require('sharp');
sharp.cache(false);

function convert(src, dest, width, height, cb) {

  // check already converted
  if (fs.existsSync(dest)) {
    return cb(undefined);
  }

  // check source file
  fs.stat(src, (err, stats) => {
    if (err) {
      return cb(err);
    }
    if (!stats.isFile()) {
      return cb(new Error('Source file does not exist'));
    }

    // try making the directory if not already there
    mkdirp(path.dirname(dest), (err) => {
      if (err) {
        return cb(err);
      }

      sharp(src)
        .resize(width, height)
        .crop(sharp.strategy.attention)
        .toFile(dest, (err, info) => {
          return cb(err);
        })
    });
  });
}

function getPngAndConvert(src, dest, width, height, cb) {

  convert(src, dest, width, height, (err) => {
    if (err) {
      return cb(err, undefined);
    }
    fs.readFile(dest, (err, data) => {
      if (err) {
        return cb(err, undefined);
      }
      return cb(undefined, new Buffer(data));
    });
  });

}

module.exports = {
  getPngAndConvert,
  convert,
};


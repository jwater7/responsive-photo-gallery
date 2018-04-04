// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
var sharp = require('sharp');
// alpine linux needs no cache option
sharp.cache(false);

const exifReader = require('exif-reader');

// For corrections with auto rotations (1 (0deg) and 3 (180deg) are orig WxH)
// 6 needs to be rotated 90 deg, 8 needs to be rotated 270 deg
// 2 and 4 are mirrors of 1 and 3, 5 and 7 are mirrors of 6 and 8
const needsSwitched = [5, 6, 7, 8];

function cacheThumb(src, dest, width, height, cb) {

  // check source file
  fs.stat(src, (err, stats) => {
    if (err) {
      return cb(err, undefined, undefined);
    }
    if (!stats.isFile()) {
      return cb(new Error('Source file does not exist'), undefined, undefined);
    }

    // try making the directory if not already there
    mkdirp(path.dirname(dest), (err) => {
      if (err) {
        return cb(err, undefined, undefined);
      }

      const sharpImage = sharp(src);
      return sharpImage
        .rotate()
        .resize(width, height)
        .crop(sharp.strategy.attention)
        .toFile(dest, (err, info) => {
          if (err) {
            return cb(err, undefined, undefined);
          }
          const sharpImageForBuf = sharp(dest);
          return sharpImageForBuf
            .toBuffer((err, imageBuffer, imageInfo) => {
              if (err) {
                return cb(err, undefined, undefined);
              }
              const contentType = 'image/' + info.format;
              return cb(undefined, imageBuffer, contentType);
            });
        });
    });
  });
}

function cacheThumbAndGetBuffer(src, dest, width, height, cb) {

  // check already converted
  if (fs.existsSync(dest)) {
    return fs.readFile(dest, (err, data) => {
      if (err) {
        return cb(err, undefined, undefined);
      }
      const imageBuffer = new Buffer(data);
      const sharpImage = sharp(imageBuffer);
      return sharpImage
        .metadata((err, metadata) => {
          if (err) {
            return cb(err, undefined, undefined);
          }
          const contentType = 'image/' + metadata.format;
          return cb(undefined, imageBuffer, contentType);
      });
    });
  }

  return cacheThumb(src, dest, width, height, (err, imageBuffer, contentType) => {
    if (err) {
      return cb(err, undefined, undefined);
    }
    return cb(undefined, imageBuffer, contentType);
  });

}

function getMetadata(src, cb) {
  var returnMetadata = {};
  // get file size

  returnMetadata['format'] = 'image';

  fs.stat(src, (err, stats) => {
    // Best guess mtime
    if (err) {
      // Default to now
      let date = new Date();
      returnMetadata['modifyDate'] = date.toISOString();
    } else {
      returnMetadata['modifyDate'] = stats.mtime;
    }

    sharp(src)
      .metadata((err, metadata) => {
        if(err) {
          return cb(err, undefined);
        }
        returnMetadata['width'] = metadata.width;
        returnMetadata['height'] = metadata.height;
        returnMetadata['formatType'] = metadata.format;
        returnMetadata['orientation'] = metadata.orientation;
        returnMetadata['orientedWidth'] = metadata.width;
        returnMetadata['orientedHeight'] = metadata.height;
        if (needsSwitched.indexOf(metadata.orientation) > -1) {
          returnMetadata['orientedWidth'] = metadata.height;
          returnMetadata['orientedHeight'] = metadata.width;
        }
        // populate from exif
        if (metadata.exif) {
          const exifData = exifReader(metadata.exif);
          if (exifData) {
            if(exifData.image.Orientation) {
              returnMetadata['exifOrientation'] = exifData.image.Orientation;
            }
            if(exifData.image.ModifyDate) {
              returnMetadata['modifyDate'] = exifData.image.ModifyDate;
            }
            if(exifData.gps) {
              returnMetadata['exifGPS'] = exifData.gps;
            }
          }
        }
        return cb(undefined, returnMetadata);
      });
  });

}

function getNormalizedImageBuffer(src, cb) {

  fs.stat(src, (err, stats) => {
    if (err) {
      return cb(err, undefined, undefined);
    }
    if (!stats.isFile()) {
      return cb(new Error('Source file does not exist'), undefined, undefined);
    }

    sharp(src)
      .rotate()
      .toBuffer((err, output_buffer, info) => {
        if(err) {
          return cb(err, undefined, undefined);
        }
        //info.height // after image operation
        //info.width // after image operation
        const contentType = 'image/' + info.format;
        return cb(undefined, output_buffer, contentType);
      });
  });

}

module.exports = {
  cacheThumbAndGetBuffer,
  cacheThumb,
  getMetadata,
  getNormalizedImageBuffer,
};


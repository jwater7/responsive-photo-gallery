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

const ffmpeg = require('fluent-ffmpeg');

// For corrections with auto rotations (1 (0deg) and 3 (180deg) are orig WxH)
// 6 needs to be rotated 90 deg, 8 needs to be rotated 270 deg
// 2 and 4 are mirrors of 1 and 3, 5 and 7 are mirrors of 6 and 8
const needsSwitched = [5, 6, 7, 8];

function cacheThumb(src, dest, width, height, cb) {

  if(path.extname(src).toLowerCase() == '.mov') {
    return cacheVideoThumb(src, dest, width, height, cb);
  }

  return cacheImageThumb(src, dest, width, height, cb);

}

function cacheImageThumb(src, dest, width, height, cb) {

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
              const contentType = 'image/' + imageInfo.format;
              return cb(undefined, imageBuffer, contentType);
            });
        });
    });
  });
}

function cacheVideoThumb(src, dest, width, height, cb) {

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

      const ffmpegImage = ffmpeg(src);
      return ffmpegImage
        .on('end', function(err, stdout, stderr) {
          const sharpImageForBuf = sharp(dest);
          return sharpImageForBuf
            .toBuffer((err, imageBuffer, imageInfo) => {
              if (err) {
                return cb(err, undefined, undefined);
              }
              const contentType = 'image/' + imageInfo.format;
              return cb(undefined, imageBuffer, contentType);
            });
        })
        .on('error', function(err, stdout, stderr) {
          return cb(err, undefined, undefined);
        })
        .screenshots({
          count: 1,
          folder: path.dirname(dest),
          filename: path.basename(dest),
          size: width + 'x' + height,
        });
    });
  });
}

function cacheThumbAndGetBuffer(src, dest, width, height, cb) {

  // Translate dest to have image extension with thumbs for videos
  var tran_dest = dest;
  if(path.extname(src).toLowerCase() == '.mov') {
    tran_dest = dest + '.PNG';
  }

  // check already converted
  if (fs.existsSync(tran_dest)) {
    return fs.readFile(tran_dest, (err, data) => {
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

  return cacheThumb(src, tran_dest, width, height, (err, imageBuffer, contentType) => {
    if (err) {
      return cb(err, undefined, undefined);
    }
    return cb(undefined, imageBuffer, contentType);
  });

}

function getMetadata(src, cb) {

  if(path.extname(src).toLowerCase() == '.mov') {
    return getVideoMetadata(src, cb);
  }

  return getImageMetadata(src, cb);

}

function getImageMetadata(src, cb) {
  var returnMetadata = {};
  // get file size

  returnMetadata['format'] = 'image';

  fs.stat(src, (err, stats) => {
    // Best guess mtime
    if (err) {
      // Default to now
      returnMetadata['modifyDate'] = new Date();
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

function getVideoMetadata(src, cb) {
  var returnMetadata = {};
  // get file size

  returnMetadata['format'] = 'video';

  fs.stat(src, (err, stats) => {
    // Best guess mtime
    if (err) {
      // Default to now
      returnMetadata['modifyDate'] = new Date();
    } else {
      returnMetadata['modifyDate'] = stats.mtime;
    }

    ffmpeg.ffprobe(src, function(err, metadata) {
      if(err) {
        return cb(err, undefined);
      }

      returnMetadata['formatType'] = metadata.format.format_name; //'mov,mp4,m4a,3gp,3g2,mj2'
      returnMetadata['modifyDate'] = new Date(metadata.format.tags.creation_time); //'2018-03-26 18:07:46'

      //for metadata.streams[]
      //returnMetadata['width'] = metadata.streams[i].width; //1920
      //returnMetadata['height'] = metadata.streams[i].height; //1080
      //returnMetadata[''] = metadata.streams[i].codec_name; //'h264'
      //returnMetadata[''] = metadata.streams[i].codec_type; //'video'

      //returnMetadata['orientation']
      returnMetadata['orientedWidth'] = metadata.streams[0].width; //1920
      returnMetadata['orientedHeight'] = metadata.streams[0].height; //1080
      //returnMetadata['exifOrientation']
      //returnMetadata['exifGPS']
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
  getMetadata,
  getNormalizedImageBuffer,
};


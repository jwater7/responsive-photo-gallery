// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');

function cacheThumb(src, dest, width, height, cb) {

  // TODO need to check exists
  // TODO create target directory if it does not exist yet

  ffmpeg(src)
    .on('end', function() {
      // TODO return errors?
      return cb(undefined, true);
    })
    .screenshots({
      count: 1,
      folder: path.dirname(dest),
      filename: path.basename(dest) + '.PNG',
      size: width + 'x' + height,
    });

}

function cacheThumbAndGetBuffer(src, dest, width, height, cb) {

}

function getMetadata(src, cb) {
  var returnMetadata = {};
  // get file size

  returnMetadata['format'] = 'video';

  fs.stat(src, (err, stats) => {
    // Best guess mtime
    if (err) {
      // Default to now
      let date = new Date();
      returnMetadata['modifyDate'] = date.toISOString();
    } else {
      returnMetadata['modifyDate'] = stats.mtime;
    }

    ffmpeg.ffprobe(src, function(err, metadata) {
      if(err) {
        return cb(err, undefined);
      }

      returnMetadata['formatType'] = metadata.format.format_name; //'mov,mp4,m4a,3gp,3g2,mj2'
      returnMetadata['modifyDate'] = metadata.format.tags.creation_time; //'2018-03-26 18:07:46'

      //for metadata.streams[]
      //returnMetadata['width'] = metadata.streams[i].width; //1920
      //returnMetadata['height'] = metadata.streams[i].height; //1080
      //returnMetadata[''] = metadata.streams[i].codec_name; //'h264'
      //returnMetadata[''] = metadata.streams[i].codec_type; //'video'

      //returnMetadata['orientation']
      //returnMetadata['orientedWidth']
      //returnMetadata['orientedHeight']
      //returnMetadata['exifOrientation']
      //returnMetadata['exifGPS']
      return cb(undefined, returnMetadata);
    });
  });

}

module.exports = {
  cacheThumbAndGetBuffer,
  cacheThumb,
  getMetadata,
};


// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { mkdirp } = require('mkdirp');
var sharp = require('sharp');
// alpine linux needs no cache option
sharp.cache(false);
//sharp.concurrency(16);

const exifReader = require('exif-reader');

const ffmpeg = require('fluent-ffmpeg');

// For corrections with auto rotations (1 (0deg) and 3 (180deg) are orig WxH)
// 6 needs to be rotated 90 deg, 8 needs to be rotated 270 deg
// 2 and 4 are mirrors of 1 and 3, 5 and 7 are mirrors of 6 and 8
const needsSwitched = [5, 6, 7, 8];

// TODO need to detect mroe video formats from names
const isVideo = (f) => (
  path.extname(f).toLowerCase() == '.mov'
  || path.extname(f).toLowerCase() == '.mp4'
)

function cacheThumb(src, dest, width, height, cb) {

  if(isVideo(src)) {
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
    mkdirp(path.dirname(dest))
    .catch(err => cb(err, undefined, undefined))
    .then(() => {
      const sharpImage = sharp(src);
      return sharpImage
        .rotate()
        .resize({
          width,
          height,
          fit: sharp.fit.cover,
          position: sharp.strategy.attention,
        })
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
    mkdirp(path.dirname(dest))
    .catch(err => cb(err, undefined, undefined))
    .then(() => {
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
  if(isVideo(src)) {
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

  if(isVideo(src)) {
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
          try {
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
          } catch(err) {
            // console.log(`TODO Error for ${src}`, err)
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

      if (metadata.format) {
        returnMetadata['formatType'] = metadata.format.format_name; //'mov,mp4,m4a,3gp,3g2,mj2'

        if (metadata.format.tags) {
          if (metadata.format.tags.creation_time) {
            returnMetadata['modifyDate'] = new Date(metadata.format.tags.creation_time); //'2018-03-26 18:07:46'
          }
          // overwrite if it has an apple one
          if (metadata.format.tags['com.apple.quicktime.creationdate']) {
            returnMetadata['modifyDate'] = new Date(metadata.format.tags['com.apple.quicktime.creationdate']); //'2021-11-16T21:32:21-0800'
          }

          // save location if it has it
          if (metadata.format.tags['com.apple.quicktime.location.ISO6709']) {
            returnMetadata['ISO6709GPS'] = metadata.format.tags['com.apple.quicktime.location.ISO6709']; //'+47.1187-122.9301+034.945/'
          }
        }
      }

      //for metadata.streams[]
      //returnMetadata['width'] = metadata.streams[i].width; //1920
      //returnMetadata['height'] = metadata.streams[i].height; //1080
      //returnMetadata[''] = metadata.streams[i].codec_name; //'h264'
      //returnMetadata[''] = metadata.streams[i].codec_type; //'video'

      //returnMetadata['orientation']
      // TODO just looking at the first one for now
      if (metadata.streams && metadata.streams.length > 0) {
        returnMetadata['orientedWidth'] = metadata.streams[0].width; //1920
        returnMetadata['orientedHeight'] = metadata.streams[0].height; //1080
      }
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

// ===========================================================================
// Sprite / collage primitives (added on the monorepo fold-in).
//
// New code here intentionally uses async/await + promises rather than the
// callback style above. The album build pass decodes each source ONCE via
// renderCell() — which returns the square cell plus the oriented dimensions and
// EXIF capture date the manifest/grouping need — then buildSpriteSheet() and
// buildCollage() composite those already-rendered cells (no source re-decode).
// ===========================================================================

const DEFAULT_CELL_SIZE = 256;
const DEFAULT_QUALITY = 80;
// Background fill for grid gaps (last row / partial sheets).
const DEFAULT_BACKGROUND = { r: 17, g: 17, b: 17 };

function captureDateFromExif(metadata, fallback) {
  if (metadata && metadata.exif) {
    try {
      const exifData = exifReader(metadata.exif);
      if (exifData) {
        if (exifData.exif && exifData.exif.DateTimeOriginal) {
          return exifData.exif.DateTimeOriginal;
        }
        if (exifData.image && exifData.image.ModifyDate) {
          return exifData.image.ModifyDate;
        }
      }
    } catch (err) {
      // unreadable exif; fall through to the fallback (file mtime)
    }
  }
  return fallback;
}

async function statOrDefault(src) {
  try {
    const stats = await fs.promises.stat(src);
    return { isFile: stats.isFile(), mtime: stats.mtime };
  } catch (err) {
    return { isFile: false, mtime: new Date() };
  }
}

async function renderImageCell(src, size) {
  const { isFile, mtime } = await statOrDefault(src);
  if (!isFile) {
    throw new Error('Source file does not exist');
  }

  const metadata = await sharp(src).metadata();
  let orientedWidth = metadata.width;
  let orientedHeight = metadata.height;
  if (needsSwitched.indexOf(metadata.orientation) > -1) {
    orientedWidth = metadata.height;
    orientedHeight = metadata.width;
  }
  const captureDate = captureDateFromExif(metadata, mtime);

  const { data: buffer, info } = await sharp(src)
    .rotate()
    .resize({
      width: size,
      height: size,
      fit: sharp.fit.cover,
      position: sharp.strategy.attention,
    })
    .jpeg({ quality: DEFAULT_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer,
    format: 'image',
    orientedWidth,
    orientedHeight,
    captureDate,
    cellWidth: info.width,
    cellHeight: info.height,
  };
}

function ffprobeAsync(src) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(src, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function screenshotToTemp(src) {
  const tmp = path.join(
    os.tmpdir(),
    'fip-cell-' + crypto.randomBytes(6).toString('hex') + '.png'
  );
  return new Promise((resolve, reject) => {
    ffmpeg(src)
      .on('end', () => resolve(tmp))
      .on('error', (err) => reject(err))
      .screenshots({
        count: 1,
        folder: path.dirname(tmp),
        filename: path.basename(tmp),
      });
  });
}

async function renderVideoCell(src, size) {
  const { mtime } = await statOrDefault(src);
  let orientedWidth;
  let orientedHeight;
  let captureDate = mtime;
  try {
    const probe = await ffprobeAsync(src);
    if (probe.streams && probe.streams.length) {
      orientedWidth = probe.streams[0].width;
      orientedHeight = probe.streams[0].height;
    }
    if (probe.format && probe.format.tags) {
      const tags = probe.format.tags;
      if (tags.creation_time) {
        captureDate = new Date(tags.creation_time);
      }
      if (tags['com.apple.quicktime.creationdate']) {
        captureDate = new Date(tags['com.apple.quicktime.creationdate']);
      }
    }
  } catch (err) {
    // probe failed; fall back to mtime + the cell's own dimensions
  }

  const tmp = await screenshotToTemp(src);
  try {
    const { data: buffer, info } = await sharp(tmp)
      .rotate()
      .resize({
        width: size,
        height: size,
        fit: sharp.fit.cover,
        position: sharp.strategy.attention,
      })
      .jpeg({ quality: DEFAULT_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer,
      format: 'video',
      orientedWidth: orientedWidth || info.width,
      orientedHeight: orientedHeight || info.height,
      captureDate,
      cellWidth: info.width,
      cellHeight: info.height,
    };
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

// renderCell: decode a source ONCE -> { buffer (size x size cover cell),
// format, orientedWidth, orientedHeight, captureDate, cellWidth, cellHeight }.
async function renderCell(src, size = DEFAULT_CELL_SIZE) {
  if (isVideo(src)) {
    return renderVideoCell(src, size);
  }
  return renderImageCell(src, size);
}

// compositeGrid: lay already-square cell buffers into a `columns`-wide grid and
// write a single JPEG to `dest`. Returns the per-cell geometry (by index) so the
// caller can map grid cells back to source images in the manifest.
async function compositeGrid(cellBuffers, opts, dest) {
  if (!cellBuffers.length) {
    throw new Error('No cells to composite');
  }
  const cellSize = opts.cellSize || DEFAULT_CELL_SIZE;
  const columns = Math.max(
    1,
    opts.columns || Math.ceil(Math.sqrt(cellBuffers.length))
  );
  const background = opts.background || DEFAULT_BACKGROUND;
  const quality = opts.quality || DEFAULT_QUALITY;

  const rows = Math.ceil(cellBuffers.length / columns);
  const width = columns * cellSize;
  const height = rows * cellSize;

  const cells = [];
  const composites = cellBuffers.map((input, i) => {
    const left = (i % columns) * cellSize;
    const top = Math.floor(i / columns) * cellSize;
    cells.push({ index: i, x: left, y: top, w: cellSize, h: cellSize });
    return { input, left, top };
  });

  await mkdirp(path.dirname(dest));
  await sharp({ create: { width, height, channels: 3, background } })
    .composite(composites)
    .jpeg({ quality })
    .toFile(dest);

  return { dest, width, height, columns, rows, cellSize, cells };
}

// buildSpriteSheet: composite rendered cells into a sheet. `cells` may be
// renderCell() results ({buffer,...}) or raw buffers. With opts.resize the cells
// are first rescaled to cellSize (use this to pack larger cells into a smaller
// sheet, e.g. the cover) — re-encoding the small cells, never the source images.
async function buildSpriteSheet(cells, opts, dest) {
  const options = opts || {};
  const cellSize = options.cellSize || DEFAULT_CELL_SIZE;
  let buffers = cells.map((cell) => (cell && cell.buffer ? cell.buffer : cell));
  if (options.resize) {
    buffers = await Promise.all(
      buffers.map((buf) =>
        sharp(buf)
          .resize({ width: cellSize, height: cellSize, fit: sharp.fit.cover })
          .toBuffer()
      )
    );
  }
  return compositeGrid(buffers, { ...options, cellSize }, dest);
}

module.exports = {
  cacheThumbAndGetBuffer,
  getMetadata,
  getNormalizedImageBuffer,
  renderCell,
  buildSpriteSheet,
};


// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');

var sharp = require('sharp');
sharp.cache(false);
const exifReader = require('exif-reader');
const thumbnailSharp = require('../thumbnail-sharp/index');

const isDirectory = source => fs.lstatSync(source).isDirectory()

//const getDirectories = source => fs.readdirSync(source).map(name => path.join(source, name)).filter(isDirectory)

class imageHandler {
  constructor(imagePath, thumbPath=false) {
    this.imagePath = imagePath;
    this.thumbPath = thumbPath;
  }

  image(album, image, thumb, _cb) {

    // Required arguments
    if (!album || !image) {
      return _cb({
        'error': {
          'code': 500,
          'message': 'missing required argument',
        }
      });
    }

    const san_album = sanitize(album);
    const san_image = sanitize(image);
    if (!san_album || !san_image) {
      return _cb({
        'error': {
          'code': 500,
          'message': 'malformed argument',
        }
      });
    }

    const image_path = path.join(this.imagePath, san_album, san_image);

    // If they want a thumbnail, generate, cache, and return it instead
    if (thumb) {
      const san_thumb = sanitize(thumb);
      const thumb_path = path.join(this.thumbPath, san_album, san_thumb, san_image);
      const [ width, height ] = san_thumb.split('x');

      // make sure we have valid input
      const san_width = parseInt(width);
      const san_height = parseInt(height);
      if (+width === san_width && +height === san_height) {
        return thumbnailSharp.convert(image_path, thumb_path, san_width, san_height, (err) => {
          if (err) {
            return _cb(image_path);
          }
          return _cb(thumb_path);
        });
      }
    }

    return _cb(image_path);
  }

  thumbnails(album, thumb, _cb) {

    // Required arguments
    if (!album || !thumb) {
      return _cb({
        'error': {
          'code': 500,
          'message': 'missing required argument',
        }
      });
    }

    let images = {};
    const san_album = sanitize(album);
    const san_thumb = sanitize(thumb);
    // make sure we have valid input
    const [ width, height ] = san_thumb.split('x');
    const san_width = parseInt(width);
    const san_height = parseInt(height);
    if (!san_album || !san_thumb || +width !== san_width || +height !== san_height) {
      return _cb({
        'error': {
          'code': 500,
          'message': 'malformed argument',
        }
      });
    }
    let files = [];
    let album_path = path.join(this.imagePath, san_album);
    try {
      files = fs.readdirSync(album_path);
    } catch(err) {
      return _cb({
        'error': {
          'code': 500,
          'message': err.message,
        }
      });
    }
    
    var itemsProcessed = 0;
    files.forEach((file) => {
      let image_path = path.join(album_path, file);
      let thumb_path = path.join(this.thumbPath, san_album, san_thumb, file);
      thumbnailSharp.getPngAndConvert(image_path, thumb_path, san_width, san_height, (err, image_buffer) => {
        itemsProcessed++;
        if (err) {
          return;
        }
        images[file] = {
          base64tag: "data:image/png;base64," + image_buffer.toString('base64'),
        };

        if (itemsProcessed >= files.length) {
          if (!images) {
            return _cb({
              'error': {
                'code': 500,
                'message': 'No Images Processed',
              }
            });
          }
          return _cb({
            'result': images,
          });
        }
      });
    });

  }

  list(album, _cb) {

    // Required arguments
    if (!album) {
      return _cb({
        'error': {
          'code': 500,
          'message': 'missing required argument',
        }
      });
    }

    let images = {};
    const san_album = sanitize(album);
    if (!san_album) {
      return _cb({
        'error': {
          'code': 500,
          'message': 'malformed argument',
        }
      });
    }
    let files = [];
    let album_path = path.join(this.imagePath, san_album);
    try {
      files = fs.readdirSync(album_path);
    } catch(err) {
      return _cb({
        'error': {
          'code': 500,
          'message': err.message,
        }
      });
    }
    
    var itemsProcessed = 0;
    files.forEach((file) => {
      let image_path = path.join(album_path, file);
      // get file ctime
      fs.stat(image_path, (err, stats) => {
        if (err) {
            itemsProcessed++;
            return;
        }
        // get file size
        sharp(image_path)
          .metadata((err, metadata) => {
            itemsProcessed++;
            if(!err) {
              let modifyDate = stats.mtime;
              let gps = false;
              if (metadata.exif) {
                const exifData = exifReader(metadata.exif);
                if (exifData) {
                  if(exifData.image.ModifyDate) {
                    modifyDate = exifData.image.ModifyDate;
                  }
                  if(exifData.gps) {
                    gps = exifData.gps;
                  }
                }
              }
              images[file] = {
                description: file,
                width: metadata.width,
                height: metadata.height,
                orientation: metadata.orientation,
                modifyDate: modifyDate,
                gps: gps,
              };
            }
            // Done - return the info
            if (itemsProcessed >= files.length) {
              if (!images) {
                return _cb({
                  'error': {
                    'code': 500,
                    'message': 'No Images Processed',
                  }
                });
              }
              return _cb({
                'result': images,
              });
            }
          });
      });
    });

  }

  albums(_cb) {
 
    let dirs = {};
    let files = [];
    try {
      files = fs.readdirSync(this.imagePath);
    } catch(err) {
      return _cb({
        'error': {
          'code': 500,
          'message': err.message,
        }
      });
    }
    files.forEach((file) => {
      if (isDirectory(path.join(this.imagePath, file))) {
        dirs[file] = {description: file};
      }
    });
    if (!dirs) {
      return _cb({
        'error': {
          'code': 500,
          'message': 'No Albums Processed',
        }
      });
    }
    return _cb({
      'result': dirs,
    });
  }

}

module.exports = imageHandler;


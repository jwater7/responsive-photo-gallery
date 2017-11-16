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
          _cb(thumb_path);
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
 
    let album_path = path.join(this.imagePath, san_album);
    fs.readdir(album_path, (err, files) => {
      if (err) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
      }
      // No files to loop on
      if (!files.length) {
        return _cb({
          'error': {
            'code': 500,
            'message': 'No Files Processed',
          }
        });
      }
      
      let images = {};
      files.forEach((file, fileIndex, fileArray) => {

        let image_path = path.join(album_path, file);
        let thumb_path = path.join(this.thumbPath, san_album, san_thumb, file);
        thumbnailSharp.getPngAndConvert(image_path, thumb_path, san_width, san_height, (err, image_buffer) => {
          if (!err) {
            images[file] = {
              base64tag: "data:image/png;base64," + image_buffer.toString('base64'),
            };
          }

          // Last loop to return
          if (fileIndex >= fileArray.length-1) {
            if (Object.keys(images).length === 0) {
              return _cb({
                'error': {
                  'code': 500,
                  'message': 'No Images Processed',
                }
              });
            }
            _cb({
              'result': images,
            });
          }
        });
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
    let album_path = path.join(this.imagePath, san_album);
    fs.readdir(album_path, (err, files) => {
      if (err) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
      }
      // No files to loop on
      if (!files.length) {
        return _cb({
          'error': {
            'code': 500,
            'message': 'No Files Processed',
          }
        });
      }

      files.forEach((file, fileIndex, fileArray) => {
        let image_path = path.join(album_path, file);

        fs.stat(image_path, (err, stats) => {
          // Best guess mtime
          // TODO default value
          let modifyDate;
          if (!err) {
              let modifyDate = stats.mtime;
          }

          // get file size
          sharp(image_path)
            .metadata((err, metadata) => {
              if(!err) {
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

              // Last loop to return
              if (fileIndex >= fileArray.length-1) {
                if (Object.keys(images).length === 0) {
                  return _cb({
                    'error': {
                      'code': 500,
                      'message': 'No Images Processed',
                    }
                  });
                }
                _cb({
                  'result': images,
                });
              }

            });
        });
      });
    });

  }

  albums(_cb) {
 
    fs.readdir(this.imagePath, (err, files) => {
      if (err) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
      }
      // No files to loop on
      if (!files.length) {
        return _cb({
          'error': {
            'code': 500,
            'message': 'No Albums Processed',
          }
        });
      }

      let dirs = {};
      files.forEach((file, fileIndex, fileArray) => {
        if (isDirectory(path.join(this.imagePath, file))) {
          dirs[file] = {description: file};
        }
        // Last loop to return
        if (fileIndex >= fileArray.length-1) {
          _cb({
            'result': dirs,
          });
        }
      });
    });
  }
}

module.exports = imageHandler;


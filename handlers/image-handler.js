// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');
/* 
// Alternative to sanitize
const sanitizeToRoot = (rootDir, subDir) => {
  var s = path.resolve(path.join(path.resolve(rootDir), path.normalize(subDir)));
  if (s.startsWith(path.resolve(rootDir))) {
    return s;
  }
  return '';
}
*/

const thumbnailSharp = require('../thumbnail-sharp/index');

const getThumbBuffer = (image_path, thumb_path, thumb, _cb) => {

  const [ width, height ] = thumb.split('x');

  // make sure we have valid input
  const san_width = parseInt(width);
  const san_height = parseInt(height);
  if (+width !== san_width || +height !== san_height) {
    return _cb(new Error('Invalid Dimensions'), undefined, undefined);
  }

  return thumbnailSharp.cacheThumbAndGetBuffer(image_path, thumb_path, san_width, san_height, (err, thumb_buffer, thumb_content_type) => {
    if (err) {
      return _cb(err, undefined, undefined);
    }

    return _cb(undefined, thumb_buffer, thumb_content_type);
  });

}

const getImageBuffer = (image_path, _cb) => {

  return thumbnailSharp.getNormalizedImageBuffer(image_path, (err, image_buffer, image_content_type) => {
    if (err) {
      return _cb(err, undefined, undefined);
    }

    return _cb(undefined, image_buffer, image_content_type);
  });

}

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
      }, undefined, undefined);
    }

    const san_album = sanitize(album);
    const san_image = sanitize(image);
    if (!san_album || !san_image) {
      return _cb({
        'error': {
          'code': 500,
          'message': 'malformed argument',
        }
      }, undefined, undefined);
    }

    const image_path = path.join(this.imagePath, san_album, san_image);

    // If they want a thumbnail, generate, cache, and return it instead
    if (thumb) {
      const san_thumb = sanitize(thumb);
      const thumb_path = path.join(this.thumbPath, san_album, san_thumb, san_image);
      return getThumbBuffer(image_path, thumb_path, san_thumb, (err, thumb_buffer, thumb_content_type) => {
        if (err) {
          // return the original image if there is an error
          return getImageBuffer(image_path, (err, image_buffer, image_content_type) => {
            if (err) {
              return _cb({
                'error': {
                  'code': 500,
                  'message': 'Unable to get image',
                }
              }, undefined, undefined);
            }
            return _cb(undefined, image_buffer, image_content_type);
          });
        }
        return _cb(undefined, thumb_buffer, thumb_content_type);
      });
    }

    return getImageBuffer(image_path, (err, image_buffer, image_content_type) => {
      if (err) {
        return _cb({
          'error': {
            'code': 500,
            'message': 'Unable to get image',
          }
        }, undefined, undefined);
      }
      return _cb(undefined, image_buffer, image_content_type);
    });

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
      let done = 0;
      for (let i = 0; i < files.length; i++) {
        let file = files[i];

        let image_path = path.join(album_path, file);
        let thumb_path = path.join(this.thumbPath, san_album, san_thumb, file);
        thumbnailSharp.cacheThumbAndGetBuffer(image_path, thumb_path, san_width, san_height, (err, image_buffer, image_content_type) => {
          if (!err) {
            images[file] = {
              // TODO: these are not necessarily png files
              base64tag: "data:" + image_content_type + ";base64," + image_buffer.toString('base64'),
            };
          }

          // Increment processing counter
          done++;

          // Last loop to return
          if (done >= files.length) {
            if (Object.keys(images).length === 0) {
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
      }
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

      let done = 0;
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        let image_path = path.join(album_path, file);

        thumbnailSharp.getImageMetadata(image_path, (err, image_metadata) => {
          if(!err) {
            // TODO description
            image_metadata['description'] = file;
            images[file] = image_metadata;
          }

          // Increment processing counter
          done++;

          // Last loop to return
          if (done >= files.length) {
            if (Object.keys(images).length === 0) {
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
      }
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
      let done = 0;
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        if (fs.statSync(path.join(this.imagePath, file)).isDirectory()) {
          dirs[file] = {description: file};
        }
      }

      return _cb({
        'result': dirs,
      });

    });
  }
}

module.exports = imageHandler;


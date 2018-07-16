// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');

const imageProcessing = require('fast-image-processing');

// Alternative to sanitize for paths
const sanitizeToRoot = (rootDir, subDir) => {
  var s = path.resolve(path.join(path.resolve(rootDir), path.normalize(subDir)));
  if (s.startsWith(path.resolve(rootDir))) {
    return s;
  }
  return '';
}

const walkDir = (basedir, dir = '.', filelist = []) => {
  let files = fs.readdirSync(path.join(basedir, dir));
  files.forEach((file) => {
    try {
      let stat = fs.statSync(path.join(basedir, dir, file));
      if (stat.isDirectory()) {
        filelist = walkDir(basedir, path.join(dir, file), filelist);
      } else {
        filelist.push(path.join(dir, file));
      }
    } catch(e) {
      //ignore failed stat, not a directory or file, probably failed symlink
    }
  });
  return filelist;
}

const getThumbBuffer = (image_path, thumb_path, thumb, _cb) => {

  const [ width, height ] = thumb.split('x');

  // make sure we have valid input
  const san_width = parseInt(width);
  const san_height = parseInt(height);
  if (+width !== san_width || +height !== san_height) {
    return _cb(new Error('Invalid Dimensions'), undefined, undefined);
  }

  return imageProcessing.cacheThumbAndGetBuffer(image_path, thumb_path, san_width, san_height, (err, thumb_buffer, thumb_content_type) => {
    if (err) {
      return _cb(err, undefined, undefined);
    }

    return _cb(undefined, thumb_buffer, thumb_content_type);
  });

}

const getImageBuffer = (image_path, _cb) => {

  return imageProcessing.getNormalizedImageBuffer(image_path, (err, image_buffer, image_content_type) => {
    if (err) {
      return _cb(err, undefined, undefined);
    }

    return _cb(undefined, image_buffer, image_content_type);
  });

}

const sanitizeRequiredArguments = (args, _cb) => {

  var san_args = [];
  for (let i = 0; i < args.length; i++) {
    // Required arguments
    if (!args[i]) {
      return _cb(new Error('missing required argument'), undefined);
    }
    const san_arg = sanitize(args[i]);
    if (!san_arg) {
      return _cb(new Error('malformed argument'), undefined);
    }
    san_args.push(san_arg);
  }

  return _cb(undefined, san_args);
}

class imageHandler {
  constructor(imagePath, thumbPath=false) {
    this.imagePath = imagePath;
    this.thumbPath = thumbPath;
  }

  image(album, image, thumb, _cb) {

    sanitizeRequiredArguments([album], (err, args) => {
      if (err || !args) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        }, undefined, undefined);
      }
      const [album] = args;

      const image_path = sanitizeToRoot(this.imagePath, path.join(album, image));

      // If they want a thumbnail, generate, cache, and return it instead
      if (thumb) {
        const san_thumb = sanitize(thumb);
        let thumb_path = sanitizeToRoot(this.thumbPath, path.join(album, thumb, image));
        // TODO find a better way to do this rather than using extension
        if (path.extname(image).toLowerCase() == '.mov') {
          thumb_path = sanitizeToRoot(this.thumbPath, path.join(album, 'video', thumb, image));
        }
        return getThumbBuffer(image_path, thumb_path, san_thumb, (err, thumb_buffer, thumb_content_type) => {
          if (err) {
            // return the original image if there is an error
            return getImageBuffer(image_path, (err, image_buffer, image_content_type) => {
              if (err) {
                return _cb({
                  'error': {
                    'code': 500,
                    'message': 'Unable to get backup image',
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
    });

  }

  video(album, image, _cb) {

    sanitizeRequiredArguments([album], (err, args) => {
      if (err || !args) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        }, undefined, undefined);
      }
      const [album] = args;

      const vid_path = sanitizeToRoot(this.imagePath, path.join(album, image));

      return _cb(undefined, vid_path);
    });

  }

  thumbnails(album, thumb, _cb) {

    sanitizeRequiredArguments([album, thumb], (err, args) => {
      if (err || !args) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
      }
      const [album, thumb] = args;

      // make sure we have valid input
      const [ width, height ] = thumb.split('x');
      const san_width = parseInt(width);
      const san_height = parseInt(height);
      if (+width !== san_width || +height !== san_height) {
        return _cb({
          'error': {
            'code': 500,
            'message': 'malformed argument',
          }
        });
      }

      let album_path = path.join(this.imagePath, album);
      let files = walkDir(album_path);
 
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
        let thumb_path = path.join(this.thumbPath, album, thumb, file);
        if (path.extname(file).toLowerCase() == '.mov') {
          thumb_path = sanitizeToRoot(this.thumbPath, path.join(album, 'video', thumb, file));
        }
        imageProcessing.cacheThumbAndGetBuffer(image_path, thumb_path, san_width, san_height, (err, image_buffer, image_content_type) => {
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

    sanitizeRequiredArguments([album], (err, args) => {
      if (err || !args) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
      }
      const [album] = args;

      let album_path = path.join(this.imagePath, album);
      let files = walkDir(album_path);

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

        imageProcessing.getMetadata(image_path, (err, image_metadata) => {
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
      for (let i = 0; i < files.length; i++) {
        try {
          let file = files[i];
          if (fs.statSync(path.join(this.imagePath, file)).isDirectory()) {
            dirs[file] = {description: file};
          }
        } catch(e) {
          //ignore failed stat, not a directory or file, probably failed symlink
        }
      }

      return _cb({
        'result': dirs,
      });

    });
  }
}

module.exports = imageHandler;


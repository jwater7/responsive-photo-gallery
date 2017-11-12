'use strict'

const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');

const isDirectory = source => fs.lstatSync(source).isDirectory()

//const getDirectories = source => fs.readdirSync(source).map(name => path.join(source, name)).filter(isDirectory)

class imageHandler {
  constructor(imagePath) {
    this.imagePath = imagePath;
  }

  image(album, image) {
    let san_album = sanitize(album);
    let san_image = sanitize(image);
    let ip = this.imagePath;
    return path.join(ip, san_album, san_image);
  }

  list(album, _cb) {
 
    let images = {};
    let ip = this.imagePath;
    let san_album = sanitize(album);
    if (!san_album) {
      _cb({
        'error': {
          'code': 500,
          'message': 'album argument required',
        }
      });
      return;
    }
    let files = [];
    try {
      files = fs.readdirSync(path.join(ip, san_album));
    } catch(err) {
      _cb({
        'error': {
          'code': 500,
          'message': err.message,
        }
      });
      return;
    }
    
    files.forEach(function(file) {
      images[file] = {description: file};
    });
    if (!images) {
      _cb({
        'error': {
          'code': 500,
          'message': err.message,
        }
      });
      return;
    }
    _cb({
      'result': images,
    });

  }

  albums(_cb) {
 
    let dirs = {};
    let ip = this.imagePath;
    let files = fs.readdirSync(ip);
    files.forEach(function(file) {
      if (isDirectory(path.join(ip, file))) {
        dirs[file] = {description: file};
      }
    });
    if (!dirs) {
      _cb({
        'error': {
          'code': 500,
          'message': err.message,
        }
      });
      return;
    }
    _cb({
      'result': dirs,
    });
  }

}

module.exports = imageHandler;


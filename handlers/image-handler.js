'use strict'

var fs = require('fs');

class imageHandler {
  constructor(imagePath) {
    this.imagePath = imagePath;
  }

  list(_cb) {
    fs.readdir(this.imagePath, (err, files) => {
      if (err) {
        _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
        return;
      }
      _cb({
        'result': files,
      });
    });
  }

}

module.exports = imageHandler;


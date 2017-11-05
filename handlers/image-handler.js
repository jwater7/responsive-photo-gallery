'use strict'

var fs = require('fs');

class imageHandler {
  constructor(imagePath) {
    this.imagePath = imagePath;
  }

  list(_cb) {
    fs.readdir(this.imagePath, (err, files) => {
      if (err) {
        // TODO debug only errors
        console.log(err);
        _cb({
          'result': null,
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
        return;
      }
      _cb({'result': files, 'error': null});
    });
  }

}

module.exports = imageHandler;


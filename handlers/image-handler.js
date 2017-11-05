'use strict'

var fs = require('fs');

class imageHandler {
  constructor(imagePath) {
    this.imagePath = imagePath;
  }

  list(_cb) {
    //_cb({'result': null, 'error': 'NOTIMPLEMENTED'});
    fs.readdir(this.imagePath, (err, files) => {
      if (err) {
        console.log(err);
      }
      //for (var i = 0, len = files.length; i < len; i++) {
       _cb({'result': files, 'error': null});
      //}
    });
  }

}

module.exports = imageHandler;


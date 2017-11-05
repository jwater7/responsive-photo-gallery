'use strict'

class imageHandler {
  constructor(imagePath) {
    this.imagePath = imagePath
  }

  list(_cb) {
    //_cb({'result': null, 'error': 'NOTIMPLEMENTED'})
    _cb({'result': 'TODO', 'error': null})
  }

}

module.exports = imageHandler


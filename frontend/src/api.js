// vim: tabstop=2 shiftwidth=2 expandtab
//

// TODO pass in
var base_prefix = '/';
if (process.env.PUBLIC_URL) {
  base_prefix = process.env.PUBLIC_URL;
  if (base_prefix.substr(-1) !== '/') {
    base_prefix += '/';
  }
}
if (process.env.REACT_APP_BASENAME) {
  base_prefix = process.env.REACT_APP_BASENAME;
  if (base_prefix.substr(-1) !== '/') {
    base_prefix += '/';
  }
}
var api_prefix = base_prefix || '';
if (process.env.REACT_APP_API_PREFIX) {
  api_prefix = process.env.REACT_APP_API_PREFIX;
  if (api_prefix.substr(-1) !== '/') {
    api_prefix += '/';
  }
}
api_prefix += 'api/v1';

const API = {

  login: (_cb, opts) => {
    fetch(api_prefix + '/login', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      //credentials: 'include',
      body: JSON.stringify(opts),
    })
      .then(res => res.json())
      .then(jsonData => {
        if (jsonData.error) {
          console.log('LIST ERROR: (' + jsonData.error.code + ') ' + jsonData.error.message);
          return;
        }
        _cb(jsonData.result);
      })
      // TODO debug log
      .catch(error => console.log('FETCH ERROR: ' + error.message));
  },

  logout: (_cb, opts) => {
    fetch(api_prefix + '/logout', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(opts),
    })
      .then(res => res.json())
      .then(jsonData => {
        if (jsonData.error) {
          console.log('LIST ERROR: (' + jsonData.error.code + ') ' + jsonData.error.message);
          return;
        }
        _cb(jsonData.result === opts.token);
      })
      // TODO debug log
      .catch(error => console.log('FETCH ERROR: ' + error.message));
  },

  albums: (_cb, opts) => {
    fetch(api_prefix + '/albums?token=' + opts.token)
      .then(res => res.json())
      .then(jsonData => {
        if (jsonData.error) {
          console.log('LIST ERROR: (' + jsonData.error.code + ') ' + jsonData.error.message);
          return;
        }
        _cb(jsonData.result);
      })
      // TODO debug log
      .catch(error => console.log('FETCH ERROR: ' + error.message));
  },

  list: (_cb, opts) => {
    //fetch(api_prefix + '/list', {
    //  headers: {
    //    'X-API-Key': opts.token,
    //  },
    //})
    const max_list_items = opts.max_list_items ? opts.max_list_items : '';
    fetch(api_prefix + '/list?token=' + opts.token + '&album=' + opts.album + '&num_results=' + max_list_items + '&distributed=true')
      .then(res => res.json())
      .then(jsonData => {
        if (jsonData.error) {
          console.log('LIST ERROR: (' + jsonData.error.code + ') ' + jsonData.error.message);
          return;
        }
        _cb(jsonData.result);
      })
      // TODO debug log
      .catch(error => console.log('FETCH ERROR: ' + error.message));
  },

  thumbnails: (_cb, opts) => {
    const max_list_items = opts.max_list_items ? opts.max_list_items : '';
    fetch(api_prefix + '/thumbnails?token=' + opts.token + '&album=' + opts.album + '&thumb=' + opts.thumb + '&num_results=' + max_list_items + '&distributed=true')
      .then(res => res.json())
      .then(jsonData => {
        if (jsonData.error) {
          console.log('LIST ERROR: (' + jsonData.error.code + ') ' + jsonData.error.message);
          return;
        }
        _cb(jsonData.result);
      })
      // TODO debug log
      .catch(error => console.log('FETCH ERROR: ' + error.message));
  },

  imageurl: (opts) => {
    if (!opts.album || !opts.image || !opts.token) {
      return false;
    }
    let iurl = api_prefix + '/image?token=' + opts.token + '&album=' + opts.album + '&image=' + opts.image;
    if (opts.thumb) {
      iurl += '&thumb=' + opts.thumb;
    }
    return iurl;
  },

  videourl: (opts) => {
    if (!opts.album || !opts.image || !opts.token) {
      return false;
    }
    //TODO let iurl = api_prefix + '/video?token=' + opts.token + '&album=' + opts.album + '&image=' + opts.image;
    let iurl = api_prefix + '/video?token=' + opts.token + '&album=' + opts.album + '&image=' + opts.image;
    if (opts.thumb) {
      iurl += '&thumb=' + opts.thumb;
    }
    return iurl;
  },

  appendThumbnail: (url, opts) => {
    if (!opts.size) {
      return false;
    }
    return(url + '&thumb=' + opts.size);
  },

}

export default API;



// TODO pass in
var api_prefix = '';
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

  logout: (_cb) => {
    _cb(false);
  },

  list: (_cb, opts) => {
    //fetch(api_prefix + '/list', {
    //  headers: {
    //    'X-API-Key': opts.token,
    //  },
    //})
    fetch(api_prefix + '/list?token=' + opts.token)
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

}

export default API;


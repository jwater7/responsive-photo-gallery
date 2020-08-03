// vim: tabstop=2 shiftwidth=2 expandtab
//

import qs from 'query-string';

// Alternative to URLSearchParams for browsers that don't support it
export const getParams = (query) => {
  if (!query) {
    return {};
  }

  return (/^[?#]/.test(query) ? query.slice(1) : query)
    .split('&')
    .reduce((params, param) => {
      let [key, value] = param.split('=');
      params[key] = value ? decodeURIComponent(value.replace(/\+/g, ' ')) : '';
      return params;
    }, {});
};

export const getURLParams = (locsearch, ps = {}) => {
  // find the index
  if (!locsearch) {
    return {};
  }

  //const params = new URLSearchParams(props.location.search);
  const params = qs.parse(locsearch);
  return Object.keys(ps).reduce(
    (acc, p) => ({
      ...acc,
      [p]: params[p] || ps[p],
    }),
    {}
  );
};

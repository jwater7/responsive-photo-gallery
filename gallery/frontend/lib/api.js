// vim: tabstop=2 shiftwidth=2 expandtab
//

// TODO pass in
let base_prefix = '/';
if (process.env.PUBLIC_URL) {
  base_prefix = process.env.PUBLIC_URL;
  if (base_prefix.substr(-1) !== '/') {
    base_prefix += '/';
  }
}
if (process.env.NEXT_PUBLIC_BASENAME) {
  base_prefix = process.env.NEXT_PUBLIC_BASENAME;
  if (base_prefix.substr(-1) !== '/') {
    base_prefix += '/';
  }
}
let api_prefix = base_prefix || '';
if (process.env.NEXT_PUBLIC_API_PREFIX) {
  api_prefix = process.env.NEXT_PUBLIC_API_PREFIX;
  if (process.env.NEXT_PUBLIC_API_PREFIX_OVERRIDE) {
    api_prefix = process.env.NEXT_PUBLIC_API_PREFIX_OVERRIDE;
  }
  if (api_prefix.substr(-1) !== '/') {
    api_prefix += '/';
  }
}
api_prefix += 'api/v1';

export const login = async (opts) => {
  try {
    const res = await fetch(api_prefix + '/login', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      //credentials: 'include',
      body: JSON.stringify({
        cookie_path: base_prefix,
        cookie_max_age_sec: 60 * 60 * 24 * 365,
        ...opts,
      }),
    })
    const jsonData = await res.json()
    if (jsonData.error) {
      console.log(
        'LOGIN ERROR: (' +
        jsonData.error.code +
        ') ' +
        jsonData.error.message
      );
      throw new Error(jsonData.error.message);
    }
    return jsonData.result;
  } catch (err) {
    // TODO debug log
    console.log('FETCH ERROR: ' + err.message);
    // TODO custom error
    throw new Error(err.message, { cause: err })
  }
}

// Auth heartbeat + enrichment feature flags in one request. Returns
// { loggedIn, features, degraded }. Feature flags ride along so the client
// bootstraps in a single call (see data/use-ping.js).
export const ping = async (opts) => {
  // Only a *definitive* auth rejection (the JWT gate's 401/403) counts as
  // "logged out". Every other failure — network blip, 5xx, proxy hiccup during a
  // cold boot — is *unknown*, not a logout, so we throw and let SWR keep the last
  // known state and retry. Conflating the two used to bounce a still-logged-in
  // user to the home page on a hard reload (TODO Bugfix #1).
  let res
  try {
    res = await fetch(api_prefix + '/ping')
  } catch (err) {
    console.log('FETCH ERROR: ' + err.message)
    throw err
  }
  if (res.status === 401 || res.status === 403) {
    return { loggedIn: false }
  }
  if (!res.ok) {
    throw new Error('ping failed: ' + res.status)
  }
  const jsonData = await res.json().catch(() => null)
  if (!jsonData || jsonData.error) {
    throw new Error('ping returned a malformed response')
  }
  return {
    loggedIn: true,
    features: jsonData.features,
    degraded: jsonData.degraded,
  }
}

export const logout = async (opts) => {
  try {
    const res = await fetch(api_prefix + '/logout', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cookie_path: base_prefix,
        cookie_max_age_sec: 60 * 60 * 24 * 365,
        ...opts,
      }),
    })
    if (!res?.ok) {
      throw new Error(res.statusText)
    }
    const jsonData = await res.json()

    if (jsonData.error) {
      console.log(
        'LOGOUT ERROR: (' +
        jsonData.error.code +
        ') ' +
        jsonData.error.message
      );
      throw new Error(jsonData.error.message);
    }
    return !!jsonData;
  } catch (err) {
    console.log('FETCH ERROR: ' + err.message);
    // TODO custom error
    throw new Error(err.message, { cause: err })
  }
}

export const albums = async () => {
  // TODO fetch(api_prefix + '/albums?token=' + opts.token)
  try {
    const res = await fetch(api_prefix + '/albums')
    if (!res?.ok) {
      throw new Error(res.statusText)
    }
    const jsonData = await res.json()
    if (jsonData.error) {
      console.log(
        'ALBUMS ERROR: (' +
        jsonData.error.code +
        ') ' +
        jsonData.error.message
      );
      throw new Error(jsonData.error.message);
    }
    return jsonData?.result
  } catch (err) {
    console.log('FETCH ERROR: ' + err.message);
    // TODO custom error
    throw new Error(err.message, { cause: err })
  }
}

export const list = async (opts) => {
  //fetch(api_prefix + '/list', {
  //  headers: {
  //    'X-API-Key': opts.token,
  //  },
  //})
  const max_list_items = opts.max_list_items ? opts.max_list_items : '';
  // TODO fetch(api_prefix + '/list?token=' + opts.token + '&album=' + opts.album + '&num_results=' + max_list_items + '&distributed=true')
  try {
    const res = await fetch(
      api_prefix +
      '/list?album=' +
      encodeURIComponent(opts.album) +
      '&num_results=' +
      max_list_items +
      '&distributed=true&withMetadata=' +
      JSON.stringify({ tags: ['favorite'] })
    )
    if (!res?.ok) {
      throw new Error(res.statusText)
    }
    const jsonData = await res.json()
    if (jsonData.error) {
      console.log(
        'LIST ERROR: (' +
        jsonData.error.code +
        ') ' +
        jsonData.error.message
      );
      throw new Error(jsonData.error.message);
    }
    return jsonData?.result
  } catch (err) {
    console.log('FETCH ERROR: ' + err.message);
    // TODO custom error
    throw new Error(err.message, { cause: err })
  }
}

export const thumbnails = async opts => {
  const max_list_items = opts.max_list_items ? opts.max_list_items : '';
  // TODO fetch(api_prefix + '/thumbnails?token=' + opts.token + '&album=' + opts.album + '&thumb=' + opts.thumb + '&num_results=' + max_list_items + '&distributed=true')
  try {
    const res = await fetch(
      api_prefix +
      '/thumbnails?album=' +
      encodeURIComponent(opts.album) +
      '&thumb=' +
      opts.thumb +
      '&num_results=' +
      max_list_items +
      '&distributed=true'
    )
    if (!res?.ok) {
      throw new Error(res.statusText)
    }
    const jsonData = await res.json()
    if (jsonData.error) {
      console.log(
        'THUMBNAILS ERROR: (' +
        jsonData.error.code +
        ') ' +
        jsonData.error.message
      );
      throw new Error(jsonData.error.message);
    }
    return jsonData?.result
  } catch (err) {
    console.log('FETCH ERROR: ' + err.message);
    // TODO custom error
    throw new Error(err.message, { cause: err })
  }
}

export const tag = async (opts) => {
  try {
    const res = await fetch(api_prefix + '/image-data', {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      //credentials: 'include',
      body: JSON.stringify({
        ...opts,
      }),
    });
    const jsonData = await res.json();
    if (jsonData.error) {
      console.log(
        'UPDATE PAGE ERROR: (' +
        jsonData.error.code +
        ') ' +
        jsonData.error.message
      );
      return null;
    }
    return jsonData.result;
  } catch (err) {
    console.log('FETCH ERROR: ' + err.message);
  }
}

export const imageurl = (opts) => {
  if (!opts.album || !opts.image) {
    return false;
  }
  // TODO let iurl = api_prefix + '/image?token=' + opts.token + '&album=' + opts.album + '&image=' + opts.image;
  let iurl =
    api_prefix + '/image?album=' + encodeURIComponent(opts.album) + '&image=' + encodeURIComponent(opts.image);
  if (opts.thumb) {
    iurl += '&thumb=' + encodeURIComponent(opts.thumb);
  }
  return iurl;
}

export const videourl = (opts) => {
  if (!opts.album || !opts.image) {
    return false;
  }
  //TODO let iurl = api_prefix + '/video?token=' + opts.token + '&album=' + opts.album + '&image=' + opts.image;
  // TODO let iurl = api_prefix + '/video?token=' + opts.token + '&album=' + opts.album + '&image=' + opts.image;
  let iurl =
    api_prefix + '/video?album=' + encodeURIComponent(opts.album) + '&image=' + encodeURIComponent(opts.image);
  if (opts.thumb) {
    iurl += '&thumb=' + encodeURIComponent(opts.thumb);
  }
  return iurl;
}

export const appendThumbnail = (url, opts) => {
  if (!opts.size) {
    return false;
  }
  return url + '&thumb=' + opts.size;
}

// --- Album build cache (sprite sheets / collage cover / manifest) -----------

// Cap how many album-manifest / album-status requests are in flight at once.
// The home page mounts one element per album and each fetches its manifest, so a
// cold library would otherwise ask the API to start hundreds of full-album
// builds simultaneously. A small global queue smooths that into a steady
// trickle (cold builds happen a few at a time; warm loads are fast anyway).
const ALBUM_FETCH_CONCURRENCY = 4
let albumActive = 0
const albumQueue = []
const pumpAlbumQueue = () => {
  while (albumActive < ALBUM_FETCH_CONCURRENCY && albumQueue.length) {
    const job = albumQueue.shift()
    albumActive++
    job().finally(() => {
      albumActive--
      pumpAlbumQueue()
    })
  }
}
const limitAlbum = (fn) =>
  new Promise((resolve, reject) => {
    albumQueue.push(() => fn().then(resolve, reject))
    pumpAlbumQueue()
  })

// Fetch the album manifest. Returns { manifest } when ready, or
// { building: true, ...status } when the album is cold/stale (202).
export const albumManifest = (album) =>
  limitAlbum(async () => {
    const res = await fetch(
      api_prefix + '/album-manifest?album=' + encodeURIComponent(album)
    )
    const jsonData = await res.json().catch(() => ({}))
    if (res.status === 202) {
      return { building: true, ...(jsonData.result || {}) }
    }
    if (!res.ok || jsonData.error) {
      throw new Error(jsonData?.error?.message || res.statusText)
    }
    return { manifest: jsonData.result }
  })

// Build progress: { state, done, total, sheetsReady }.
export const albumStatus = (album) =>
  limitAlbum(async () => {
    const res = await fetch(
      api_prefix + '/album-status?album=' + encodeURIComponent(album)
    )
    const jsonData = await res.json().catch(() => ({}))
    return jsonData.result || { state: 'unknown' }
  })

// In-progress album builds for the admin dashboard: { building: [...],
// activeBuilds, queuedBuilds, concurrency }. A standalone admin poll — not
// gated by the per-album build pipeline above.
export const albumActivity = async () => {
  const res = await fetch(api_prefix + '/album-activity')
  const jsonData = await res.json().catch(() => ({}))
  return (
    jsonData.result || {
      building: [],
      activeBuilds: 0,
      queuedBuilds: 0,
      concurrency: 0,
    }
  )
}

// Image names carrying a tag (default "favorite") in an album.
export const albumTags = async (album, tag = 'favorite') => {
  const res = await fetch(
    api_prefix +
      '/album-tags?album=' +
      encodeURIComponent(album) +
      '&tag=' +
      encodeURIComponent(tag)
  )
  const jsonData = await res.json().catch(() => ({}))
  return jsonData.result || []
}

// `v` is an optional cache-buster (e.g. the manifest albumHash) so long-cached
// artifacts refresh when an album rebuilds.
export const albumCoverUrl = (album, v) =>
  api_prefix +
  '/album-cover?album=' +
  encodeURIComponent(album) +
  (v ? '&v=' + encodeURIComponent(v) : '')

export const albumSpriteUrl = (album, sheet, v) =>
  api_prefix +
  '/album-sprite?album=' +
  encodeURIComponent(album) +
  '&sheet=' +
  encodeURIComponent(sheet) +
  (v ? '&v=' + encodeURIComponent(v) : '')

// Admin: the directory exclude list (POSIX paths relative to IMAGE_PATH). A
// top-level entry hides a whole album; a nested entry hides a subtree from the
// build + enrichment walks. Core /api/v1 route (not the enrich proxy).
export const getExcludes = async () => {
  const res = await fetch(api_prefix + '/excludes')
  if (!res.ok) throw new Error('excludes fetch failed')
  const json = await res.json()
  return json.excludes || []
}

// Replace the exclude list. Server normalizes, reaps newly-excluded albums'
// build cache, and fires a background enrichment reap; returns the normalized
// list. Non-blocking server-side.
export const setExcludes = async (excludes) => {
  const res = await fetch(api_prefix + '/excludes', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ excludes }),
  })
  if (!res.ok) throw new Error('excludes update failed')
  const json = await res.json()
  return json.excludes || []
}

// --- User management (admin) ------------------------------------------------
// All behind the same /api/v1 auth gate. Errors surface the server message so
// the admin UI can show "user exists", "no such user", etc.

const userError = async (res, fallback) => {
  const json = await res.json().catch(() => ({}))
  throw new Error(json?.error?.message || fallback)
}

export const listUsers = async () => {
  const res = await fetch(api_prefix + '/users')
  if (!res.ok) await userError(res, 'could not load users')
  const json = await res.json()
  return json.result || []
}

export const createUser = async (username, password) => {
  const res = await fetch(api_prefix + '/users', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) await userError(res, 'could not create user')
  return (await res.json()).result
}

export const setUserPassword = async (username, password) => {
  const res = await fetch(
    api_prefix + '/users/' + encodeURIComponent(username) + '/password',
    {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    }
  )
  if (!res.ok) await userError(res, 'could not set password')
  return (await res.json()).result
}

export const deleteUser = async (username) => {
  const res = await fetch(
    api_prefix + '/users/' + encodeURIComponent(username),
    { method: 'DELETE' }
  )
  if (!res.ok) await userError(res, 'could not delete user')
  return (await res.json()).result
}

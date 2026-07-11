// vim: tabstop=2 shiftwidth=2 expandtab
//
// Gallery API client. Prefix derivation + fetch/error plumbing live in
// lib/api-base.js (shared with lib/enrich-api.js); helpers here are thin
// wrappers that keep their public contracts (names, args, return shapes).

import { BASE_PREFIX, API_PREFIX, apiFetch, apiRequest, qs } from './api-base'

// login/logout set + clear the JWT cookie for the whole base path, long-lived
// so the cookie outlives the browser session (the JWT inside carries its own
// expiry).
const cookieOpts = {
  cookie_path: BASE_PREFIX,
  cookie_max_age_sec: 60 * 60 * 24 * 365,
}

export const login = async (opts) => {
  const json = await apiFetch(
    API_PREFIX + '/login',
    { method: 'POST', body: { ...cookieOpts, ...opts } },
    'login failed'
  )
  return json.result
}

// Auth heartbeat + enrichment feature flags in one request. Returns
// { loggedIn, features, degraded }. Feature flags ride along so the client
// bootstraps in a single call (see data/use-ping.js).
export const ping = async () => {
  // Only a *definitive* auth rejection (the JWT gate's 401/403) counts as
  // "logged out". Every other failure — network blip, 5xx, proxy hiccup during a
  // cold boot — is *unknown*, not a logout, so we throw and let SWR keep the last
  // known state and retry. Conflating the two used to bounce a still-logged-in
  // user to the home page on a hard reload (TODO Bugfix #1).
  const { status, ok, json } = await apiRequest(API_PREFIX + '/ping')
  if (status === 401 || status === 403) {
    return { loggedIn: false }
  }
  if (!ok) {
    throw new Error('ping failed: ' + status)
  }
  if (!json || json.error) {
    throw new Error('ping returned a malformed response')
  }
  return {
    loggedIn: true,
    features: json.features,
    degraded: json.degraded,
  }
}

export const logout = async (opts) => {
  const json = await apiFetch(
    API_PREFIX + '/logout',
    { method: 'POST', body: { ...cookieOpts, ...opts } },
    'logout failed'
  )
  return !!json
}

export const albums = async () => {
  const json = await apiFetch(API_PREFIX + '/albums', {}, 'albums failed')
  return json.result
}

// Replace an image's tag set. Returns null (never throws) on any failure —
// the useFavorites hooks key their optimistic-update REVERT off that null.
export const tag = async (opts) => {
  try {
    const json = await apiFetch(
      API_PREFIX + '/image-data',
      { method: 'PATCH', body: { ...opts } },
      'image-data update failed'
    )
    return json.result
  } catch (err) {
    return null
  }
}

export const imageurl = (opts) => {
  if (!opts.album || !opts.image) {
    return false
  }
  let iurl =
    API_PREFIX + '/image?' + qs({ album: opts.album, image: opts.image })
  if (opts.thumb) {
    iurl += '&thumb=' + encodeURIComponent(opts.thumb)
  }
  return iurl
}

export const videourl = (opts) => {
  if (!opts.album || !opts.image) {
    return false
  }
  let iurl =
    API_PREFIX + '/video?' + qs({ album: opts.album, image: opts.image })
  if (opts.thumb) {
    iurl += '&thumb=' + encodeURIComponent(opts.thumb)
  }
  return iurl
}

// --- Album build cache (sprite sheets / collage cover / manifest) -----------

// Cap how many album-manifest requests are in flight at once. The home page
// mounts one element per album and each fetches its manifest, so a cold
// library would otherwise ask the API to start hundreds of full-album builds
// simultaneously. A small global queue smooths that into a steady trickle
// (cold builds happen a few at a time; warm loads are fast anyway).
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
    const { status, ok, json } = await apiRequest(
      API_PREFIX + '/album-manifest?' + qs({ album })
    )
    if (status === 202) {
      return { building: true, ...((json && json.result) || {}) }
    }
    if (!ok || !json || json.error) {
      throw new Error(
        (json && json.error && json.error.message) ||
          'album-manifest failed (HTTP ' + status + ')'
      )
    }
    return { manifest: json.result }
  })

// In-progress album builds for the admin dashboard: { building: [...],
// activeBuilds, queuedBuilds, concurrency }. A standalone admin poll — never
// throws; a failed poll just reports an idle default.
export const albumActivity = async () => {
  const { json } = await apiRequest(API_PREFIX + '/album-activity')
  return (
    (json && json.result) || {
      building: [],
      activeBuilds: 0,
      queuedBuilds: 0,
      concurrency: 0,
    }
  )
}

// Image names carrying a tag (default "favorite") in an album. Never throws;
// no tags directory just means no favorites.
export const albumTags = async (album, tag = 'favorite') => {
  const { json } = await apiRequest(API_PREFIX + '/album-tags?' + qs({ album, tag }))
  return (json && json.result) || []
}

// `v` is an optional cache-buster (e.g. the manifest albumHash) so long-cached
// artifacts refresh when an album rebuilds.
export const albumCoverUrl = (album, v) =>
  API_PREFIX + '/album-cover?' + qs({ album, ...(v ? { v } : {}) })

export const albumSpriteUrl = (album, sheet, v) =>
  API_PREFIX + '/album-sprite?' + qs({ album, sheet, ...(v ? { v } : {}) })

// Admin: the directory exclude list (POSIX paths relative to IMAGE_PATH). A
// top-level entry hides a whole album; a nested entry hides a subtree from
// every media walk. Core /api/v1 route (not the enrich proxy).
export const getExcludes = async () => {
  const json = await apiFetch(API_PREFIX + '/excludes', {}, 'excludes fetch failed')
  return json.excludes || []
}

// Replace the exclude list. Server normalizes, reaps newly-excluded albums'
// build cache, and fires a background enrichment reap; returns the normalized
// list. Non-blocking server-side.
export const setExcludes = async (excludes) => {
  const json = await apiFetch(
    API_PREFIX + '/excludes',
    { method: 'PUT', body: { excludes } },
    'excludes update failed'
  )
  return json.excludes || []
}

// --- User management (admin) ------------------------------------------------
// All behind the same /api/v1 auth gate. apiFetch surfaces the server message
// so the admin UI can show "user exists", "no such user", etc.

export const listUsers = async () => {
  const json = await apiFetch(API_PREFIX + '/users', {}, 'could not load users')
  return json.result || []
}

export const createUser = async (username, password) => {
  const json = await apiFetch(
    API_PREFIX + '/users',
    { method: 'POST', body: { username, password } },
    'could not create user'
  )
  return json.result
}

export const setUserPassword = async (username, password) => {
  const json = await apiFetch(
    API_PREFIX + '/users/' + encodeURIComponent(username) + '/password',
    { method: 'PUT', body: { password } },
    'could not set password'
  )
  return json.result
}

export const deleteUser = async (username) => {
  const json = await apiFetch(
    API_PREFIX + '/users/' + encodeURIComponent(username),
    { method: 'DELETE' },
    'could not delete user'
  )
  return json.result
}

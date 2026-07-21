// vim: tabstop=2 shiftwidth=2 expandtab
//
// The one place the API base URL is derived and the one fetch wrapper every
// endpoint helper uses. Before this module the prefix derivation lived
// verbatim in BOTH lib/api.js and lib/enrich-api.js (a fix applied to one
// silently left the other resolving a different base URL under
// reverse-proxy/base-path deploys), and every endpoint hand-rolled its own
// fetch/error block — four drifted styles.
//
// NOTE on the env reads: Next.js inlines PUBLIC_URL / NEXT_PUBLIC_* at BUILD
// time by replacing the literal `process.env.<NAME>` member expressions, and
// the published image's entrypoint rewrites baked sentinel values at startup.
// Both mechanisms require these to stay written out literally — do not
// destructure process.env or read names dynamically.

const withSlash = (p) => (p.substr(-1) === '/' ? p : p + '/')

let base = '/'
if (process.env.PUBLIC_URL) {
  base = withSlash(process.env.PUBLIC_URL)
}
if (process.env.NEXT_PUBLIC_BASENAME) {
  base = withSlash(process.env.NEXT_PUBLIC_BASENAME)
}
let api = base || ''
if (process.env.NEXT_PUBLIC_API_PREFIX) {
  api = process.env.NEXT_PUBLIC_API_PREFIX
  if (process.env.NEXT_PUBLIC_API_PREFIX_OVERRIDE) {
    api = process.env.NEXT_PUBLIC_API_PREFIX_OVERRIDE
  }
  api = withSlash(api)
}

// Base path (trailing slash) — the login/logout cookie path.
export const BASE_PREFIX = base
// The gallery API and the enrichment proxy it mounts.
export const API_PREFIX = api + 'api/v1'
export const ENRICH_PREFIX = api + 'api/v1/enrich'

// Query-string builder preserving the previous hand-built encoding
// (encodeURIComponent values). Params with undefined/null values are omitted;
// '' is kept (some endpoints send an intentionally empty num_results).
export const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => k + '=' + encodeURIComponent(v))
    .join('&')

// Low-level request: JSON in/out, network errors thrown, body parsed
// best-effort. Returns { status, ok, json } for callers that must interpret
// specific statuses themselves (ping's 401/403, album-manifest's 202).
export const apiRequest = async (url, { method = 'GET', body } = {}) => {
  let res
  try {
    res = await fetch(url, {
      method,
      ...(body !== undefined
        ? {
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          }
        : {}),
    })
  } catch (err) {
    console.log('FETCH ERROR: ' + url + ': ' + err.message)
    throw new Error(err.message, { cause: err })
  }
  const json = await res.json().catch(() => null)
  return { status: res.status, ok: res.ok, json }
}

// Standard request: throws one uniform Error on !ok or an {error:{code,
// message}} body, preferring the server's message (falling back to
// `fallback`, then the HTTP status). Returns the parsed body.
export const apiFetch = async (url, opts = {}, fallback = 'request failed') => {
  const { status, ok, json } = await apiRequest(url, opts)
  if (!ok || (json && json.error)) {
    const message =
      (json && json.error && json.error.message) || fallback + ' (HTTP ' + status + ')'
    console.log('API ERROR: ' + url + ': ' + message)
    throw new Error(message)
  }
  return json || {}
}

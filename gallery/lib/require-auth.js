// vim: tabstop=2 shiftwidth=2 expandtab
//
// Single source of truth for the JWT auth gate, shared by the gallery API
// (routes/api.js) and the enrichment mount (app.js). With NO_AUTHENTICATION=yes
// it becomes a passthrough, so the gate behaves identically whether applied
// in-router or at a mount point.

// Structural marker so test/auth.test.js can recognize the auth gate by identity
// (it's instantiated in several places) rather than by a magic string or by
// observing a 401. Tagging a function is a behavioral no-op.
const AUTH_GATE = Symbol('authGate')

const requireAuth = (passport) => {
  const gate =
    process.env.NO_AUTHENTICATION === 'yes'
      ? (req, res, next) => next()
      : passport.authenticate('jwt-cookiecombo', {
          session: false,
          failWithError: true,
        })
  gate[AUTH_GATE] = true
  return gate
}

requireAuth.AUTH_GATE = AUTH_GATE
module.exports = requireAuth

// vim: tabstop=2 shiftwidth=2 expandtab
//
// Single source of truth for the JWT auth gate, shared by the gallery API
// (routes/api.js) and the enrichment mount (app.js). With NO_AUTHENTICATION=yes
// it becomes a passthrough, so the gate behaves identically whether applied
// in-router or at a mount point.

module.exports = (passport) =>
  process.env.NO_AUTHENTICATION === 'yes'
    ? (req, res, next) => next()
    : passport.authenticate('jwt-cookiecombo', {
        session: false,
        failWithError: true,
      })

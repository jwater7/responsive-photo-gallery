// vim: tabstop=2 shiftwidth=2 expandtab
//
// One-time login before the suite: authenticate with the debug-data throwaway
// admin creds (read here, never printed) and save the session as a storageState
// the tests reuse. Fails fast with a clear message if the stack isn't up.

const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');

module.exports = async () => {
  const baseURL = process.env.MAP_CHECK_URL || 'http://localhost:3000';
  const authCfg = path.resolve(__dirname, '../debug-data/config/auth/config.json');
  if (!fs.existsSync(authCfg)) {
    throw new Error(`e2e: no auth config at ${authCfg} — is the local stack initialised?`);
  }
  const cfg = require(authCfg);
  const user = Object.keys(cfg.users || {})[0];
  const pass = user && cfg.users[user].password;
  if (!user || !pass) throw new Error('e2e: no admin user in the debug-data auth config');

  const ctx = await request.newContext({ baseURL });
  const r = await ctx.post('/api/v1/login', { data: { username: user, password: pass } });
  if (!r.ok()) {
    throw new Error(`e2e: login failed (${r.status()}) — is the gallery up at ${baseURL}?`);
  }
  const dir = path.resolve(__dirname, '.auth');
  fs.mkdirSync(dir, { recursive: true });
  await ctx.storageState({ path: path.join(dir, 'state.json') });
  await ctx.dispose();
};

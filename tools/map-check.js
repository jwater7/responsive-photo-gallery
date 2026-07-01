// vim: tabstop=2 shiftwidth=2 expandtab
//
// Map UI smoke/regression harness. Drives the running gallery's map via deep-link
// URLs and asserts on the rendered Leaflet DOM — the layer unit tests and backend
// queries can't see (off-screen bubbles, wrong marker counts, popups, blank map).
//
// Prereqs:
//   - the local stack is up (docker compose up -d) with the debug-data albums, and
//   - Playwright's browser is installed once: `npx playwright install chromium`.
// Run:  npm run map-check           (from the repo root)
//   env MAP_CHECK_URL   gallery base URL (default http://localhost:3000)
//
// Auth: reads the debug-data throwaway admin creds and logs in via /api/v1/login
// (the cookie is shared with the browser context). Credentials are never printed.
// Screenshots land in tools/shots/. Exits non-zero if login fails, a scenario logs
// a console error, or a /geo-density call is not 200 — so it is CI-usable.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const BASE = process.env.MAP_CHECK_URL || 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const authCfg = path.join(REPO, 'debug-data/config/auth/config.json');
if (!fs.existsSync(authCfg)) {
  console.error(`no auth config at ${authCfg} — is the local stack initialised?`);
  process.exit(2);
}
const cfg = require(authCfg);
const USER = Object.keys(cfg.users || {})[0];
const PASS = USER && cfg.users[USER].password;
if (!USER || !PASS) {
  console.error('no admin user found in the debug-data auth config');
  process.exit(2);
}

// Deep-link scenarios. `z` drives the initial zoom (map honours the URL zoom).
// SYD = the dense 100-pile (test-grouping-dense); EIF = the 30-group.
const SYD = 'lat=-33.8568&lng=151.2153';
const EIF = 'lat=48.8584&lng=2.2945';
const DEFAULT_SCENARIOS = [
  { label: 'world-z2', path: '/map' },
  { label: 'sydney-z12-circle', path: `/map?${SYD}&z=12` },
  { label: 'sydney-z15-near', path: `/map?${SYD}&z=15` },
  { label: 'sydney-z19-max', path: `/map?${SYD}&z=19` },
  { label: 'eiffel-z12-circle', path: `/map?${EIF}&z=12` },
  { label: 'eiffel-z18-near', path: `/map?${EIF}&z=18` },
];
// Ad-hoc scenarios from argv as `label=/map?..` pairs, else the defaults.
const cli = process.argv.slice(2).map((a) => {
  const eq = a.indexOf('=');
  return eq > 0 ? { label: a.slice(0, eq), path: a.slice(eq + 1) } : { label: a.replace(/\W+/g, '-'), path: a };
});
const scenarios = cli.length ? cli : DEFAULT_SCENARIOS;

// A blank 1x1 tile so blocked OSM imagery doesn't mask real console errors.
const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');

async function login(context) {
  const r = await context.request.post(BASE + '/api/v1/login', { data: { username: USER, password: PASS } });
  return r.ok();
}

async function runScenario(context, sc) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const density = [];
  page.on('response', async (r) => {
    if (r.url().includes('/geo-density')) {
      let b; try { b = await r.json(); } catch {}
      density.push({ status: r.status(), cells: b && b.cells ? b.cells.length : null, total: b ? b.total : null });
    }
  });
  await page.route('**tile.openstreetmap.org**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK }));
  await page.goto(BASE + sc.path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.leaflet-container', { timeout: 15000 }).catch(() => {});
  await page.waitForResponse((r) => r.url().includes('/geo-density'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const vp = page.viewportSize();
  const bubbles = await page.$$('.rpg-cell-marker');
  const thumbs = await page.$$('.rpg-photo-marker');
  const hexes = await page.$$('path.leaflet-interactive');
  let onscreen = 0, offscreen = 0;
  for (const b of bubbles) {
    const bb = await b.boundingBox();
    if (!bb) continue;
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    if (cx >= 0 && cx <= vp.width && cy >= 0 && cy <= vp.height) onscreen++; else offscreen++;
  }
  await page.screenshot({ path: path.join(SHOTS, `${sc.label}.png`) });
  await page.close();

  const densityBad = density.length === 0 || density.some((d) => d.status !== 200);
  const failed = errors.length > 0 || densityBad || offscreen > 0;
  return {
    label: sc.label,
    density: density.map((d) => `${d.status}/cells:${d.cells}/total:${d.total}`).join(' ') || 'NONE',
    hexbins: hexes.length, bubbles: bubbles.length, thumbs: thumbs.length,
    offscreen, errors: errors.length, firstError: errors[0] || '',
    ok: !failed,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (!(await login(context))) {
    console.error('login FAILED');
    await browser.close();
    process.exit(1);
  }
  const results = [];
  for (const sc of scenarios) results.push(await runScenario(context, sc));
  console.table(results);
  console.log('screenshots:', SHOTS);
  await browser.close();
  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.error(`FAIL: ${failures.length} scenario(s) — ${failures.map((f) => f.label).join(', ')}`);
    process.exit(1);
  }
  console.log('PASS: all scenarios');
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1); });

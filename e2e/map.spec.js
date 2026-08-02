// vim: tabstop=2 shiftwidth=2 expandtab
//
// Map regression tests. Assert on the rendered Leaflet DOM — the things unit
// tests and backend queries can't see. Uses the documented debug-data test albums
// (see the README "Generating test images" section): a dense pile at Sydney and a
// 30-image group at the Eiffel Tower. Each test fails if the page logs a console
// error. Deep-link `z` drives the initial zoom.

const { test, expect } = require('@playwright/test');

// 1x1 transparent tile so blocked OSM imagery can't mask real console errors.
const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');
const SYD = 'lat=-33.8568&lng=151.2153';
const EIF = 'lat=48.8584&lng=2.2945';
// The `test-colocated-small` fixture (gallery/scripts/gen-map-fixtures.js): 3
// spots ~40 m apart near Reykjavik, 2 EXACTLY-colocated photos at each. So the
// area holds 6 photos at 3 distinct coordinates — one "6" circle at mid zoom,
// three "2"-piles at deep zoom. Reproduces the "cell says 6 but only 3 tiles
// show" report (co-located photos stacking invisibly).
const REY = 'lat=64.1466&lng=-21.9426';

let consoleErrors;
test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.route('**tile.openstreetmap.org**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK }));
});
test.afterEach(() => {
  expect(consoleErrors, `page console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});

// Navigate to a map deep-link and wait for the density response + the map.
async function openMap(page, url) {
  const density = page.waitForResponse((r) => r.url().includes('/geo-density'));
  await page.goto(url);
  await expect(page.locator('.leaflet-container')).toBeVisible();
  expect((await density).status()).toBe(200);
}

const bubbles = (page) => page.locator('.rpg-cell-marker');
const thumbs = (page) => page.locator('.rpg-photo-marker');
const hexbins = (page) => page.locator('path.leaflet-interactive');
const popup = (page) => page.locator('.leaflet-popup');

// Zoom in one step via Leaflet's control and wait out the debounced density
// refetch, so assertions run against the re-rendered (finer-resolution) layer.
async function zoomIn(page) {
  const density = page.waitForResponse((r) => r.url().includes('/geo-density'));
  await page.locator('.leaflet-control-zoom-in').click();
  await density;
}

test('world zoom renders hexbins, no count bubbles', async ({ page }) => {
  await openMap(page, '/map');
  await expect(hexbins(page).first()).toBeVisible();
  await expect(bubbles(page)).toHaveCount(0);
});

test('mid zoom renders count circles', async ({ page }) => {
  await openMap(page, `/map?${SYD}&z=12`);
  await expect(bubbles(page).first()).toBeVisible();
});

test('dense pile stays ONE on-screen bubble at max zoom', async ({ page }) => {
  // Regression: the bubble used to be placed at the coarse cell center and fall
  // off-screen at max zoom ("the group disappears").
  await openMap(page, `/map?${SYD}&z=19`);
  await expect(bubbles(page)).toHaveCount(1);
  await expect(bubbles(page)).toBeInViewport();
});

test('near zoom separates individual thumbnails from the pile', async ({ page }) => {
  // Regression: a loner sharing a coarse cell used to lump into the pile's bubble.
  await openMap(page, `/map?${SYD}&z=15`);
  await expect(bubbles(page).first()).toBeVisible(); // the pile
  await expect(thumbs(page).first()).toBeVisible(); // sparse photos as their own thumbnails
});

test('small group renders as individual thumbnails near zoom', async ({ page }) => {
  await openMap(page, `/map?${EIF}&z=18`);
  await expect(thumbs(page).first()).toBeVisible();
  await expect(bubbles(page)).toHaveCount(0);
});

test('clicking a mid-zoom circle opens the paged photo popup', async ({ page }) => {
  await openMap(page, `/map?${SYD}&z=12`);
  await bubbles(page).first().click();
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect(page.locator('.leaflet-popup').getByText(/photos? here/)).toBeVisible();
});

// --- co-located piles (the "cell says 6, map shows 3" regression) -------------

test('colocated photos count the whole group in one mid-zoom circle', async ({ page }) => {
  // 3 spots x 2 photos = 6, all within one H3 cell at this zoom -> a single "6".
  await openMap(page, `/map?${REY}&z=12`);
  await expect(bubbles(page)).toHaveCount(1);
  await expect(bubbles(page).filter({ hasText: '6' })).toBeVisible();
});

test('colocated photos pile into badged markers, not hidden underneath', async ({ page }) => {
  // Regression: at deep zoom each spot's 2 exactly-colocated photos used to render
  // as two markers stacked on the same pixel, hiding one — so the eye saw 3 where
  // the cell counted 6. Now each pile is ONE thumbnail badged with its count.
  await openMap(page, `/map?${REY}&z=18`);
  await expect(thumbs(page)).toHaveCount(3); // 3 spots, not 6 stacked
  await expect(thumbs(page).filter({ hasText: '2' })).toHaveCount(3); // each badged "2"
  await expect(bubbles(page)).toHaveCount(0);
});

test('clicking a pile opens all its colocated photos in the lightbox', async ({ page }) => {
  await openMap(page, `/map?${REY}&z=18`);
  await thumbs(page).first().click();
  // The lightbox opens with the pile as a group; both photos are navigable.
  await expect(page.locator('.yarl__container')).toBeVisible();
});

// --- open photo is addressable in the URL (?img=) ------------------------------

const lightbox = (page) => page.locator('.yarl__container');

// Open the first pile at Reykjavik and return the URL params once the lightbox is up.
async function openPhoto(page) {
  await openMap(page, `/map?${REY}&z=18`);
  await thumbs(page).first().click();
  await expect(lightbox(page)).toBeVisible();
  return new URL(page.url()).searchParams;
}

test('opening a photo puts it in the URL with the viewport', async ({ page }) => {
  // Regression: the map lightbox had no URL representation at all, so a refresh
  // (or a shared link) dropped you back at the world view with nothing open.
  const p = await openPhoto(page);
  expect(p.get('img'), 'photo hash missing from URL').toMatch(/^[a-f0-9]{8,64}$/i);
  expect(Number(p.get('lat'))).toBeCloseTo(64.1466, 1);
  expect(Number(p.get('lng'))).toBeCloseTo(-21.9426, 1);
  expect(Number(p.get('z'))).toBeGreaterThan(12);
});

test('refreshing while viewing a photo reopens it at the same place', async ({ page }) => {
  const p = await openPhoto(page);
  const img = p.get('img');
  await page.reload();
  await expect(lightbox(page)).toBeVisible();
  // Same photo, still addressable (the restore path must not drop the param).
  expect(new URL(page.url()).searchParams.get('img')).toBe(img);
  // ...and the map behind it is still at the photo's location, not the world view.
  await expect(page.locator('.leaflet-container')).toBeVisible();
  expect(Number(new URL(page.url()).searchParams.get('z'))).toBeGreaterThan(12);
});

test('closing the lightbox drops the photo but keeps the place', async ({ page }) => {
  await openPhoto(page);
  await page.locator('.yarl__button[aria-label="Close"]').click();
  await expect(lightbox(page)).toHaveCount(0);
  const p = new URL(page.url()).searchParams;
  expect(p.get('img'), 'img should be cleared on close').toBeNull();
  expect(p.get('lat'), 'viewport should survive the close').not.toBeNull();
});

// --- "View in album" jumps back to the album grid ------------------------------

test('View in album lands on the album grid, not another lightbox', async ({ page }) => {
  await openPhoto(page);
  // The action lives in the metadata panel; pin it open via the info toggle so it
  // can't auto-hide out from under the click.
  await page.locator('.yarl__button[aria-label="Toggle image details"]').click();
  // Scope to the CURRENT slide: yarl also renders the neighbours (off-screen), so
  // an unscoped match would be ambiguous — and could fire the wrong photo's link.
  await page.locator('.yarl__slide_current').getByText('View in album').click();
  // Trailing slash: the static export serves /album/ (output: 'export').
  await expect(page).toHaveURL(/\/album\/?\?.*at=/);
  // The grid, NOT the lightbox: `at=` exists precisely so it doesn't reopen one.
  await expect(lightbox(page)).toHaveCount(0);
});

// --- popup follows its location across zoom (deep-link "View on map") ----------

test('deep-link popup stays attached to its cell as you zoom in', async ({ page }) => {
  // Regression: the popup was pinned to the cell center captured at click time, so
  // zooming (which redraws that area as a finer cell at a new center) left it
  // stranded, visibly detached. Now it re-homes onto the current cell each zoom.
  // `hash` makes this a "View on map" deep-link, which auto-opens the popup.
  await openMap(page, `/map?${REY}&z=9&hash=fixture`);
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).getByText(/photos? here/)).toBeVisible();
  // Zoom deeper through several resolution steps; the popup must persist (follow),
  // not vanish or detach — it stays a circle down to CIRCLE_MAX_ZOOM (12).
  await zoomIn(page); // z10
  await expect(popup(page)).toBeVisible();
  await zoomIn(page); // z11
  await expect(popup(page)).toBeVisible();
  await zoomIn(page); // z12
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).getByText(/photos? here/)).toBeVisible();
  // ...and it stays ATTACHED to the circle it describes. Pre-fix the popup hung at
  // the cell center captured at open time while the circle moved to the finer
  // cell's center on each zoom — they drifted ~340px apart. Assert they're aligned.
  await expect(bubbles(page)).toHaveCount(1);
  const p = await popup(page).boundingBox();
  const b = await bubbles(page).first().boundingBox();
  const dx = Math.abs(p.x + p.width / 2 - (b.x + b.width / 2));
  expect(dx, `popup detached from its circle by ${dx.toFixed(0)}px`).toBeLessThan(60);
});

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

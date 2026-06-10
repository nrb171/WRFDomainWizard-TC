/**
 * Headless browser smoke test for the Tropical Cyclone workflow.
 * Not part of the jest suite; run manually with:
 *
 *   npm i -D playwright-core @playwright/browser-chromium
 *   python3 -m http.server 8123 &
 *   node test/smoke.tc.mjs
 */
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:8123/index.html';
const TRACK = new URL('../samples/tracks/MARIA_2017_track.geojson', import.meta.url).pathname;

const failures = [];
const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.wizard === 'object', null, { timeout: 15000 });
await sleep(1500);

// 1. open the TC tab
await page.click('a[href="#tropical-cyclone"]');
await sleep(300);
check('TC sidebar pane opens', await page.$eval('#tropical-cyclone', el => el.classList.contains('active')));

// 2. upload the storm track
await page.setInputFiles('#input-tc-track-file', TRACK);
await page.waitForFunction(
    () => document.querySelector('#tc-storm-name')?.textContent === 'MARIA',
    null, { timeout: 5000 });
check('track file loads and storm name displayed', true);

check('track markers drawn', await page.evaluate(() =>
    document.querySelectorAll('path.leaflet-interactive').length > 60));
check('legend displayed', await page.evaluate(() =>
    document.querySelector('.storm-track-legend') !== null));
check('start/end default to track extent', await page.evaluate(() =>
    document.querySelector('#tc-start').value === '2017-09-16T12:00' &&
    document.querySelector('#tc-end').value.startsWith('2017-10-02')));

// 3. set a simulation window and build domains
await page.evaluate(() => {
    document.querySelector('#tc-start').value = '2017-09-18T00:00';
    document.querySelector('#tc-end').value = '2017-09-21T00:00';
    document.querySelector('#tc-start').dispatchEvent(new Event('change'));
    document.querySelector('#tc-end').dispatchEvent(new Event('change'));
});
await page.click('#tc-build-domains');
await sleep(1200);

check('summary table rendered', await page.evaluate(() =>
    document.querySelector('#tc-summary table') !== null &&
    document.querySelectorAll('#tc-summary tbody tr').length === 3));

check('domains panel opened with values', await page.evaluate(() =>
    document.querySelector('#domains').classList.contains('active') &&
    document.querySelector('#container-wps-form').style.display !== 'none' &&
    document.querySelector('input[name="ref_lat"]').value.length > 0 &&
    document.querySelector('select[name="map_proj"]').value === 'mercator'));

check('three grids listed in domains panel', await page.evaluate(() =>
    document.querySelectorAll('#grids .container-grid').length >= 3));

check('namelist.input button enabled', await page.evaluate(() =>
    document.querySelector('#tc-save-namelist-input').disabled === false));

// 4. click a track point and use "Set as end"
await page.click('a[href="#tropical-cyclone"]');
await sleep(300);
const popupWorked = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const markers = document.querySelectorAll('path.storm-track-point');
    // last marker = last track point
    markers[markers.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(400);
    const button = document.querySelector('.leaflet-popup button[data-action="set-end"]');
    if (!button) return false;
    button.click();
    await sleep(200);
    return document.querySelector('#tc-end').value.startsWith('2017-10-02');
});
check('clicking a track point sets the end time', popupWorked);

const realErrors = pageErrors.filter(e => !/tile|Failed to fetch|NetworkError|ERR_/i.test(e));
check('no javascript errors', realErrors.length === 0);
if (realErrors.length) console.log(realErrors.join('\n'));

await browser.close();

if (failures.length) {
    console.error(`\n${failures.length} smoke check(s) failed`);
    process.exit(1);
}
console.log('\nAll smoke checks passed');

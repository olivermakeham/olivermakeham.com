// Builds the static portrait thumbnails used by the card hand (src/assets/hand/*.webp).
// It screenshots the real home-page covers in their final, non-interactive state, so
// re-run it whenever a home cover changes:
//   1. astro dev --background
//   2. npm i --no-save playwright-core   (Edge/Chrome is used; no browser download)
//   3. node scripts/build-hand-cards.mjs   (ONLY=maps,bar rebuilds just those cards)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const sharp = require('sharp');

const BASE = process.env.SITE_URL ?? 'http://localhost:4321';
const OUT = new URL('../src/assets/hand/', import.meta.url);
const WIDTH = 300;
const HEIGHT = 420;

// Where the portrait crop sits horizontally on each 3:2 cover (0 = left, 1 = right)
const focus = {
    game: 0.5,
    swaplings: 0.5,
    maps: 0.5,
    animation: 0.5,
    presents: 0.5,
    callan: 0.5,
    graphics: 0.5,
    bar: 0.5,
    assortments: 0.5,
    ...JSON.parse(process.env.FOCUS ?? '{}'),
};

const hrefs = Object.keys(focus).filter((id) => !process.env.ONLY || process.env.ONLY.split(',').includes(id));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 });
await page.addStyleTag({
    content: `
        *, *::before, *::after { transition: none !important; animation: none !important; }
        .bar-cover-full, .cover-fade { opacity: 1 !important; }
        vite-error-overlay, astro-dev-toolbar { display: none !important; }
    `,
});
await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
    }
    await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {})));
});
await page.waitForTimeout(2500);

for (const id of hrefs) {
    const cover = page.locator(`a.cover[href="/${id}"]`);
    await cover.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const raw = await cover.screenshot();
    const meta = await sharp(raw).metadata();
    const cropWidth = Math.round((meta.height * WIDTH) / HEIGHT);
    const left = Math.round((meta.width - cropWidth) * focus[id]);
    await sharp(raw)
        .extract({ left, top: 0, width: cropWidth, height: meta.height })
        .resize(WIDTH, HEIGHT)
        .webp({ quality: 82 })
        .toFile(new URL(`${id}.webp`, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    console.log('wrote', id, meta.width, meta.height);
}

await browser.close();

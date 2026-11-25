// Draws the DeepScrape mark at each icon size and packs build/icon.ico and build/icon.png.
// Run: node tools/make-icon.js
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');

const svg = (px) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 30 30">
<rect width="30" height="30" rx="7" fill="#0B7A75"/><g fill="#fff">
<rect x="6" y="6" width="5" height="5" rx="1"/><rect x="12.5" y="6" width="5" height="5" rx="1" opacity=".75"/><rect x="19" y="6" width="5" height="5" rx="1" opacity=".5"/>
<rect x="6" y="12.5" width="5" height="5" rx="1" opacity=".75"/><rect x="12.5" y="12.5" width="5" height="5" rx="1" opacity=".5"/>
<rect x="6" y="19" width="5" height="5" rx="1" opacity=".5"/></g></svg>`;

(async () => {
  const out = path.join(__dirname, '..', 'build'); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const sizes = [16, 24, 32, 48, 64, 128, 256]; const pngs = [];
  for (const px of sizes) {
    const page = await browser.newPage({ viewport: { width: px, height: px } });
    await page.setContent(`<body style="margin:0;background:transparent">${svg(px)}</body>`);
    pngs.push(await page.screenshot({ omitBackground: true })); await page.close();
  }
  await browser.close();
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length; const dir = [];
  sizes.forEach((px, i) => {
    const e = Buffer.alloc(16); e[0] = px === 256 ? 0 : px; e[1] = px === 256 ? 0 : px; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length; dir.push(e);
  });
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, ...dir, ...pngs]));
  fs.writeFileSync(path.join(out, 'icon.png'), pngs[pngs.length - 1]);
  console.log('Wrote build/icon.ico and build/icon.png');
})();

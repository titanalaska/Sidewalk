// Shovel Command's home-screen icon (Matt, 11/24/26): a gold tile with a black shovel. It is the reverse of Titan
// Inventory's icon (a gold drawing on a black tile), so the two Titan apps stay apart on a phone's home screen.
// Read from each PNG's own pixels. The bytes go in as a data: URL, because a file:// image would taint the canvas.
//   gold  245,184,0 (#f5b800, --gold): the most common colour, bucketed by >> 3 (bucket centre = v >> 3 << 3 + 4)
//   black: at least 3% of the opaque pixels have every channel at 40 or under (the shovel)
//   blue  31,95,168 (shell 77's tile, the old --accent): at most 0.5% within 12 on every channel
const { test, expect } = require('./no-real-weather.js');
const fs = require('fs');
const path = require('path');

for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
  test('icon: ' + f + ' is a gold tile with a black shovel and no blue', async ({ page }) => {
    const b64 = fs.readFileSync(path.join(__dirname, '..', f)).toString('base64');
    await page.setContent('<img id="i" src="data:image/png;base64,' + b64 + '">');
    const s = await page.evaluate(async () => {
      const img = document.getElementById('i');
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const counts = new Map();
      let opaque = 0, black = 0, blue = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] <= 200) continue;
        opaque++;
        const r = d[k], g = d[k + 1], b = d[k + 2];
        const key = (r >> 3) + ',' + (g >> 3) + ',' + (b >> 3);
        counts.set(key, (counts.get(key) || 0) + 1);
        if (r <= 40 && g <= 40 && b <= 40) black++;
        if (Math.abs(r - 31) <= 12 && Math.abs(g - 95) <= 12 && Math.abs(b - 168) <= 12) blue++;
      }
      let top = null, most = -1;
      for (const [key, n] of counts) if (n > most) { most = n; top = key; }
      return { opaque, top: top.split(',').map((v) => Number(v) * 8 + 4), black: black / opaque, blue: blue / opaque };
    });
    expect(s.opaque).toBeGreaterThan(1000);
    const gold = [245, 184, 0];
    s.top.forEach((v, i) => expect(Math.abs(v - gold[i]), 'channel ' + i + ' of the most common colour ' + s.top).toBeLessThanOrEqual(12));
    expect(s.black).toBeGreaterThanOrEqual(0.03);
    expect(s.blue).toBeLessThanOrEqual(0.005);
  });
}

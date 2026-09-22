// Image import: runs the exact pipeline the panel uses (P.readChart) on real chart screenshots.
import { createRequire } from 'module';
import fs from 'fs';
import assert from 'assert/strict';
const require = createRequire(import.meta.url);
const req = (m) => { try { return require(m); } catch { return require((process.env.TESS_DIR || '') + '/' + m); } };
const { PNG } = req('pngjs');
const T = req('tesseract.js');
const P = require('../extension/parse-image.js');
const here = (p) => new URL(p, import.meta.url).pathname;

const worker = await T.createWorker('eng', 1, { langPath: here('../extension/vendor/tesseract/lang'), gzip: true });
const encode = (pre) => { const o = new PNG({ width: pre.width, height: pre.height }); o.data = Buffer.from(pre.data); return PNG.sync.write(o); };
async function read(file) {
  const png = PNG.sync.read(fs.readFileSync(here(file)));
  return P.readChart({ data: png.data, width: png.width, height: png.height }, worker, encode);
}
function check(label, res, modes, expected) {
  assert.deepEqual(res.modes, modes, label + ': modes');
  assert.equal(res.colors.length, expected.length, label + ': colour count');
  expected.forEach(([name, group, hex, a], i) => {
    const c = res.colors[i];
    assert.equal(c.name.replace(/\s+/g, ' '), name, `${label}: name #${i + 1}`);
    assert.equal(c.group, group, `${label}: group of ${name}`);
    modes.forEach((m) => {
      assert.equal(c.values[m].hex, hex, `${label}: hex of ${name} (${m})`);
      assert.equal(c.values[m].a, a, `${label}: opacity of ${name} (${m})`);
    });
  });
  console.log(`✓ ${label}: ${expected.length} colours × ${modes.length} mode(s) — names, groups, hex and opacity all correct`);
}

const T1 = 'Color/Text', B = 'Color/BG', I = 'Color/Icon and stroke', BL = 'Color/Button and link';
const base = [
  ['Brand', '', 'FA580D', 1], ['Brand secondary', '', '5B69FF', 1],
  ['Text 01', T1, '000000', 1], ['Text 02', T1, '000000', 0.8], ['Text 03', T1, '000000', 0.6], ['Text 04', T1, '000000', 0.3],
  ['Text light 01', T1, 'FFFFFF', 1], ['Text light 02', T1, 'FFFFFF', 0.8], ['Text light 03', T1, 'FFFFFF', 0.6], ['Text light 04', T1, 'FFFFFF', 0.3],
  ['BG 01', B, 'FFFFFF', 1], ['BG 02', B, 'F1F1F1', 1], ['BG 03', B, 'F7F7F7', 1], ['BG dark 01', B, '000000', 1], ['BG dark 02', B, '131315', 1],
];
check('chart-desktop.png', await read('./fixtures/chart-desktop.png'), ['Desktop'], base);
check('chart-3modes (JPEG screenshot)', await read('./fixtures/chart-3modes.png'), ['Desktop', 'Tab', 'Mobile'], [...base,
  ['Icon 01', I, '000000', 1], ['Icon 02', I, '000000', 0.8], ['Icon 03', I, '000000', 0.6], ['Icon brand', I, 'FA580D', 1], ['Icon star', I, 'FFFF00', 1],
  ['Dark 20', I, '000000', 0.2], ['Dark 15', I, '000000', 0.15], ['Dark 10', I, '000000', 0.1], ['Dark 5', I, '000000', 0.05], ['Dark 3', I, '000000', 0.03],
  ['White 32', I, 'FFFFFF', 0.32], ['White 20', I, 'FFFFFF', 0.2], ['White 15', I, 'FFFFFF', 0.15], ['White 10', I, 'FFFFFF', 0.1], ['White 5', I, 'FFFFFF', 0.05], ['White 3', I, 'FFFFFF', 0.03],
  ['Button', BL, 'FA580D', 1], ['Button dark', BL, '000000', 1],
]);
await worker.terminate();

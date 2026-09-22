// Palette — turn OCR words + image pixels of a colour chart into colours.
// Pure logic, shared by the side panel (browser) and tests (node).
(function (root) {
  'use strict';

  // ---------- pixels ----------
  // img = { data: Uint8ClampedArray RGBA, width, height }
  function px(img, x, y) {
    x = Math.max(0, Math.min(img.width - 1, x | 0)); y = Math.max(0, Math.min(img.height - 1, y | 0));
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }
  const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  const toHex = (c) => c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const fromHex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));

  function dominant(img, x0, y0, x1, y1, exclude) {
    const counts = new Map(); let total = 0;
    for (let y = Math.max(0, y0 | 0); y < Math.min(img.height, y1); y++) {
      for (let x = Math.max(0, x0 | 0); x < Math.min(img.width, x1); x++) {
        const c = px(img, x, y); total++;
        if (exclude && exclude.some((e) => dist(c, e) < 8)) continue;
        const k = toHex(c); counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    let best = null, n = 0;
    for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    return best ? { hex: best, share: n / Math.max(1, total), count: n } : null;
  }

  // Grayscale, ×scale with bilinear smoothing, contrast-stretched (dark charts inverted).
  // No hard threshold: faint grey text (group names, %) survives and Tesseract binarises itself.
  function preprocess(img, scale = 2) {
    const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
    const g = new Float32Array(img.width * img.height);
    let sum = 0;
    for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
      const r = img.data[i], gg = img.data[i + 1], b = img.data[i + 2];
      g[j] = r * 0.299 + gg * 0.587 + b * 0.114; sum += g[j];
      if (Math.max(r, gg, b) - Math.min(r, gg, b) > 60) g[j] = -1;   // coloured swatch pixel: blank it out below
    }
    const dark = sum / g.length < 128;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(img.height - 1, Math.max(0, (y + 0.5) / scale - 0.5)), y0 = Math.floor(sy), y1 = Math.min(img.height - 1, y0 + 1), fy = sy - y0;
      for (let x = 0; x < W; x++) {
        const sx = Math.min(img.width - 1, Math.max(0, (x + 0.5) / scale - 0.5)), x0 = Math.floor(sx), x1 = Math.min(img.width - 1, x0 + 1), fx = sx - x0;
        let l = (g[y0 * img.width + x0] * (1 - fx) + g[y0 * img.width + x1] * fx) * (1 - fy) + (g[y1 * img.width + x0] * (1 - fx) + g[y1 * img.width + x1] * fx) * fy;
        if (l < 0 || (g[y0 * img.width + x0] < 0)) l = dark ? 0 : 255;       // colour swatches → background
        if (dark) l = 255 - l;
        l = 255 * Math.pow(Math.max(0, l) / 255, 2.4);   // gamma: grey text gets much darker, white stays white
        const o = (y * W + x) * 4; out[o] = out[o + 1] = out[o + 2] = l; out[o + 3] = 255;
      }
    }
    return { data: out, width: W, height: H, scale };
  }

  // ---------- text ----------
  const HEX_FIX = { o: '0', O: '0', Q: '0', q: '0', l: '1', I: '1', i: '1', '|': '1', s: '5', S: '5', z: '2', Z: '2', G: '6', g: '9' };
  function readHex(t) {
    const s = String(t).replace(/^#/, '').replace(/[^0-9A-Za-z|]/g, '');
    if (s.length < 6 || s.length > 8) return null;
    const fixed = s.split('').map((ch) => (/[0-9a-fA-F]/.test(ch) && !(ch === 'b' || ch === 'd' || ch === 'e' || ch === 'c' || ch === 'a' || ch === 'f') ? ch : HEX_FIX[ch] || ch)).join('');
    const h = fixed.toUpperCase();
    return /^[0-9A-F]{6}$/.test(h) ? h : null;
  }
  const hasAlnum = (t) => /[A-Za-z0-9]/.test(t);
  const isIconJunk = (t) => !hasAlnum(t) || t.length === 1 || /[^A-Za-z0-9\-_.()&'+:]/.test(t);
  function cleanName(tokens) {
    const toks = tokens.map((w) => w.t);
    while (toks.length && isIconJunk(toks[0])) toks.shift();
    return toks.filter(hasAlnum).join(' ')
      .replace(/([A-Za-z ])[Oo](?=\d)/g, (m, p) => p + '0')   // BGO1 → BG01
      .replace(/(\d)[Oo](?=\d|\b)/g, (m, p) => p + '0')
      .replace(/\s+/g, ' ').trim();
  }

  // OCR mixes up look-alike glyphs (0/C/D, 8/B, 5/S…). If a look-alike reading matches the
  // swatch far better than what was read, use it. Colour-profile shifts stay well below the threshold.
  const LOOK = { '0': '0CD8', C: 'C0', D: 'D0', '8': '8B0', B: 'B8', '5': '5S', '6': '6BE', '1': '17', '7': '71', E: 'EF6', F: 'FE', '9': '96', '3': '38' };
  function fixConfusions(hex, swatch) {
    const target = fromHex(swatch);
    const d0 = dist(fromHex(hex), target);
    if (d0 < 45) return hex;
    let best = hex, bd = d0;
    (function walk(i, cur) {
      if (i === 6) { if (/^[0-9A-F]{6}$/.test(cur)) { const d = dist(fromHex(cur), target); if (d < bd) { bd = d; best = cur; } } return; }
      for (const ch of (LOOK[hex[i]] || hex[i])) walk(i + 1, cur + ch);
    })(0, '');
    return bd < 40 && bd * 2 + 20 < d0 ? best : hex;
  }

  // words: [{ t, b:{x0,y0,x1,y1} }] in ORIGINAL image coordinates.
  // opts.reread(bbox, kind) → Promise<string>: optional second OCR pass on one cell
  // (kind 'hex' uses a hex-only whitelist). Greatly improves accuracy.
  async function parseChart(words, img, opts = {}) {
    words = words.filter((w) => w.t && w.t.trim()).map((w) => ({ ...w, t: w.t.trim(), yc: (w.b.y0 + w.b.y1) / 2, h: w.b.y1 - w.b.y0 }));
    if (!words.length) return { modes: [], colors: [], error: 'no-text' };
    const hs = words.map((w) => w.h).sort((a, b) => a - b); const H = hs[hs.length >> 1] || 12;

    // rows
    const rows = [];
    words.sort((a, b) => a.yc - b.yc).forEach((w) => {
      const r = rows.find((r) => Math.abs(r.yc - w.yc) < H * 0.6);
      if (r) { r.words.push(w); r.yc = (r.yc * (r.words.length - 1) + w.yc) / r.words.length; } else rows.push({ yc: w.yc, words: [w] });
    });
    rows.forEach((r) => r.words.sort((a, b) => a.b.x0 - b.b.x0));

    // header row: contains "Name", or first row without hex whose words split into ≥2 clusters
    const isNameWord = (t) => /^[nm][a-z]{2}e$/i.test(t) && /am|ame/i.test(t);   // Name, Mame, Narne…
    let headerIdx = rows.findIndex((r) => r.words.some((w) => isNameWord(w.t)));
    if (headerIdx < 0) {
      const firstHex = rows.findIndex((r) => r.words.some((w) => readHex(w.t)));
      if (firstHex > 0 && !rows[firstHex - 1].words.some((w) => readHex(w.t)) && rows[firstHex - 1].words.length >= 2) headerIdx = firstHex - 1;
    }
    let cols = null;
    if (headerIdx >= 0) {
      const cl = [];
      rows[headerIdx].words.forEach((w) => {
        const last = cl[cl.length - 1];
        if (last && w.b.x0 - last.x1 < H * 1.5) { last.t += ' ' + w.t; last.x1 = w.b.x1; } else cl.push({ t: w.t, x0: w.b.x0, x1: w.b.x1 });
      });
      cols = cl.filter((c, i) => !(i === 0 && (isNameWord(c.t) || cl.length > 1 && c.x0 < cl[1].x0 && !rows.slice(headerIdx + 1).some((r) => r.words.some((w) => readHex(w.t) && Math.abs(w.b.x0 - c.x0) < H * 4)))));
    }
    if (!cols || !cols.length) {
      headerIdx = -1;
      const xs = rows.map((r) => r.words.find((w) => readHex(w.t))).filter(Boolean).map((w) => w.b.x0).sort((a, b) => a - b);
      if (!xs.length) return { modes: [], colors: [], error: 'no-colours' };
      cols = [{ t: 'Default', x0: xs[xs.length >> 1] - H * 2.2 }];
    }
    cols.forEach((c, i) => { c.xEnd = i + 1 < cols.length ? cols[i + 1].x0 - H * 0.3 : Infinity; c.xStart = c.x0 - H * 0.4; });
    const modes = cols.map((c) => c.t);
    const nameEnd = cols[0].xStart;

    // icon column: short/junk tokens sitting left of where names start
    const firstX = rows.slice(headerIdx + 1).map((r) => r.words.filter((w) => w.b.x1 <= nameEnd).map((w) => w.b.x0));
    const shortLeft = rows.slice(headerIdx + 1).flatMap((r) => { const ws = r.words.filter((w) => w.b.x1 <= nameEnd); return ws.length > 1 && isIconJunk(ws[0].t) && !/^[A-Z]{2,3}$/.test(ws[0].t) ? [ws[0]] : []; });
    let iconX1 = -Infinity;
    if (shortLeft.length >= 3) {
      const xs = shortLeft.map((w) => w.b.x0).sort((a, b) => a - b); const mx = xs[xs.length >> 1];
      const same = shortLeft.filter((w) => Math.abs(w.b.x0 - mx) < H);
      if (same.length >= 3) iconX1 = Math.max(...same.map((w) => w.b.x1)) + H * 0.1;
    }
    void firstX;

    const tableLeft = Math.min(...words.map((w) => w.b.x0));
    const colors = []; let group = '';
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      if (ri <= headerIdx) continue;
      const nameToks = r.words.filter((w) => w.b.x1 <= nameEnd + H * 0.2 && !(w.b.x1 <= iconX1 && w.t.length <= 3 && !/^\d+$/.test(w.t)));
      const band = [r.yc - H * 0.35, r.yc + H * 0.35];
      const bg = dominant(img, 0, band[0], img.width, band[1]);
      const bgC = bg ? fromHex(bg.hex) : [255, 255, 255];
      const values = {}; const flags = []; let any = false;
      for (const c of cols) {
        const toks = r.words.filter((w) => w.b.x0 >= c.xStart && w.b.x0 < c.xEnd);
        let hexTok = toks.find((w) => readHex(w.t)) || toks.find((w) => /^#?[0-9A-Za-z|]{5,9}$/.test(w.t) && w.b.x1 - w.b.x0 > H * 2);
        let ocr = hexTok ? readHex(hexTok.t) : null; let cand = null;
        if (hexTok && opts.reread) {
          const b = hexTok.b, pad = H * 0.25;
          const t2 = await opts.reread({ x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }, 'hex');
          const h2 = readHex(t2); if (h2) { if (ocr && ocr !== h2) cand = [h2, ocr]; ocr = h2; }
        }
        // opacity: number (optionally with %) after the hex
        let a = 1;
        const after = toks.filter((w) => !hexTok || w.b.x0 > hexTok.b.x1);
        for (let k = 0; k < after.length; k++) {
          const m = after[k].t.match(/^(\d{1,3})\s*%?$/);
          if (m && (/%/.test(after[k].t) || (after[k + 1] && /^%/.test(after[k + 1].t)) || +m[1] <= 100)) { a = Math.min(100, +m[1]) / 100; break; }
        }
        if (hexTok && opts.reread) {
          const x0 = hexTok.b.x1 + H * 0.4, x1 = Math.min(c.xEnd, img.width) - H * 0.2;
          if (x1 - x0 > H) {
            const t3 = await opts.reread({ x0, y0: hexTok.b.y0 - H * 0.25, x1, y1: hexTok.b.y1 + H * 0.25 }, 'pct');
            const m3 = String(t3).match(/(\d{1,3})/);
            if (m3 && +m3[1] <= 100 && +m3[1] > 0) a = +m3[1] / 100;
          }
        }
        // swatch: between column start and the hex text
        const sx0 = c.x0 - H * 0.2, sx1 = hexTok ? hexTok.b.x0 - H * 0.15 : c.x0 + H * 1.6;
        const sw = sx1 - sx0 > 2 ? dominant(img, sx0, band[0], sx1, band[1], [bgC]) : null;
        const swatch = sw && sw.count > 4 ? sw.hex : null;
        if (!ocr && !swatch && !toks.length) continue;
        any = true;
        // The typed hex is the truth (screenshots shift colours through display profiles).
        // The swatch is only a fallback when the hex can't be read.
        let hex = ocr, f = null;
        if (!ocr && swatch) { hex = swatch; f = 'estimated'; }
        else if (!ocr) { hex = bg ? bg.hex : 'FFFFFF'; f = 'estimated'; }
        // Two readings disagree a lot (e.g. 6 read as E)? Keep the one closer to the swatch.
        if (cand && swatch && dist(fromHex(cand[0]), fromHex(cand[1])) > 40) { const t = fromHex(swatch); hex = ocr = cand.sort((x, y) => dist(fromHex(x), t) - dist(fromHex(y), t))[0]; }
        if (ocr && swatch) hex = fixConfusions(ocr, swatch);
        // A checkerboard in the swatch means the colour is see-through.
        const sxs = c.x0 - H * 0.2, sxe = hexTok ? hexTok.b.x0 - H * 0.15 : c.x0 + H * 1.6;
        const tones = new Set(); for (let yy = band[0] | 0; yy < band[1]; yy += 1) for (let xx = (sxs + (sxe - sxs) / 2) | 0; xx < sxe; xx++) { const q = px(img, xx, yy); if (Math.abs(q[0] - q[1]) < 6 && Math.abs(q[1] - q[2]) < 6 && q[0] > 150 && q[0] < 250) tones.add(q[0] >> 3); }
        const checker = tones.size >= 2;
        if (f) flags.push(f);
        values[c.t] = { hex, a, checker, est: !!f };
      }
      // Opacity missed in one column? Borrow it from a sibling column with the same colour.
      const vs = Object.values(values);
      vs.forEach((v) => {
        if (v.a === 1) { const sib = vs.find((o) => o !== v && o.hex === v.hex && o.a < 1); if (sib && (v.checker || vs.filter((o) => o.a === sib.a).length >= vs.length - 1)) v.a = sib.a; }
      });
      // Code unreadable in one column? If a sibling column's code matches its swatch closely, use that code.
      vs.forEach((v) => {
        if (!v.est) return;
        const sib = vs.find((o) => !o.est && dist(fromHex(o.hex), fromHex(v.hex)) < 40);
        if (sib) { v.hex = sib.hex; v.est = false; }
      });
      if (!vs.some((v) => v.est)) { const k = flags.indexOf('estimated'); if (k >= 0) flags.splice(k, 1); }
      vs.forEach((v) => { delete v.checker; delete v.est; });
      if (!any) {
        const hw = r.words.filter((w) => w.b.x1 <= nameEnd + H * 0.2);
        let head = hw.map((w) => (/^[|!\\]$/.test(w.t) ? '/' : w.t)).filter((t) => hasAlnum(t) || t === '/').join(' ');
        if (opts.reread && hw.length) {
          // Re-read the whole heading from the table's left edge: faint grey parts ("Color /") are often missed.
          const pad = H * 0.3;
          const t2 = await opts.reread({ x0: Math.max(0, tableLeft - pad), y0: Math.min(...hw.map((w) => w.b.y0)) - pad, x1: Math.max(...hw.map((w) => w.b.x1)) + pad, y1: Math.max(...hw.map((w) => w.b.y1)) + pad }, 'name');
          const c2 = String(t2 || '').replace(/[|!\\]/g, '/').replace(/[^A-Za-z0-9 /&\-_.()]/g, '').trim();
          if (c2 && c2.length >= head.replace(/\s/g, '').length) head = c2;
        }
        if (!head.includes('/')) {
          // Figma writes groups as "Color / Text"; a faint slash may be lost, but the wide gap stays.
          const aw = hw.filter((w) => hasAlnum(w.t));
          head = aw.map((w, k) => (k && w.b.x0 - aw[k - 1].b.x1 > H * 0.8 ? '/ ' : '') + w.t).join(' ');
        }
        if (head) group = head.replace(/\s*\/\s*/g, '/').replace(/^\/|\/$/g, '');
        continue;
      }
      let text = cleanName(nameToks);
      if (opts.reread && nameToks.length) {
        const ws = nameToks.filter((w) => hasAlnum(w.t) && !isIconJunk(w.t) || /^\d+$/.test(w.t));
        const use = ws.length ? ws : nameToks, pad = H * 0.25;
        const bb = { x0: Math.min(...use.map((w) => w.b.x0)) - pad, y0: Math.min(...use.map((w) => w.b.y0)) - pad, x1: Math.max(...use.map((w) => w.b.x1)) + pad, y1: Math.max(...use.map((w) => w.b.y1)) + pad };
        const t2 = cleanName(String(await opts.reread(bb, 'name')).split(/\s+/).map((t) => ({ t })));
        const nt = (x) => x.split(' ').filter(Boolean).length;
        if (t2 && (!text || nt(t2) >= nt(text))) text = t2;   // never drop a word the first pass saw (e.g. "White 5")
      }
      colors.push({ name: text || `Colour ${colors.length + 1}`, group, values, flags: [...new Set(flags)], selected: true });
    }
    // "BG01" → "BG 01" when the chart otherwise writes names as "Text 01"
    const spaced = colors.some((c) => /[A-Za-z] \d+$/.test(c.name));
    if (spaced) colors.forEach((c) => { c.name = c.name.replace(/([A-Za-z])(\d+)$/, '$1 $2'); });
    return { modes, colors };
  }

  // Pick an upscale so small UI text becomes large enough for OCR.
  function chooseScale(img) {
    const w = Math.max(img.width, img.height * 0.6);
    return w < 1100 ? 3 : w < 1800 ? 2 : 1.5;
  }

  // Crop cells out of the preprocessed image and stack them into one tall strip, so a whole
  // batch of cells is recognised in ONE OCR call instead of one call per cell.
  function buildStrip(pre, cells) {
    const GAP = 24, PADX = 16;
    const boxes = cells.map((c) => {
      const x0 = Math.max(0, Math.floor(c.x0 * pre.scale)), y0 = Math.max(0, Math.floor(c.y0 * pre.scale));
      const x1 = Math.min(pre.width, Math.ceil(c.x1 * pre.scale)), y1 = Math.min(pre.height, Math.ceil(c.y1 * pre.scale));
      return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    });
    const W = Math.max(...boxes.map((b) => b.w)) + PADX * 2;
    const H = boxes.reduce((s, b) => s + b.h + GAP, GAP);
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    let y = GAP; const spans = [];
    boxes.forEach((b) => {
      for (let r = 0; r < b.h; r++) {
        const src = ((b.y0 + r) * pre.width + b.x0) * 4, dst = ((y + r) * W + PADX) * 4;
        data.set(pre.data.subarray(src, src + b.w * 4), dst);
      }
      spans.push([y, y + b.h]); y += b.h + GAP;
    });
    return { img: { data, width: W, height: H, scale: pre.scale }, spans };
  }

  // Full pipeline shared by the panel and the tests.
  // worker: a Tesseract worker; encode(pre) → something worker.recognize accepts (canvas / PNG buffer).
  async function readChart(img, worker, encode, onProgress) {
    const scale = chooseScale(img);
    const pre = preprocess(img, scale);
    const prog = (p) => { if (onProgress) onProgress(p); };
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const r = await worker.recognize(await encode(pre), {}, { blocks: true });
    prog(0.45);
    const words = [];
    for (const b of r.data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const x of l.words)
      words.push({ t: x.text, b: { x0: x.bbox.x0 / scale, y0: x.bbox.y0 / scale, x1: x.bbox.x1 / scale, y1: x.bbox.y1 / scale } });

    // Pass A: find out which cells need a closer look.
    const reqs = [];
    const key = (bb, kind) => kind + ':' + [bb.x0, bb.y0, bb.x1, bb.y1].map((v) => Math.round(v * 10)).join(',');
    await parseChart(words, img, { reread: async (bb, kind) => { reqs.push({ bb, kind, k: key(bb, kind) }); return ''; } });

    // Pass B: one OCR call per kind (names / hex codes / opacity) on a stacked strip of those cells.
    const WL = { hex: '0123456789ABCDEF#', pct: '0123456789%', name: '' };
    const got = new Map(); const kinds = ['name', 'hex', 'pct']; let done = 0;
    for (const kind of kinds) {
      const list = reqs.filter((q) => q.kind === kind && !got.has(q.k));
      const uniq = [...new Map(list.map((q) => [q.k, q])).values()];
      if (uniq.length) {
        const { img: strip, spans } = buildStrip(pre, uniq.map((q) => q.bb));
        await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: WL[kind] });
        const rr = await worker.recognize(await encode(strip), {}, { blocks: true });
        const texts = uniq.map(() => []);
        for (const b of rr.data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const x of l.words) {
          const yc = (x.bbox.y0 + x.bbox.y1) / 2;
          const i = spans.findIndex(([a, z]) => yc >= a - 6 && yc <= z + 6);
          if (i >= 0) texts[i].push([x.bbox.x0, x.text]);
        }
        uniq.forEach((q, i) => got.set(q.k, texts[i].sort((a, b) => a[0] - b[0]).map((t) => t[1]).join(' ').trim()));
      }
      prog(0.45 + (++done / kinds.length) * 0.5);
    }
    // Pass C: final parse using the batched results.
    return parseChart(words, img, { reread: async (bb, kind) => got.get(key(bb, kind)) || '' });
  }

  const api = { parseChart, readChart, chooseScale, preprocess, readHex, cleanName, dominant };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaletteImage = api;
})(typeof self !== 'undefined' ? self : this);

import { createRequire } from 'module';
import fs from 'fs';
import assert from 'assert/strict';
const require = createRequire(import.meta.url);
const M = require('../extension/merge.js');
const kirki = JSON.parse(fs.readFileSync(new URL('./fixtures/kirki-saved-data.json', import.meta.url)));
const before = JSON.stringify(kirki);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };

const chart = { modes: ['Desktop'], colors: [
  { name: 'Brand', group: '', values: { Desktop: { hex: 'FA580D', a: 1 } } },
  { name: 'Text 02', group: 'Color/Text', values: { Desktop: { hex: '000000', a: 0.8 } } },
  { name: 'Test', group: '', values: { Desktop: { hex: '111111', a: 1 } } },
  { name: 'BG 01', group: 'Color/BG', values: { Desktop: { hex: 'FFFFFF', a: 1 } }, selected: false },
]};

t('first incoming mode maps to default', () => {
  assert.deepEqual(M.suggestModeMap(kirki, ['Desktop']), { Desktop: 'default' });
});
t('matches existing mode by title, otherwise proposes create', () => {
  assert.deepEqual(M.suggestModeMap(kirki, ['Light', 'new mode', 'Dark']), { Light: 'default', 'new mode': 'k-mzmrz83q', Dark: { create: 'Dark' } });
});
t('adds selected colours, rgba format, fills every mode', () => {
  const r = M.merge(kirki, chart, M.suggestModeMap(kirki, chart.modes));
  const col = M.colorCollection(r.data.variableData);
  assert.equal(r.added.length, 3);
  const b = col.variables.find((v) => v.title === 'Brand');
  assert.deepEqual(b.value, { default: 'rgba(250, 88, 13, 1.00)', 'k-mzmrz83q': 'rgba(250, 88, 13, 1.00)' });
  assert.equal(col.variables.find((v) => v.title === 'Text 02').value.default, 'rgba(0, 0, 0, 0.8)');
  assert.match(b.id, /^k-[a-z0-9]{8}$/);
});
t('never touches existing variables; same name is added alongside', () => {
  const r = M.merge(kirki, chart, { Desktop: 'default' });
  const col = M.colorCollection(r.data.variableData);
  const tests = col.variables.filter((v) => v.title === 'Test');
  assert.equal(tests.length, 2);
  assert.deepEqual(tests[0], JSON.parse(before).variableData.data[0].variables.find((v) => v.id === 'k-1pok7dpi'));
  assert.equal(r.sameName, 1);
  const orig = JSON.parse(before);
  assert.deepEqual(r.data.variableData.data.slice(1), orig.variableData.data.slice(1));
  assert.deepEqual(col.variables.slice(0, orig.variableData.data[0].variables.length), orig.variableData.data[0].variables);
  assert.equal(JSON.stringify(kirki), before, 'input not mutated');
});
t('skips deselected colours', () => {
  const r = M.merge(kirki, chart, { Desktop: 'default' });
  assert.ok(!r.added.some((a) => a.title === 'BG 01'));
});
t('new mode is added to all four collections with one shared key', () => {
  const inc = { modes: ['Light', 'Dark'], colors: [{ name: 'Bg', values: { Light: { hex: 'FFFFFF', a: 1 }, Dark: { hex: '000000', a: 1 } } }] };
  const r = M.merge(kirki, inc, { Light: 'default', Dark: { create: 'Dark' } });
  assert.equal(r.newModes.length, 1);
  const key = r.newModes[0].key;
  r.data.variableData.data.forEach((c) => assert.ok(c.modes.some((m) => m.key === key && m.title === 'Dark')));
  const v = M.colorCollection(r.data.variableData).variables.at(-1);
  assert.equal(v.value[key], 'rgba(0, 0, 0, 1.00)');
  assert.equal(v.value['k-mzmrz83q'], 'rgba(255, 255, 255, 1.00)');
});
t('ids are unique across the whole document', () => {
  const r = M.merge(kirki, chart, { Desktop: 'default' });
  const ids = r.data.variableData.data.flatMap((c) => c.variables.map((v) => v.id));
  assert.equal(new Set(ids).size, ids.length);
});
t('smart naming: plain unless incoming clash; never repeats group word', () => {
  const titles = M.buildTitles([
    { name: 'Primary', group: 'Light' }, { name: 'Primary', group: 'Dark' },
    { name: 'Text 01', group: 'Color/Text' }, { name: 'Text 01', group: 'Other/Text' }, { name: 'Solo', group: 'X' },
  ]);
  assert.deepEqual(titles, ['Light/Primary', 'Dark/Primary', 'Text 01', 'Text 01', 'Solo']);
  assert.deepEqual(M.buildTitles([{ name: 'Text 02', group: 'Color/Text' }], 'path'), ['Color/Text/Text 02']);
});
t('custom title from review screen wins', () => {
  const r = M.merge(kirki, { modes: ['D'], colors: [{ name: 'a', title: 'Renamed', values: { D: { hex: '010203', a: 0.3 } } }] }, { D: 'default' });
  assert.equal(r.added[0].title, 'Renamed');
});
t('parseRgba round-trips', () => {
  assert.deepEqual(M.parseRgba('rgba(250, 88, 13, 0.8)'), { hex: 'FA580D', a: 0.8 });
  assert.deepEqual(M.parseRgba('#000000'), { hex: '000000', a: 1 });
});
t('sync: classify new / changed / same, and removed', () => {
  const inc = { scope: 'figma:f:', modes: ['D'], colors: [
    { key: 'figma:f:1', name: 'A', values: { D: { hex: 'FA580D', a: 0.8 } } },   // Test is 250,88,13,0.8 → same
    { key: 'figma:f:2', name: 'B', values: { D: { hex: '000000', a: 1 } } },     // Primary 25,115,238 → changed
    { key: 'figma:f:3', name: 'C', values: { D: { hex: '111111', a: 1 } } } ] };  // unlinked → new
  const links = { 'figma:f:1': 'k-1pok7dpi', 'figma:f:2': 'k-mii4xpxq', 'figma:f:9': 'k-tfnwakzs' };
  const r = M.classify(kirki, inc, links, { D: 'default' });
  assert.deepEqual(r.rows.map((x) => x.status), ['same', 'changed', 'new']);
  assert.deepEqual(r.removed, ['White']);
});
t('sync: ticked update changes only that variable, other modes kept', () => {
  const inc = { modes: ['D'], colors: [{ key: 'k', name: 'Test', updateId: 'k-1pok7dpi', values: { D: { hex: '000000', a: 1 } } }] };
  const r = M.merge(kirki, inc, { D: 'default' });
  const v = M.colorCollection(r.data.variableData).variables.find((x) => x.id === 'k-1pok7dpi');
  assert.equal(v.value.default, 'rgba(0, 0, 0, 1.00)');
  assert.equal(v.value['k-mzmrz83q'], 'rgba(35, 22, 16, 0.8)');
  assert.equal(r.added.length, 0); assert.equal(r.updated.length, 1);
  assert.equal(M.colorCollection(r.data.variableData).variables.length, M.colorCollection(kirki.variableData).variables.length);
});
console.log(`\n✓ all ${n} merge tests passed`);

// Palette — Kirki editor recon. Paste into the DevTools Console on a Kirki editor page (?action=kirki).
// It only READS: finds where the editor keeps variables in memory and records how Kirki updates them.
(() => {
  const out = { globals: [], redux: [], actions: [] };
  const isVarData = (o) => o && typeof o === 'object' && Array.isArray(o.data) && o.data.some((c) => c && c.key === 'color' && Array.isArray(c.variables));
  // 1) window globals (breadth-first, limited)
  const seen = new WeakSet(); const q = Object.keys(window).filter((k) => !/^(webkit|on|chrome|document|frames|parent|top|self|window|__palRecon)/.test(k)).map((k) => [k, window[k], 0]);
  let n = 0;
  while (q.length && n < 150000) {
    const [path, v, d] = q.shift(); n++;
    if (!v || typeof v !== 'object' || seen.has(v) || v instanceof Node) continue; seen.add(v);
    try {
      if (isVarData(v) || (v.variableData && isVarData(v.variableData))) out.globals.push(path);
      if (d < 6) for (const k of Object.keys(v).slice(0, 300)) q.push([path + '.' + k, v[k], d + 1]);
    } catch {}
  }
  // 2) React-Redux store (via React fiber of the root element)
  const findStore = () => {
    for (const el of document.querySelectorAll('body, body *')) {
      const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'));
      if (!fk) continue;
      let f = el[fk]; let hops = 0;
      while (f && hops++ < 5000) {
        const s = f.memoizedProps && f.memoizedProps.store;
        if (s && typeof s.getState === 'function' && typeof s.dispatch === 'function') return s;
        f = f.child || f.sibling || (f.return && f.return.sibling);
      }
    }
    return null;
  };
  const store = findStore();
  if (store) {
    const st = store.getState(); const sq = [['state', st, 0]]; const sseen = new WeakSet();
    while (sq.length) { const [p, v, d] = sq.shift(); if (!v || typeof v !== 'object' || sseen.has(v)) continue; sseen.add(v);
      if (isVarData(v) || (v.variableData && isVarData(v.variableData))) out.redux.push(p);
      if (d < 6) for (const k of Object.keys(v).slice(0, 300)) sq.push([p + '.' + k, v[k], d + 1]); }
    // 3) record the actions Kirki dispatches when you edit a variable
    const orig = store.dispatch;
    store.dispatch = function (a) { try { if (a && a.type) out.actions.push({ type: a.type, payload: JSON.stringify(a.payload ?? null).slice(0, 1500) }); } catch {} return orig.apply(this, arguments); };
    window.__palStore = store;
  }
  out.hasRedux = !!store;
  window.__palRecon = out;
  console.log('%cPalette recon ready', 'color:#5741f3;font-weight:600', { globals: out.globals, redux: out.redux, hasRedux: out.hasRedux });
  console.log('Now change ONE colour variable in Kirki (value or name), then run:  copy(JSON.stringify(__palRecon))  and paste the result to Claude.');
})();

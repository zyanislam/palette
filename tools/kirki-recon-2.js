// Palette — Kirki recon #2. Paste into the Console on a Kirki editor page. READ-ONLY.
(() => {
  const out = { found: [], dispatchCalls: [], notes: [] };
  const isVD = (o) => o && typeof o === 'object' && Array.isArray(o.data) && o.data.some((c) => c && c.key === 'color' && Array.isArray(c.variables));
  const hasVD = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 3) return null;
    if (isVD(o)) return '';
    try { for (const k of Object.keys(o).slice(0, 80)) { const r = hasVD(o[k], depth + 1); if (r !== null) return k + (r ? '.' + r : ''); } } catch {}
    return null;
  };
  const name = (f) => (f && f.type && (f.type.displayName || f.type.name || (f.type._context && 'Provider'))) || (f && typeof f.type === 'string' ? f.type : '?');
  // start from any canvas element that received variableData
  let start = null;
  for (const fr of document.querySelectorAll('iframe')) {
    try { for (const el of fr.contentDocument.querySelectorAll('[id]')) { const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$')); if (k) { start = el[k]; break; } } } catch {}
    if (start) break;
  }
  if (!start) { const el = [...document.querySelectorAll('*')].find((e) => Object.keys(e).some((x) => x.startsWith('__reactFiber$'))); start = el && el[Object.keys(el).find((x) => x.startsWith('__reactFiber$'))]; }
  let f = start, depth = 0;
  while (f && depth < 400) {
    // hooks (useState / useReducer / zustand etc.)
    let h = f.memoizedState, i = 0;
    while (h && typeof h === 'object' && 'memoizedState' in h && i < 80) {
      const p = hasVD(h.memoizedState);
      if (p !== null) {
        const q = h.queue;
        const rec = { depth, component: name(f), hook: i, path: p, hasDispatch: !!(q && q.dispatch), reducer: q && q.lastRenderedReducer ? (q.lastRenderedReducer.name || 'anon') : null, stateKeys: h.memoizedState && typeof h.memoizedState === 'object' ? Object.keys(h.memoizedState).slice(0, 25) : typeof h.memoizedState };
        out.found.push(rec);
        if (q && q.dispatch && !q.dispatch.__pal) {
          const orig = q.dispatch; const tag = rec.component + '#' + i;
          q.dispatch = function (a) { try { out.dispatchCalls.push({ hook: tag, arg: typeof a === 'function' ? 'fn:' + String(a).slice(0, 400) : JSON.stringify(a).slice(0, 800) }); } catch {} return orig.apply(this, arguments); };
          q.dispatch.__pal = true;
        }
      }
      h = h.next; i++;
    }
    // context providers
    if (f.type && f.type._context && f.memoizedProps) {
      const p = hasVD(f.memoizedProps.value);
      if (p !== null) out.found.push({ depth, component: 'ContextProvider', context: f.type._context.displayName || '?', path: p, valueKeys: Object.keys(f.memoizedProps.value || {}).slice(0, 40) });
    }
    f = f.return; depth++;
  }
  // global stores that expose getState/setState (zustand/valtio style)
  for (const k of Object.keys(window)) { try { const v = window[k]; if (v && typeof v.getState === 'function') { const p = hasVD(v.getState()); if (p !== null) out.found.push({ global: k, path: p, setState: typeof v.setState }); } } catch {} }
  window.__palRecon2 = out;
  console.log('%cPalette recon 2 ready', 'color:#5741f3;font-weight:600', out.found);
  console.log('Now change ONE colour variable in Kirki, then run:  copy(JSON.stringify(__palRecon2))  and paste the result to Claude.');
})();

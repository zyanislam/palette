// Palette — runs INSIDE the Kirki editor page (MAIN world) via chrome.scripting.
// Must be self-contained: it is serialised and injected as a single function.
async function paletteKirkiOp(op, payload) {
  const isEditor = /[?&]action=kirki\b/.test(location.search);
  const link = document.querySelector('link[rel="https://api.w.org/"]');
  const root = ((window.wpApiSettings && window.wpApiSettings.root) || (link && link.href) || location.origin + '/wp-json/').replace(/\/?$/, '/');

  async function nonce() {
    if (window.__paletteNonce) return window.__paletteNonce;
    let n = window.wpApiSettings && window.wpApiSettings.nonce;
    if (!n) {
      // Look for a nonce in Kirki's own globals (shallow scan).
      for (const k of Object.keys(window)) {
        if (!/kirki|droip|wp/i.test(k)) continue;
        try {
          const o = window[k];
          if (o && typeof o === 'object') for (const kk of Object.keys(o)) {
            if (/nonce/i.test(kk) && typeof o[kk] === 'string' && /^[a-f0-9]{10}$/.test(o[kk])) { n = o[kk]; break; }
          }
        } catch {}
        if (n) break;
      }
    }
    if (!n) {
      // WordPress core: returns a fresh REST nonce for the logged-in user.
      const ajax = root.replace(/wp-json\/$/, 'wp-admin/admin-ajax.php');
      try { const r = await fetch(ajax + '?action=rest-nonce', { credentials: 'include' }); const t = (await r.text()).trim(); if (/^[a-f0-9]{10}$/.test(t)) n = t; } catch {}
    }
    window.__paletteNonce = n || '';
    return window.__paletteNonce;
  }
  const url = (m) => root + 'kirki/v1/global-ui-saved-data?_method=' + m;

  async function get() {
    const r = await fetch(url('get'), { credentials: 'include', headers: { accept: 'application/json', 'x-wp-nonce': await nonce() } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.success || !j.data) throw new Error((j && j.message) || 'Could not read Kirki variables (' + r.status + ')');
    return j.data;
  }
  async function put(data) {
    const fd = new FormData();
    fd.append('data', JSON.stringify({ globalColors: data.globalColors || [], shadows: data.shadows || [], variableData: data.variableData }));
    const r = await fetch(url('put'), { method: 'POST', credentials: 'include', headers: { accept: 'application/json', 'x-wp-nonce': await nonce() }, body: fd });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.success) throw new Error((j && j.message) || 'Kirki refused the save (' + r.status + ')');
    return true;
  }

  // Locate every place the editor keeps its in-memory variableData.
  // Kirki keeps more than one copy: the canvas state, and a cache the Variables panel reads when it opens.
  function findVariableOwners() {
    const fk = (el) => Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    const docs = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
    let vd = null;
    outer: for (const d of docs) for (const el of d.querySelectorAll('[id]')) {
      const k = fk(el); if (!k) continue;
      let f = el[k];
      for (let i = 0; f && i < 30; i++, f = f.return) { const p = f.memoizedProps; if (p && p.variableData && Array.isArray(p.variableData.data)) { vd = p.variableData; break outer; } }
    }
    if (!vd) return null;
    const roots = new Set();
    for (const d of docs) for (const el of d.querySelectorAll('[id], body > div')) { const k = Object.keys(el).find((x) => x.startsWith('__reactContainer$')); if (k) roots.add(el[k]); }
    if (!roots.size) for (const d of docs) for (const el of d.querySelectorAll('*')) { const k = Object.keys(el).find((x) => x.startsWith('__reactContainer$')); if (k) roots.add(el[k]); }
    const direct = [], wrapped = [];
    const stack = [...roots]; let n = 0;
    while (stack.length && n++ < 300000) {
      const f = stack.pop();
      if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
      let h = f.memoizedState, i = 0;
      while (h && typeof h === 'object' && 'memoizedState' in h && i++ < 120) {
        const st = h.memoizedState, q = h.queue;
        if (q && typeof q.dispatch === 'function') {
          if (st === vd) direct.push(q.dispatch);
          else if (st && typeof st === 'object' && st.variableData === vd) wrapped.push({ dispatch: q.dispatch, state: st });
        }
        h = h.next;
      }
    }
    return { vd, direct, wrapped };
  }

  // Resolve when Kirki's own save of the variables finishes (or after `ms`).
  function watchKirkiSave(ms) {
    return new Promise((resolve) => {
      let done = false; const finish = (v) => { if (!done) { done = true; restore(); resolve(v); } };
      const isSave = (u) => /global-ui-saved-data\?_method=put/.test(String(u));
      const of = window.fetch;
      window.fetch = function (u, o) { const p = of.apply(this, arguments); if (isSave(u && u.url || u)) p.then((r) => finish(r.ok), () => finish(false)); return p; };
      const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) { this.__palSave = isSave(u); return oo.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () { if (this.__palSave) this.addEventListener('loadend', () => finish(this.status >= 200 && this.status < 300)); return os.apply(this, arguments); };
      function restore() { window.fetch = of; XMLHttpRequest.prototype.open = oo; XMLHttpRequest.prototype.send = os; }
      setTimeout(() => finish(false), ms);
    });
  }

  try {
    if (op === 'info') return { ok: true, isEditor, host: location.host };
    if (!isEditor) return { ok: false, error: 'not-editor' };
    if (op === 'get') return { ok: true, data: await get() };
    if (op === 'put') { await put(payload); return { ok: true }; }
    if (op === 'liveState') {
      const o = findVariableOwners();
      window.__palOwners = o;
      return o && (o.direct.length || o.wrapped.length) ? { ok: true, variableData: JSON.parse(JSON.stringify(o.vd)) } : { ok: false, error: 'live-unavailable' };
    }
    if (op === 'live') {
      // Update the open editor in place, then let Kirki save it (we save ourselves if it doesn't within 2.5 s).
      let o = window.__palOwners;
      if (!o || !o.vd || !document.contains(document.body)) o = findVariableOwners();
      window.__palOwners = null;
      if (!o || !(o.direct.length || o.wrapped.length)) return { ok: false, error: 'live-unavailable' };
      const next = payload.variableData;
      const saved = watchKirkiSave(2500);
      // 1) Update the old object in place, so caches that still point at it (e.g. the Variables panel
      //    reading it when it opens) see the new variables too.
      o.vd.data = next.data;
      // 2) Tell React about it so everything on screen re-renders now.
      o.direct.forEach((d) => d(next));
      o.wrapped.forEach((w) => w.dispatch({ ...w.state, variableData: next }));
      const kirkiSaved = await saved;
      if (!kirkiSaved) await put({ globalColors: payload.globalColors, shadows: payload.shadows, variableData: next });
      return { ok: true, savedBy: kirkiSaved ? 'kirki' : 'palette', owners: o.direct.length + o.wrapped.length };
    }
    if (op === 'reload') { setTimeout(() => location.reload(), 60); return { ok: true }; }
    return { ok: false, error: 'unknown op' };
  } catch (e) {
    window.__paletteNonce = null;
    return { ok: false, error: String(e && e.message || e) };
  }
}

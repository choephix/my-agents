// ==UserScript==
// @name         Full Page Shot
// @namespace    local.tools
// @version      0.2.0
// @description  Any element or the whole page, top to bottom, as one PNG. Alt+Shift+P picks an element DevTools-style; press it again for the whole page.
// @match        *://*/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/dist/index.js
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/full-page-shot.user.js
// @updateURL    https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/full-page-shot.user.js
// ==/UserScript==

/* global modernScreenshot */
(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const HOTKEY = e => e.altKey && e.shiftKey && e.code === 'KeyP';
  const MAX_SIDE = 32767;          // canvas side limit (Chrome, Firefox)
  const MAX_AREA = 268435456;      // canvas area limit (Chrome: 16384²)
  const PRESCROLL_STEPS = 40;      // cap, or an infinite feed grows forever
  const PRESCROLL_WAIT = 150;      // ms per step for lazy content to arrive
  const IMG_WAIT = 5000;           // ms to let triggered images finish
  const ASSET_TIMEOUT = 15000;     // ms per image/font fetch
  const TOAST_ID = 'fps-toast';

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ----------------------------------------------------------------- toast
  let toastEl = null;
  function toast(msg, kind = 'ok', ms = 2800) {
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement('div');
      toastEl.id = TOAST_ID;
      document.documentElement.appendChild(toastEl);
    }
    const colors = { ok: '#1d9bf0', good: '#00ba7c', bad: '#f4212e' };
    const el = toastEl;
    el.textContent = msg;
    el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      z-index:2147483647;max-width:80vw;padding:10px 16px;border-radius:10px;
      font:13px/1.4 system-ui,sans-serif;color:#fff;background:${colors[kind]};
      box-shadow:0 4px 16px rgba(0,0,0,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
    clearTimeout(el._hide);
    if (ms) el._hide = setTimeout(() => { el.remove(); if (toastEl === el) toastEl = null; }, ms);
  }

  // ---------------------------------------------------------------- target
  const scrolls = el => el.scrollHeight > el.clientHeight + 1
    && /auto|scroll|overlay/.test(getComputedStyle(el).overflowY);

  /**
   * What "the whole page" is. Normally the document scrolls, so it's the
   * document. Apps (chat, mail, dashboards) pin the document to the viewport
   * and scroll an inner pane instead; then it's that pane, the biggest one,
   * unrolled to its full height. Panes under a quarter of the viewport
   * (code blocks, dropdowns) don't count.
   */
  function pageTarget() {
    const doc = document.scrollingElement || document.documentElement;
    const page = { kind: 'page', node: document.documentElement, scroller: doc };
    if (doc.scrollHeight > innerHeight + 1) return page;

    let best = null, bestArea = innerWidth * innerHeight * 0.25;
    for (const el of document.body.querySelectorAll('*')) {
      if (!scrolls(el)) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best ? { kind: 'pane', node: best, scroller: best } : page;
  }

  /** A picked element; one that scrolls is unrolled like a pane. */
  function elementTarget(el) {
    if (el === document.documentElement || el === document.body) return pageTarget();
    return scrolls(el)
      ? { kind: 'pane', node: el, scroller: el }
      : { kind: 'element', node: el, scroller: null };
  }

  /** First opaque background from the node up; the PNG has no transparency. */
  function backgroundOf(node) {
    for (let el = node; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    if (node === document.documentElement && document.body) {
      const bg = getComputedStyle(document.body).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return '#fff';
  }

  // ------------------------------------------------------------- lazy load
  /**
   * Lazy images and scroll-triggered content only exist once scrolled into
   * view. Walk the scroller down a viewport at a time, then put it back.
   * `instant` overrides a page's `scroll-behavior: smooth`.
   */
  async function prescroll(scroller) {
    document.querySelectorAll('img[loading="lazy"]').forEach(img => { img.loading = 'eager'; });

    const start = scroller.scrollTop;
    for (let i = 0; i < PRESCROLL_STEPS; i++) {
      const before = scroller.scrollTop;
      scroller.scrollTo({ top: before + scroller.clientHeight, behavior: 'instant' });
      await sleep(PRESCROLL_WAIT);
      if (scroller.scrollTop === before) break;   // bottom, nothing new appeared
    }
    scroller.scrollTo({ top: start, behavior: 'instant' });

    const pending = [...document.images].filter(img => !img.complete);
    await Promise.race([
      sleep(IMG_WAIT),
      Promise.all(pending.map(img => new Promise(r => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      }))),
    ]);
    await sleep(PRESCROLL_WAIT);
  }

  // ---------------------------------------------------------------- assets
  /**
   * The renderer inlines every image as a data URL, which a plain fetch can't
   * do for cross-origin images without CORS headers. GM_xmlhttpRequest isn't
   * bound by CORS. Same-origin and data/blob URLs go the normal way.
   */
  function fetchImage(url) {
    let u;
    try { u = new URL(url, location.href); } catch { return Promise.resolve(false); }
    if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return Promise.resolve(false);

    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'GET', url: u.href, responseType: 'blob', timeout: ASSET_TIMEOUT,
        onload: r => {
          if (r.status < 200 || r.status >= 300 || !r.response) return resolve(false);
          let blob = r.response;
          if (!blob.type) {   // SVG images need their type to decode
            const type = (r.responseHeaders.match(/^content-type:\s*([^;\r\n]+)/im) || [])[1];
            if (type) blob = new Blob([blob], { type });
          }
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => resolve(false);
          fr.readAsDataURL(blob);
        },
        onerror: () => resolve(false),
        ontimeout: () => resolve(false),
      });
    });
  }

  // --------------------------------------------------------------- capture
  async function render({ kind, node, scroller }) {
    if (scroller) {
      toast('Scrolling through it…', 'ok', 0);
      await prescroll(scroller);
    }

    let width, height;
    if (kind === 'page') {
      width = scroller.scrollWidth;
      height = scroller.scrollHeight;
    } else if (kind === 'pane') {
      // Sized border-box: its own border and scrollbar gutter included.
      width = node.offsetWidth;
      height = node.scrollHeight + node.offsetHeight - node.clientHeight;
    } else {
      const r = node.getBoundingClientRect();   // what the renderer measures too
      width = Math.ceil(r.width);
      height = Math.ceil(r.height);
    }
    if (!width || !height) throw new Error('that element has no size.');

    // Retina sharpness when it fits; shrink to stay inside the canvas limits.
    const scale = Math.min(devicePixelRatio || 1, MAX_SIDE / width, MAX_SIDE / height,
      Math.sqrt(MAX_AREA / (width * height)));

    // The renderer draws the page as an SVG data: image. A page whose
    // Content-Security-Policy bans data: images gets a blank PNG back, silently.
    let cspBlocked = false;
    const onCsp = e => { if (/^(data|blob)/.test(e.blockedURI)) cspBlocked = true; };
    document.addEventListener('securitypolicyviolation', onCsp);
    toast('Rendering…', 'ok', 0);
    let blob;
    try {
      blob = await modernScreenshot.domToBlob(node, {
        // A plain element keeps its own size; page and pane get their unrolled one.
        ...(kind === 'element' ? {} : { width, height }),
        scale,
        type: 'image/png',
        backgroundColor: backgroundOf(node),
        style: kind === 'pane' ? { boxSizing: 'border-box', maxHeight: 'none', overflow: 'visible' } : null,
        // Hidden menus, dialogs and templates cost clone time and draw nothing.
        filter: n => n.nodeType !== 1 || (n.id !== TOAST_ID && getComputedStyle(n).display !== 'none'),
        fetchFn: fetchImage,
        timeout: ASSET_TIMEOUT,
        progress: (done, total) => toast(`Rendering… ${done}/${total} assets`, 'ok', 0),
      });
      await sleep(0);   // violation events are queued tasks
    } finally {
      document.removeEventListener('securitypolicyviolation', onCsp);
    }
    if (cspBlocked) throw new Error("this site's Content-Security-Policy blocks the image it is drawn from.");
    if (!blob) throw new Error('Rendering produced no image.');
    return { blob, width, height, scale, kind };
  }

  function fileName() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
    const title = (document.title || location.pathname).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100);
    return `${location.hostname} - ${title} - ${stamp}.png`;
  }

  function download(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  function describe({ width, height, scale, kind }) {
    const px = `${Math.floor(width * scale)}×${Math.floor(height * scale)}`;
    const what = { page: 'page', pane: 'scroll pane', element: 'element' }[kind];
    return scale < 1 ? `${what} ${px} (shrunk ${Math.round(scale * 100)}% to fit canvas limits)` : `${what} ${px}`;
  }

  let busy = false;
  async function shoot(to, target) {
    if (busy) return;
    busy = true;
    try {
      const shot = await render(target || pageTarget());
      if (to === 'clipboard') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': shot.blob })]);
          toast(`✓ On clipboard: ${describe(shot)}`, 'good', 4200);
          return;
        } catch (err) {
          console.warn('[full-page-shot] clipboard refused the image, downloading instead', err);
          download(shot.blob);
          toast(`Clipboard refused it, downloaded instead: ${describe(shot)}`, 'ok', 5000);
          return;
        }
      }
      download(shot.blob);
      toast(`✓ Downloaded: ${describe(shot)}`, 'good', 4200);
    } catch (err) {
      console.error('[full-page-shot]', err);
      toast(`Screenshot failed: ${err.message || err}`, 'bad', 6000);
    } finally {
      busy = false;
    }
  }

  // ---------------------------------------------------------------- picker
  // DevTools' box-model colours: margin, border, padding, content.
  const BOX = { margin: 'rgba(246,178,107,.66)', border: 'rgba(255,229,153,.66)',
                padding: 'rgba(147,196,125,.55)', content: 'rgba(111,168,220,.66)' };

  const label = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = [...el.classList].slice(0, 3).map(c => `.${c}`).join('');
    return el.localName + id + cls;
  };

  /** Above an element's parent, crossing out of a shadow root to its host. */
  const parentOf = el => el.parentElement || el.getRootNode().host || null;

  let picking = null;

  function startPicking(to) {
    if (picking) return;
    if (busy) return toast('Still rendering the last one…', 'ok');

    const mk = css => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;pointer-events:none;box-sizing:border-box;'
        + 'z-index:2147483646;display:none;' + css;
      return d;
    };
    const marginBox  = mk(`border-style:solid;border-color:${BOX.margin}`);
    const borderBox  = mk(`border-style:solid;border-color:${BOX.border}`);
    const paddingBox = mk(`border-style:solid;border-color:${BOX.padding};background:${BOX.content}`);
    const tag  = mk(`padding:3px 7px;border-radius:4px;background:#333;color:#fff;white-space:nowrap;
      font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 2px 8px rgba(0,0,0,.4)`);
    const hint = mk(`display:block;bottom:12px;left:50%;transform:translateX(-50%);z-index:2147483647;
      padding:8px 14px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;color:#fff;
      background:#1d9bf0;box-shadow:0 4px 14px rgba(0,0,0,.4)`);
    hint.textContent = 'Click to capture · ↑ parent · ↓ back · Alt+Shift+P whole page · Esc cancel';
    const cursor = document.createElement('style');
    cursor.textContent = '*{cursor:crosshair !important}';
    const boxes = [marginBox, borderBox, paddingBox, tag];
    document.documentElement.append(cursor, ...boxes, hint);

    let trail = [];   // the hovered element, then each ↑ step; the last is selected
    const selected = () => trail[trail.length - 1] || null;
    let frame = 0;

    function place(d, x, y, w, h, [t, r, b, l]) {
      Object.assign(d.style, { display: 'block', left: `${x}px`, top: `${y}px`,
        width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px`,
        borderWidth: `${t}px ${r}px ${b}px ${l}px` });
    }

    function draw() {
      const el = selected();
      if (!el || !el.isConnected) { boxes.forEach(d => { d.style.display = 'none'; }); return; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const sides = f => ['Top', 'Right', 'Bottom', 'Left'].map(s => Math.max(0, parseFloat(cs[f(s)]) || 0));
      const m = sides(s => `margin${s}`), b = sides(s => `border${s}Width`), p = sides(s => `padding${s}`);
      place(marginBox, r.left - m[3], r.top - m[0], r.width + m[1] + m[3], r.height + m[0] + m[2], m);
      place(borderBox, r.left, r.top, r.width, r.height, b);
      place(paddingBox, r.left + b[3], r.top + b[0], r.width - b[1] - b[3], r.height - b[0] - b[2], p);

      tag.textContent = `${label(el)}  ${Math.round(r.width)} × ${Math.round(r.height)}`
        + (scrolls(el) ? `  ↕ unrolls to ${el.scrollHeight}` : '');
      tag.style.display = 'block';
      const tw = tag.offsetWidth, th = tag.offsetHeight;
      let top = r.bottom + m[2] + 6;                            // below, like DevTools
      if (top + th > innerHeight) top = r.top - m[0] - th - 6;  // else above
      top = Math.min(Math.max(top, 4), innerHeight - th - 4);   // else pinned inside
      tag.style.top = `${top}px`;
      tag.style.left = `${Math.min(Math.max(r.left, 4), innerWidth - tw - 4)}px`;
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };

    // composedPath()[0] reaches inside open shadow roots; e.target stops at the host.
    const hit = e => { const t = e.composedPath()[0]; return t && t.nodeType === 1 ? t : null; };
    const eat = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

    const onMove = e => {
      const t = hit(e);
      if (t && t !== trail[0]) { trail = [t]; schedule(); }
    };
    const onClick = e => {
      eat(e);
      const el = selected() || hit(e);
      stop();
      if (el) shoot(to, elementTarget(el));
    };
    const onKey = e => {
      if (e.key === 'Escape') { eat(e); stop(); }
      else if (e.key === 'ArrowUp') {
        eat(e);
        const up = selected() && parentOf(selected());
        if (up) { trail.push(up); schedule(); }
      } else if (e.key === 'ArrowDown') {
        eat(e);
        if (trail.length > 1) { trail.pop(); schedule(); }
      }
    };

    // The page must not react to the picking click: eat the whole sequence.
    const listeners = [
      ['mousemove', onMove], ['scroll', schedule], ['resize', schedule], ['keydown', onKey],
      ['pointerdown', eat], ['mousedown', eat], ['pointerup', eat], ['mouseup', eat], ['click', onClick],
    ];
    listeners.forEach(([type, fn]) => window.addEventListener(type, fn, true));

    function stop() {
      if (frame) cancelAnimationFrame(frame);
      listeners.forEach(([type, fn]) => window.removeEventListener(type, fn, true));
      cursor.remove(); hint.remove(); boxes.forEach(d => d.remove());
      picking = null;
    }
    picking = { stop, to };
  }

  // ------------------------------------------------------------------ hooks
  GM_registerMenuCommand('Pick element → PNG file  (Alt+Shift+P)', () => startPicking('file'), 'p');
  GM_registerMenuCommand('Pick element → clipboard', () => startPicking('clipboard'), 'k');
  GM_registerMenuCommand('Full page → PNG file  (Alt+Shift+P twice)', () => shoot('file'), 'f');
  GM_registerMenuCommand('Full page → clipboard', () => shoot('clipboard'), 'c');

  // First press picks an element; a second press, mid-pick, takes the whole page.
  window.addEventListener('keydown', e => {
    if (!HOTKEY(e)) return;
    e.preventDefault();
    if (picking) { const { to } = picking; picking.stop(); shoot(to); }
    else startPicking('file');
  }, true);
})();

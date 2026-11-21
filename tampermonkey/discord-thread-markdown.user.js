// ==UserScript==
// @name         Discord Thread → Markdown (for AI agents)
// @namespace    local.tools
// @version      0.11.0
// @description  Copy a Discord conversation as markdown, with per-message permalinks, attachment URLs and author avatars.
// @match        https://discord.com/channels/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/discord-thread-markdown.user.js
// @updateURL    https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/discord-thread-markdown.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const FORMAT      = 'markdown';   // 'markdown' | 'json'
  const MAX_ANCHORED = 100;         // cap when copying from a clicked message

  const HOTKEY_ALL  = e => e.altKey && e.shiftKey && e.code === 'KeyC';  // whole view / selection
  const HOTKEY_PICK = e => e.altKey && e.shiftKey && e.code === 'KeyX';  // click a start message

  // Both <li> messages and the thread-starter <div> carry this id prefix.
  const MSG     = '[id^="chat-messages-"]';
  const STARTER = '[class*="quotedChatMessage"]';
  const REPLYCX = '[id^="message-reply-context-"]';
  const SNOWFLK = /(\d{17,21})$/;

  const ASSET_OK = /^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net)\/(attachments|external)\//;

  // Inside the message element but not message content. The first two matter
  // most: Discord ships screen-reader text that is clipped, not hidden, so
  // innerText picks it up ("Server Tag: NILO", full edit dates...).
  const NOISE = [
    '[class*="hiddenVisually"]', '[class*="copyOnlyText"]', '[class*="chipletContainer"]',
    '[class*="roleIcon"]', '[class*="reactions"]', '[class*="hoverButton"]',
    '[class*="buttonContainer"]', '[class*="attachment"]', '[class*="imageContainer"]',
    '[class*="mediaAttachment"]', '[class*="loadingOverlay"]', 'time',
  ].join(',');

  // ------------------------------------------------------------- utilities
  let sandbox = null;
  const openSandbox = () => {
    sandbox = document.createElement('div');
    sandbox.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;white-space:pre-wrap';
    document.body.appendChild(sandbox);
  };
  const closeSandbox = () => { sandbox?.remove(); sandbox = null; };

  function richText(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll(NOISE).forEach(n => n.remove());
    clone.querySelectorAll('code').forEach(c => {
      if (!c.closest('pre')) c.textContent = '`' + c.textContent + '`';
    });
    clone.querySelectorAll('img').forEach(img => {
      const alt = (img.getAttribute('alt') || '').trim();
      img.replaceWith(document.createTextNode(/^(image|gif|video|thumbnail|)$/i.test(alt) ? '' : alt));
    });
    sandbox.replaceChildren(clone);
    return sandbox.innerText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function cleanUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      for (const p of ['width', 'height', 'size', 'quality', '']) u.searchParams.delete(p);
      return u.href;
    } catch { return raw; }
  }

  function assetsIn(host) {
    const byKey = new Map();
    host.querySelectorAll('a[href], img[src], video[src], source[src], video[poster]').forEach(el => {
      for (const raw of [el.getAttribute('href'), el.getAttribute('src'), el.getAttribute('poster')]) {
        if (!raw) continue;
        let abs;
        try { abs = new URL(raw, location.href).href; } catch { continue; }
        if (!ASSET_OK.test(abs)) continue;

        const url  = cleanUrl(abs);
        const m    = url.match(/\/attachments\/\d+\/(\d+)\/([^?/]+)/);
        const key  = m ? m[1] : url.split('?')[0];
        const name = decodeURIComponent(m ? m[2] : url.split('?')[0].split('/').pop() || 'asset');
        const prev = byKey.get(key);
        const better = !prev
          || (/media\.discordapp\.net/.test(prev.url) && /cdn\.discordapp\.com/.test(url));
        if (better) byKey.set(key, { name, url });
      }
    });
    return [...byKey.values()];
  }

  function linksIn(roots) {
    const set = new Set();
    for (const root of roots.filter(Boolean)) {
      root.querySelectorAll('a[href]').forEach(a => {
        const h = a.href;
        if (!h || ASSET_OK.test(h) || h.startsWith('javascript:')) return;
        if (h.startsWith('https://discord.com/channels/')) return;
        set.add(h);
      });
    }
    return [...set];
  }

  /** Only the first message of a group renders an avatar; reply previews carry the replied-to author's. */
  function avatarIn(host) {
    const img = [...host.querySelectorAll('img[class*="avatar"]')]
      .find(i => !i.closest(REPLYCX) && !/decoration/i.test(i.className));
    const src = img?.getAttribute('src');
    if (!src) return null;
    try {
      const u = new URL(src, location.href);
      u.search = '';
      if (u.hostname === 'cdn.discordapp.com') u.searchParams.set('size', '128');
      return u.href;
    } catch { return null; }
  }

  // --------------------------------------------------------- host discovery
  function messageHosts() {
    const hosts = new Set();
    document.querySelectorAll(MSG).forEach(n => hosts.add(n));

    document.querySelectorAll('time[datetime]').forEach(t => {
      if (t.closest(REPLYCX) || t.closest(MSG)) return;
      const host = t.closest(`li, ${STARTER}, [class*="message"]`);
      if (host) hosts.add(host);
    });

    return [...hosts].filter(Boolean).sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
  }

  function messageId(host) {
    const own = host.id?.match(/^chat-messages-.*?(\d{17,21})$/);
    if (own) return own[1];
    const el = [...host.querySelectorAll(MSG)].find(n => n.id);
    return el ? (el.id.match(SNOWFLK) || [])[1] : null;
  }

  /** The starter message labels its children with the THREAD id, not its own. */
  function pick(host, ids, prefix, classHint) {
    for (const id of ids) {
      if (!id) continue;
      const el = host.querySelector(`[id="${prefix}${id}"]`);
      if (el && !el.closest(REPLYCX)) return el;
    }
    return [...host.querySelectorAll(`[class*="${classHint}"]`)].find(el => !el.closest(REPLYCX)) || null;
  }

  // ----------------------------------------------------------------- build
  function context() {
    const m = location.pathname.match(/^\/channels\/([^/]+)\/(\d+)/);
    if (!m) throw new Error('Open a channel or thread first.');
    return { guildId: m[1], channelId: m[2] };
  }

  function build(nodes, meta = {}) {
    const { guildId, channelId } = context();
    if (!nodes.length) throw new Error('No messages found.');

    openSandbox();
    let lastAuthor = '(unknown)';
    const seen = new Set();
    const avatars = new Map();   // author → avatar URL, first seen wins

    const messages = nodes.map(host => {
      const id = messageId(host);
      if (!id || seen.has(id)) return null;
      seen.add(id);

      const ids       = [id, channelId];
      const contentEl = pick(host, ids, 'message-content-',     'messageContent');
      const headerEl  = pick(host, ids, 'message-username-',    'username');
      const accEl     = pick(host, ids, 'message-accessories-', 'messageAccessories');
      const replyEl   = host.querySelector(REPLYCX);

      const author = richText(
        headerEl?.matches('[class*="username"]') ? headerEl
          : headerEl?.querySelector('[class*="username"]') || headerEl
      ) || lastAuthor;
      lastAuthor = author;
      const avatar = avatarIn(host);
      if (avatar && !avatars.has(author)) avatars.set(author, avatar);

      const text   = richText(contentEl);
      const reply  = richText(replyEl?.querySelector('[class*="repliedTextContent"]') || replyEl);
      const embed  = richText(accEl);
      const assets = assetsIn(host);
      const links  = linksIn([contentEl, accEl]);

      if (!text && !assets.length && !embed) return null;   // thread header, joins, dividers

      return {
        id, author,
        isThreadStarter: !!host.closest(STARTER),
        timestamp: host.querySelector('time[datetime]')?.getAttribute('datetime') || '',
        permalink: `https://discord.com/channels/${guildId}/${channelId}/${id}`,
        replyingTo: reply || null,
        text, embed: embed || null, assets, links,
      };
    }).filter(Boolean);

    closeSandbox();
    const authors = new Set(messages.map(m => m.author));
    return {
      source: document.title.replace(/^\(\d+\)\s*/, ''),
      url: location.href,
      exportedAt: new Date().toISOString(),
      messages,
      avatars: Object.fromEntries([...avatars].filter(([a]) => authors.has(a))),
      ...meta,
    };
  }

  /** Whole rendered view, or just the current text selection. */
  function scrapeAll() {
    const sel    = window.getSelection();
    const scoped = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
    let nodes = messageHosts();
    if (scoped) nodes = nodes.filter(n => sel.containsNode(n, true));
    return build(nodes, { mode: scoped ? 'selection' : 'view' });
  }

  /** From a clicked message down to the newest rendered one, capped. */
  function scrapeFrom(host) {
    const anchorId = messageId(host);
    if (!anchorId) throw new Error("Couldn't identify that message.");

    // Recompute rather than trusting a stale list — virtualization may have moved on.
    const all = messageHosts();
    const i = all.findIndex(h => messageId(h) === anchorId);
    if (i < 0) throw new Error('That message is no longer rendered.');

    const available = all.length - i;
    return build(all.slice(i, i + MAX_ANCHORED), {
      mode: 'anchored',
      anchorId,
      truncated: available > MAX_ANCHORED,
    });
  }

  // ---------------------------------------------------------------- render
  function toMarkdown(d) {
    const scope = d.mode === 'selection' ? ' (selection only)'
                : d.mode === 'anchored'  ? ` (from ${d.anchorId} onward${d.truncated ? `, capped at ${MAX_ANCHORED}` : ''})`
                : '';
    const out = [
      `# ${d.source}`, `${d.url}`,
      `Captured ${d.exportedAt} — ${d.messages.length} message(s)${scope}`, '',
    ];
    for (const m of d.messages) {
      out.push('---', `**${m.author}** · ${m.timestamp} · [permalink](${m.permalink})`
        + (m.isThreadStarter ? '  _(thread starter)_' : ''));
      if (m.replyingTo) out.push(`> ↩︎ ${m.replyingTo.replace(/\s+/g, ' ').slice(0, 220)}`);
      if (m.text)  out.push('', m.text);
      if (m.embed) out.push('', `_embed:_ ${m.embed.replace(/\s+/g, ' ')}`);
      if (m.assets.length) {
        out.push('', 'Attachments:');
        m.assets.forEach(a => out.push(`- [${a.name}](${a.url})`));
      }
      if (m.links.length) {
        out.push('', 'Links:');
        m.links.forEach(l => out.push(`- ${l}`));
      }
      out.push('');
    }
    const avatars = Object.entries(d.avatars);
    if (avatars.length) {
      out.push('---', '', 'Avatars:');
      avatars.forEach(([a, url]) => out.push(`- **${a}**: ${url}`));
    }
    return out.join('\n');
  }

  // ------------------------------------------------------------------- I/O
  const copy = text => (typeof GM_setClipboard === 'function')
    ? (GM_setClipboard(text, 'text'), Promise.resolve())
    : navigator.clipboard.writeText(text);

  function toast(msg, ok = true) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      z-index:2147483647;padding:10px 16px;border-radius:8px;font:14px/1.4 system-ui,sans-serif;
      color:#fff;background:${ok ? '#248046' : '#a12d2f'};box-shadow:0 4px 14px rgba(0,0,0,.4)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  async function emit(makeData) {
    try {
      const data = makeData();
      const body = FORMAT === 'json' ? JSON.stringify(data, null, 2) : toMarkdown(data);
      const text = `<discord-transcript>\n${body}\n</discord-transcript>`;
      console.log(text);
      await copy(text);
      const note = data.truncated ? ` (capped at ${MAX_ANCHORED})` : '';
      toast(`Copied ${data.messages.length} message(s)${note}`);
      flashFab('copy');
      return text;
    } catch (err) {
      closeSandbox();
      console.error(err);
      toast(err.message, false);
    }
  }

  // -------------------------------------------------------------- pick mode
  let picking = null;
  let setPickActive = () => {};   // wired up by the floating buttons

  function startPicking() {
    if (picking) return;

    const style = document.createElement('style');
    style.textContent = '*{cursor:crosshair !important}';
    const mk = css => { const d = document.createElement('div'); d.style.cssText = css; return d; };

    const head = mk(`position:fixed;pointer-events:none;z-index:2147483646;display:none;
      border:2px solid #5865f2;border-radius:6px;background:rgba(88,101,242,.18)`);
    // the rest of the range — messages are contiguous, so one rect beats 99 boxes
    const tail = mk(`position:fixed;pointer-events:none;z-index:2147483645;display:none;
      border-left:2px solid rgba(88,101,242,.5);background:rgba(88,101,242,.07)`);
    const hint = mk(`position:fixed;top:16px;left:50%;transform:translateX(-50%);
      z-index:2147483647;padding:8px 14px;border-radius:8px;pointer-events:none;
      font:13px/1.4 system-ui,sans-serif;color:#fff;background:#5865f2;box-shadow:0 4px 14px rgba(0,0,0,.4)`);
    hint.textContent = `Click a message — copies from there down (max ${MAX_ANCHORED}). Esc to cancel.`;

    document.head.appendChild(style);
    document.body.append(tail, head, hint);

    let hosts   = messageHosts();
    let current = null;
    let dirty   = false;
    let frame   = 0;

    const hostAt = t => (t instanceof Element ? t.closest(`${MSG}, ${STARTER}`) : null);
    const hide = () => { head.style.display = tail.style.display = 'none'; };

    function redraw() {
      if (dirty) { hosts = messageHosts(); dirty = false; }
      const host = current;
      if (!host || !host.isConnected) return hide();

      // identity lookup, no id parsing — this runs on every mousemove
      let i = hosts.indexOf(host);
      if (i < 0) { hosts = messageHosts(); i = hosts.indexOf(host); }
      if (i < 0) return hide();

      const count = Math.min(hosts.length - i, MAX_ANCHORED);
      const a = host.getBoundingClientRect();
      const b = hosts[i + count - 1].getBoundingClientRect();

      Object.assign(head.style, { display: 'block', top: `${a.top}px`, left: `${a.left}px`,
        width: `${a.width}px`, height: `${a.height}px` });

      const clipBottom = host.closest('[class*="scroller"]')?.getBoundingClientRect().bottom ?? Infinity;
      const bottom = Math.min(b.bottom, clipBottom);
      if (bottom - a.bottom > 2) {
        Object.assign(tail.style, { display: 'block', top: `${a.bottom}px`, left: `${a.left}px`,
          width: `${a.width}px`, height: `${bottom - a.bottom}px` });
      } else {
        tail.style.display = 'none';
      }

      hint.textContent = `${count} message${count === 1 ? '' : 's'} from here`
        + (count === MAX_ANCHORED ? ` (cap — more below)` : '') + ' — Esc to cancel';
    }

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; redraw(); });
    };

    const onMove = e => {
      const host = hostAt(e.target);
      if (!host) { current = null; return hide(); }
      current = host;
      redraw();
    };
    // virtualization swaps rows in and out as you scroll, so the list goes stale
    const onScroll = () => { dirty = true; schedule(); };

    // Swallow the whole click sequence so Discord doesn't also act on it.
    const eat = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    const onDown = e => { if (hostAt(e.target)) eat(e); };
    const onClick = e => {
      const host = hostAt(e.target);
      if (!host) return;
      eat(e);
      stop();
      emit(() => scrapeFrom(host));
    };
    const onKey = e => { if (e.key === 'Escape') { eat(e); stop(); } };

    function stop() {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mouseup', onDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      style.remove(); head.remove(); tail.remove(); hint.remove();
      picking = null;
      setPickActive(false);
    }

    picking = { stop };
    setPickActive(true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseup', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  // -------------------------------------------------------- floating buttons
  // Two tiny pills, absolutely overlaid in the empty leading corner of the
  // title bar. Bright enough to find instantly, small enough to ignore.
  let flashFab = () => {};

  function mountFab() {
    if (document.getElementById('dmd-fab') || !document.body) return;

    const css = document.createElement('style');
    css.id = 'dmd-fab-style';
    css.textContent = `
      #dmd-fab{position:fixed;top:5px;left:10px;z-index:2147483644;display:flex;gap:1px;
        -webkit-app-region:no-drag;app-region:no-drag}
      .dmd-btn{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 10px 0 8px;
        border:none;cursor:pointer;user-select:none;color:#fff;
        font:700 10px/1 system-ui,-apple-system,sans-serif;letter-spacing:.6px;text-transform:uppercase;
        box-shadow:0 1px 6px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.25);
        transition:filter .13s, box-shadow .13s}
      .dmd-btn svg{width:11px;height:11px;flex:none}
      .dmd-btn:hover{filter:brightness(1.15) saturate(1.1)}
      .dmd-btn:active{filter:brightness(.9)}
      .dmd-copy{border-radius:11px 0 0 11px;background:linear-gradient(135deg,#00c2ff,#5865f2 55%,#7b3ff2)}
      .dmd-copy:hover{box-shadow:0 2px 12px rgba(88,101,242,.65), inset 0 1px 0 rgba(255,255,255,.25)}
      .dmd-pick{border-radius:0 11px 11px 0;background:linear-gradient(135deg,#ffb03a,#ff5e62 60%,#ff2e88)}
      .dmd-pick:hover{box-shadow:0 2px 12px rgba(255,94,98,.6), inset 0 1px 0 rgba(255,255,255,.25)}
      .dmd-pick.dmd-on{background:linear-gradient(135deg,#12d18e,#00b8d9);
        animation:dmd-pulse 1.1s ease-in-out infinite}
      @keyframes dmd-pulse{
        0%,100%{box-shadow:0 0 0 0 rgba(18,209,142,.55), 0 1px 6px rgba(0,0,0,.45)}
        50%{box-shadow:0 0 0 6px rgba(18,209,142,0), 0 1px 6px rgba(0,0,0,.45)}}
      .dmd-btn.dmd-ok{background:linear-gradient(135deg,#12d18e,#0aa66f) !important}
    `;

    const wrap = document.createElement('div');
    wrap.id = 'dmd-fab';

    const btn = (cls, title, svg, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `dmd-btn ${cls}`;
      b.title = title;
      b.innerHTML = `${svg}<span>${label}</span>`;
      // don't steal focus or collapse an active text selection —
      // scrapeAll() uses the selection to scope the copy
      b.addEventListener('mousedown', e => e.preventDefault());
      return b;
    };

    const copyBtn = btn('dmd-copy', 'Copy visible messages / selection as Markdown  (Alt+Shift+C)',
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>
      </svg>`, 'md');

    const pickBtn = btn('dmd-pick', 'Pick a start message, copy from there down  (Alt+Shift+X · Esc cancels)',
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <circle cx="12" cy="12" r="3.4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
      </svg>`, 'pick');

    copyBtn.addEventListener('click', () => emit(scrapeAll));
    pickBtn.addEventListener('click', () => (picking ? picking.stop() : startPicking()));

    wrap.append(copyBtn, pickBtn);
    document.head.appendChild(css);
    document.body.appendChild(wrap);

    setPickActive = on => pickBtn.classList.toggle('dmd-on', on);
    flashFab = which => {
      const b = which === 'copy' ? copyBtn : pickBtn;
      const label = b.querySelector('span'), old = label.textContent;
      b.classList.add('dmd-ok');
      label.textContent = '✓';
      setTimeout(() => { b.classList.remove('dmd-ok'); label.textContent = old; }, 900);
    };
  }

  mountFab();
  setInterval(mountFab, 3000);   // cheap self-heal if Discord ever nukes the DOM

  // ----------------------------------------------------------------- debug
  function dprobe() {
    const hosts = messageHosts();
    console.table(hosts.map((h, i) => ({
      i, tag: h.tagName, starter: !!h.closest(STARTER),
      id: h.id || '(none)', derivedId: messageId(h) || '(none)',
      time: h.querySelector('time[datetime]')?.getAttribute('datetime') || '(none)',
      text: (h.textContent || '').replace(/\s+/g, ' ').slice(0, 60),
    })));
    return hosts;
  }

  window.addEventListener('keydown', e => {
    if (HOTKEY_ALL(e))  { e.preventDefault(); emit(scrapeAll); }
    if (HOTKEY_PICK(e)) { e.preventDefault(); startPicking(); }
  }, true);

  window.dcopy = () => emit(scrapeAll);
  window.dprobe = dprobe;
  console.info('[discord→md] ready — Alt+Shift+C all, Alt+Shift+X pick. Debug: dprobe()');
})();

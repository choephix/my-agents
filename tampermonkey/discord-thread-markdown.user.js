// ==UserScript==
// @name         Discord Thread → Markdown (for AI agents)
// @namespace    local.tools
// @version      0.13.0
// @description  Copy a Discord conversation as markdown, auto-scrolling through lazy-loaded messages, with per-message permalinks, attachment URLs and author avatars.
// @match        https://discord.com/channels/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/discord-thread-markdown.user.js
// @updateURL    https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/discord-thread-markdown.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const FORMAT         = 'markdown';   // 'markdown' | 'json'
  const MAX_ALL        = 500;          // safety cap for full-view auto-scroll (md / Alt+Shift+C)
  const MAX_ANCHORED   = 100;          // cap when copying from a clicked message (pick / Alt+Shift+X)
  const MAX_RANGE      = 500;          // cap when copying an explicit start..end range (range / Alt+Shift+R)
  const SCROLL_OVERLAP = 0.72;         // fraction of viewport height per fallback scroll step
  const STEP_WAIT_MS   = 80;           // settle time after a page loads / local scroll step
  const REARM_MS       = 550;          // wait before re-arming Discord's post-eviction edge trigger
  const EDGE_WAIT_MS   = 2200;         // wait at top/bottom edge for Discord to fetch more messages
  const EDGE_QUIET_MS  = 450;          // quicker settle at live bottom (no skeleton / jump bar)
  const EDGE_MAX_MS    = 6000;         // hard cap waiting on a single stalled fetch
  const MAX_STEPS      = 600;          // safety guard against runaway scroll loops

  const HOTKEY_ALL   = e => e.altKey && e.shiftKey && e.code === 'KeyC';  // whole view / selection
  const HOTKEY_PICK  = e => e.altKey && e.shiftKey && e.code === 'KeyX';  // click a start message (to bottom)
  const HOTKEY_RANGE = e => e.altKey && e.shiftKey && e.code === 'KeyR';  // click start & end messages

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
    if (sandbox?.isConnected) return;
    sandbox = document.createElement('div');
    sandbox.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;white-space:pre-wrap';
    document.body.appendChild(sandbox);
  };
  const closeSandbox = () => { sandbox?.remove(); sandbox = null; };

  /** Compare positive decimal Snowflake IDs chronologically without BigInt overhead. */
  function cmpId(a, b) {
    if (a === b) return 0;
    return a.length !== b.length ? a.length - b.length : (a < b ? -1 : 1);
  }

  const nextFrame = (signal) => new Promise(resolve => {
    if (signal?.aborted) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const t = setTimeout(finish, 50);
    signal?.addEventListener('abort', finish, { once: true });
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
  });

  function dispatchScroll(scroller, isUp = null) {
    if (typeof scroller?.dispatchEvent !== 'function') return;
    if (isUp !== null && typeof WheelEvent === 'function') {
      scroller.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: isUp ? -120 : 120,
      }));
    }
    if (typeof Event === 'function') {
      scroller.dispatchEvent(new Event('scroll'));
    }
  }

  function sleep(ms, signal) {
    if (signal?.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(t);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const t = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

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
  function messageHosts(root = document) {
    if (!root) return [];
    const hosts = new Set();
    root.querySelectorAll(MSG).forEach(n => hosts.add(n));

    root.querySelectorAll('time[datetime]').forEach(t => {
      if (t.closest(REPLYCX) || t.closest(MSG)) return;
      const host = t.closest(`li, ${STARTER}, [class*="message"]`);
      if (host && (root === document || root.contains(host))) hosts.add(host);
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

  function isScrollableY(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  function scrollerFor(el) {
    let fallback = null;
    for (let cur = el?.parentElement; cur; cur = cur.parentElement) {
      if (!isScrollableY(cur)) continue;
      if (!fallback) fallback = cur;
      if (cur.scrollHeight > cur.clientHeight + 1 || /scroller/i.test(cur.className || '')) return cur;
    }
    return fallback || el?.closest('[class*="scroller"]') || null;
  }

  function findActiveScroller(channelId) {
    const seen = new Set();
    const candidates = [];
    for (const host of messageHosts(document)) {
      const sc = scrollerFor(host);
      if (!sc || seen.has(sc)) continue;
      seen.add(sc);
      const hosts = messageHosts(sc);
      const matchesChannel = !!channelId && hosts.some(h =>
        !h.closest(STARTER) && h.id?.startsWith(`chat-messages-${channelId}-`));
      const hasFocus = !!document.activeElement && sc.contains(document.activeElement);
      candidates.push({ sc, count: hosts.length, matchesChannel, hasFocus });
    }
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0].sc;
    return (candidates.find(c => c.matchesChannel)
      || candidates.find(c => c.hasFocus)
      || candidates[candidates.length - 1]).sc;
  }

  const atScrollBottom = sc => sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;

  function hasJumpToPresent(sc) {
    return !!sc?.parentElement?.querySelector('[class*="jumpToPresentBar"]');
  }

  /**
   * Discord renders ~2046px skeleton placeholder <div>s (filled with aria-hidden blob rows)
   * directly before the first <li> when older messages exist, and after the last <li> when
   * newer messages exist. Returns null if the standard chat <ol> isn't present.
   */
  function skeletonEdges(sc) {
    const ol = sc?.querySelector('ol[data-list-id="chat-messages"]');
    if (!ol) return null;
    const kids = [...ol.children];
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].id?.startsWith('chat-messages-')) {
        if (firstIdx < 0) firstIdx = i;
        lastIdx = i;
      }
    }
    if (firstIdx < 0) return null;
    const isSkel = el => el.tagName === 'DIV' && (
      !!el.querySelector('[class*="blob_"], [aria-hidden="true"] [class*="blob"]')
      || (el.children.length >= 5 && el.firstElementChild?.getAttribute('aria-hidden') === 'true')
    );
    return {
      before: firstIdx > 0 && kids.slice(0, firstIdx).some(isSkel),
      after:  kids.slice(lastIdx + 1).some(isSkel),
    };
  }

  function hasMoreBelow(sc) {
    if (!sc) return false;
    const skel = skeletonEdges(sc);
    if (skel?.after) return true;
    return !atScrollBottom(sc) || hasJumpToPresent(sc);
  }

  // ----------------------------------------------------------------- build
  function context(scroller = null) {
    const m = location.pathname.match(/^\/channels\/([^/]+)\/(\d+)(?:\/threads\/(\d+))?/);
    if (!m) throw new Error('Open a channel or thread first.');
    const guildId = m[1];
    let channelId = m[3] || m[2];
    if (scroller) {
      // In split-pane view (main channel + thread sidebar), derive channelId from the pane's own messages.
      const sample = [...scroller.querySelectorAll(MSG)].find(n => !n.closest(STARTER) && n.id);
      const cm = sample?.id?.match(/^chat-messages-(\d{17,21})-(\d{17,21})$/);
      if (cm) channelId = cm[1];
    }
    return { guildId, channelId };
  }

  function createHarvestState() {
    return {
      byId: new Map(),     // messageId → raw harvested record
      avatars: new Map(),  // author → avatar URL (first seen wins)
    };
  }

  function extractAuthor(host, ids) {
    const headerEl = pick(host, ids, 'message-username-', 'username');
    return richText(
      headerEl?.matches('[class*="username"]') ? headerEl
        : headerEl?.querySelector('[class*="username"]') || headerEl
    ) || null;
  }

  /**
   * Harvest currently mounted messages under `root` into `state`.
   * Already-harvested IDs are skipped (no DOM cloning / innerText layout flush)
   * while still advancing `lastAuthor` for continuation messages below them.
   */
  function harvestSnapshot(root, ctx, state, includeHost = null) {
    const { guildId, channelId } = ctx;
    const hosts = messageHosts(root);
    let lastAuthor = null;

    for (const host of hosts) {
      const id = messageId(host);
      if (!id) continue;

      const existing = state.byId.get(id);
      if (existing) {
        const a = existing.ownAuthor || existing.hintAuthor || lastAuthor;
        if (a) {
          if (!existing.hintAuthor) existing.hintAuthor = a;
          lastAuthor = a;
        }
        if (!existing.avatar) {
          const av = avatarIn(host);
          if (av) existing.avatar = av;
        }
        continue;
      }

      const ids       = [id, channelId];
      const ownAuthor = extractAuthor(host, ids);
      const effective = ownAuthor || lastAuthor;
      if (effective) lastAuthor = effective;

      const avatar = avatarIn(host);
      if (avatar && effective && !state.avatars.has(effective)) {
        state.avatars.set(effective, avatar);
      }

      if (includeHost && !includeHost(host)) continue;

      const contentEl = pick(host, ids, 'message-content-',     'messageContent');
      const accEl     = pick(host, ids, 'message-accessories-', 'messageAccessories');
      const replyEl   = host.querySelector(REPLYCX);

      const text   = richText(contentEl);
      const reply  = richText(replyEl?.querySelector('[class*="repliedTextContent"]') || replyEl);
      const embed  = richText(accEl);
      const assets = assetsIn(host);
      const links  = linksIn([contentEl, accEl]);

      if (!text && !assets.length && !embed) continue;   // thread header, joins, dividers

      state.byId.set(id, {
        id,
        ownAuthor,
        hintAuthor: effective,
        avatar,
        isThreadStarter: !!host.closest(STARTER),
        timestamp: host.querySelector('time[datetime]')?.getAttribute('datetime') || '',
        permalink: `https://discord.com/channels/${guildId}/${channelId}/${id}`,
        replyingTo: reply || null,
        text,
        embed: embed || null,
        assets,
        links,
      });
    }
  }

  /**
   * Sort harvested records chronologically, resolve continuation-message authors
   * across scroll boundaries, slice to anchor/cap, and assemble the payload.
   */
  function finalize(state, {
    anchorId = null,
    anchorIsStarter = false,
    endId = null,
    endIsStarter = false,
    max = Infinity,
    keepNewest = false,
    meta = {},
  } = {}) {
    const sorted = [...state.byId.values()].sort((a, b) => {
      if (a.isThreadStarter !== b.isThreadStarter) return a.isThreadStarter ? -1 : 1;
      return cmpId(a.id, b.id);
    });

    const avatars = new Map(state.avatars);
    let lastAuthor = '(unknown)';
    const resolved = sorted.map(m => {
      const author = m.ownAuthor
        || (lastAuthor !== '(unknown)' ? lastAuthor : null)
        || m.hintAuthor
        || '(unknown)';
      lastAuthor = author;
      if (m.avatar && author !== '(unknown)' && !avatars.has(author)) {
        avatars.set(author, m.avatar);
      }
      return {
        id: m.id,
        author,
        isThreadStarter: m.isThreadStarter,
        timestamp: m.timestamp,
        permalink: m.permalink,
        replyingTo: m.replyingTo,
        text: m.text,
        embed: m.embed,
        assets: m.assets,
        links: m.links,
      };
    });

    let messages = resolved;
    if (anchorId && !anchorIsStarter) {
      messages = messages.filter(m => cmpId(m.id, anchorId) >= 0);
    }
    if (endId) {
      messages = messages.filter(m => (endIsStarter ? m.isThreadStarter : cmpId(m.id, endId) <= 0));
    }

    const truncated = messages.length > max;
    if (truncated) {
      messages = keepNewest ? messages.slice(-max) : messages.slice(0, max);
    }

    if (!messages.length) throw new Error('No messages found.');

    const authors = new Set(messages.map(m => m.author));
    return {
      source: document.title.replace(/^\(\d+\)\s*/, ''),
      url: location.href,
      exportedAt: new Date().toISOString(),
      messages,
      avatars: Object.fromEntries([...avatars].filter(([a]) => authors.has(a))),
      ...meta,
      ...(truncated ? { truncated: true, cap: max } : {}),
    };
  }

  // ----------------------------------------------------- auto-scroll harvest
  let harvesting = null;   // { stop(), which } when an auto-scroll harvest is running

  function domBoundaryIds(scroller) {
    const hosts = messageHosts(scroller);
    let first = null, last = null;
    for (let i = 0; i < hosts.length; i++) {
      const id = messageId(hosts[i]);
      if (id) { first = id; break; }
    }
    for (let i = hosts.length - 1; i >= 0; i--) {
      const id = messageId(hosts[i]);
      if (id) { last = id; break; }
    }
    return { hosts, first, last };
  }

  function visibleAnchor(scroller) {
    if (typeof scroller.getBoundingClientRect !== 'function') return null;
    const sTop = scroller.getBoundingClientRect().top;
    const host = messageHosts(scroller).find(h =>
      typeof h.getBoundingClientRect === 'function' && h.getBoundingClientRect().bottom > sTop + 20);
    if (!host) return null;
    const id = messageId(host);
    return id ? { id, domId: host.id || null, offset: host.getBoundingClientRect().top - sTop } : null;
  }

  /**
   * Move the scroller onto the real-message / skeleton boundary so Discord's
   * managedReactiveScroller triggers its next lazy page fetch (Discord's trigger
   * zone starts 500px inside the real messages from the ~2046px skeleton edge).
   * Dispatches both `wheel` (clears Discord's `loadMorePausedUntilUserScroll` guard)
   * and `scroll` (fires `handleScroll` immediately even if already at the boundary
   * or if Chromium coalesced the native scroll event).
   */
  function scrollToBoundary(scroller, isUp) {
    const hosts = messageHosts(scroller);
    if (!hosts.length) return false;
    const target = isUp ? hosts[0] : hosts[hosts.length - 1];
    if (typeof target.scrollIntoView !== 'function') return false;
    target.scrollIntoView({ block: isUp ? 'start' : 'end' });
    dispatchScroll(scroller, isUp);
    return true;
  }

  /**
   * If Discord's trigger stays paused after an eviction, visit the middle of the
   * mounted messages (region 0, which explicitly clears `loadMorePausedUntilUserScroll`
   * on scroll) and then cross back into the top/bottom trigger region.
   */
  async function rearmBoundary(scroller, isUp, signal) {
    const hosts = messageHosts(scroller);
    if (!hosts.length) return;
    const midEl = hosts[Math.floor(hosts.length / 2)];
    if (typeof midEl.scrollIntoView === 'function') {
      midEl.scrollIntoView({ block: 'center' });
      dispatchScroll(scroller, null);
    }
    await sleep(120, signal);
    if (signal.aborted || !scroller.isConnected) return;
    scrollToBoundary(scroller, isUp);
  }

  /**
   * Wait at the top or bottom boundary of `scroller` for Discord's lazy loader to
   * mount older/newer messages. Tracks the *DOM* boundary ID (not global harvest
   * extremes, which may already contain older IDs from an earlier down-sweep) and
   * never mistakes Discord's skeleton clamp bounce for loaded content.
   */
  async function waitForPage(scroller, dir, startBoundary, sawSkel, harvestFn, signal, onWait) {
    const isUp = dir === 'up';
    const hasSkel = () => {
      const sk = skeletonEdges(scroller);
      return sk ? (isUp ? sk.before : sk.after) : false;
    };

    // If scrolling up and the thread starter is already the first mounted message, we're at the top.
    if (isUp && messageHosts(scroller)[0]?.closest(STARTER)) {
      await sleep(120, signal);
      harvestFn();
      return false;
    }

    const baseWait = (!isUp && !hasSkel() && !hasJumpToPresent(scroller))
      ? EDGE_QUIET_MS
      : EDGE_WAIT_MS;

    let lastMutationAt = 0;
    const obs = new MutationObserver(() => { lastMutationAt = performance.now(); });
    obs.observe(scroller, { childList: true, subtree: true });

    const startTime    = performance.now();
    let deadline       = startTime + baseWait;
    const hardDeadline = startTime + EDGE_MAX_MS;
    let rearms         = 0;

    onWait?.();

    try {
      while (!signal.aborted && scroller.isConnected) {
        await sleep(100, signal);
        if (signal.aborted || !scroller.isConnected) return false;

        harvestFn();
        const cur = domBoundaryIds(scroller);

        if (isUp) {
          if (cur.first && (!startBoundary.first || cmpId(cur.first, startBoundary.first) < 0)) {
            await sleep(STEP_WAIT_MS, signal);
            harvestFn();
            return true;
          }
        } else {
          if (cur.last && (!startBoundary.last || cmpId(cur.last, startBoundary.last) > 0)) {
            await sleep(STEP_WAIT_MS, signal);
            harvestFn();
            return true;
          }
        }

        // If a skeleton was present and just vanished, Discord has reached the true edge.
        if (sawSkel && !hasSkel() && (isUp || !hasJumpToPresent(scroller))) {
          return false;
        }

        const now = performance.now();
        const elapsed = now - startTime;

        // Re-arm Discord's trigger if it stayed disarmed after an eviction (up to 2 attempts).
        const nextRearmAt = rearms === 0 ? REARM_MS : REARM_MS * 3;
        if (rearms < 2 && baseWait >= 1000 && elapsed >= nextRearmAt) {
          rearms++;
          if (sawSkel || hasSkel()) {
            await rearmBoundary(scroller, isUp, signal);
          } else {
            const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            const nudge = Math.min(Math.max(200, Math.floor(scroller.clientHeight * 0.5)), maxTop);
            if (isUp && maxTop > 0) {
              scroller.scrollTop = nudge;
              await sleep(120, signal);
              scroller.scrollTop = 0;
            } else if (!isUp && maxTop > 0) {
              scroller.scrollTop = Math.max(0, maxTop - nudge);
              await sleep(120, signal);
              scroller.scrollTop = scroller.scrollHeight;
            }
          }
          continue;
        }

        if (now >= hardDeadline) return false;
        if (now >= deadline) {
          if (lastMutationAt && now - lastMutationAt < 600) {
            deadline = Math.min(hardDeadline, now + 800);
          } else {
            return false;
          }
        }
      }
      return false;
    } finally {
      obs.disconnect();
    }
  }

  /**
   * Sweep `scroller` in one direction ('up' or 'down'), harvesting every mounted
   * window until the true edge, `max` matching messages, or user abort.
   *
   * When Discord's ~2046px skeleton placeholder is present in the sweep direction,
   * jumps directly to the first/last mounted message (off-screen mounted <li>s
   * already carry full content) and re-arms if post-eviction triggers stall.
   * Falls back to overlapping viewport steps when no skeleton wrapper is present.
   */
  async function scrollSweep(scroller, dir, {
    harvestFn,
    countFn,
    max,
    stopWhen = null,
    signal,
    startPath,
    updateStatus,
  }) {
    const isUp = dir === 'up';
    let sawSkel = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted || !scroller.isConnected || location.pathname !== startPath) return;
      harvestFn();
      if (stopWhen?.()) return;
      if (countFn() > max) return;

      const skel = skeletonEdges(scroller);
      const skelInDir = !!(skel && (isUp ? skel.before : skel.after));
      if (skelInDir) sawSkel = true;

      if (isUp && messageHosts(scroller)[0]?.closest(STARTER)) return;

      // Once a skeleton we saw in this direction disappears, we have reached the true edge.
      if (sawSkel && !skelInDir && (isUp || !hasJumpToPresent(scroller))) return;

      if (skelInDir) {
        const before = domBoundaryIds(scroller);
        if (!scrollToBoundary(scroller, isUp)) return;
        await nextFrame(signal);

        const more = await waitForPage(scroller, dir, before, true, harvestFn, signal, () =>
          updateStatus(isUp ? 'loading older…' : 'loading newer…'));
        updateStatus(isUp ? 'scrolling up' : 'scrolling down');
        if (!more) return;
        continue;
      }

      // Fallback when no skeleton placeholder is present (short view, future DOM change, or test harness)
      const atEdge = isUp ? scroller.scrollTop <= 1 : atScrollBottom(scroller);
      if (atEdge) {
        const before = domBoundaryIds(scroller);
        dispatchScroll(scroller, isUp);
        const more = await waitForPage(scroller, dir, before, false, harvestFn, signal, () =>
          updateStatus(isUp ? 'loading older…' : 'loading newer…'));
        if (!more) return;
        updateStatus(isUp ? 'scrolling up' : 'scrolling down');
        continue;
      }

      const delta = Math.max(180, Math.floor(scroller.clientHeight * SCROLL_OVERLAP));
      const prevTop = scroller.scrollTop;
      const target = isUp
        ? Math.max(0, prevTop - delta)
        : Math.min(scroller.scrollHeight - scroller.clientHeight, prevTop + delta);

      scroller.scrollTop = target;
      dispatchScroll(scroller, null);
      await nextFrame(signal);
      await nextFrame(signal);
      await sleep(STEP_WAIT_MS, signal);
      if (signal.aborted || !scroller.isConnected || location.pathname !== startPath) return;

      harvestFn();
      updateStatus(isUp ? 'scrolling up' : 'scrolling down');
    }
  }

  async function runAutoHarvest(scroller, ctx, state, {
    which,
    directions,
    max,
    countFn,
    stopWhen = null,
    restoreMode = 'from-bottom',
  }) {
    const startPath       = location.pathname;
    const savedAnchor     = visibleAnchor(scroller);
    const savedScrollTop  = scroller.scrollTop;
    const savedAtBottom   = !hasMoreBelow(scroller) && atScrollBottom(scroller);
    const savedFromBottom = scroller.scrollHeight - scroller.scrollTop;

    const ac = new AbortController();
    let userStopped = false;
    const stop = () => {
      if (ac.signal.aborted) return;
      userStopped = true;
      ac.abort();
    };

    const eat = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    const onKey = e => { if (e.key === 'Escape') { eat(e); stop(); } };

    const progress = createProgressToast(stop);
    const updateStatus = phase => {
      const n = Math.min(countFn(), max);
      const capText = Number.isFinite(max) ? ` / ${max}` : '';
      progress.set(`Harvesting… ${n}${capText} messages (${phase})`);
    };

    harvesting = { stop, which };
    setFabBusy(which, true);
    document.addEventListener('keydown', onKey, true);

    const harvestFn = () => harvestSnapshot(scroller, ctx, state);
    let lastDir = directions[0] || null;
    let ranUp   = false;

    try {
      for (const dir of directions) {
        if (ac.signal.aborted || !scroller.isConnected || location.pathname !== startPath) break;
        if (countFn() > max) break;
        lastDir = dir;
        if (dir === 'up') ranUp = true;
        updateStatus(dir === 'up' ? 'scrolling up' : 'scrolling down');
        await scrollSweep(scroller, dir, {
          harvestFn,
          countFn,
          max,
          stopWhen,
          signal: ac.signal,
          startPath,
          updateStatus,
        });
      }
    } finally {
      document.removeEventListener('keydown', onKey, true);
      progress.remove();
      setFabBusy(which, false);
      harvesting = null;

      // Restore user's scroll position if still in the same pane.
      if (scroller.isConnected && location.pathname === startPath) {
        const anchorEl = (savedAnchor?.domId && document.getElementById(savedAnchor.domId))
          || (savedAnchor?.id && scroller.querySelector(`[id$="-${savedAnchor.id}"]`))
          || null;
        const skel = skeletonEdges(scroller);

        if (savedAtBottom && (!skel || !skel.after)) {
          scroller.scrollTop = scroller.scrollHeight;
        } else if (anchorEl && scroller.contains(anchorEl) && typeof anchorEl.getBoundingClientRect === 'function') {
          const diff = (anchorEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
            - savedAnchor.offset;
          scroller.scrollTop += diff;
        } else if (skel && (skel.before || skel.after)) {
          // Original anchor was evicted; land cleanly on a real message instead of a gray skeleton.
          const hosts = messageHosts(scroller);
          const fallbackEl = restoreMode === 'down-only' ? hosts[0] : hosts[hosts.length - 1];
          fallbackEl?.scrollIntoView?.({ block: restoreMode === 'down-only' ? 'start' : 'end' });
        } else if (restoreMode === 'down-only' || !ranUp) {
          scroller.scrollTop = savedScrollTop;
        } else {
          scroller.scrollTop = Math.max(0, scroller.scrollHeight - savedFromBottom);
        }
      }
    }

    return { stoppedEarly: userStopped, navigatedAway: location.pathname !== startPath, lastDir };
  }

  /** Whole conversation (auto-scrolling through lazy-loaded pages), or just the active text selection. */
  async function scrapeAll() {
    const sel    = window.getSelection();
    const scoped = sel && !sel.isCollapsed && sel.toString().trim().length > 0;

    if (scoped) {
      const ctx   = context();
      const state = createHarvestState();
      openSandbox();
      try {
        harvestSnapshot(document, ctx, state, host => sel.containsNode(host, true));
      } finally {
        closeSandbox();
      }
      return finalize(state, { meta: { mode: 'selection' } });
    }

    const urlCtx   = context();
    const scroller = findActiveScroller(urlCtx.channelId);
    const ctx      = context(scroller);
    const state    = createHarvestState();

    openSandbox();
    try {
      harvestSnapshot(scroller || document, ctx, state);

      // Short conversation that fits without scrolling (or no scroller found): instant copy.
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 2) {
        return finalize(state, { max: MAX_ALL, keepNewest: true, meta: { mode: 'view' } });
      }

      const needDown = hasMoreBelow(scroller);
      const directions = needDown ? ['down', 'up'] : ['up'];

      // If we hit MAX_ALL while sweeping up from the bottom, keep the newest MAX_ALL;
      // if we hit MAX_ALL while sweeping down from an older spot, keep from there downward.
      const { stoppedEarly, lastDir } = await runAutoHarvest(scroller, ctx, state, {
        which: 'copy',
        directions,
        max: MAX_ALL,
        countFn: () => state.byId.size,
        restoreMode: 'from-bottom',
      });

      return finalize(state, {
        max: MAX_ALL,
        keepNewest: lastDir === 'up',
        meta: {
          mode: 'view',
          ...(stoppedEarly ? { stoppedEarly: true } : {}),
        },
      });
    } finally {
      closeSandbox();
    }
  }

  /** From a clicked message down to the newest message, auto-scrolling through lazy-loaded pages. */
  async function scrapeFrom(host) {
    const anchorId = messageId(host);
    if (!anchorId) throw new Error("Couldn't identify that message.");
    const anchorIsStarter = !!host.closest(STARTER);
    const scroller = scrollerFor(host);
    const ctx      = context(scroller);
    const state    = createHarvestState();

    const countFromAnchor = () => {
      if (anchorIsStarter) return state.byId.size;
      let n = 0;
      for (const id of state.byId.keys()) {
        if (cmpId(id, anchorId) >= 0) n++;
      }
      return n;
    };

    openSandbox();
    try {
      // Harvest immediately before any scrolling so the anchor (and preceding author context) are captured.
      harvestSnapshot(scroller || document, ctx, state);
      if (!state.byId.has(anchorId)) {
        // Fallback in case the clicked host wasn't inside the detected scroller.
        harvestSnapshot(document, ctx, state);
      }

      let stoppedEarly = false;
      const canScrollDown = scroller
        && scroller.scrollHeight > scroller.clientHeight + 2
        && hasMoreBelow(scroller)
        && countFromAnchor() <= MAX_ANCHORED;

      if (canScrollDown) {
        const res = await runAutoHarvest(scroller, ctx, state, {
          which: 'pick',
          directions: ['down'],
          max: MAX_ANCHORED,
          countFn: countFromAnchor,
          restoreMode: 'down-only',
        });
        stoppedEarly = res.stoppedEarly;
      }

      return finalize(state, {
        anchorId,
        anchorIsStarter,
        max: MAX_ANCHORED,
        keepNewest: false,
        meta: {
          mode: 'anchored',
          anchorId,
          ...(stoppedEarly ? { stoppedEarly: true } : {}),
        },
      });
    } finally {
      closeSandbox();
    }
  }

  /** Compare two range endpoints chronologically (thread starter is always oldest). */
  function cmpEndpoint(a, b) {
    if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
    return cmpId(a.id, b.id);
  }

  /** Capture author/avatar hint and a short UI label for the first clicked message in range mode. */
  function describeRangeAnchor(host, scroller, ctx) {
    const id = messageId(host);
    if (!id) return null;
    const isStarter = !!host.closest(STARTER);
    const state = createHarvestState();
    openSandbox();
    try {
      harvestSnapshot(scroller || document, ctx, state);
    } finally {
      closeSandbox();
    }
    const rec = state.byId.get(id);
    const author = rec?.ownAuthor || rec?.hintAuthor || null;
    const avatar = rec?.avatar || (author ? state.avatars.get(author) : null) || null;
    const iso = host.querySelector('time[datetime]')?.getAttribute('datetime') || '';
    const hhmm = iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const label = [author || `#${id.slice(-4)}`, hhmm].filter(Boolean).join(' · ');
    return {
      id,
      domId: host.id || null,
      isStarter,
      channelId: ctx.channelId,
      startPath: location.pathname,
      authorHint: author,
      avatarHint: avatar,
      label,
    };
  }

  /** Between two clicked messages (in either order), auto-scrolling across lazy-loaded pages. */
  async function scrapeRange(first, secondHost) {
    const secondId = messageId(secondHost);
    if (!secondId) throw new Error("Couldn't identify that message.");
    const scroller = scrollerFor(secondHost);
    const ctx      = context(scroller);
    if (ctx.channelId !== first.channelId || location.pathname !== first.startPath) {
      throw new Error('Range endpoints must be in the same channel or thread.');
    }

    const second = { id: secondId, isStarter: !!secondHost.closest(STARTER) };
    const cmp = cmpEndpoint(first, second);
    const start    = cmp <= 0 ? first : second;
    const end      = cmp <= 0 ? second : first;
    const sweepDir = cmp <= 0 ? 'up' : 'down';   // viewport is at `second`, so sweep back toward `first`

    const state = createHarvestState();
    const inRange = m => (start.isStarter || cmpId(m.id, start.id) >= 0)
      && (end.isStarter ? m.isThreadStarter : cmpId(m.id, end.id) <= 0);
    const countInRange = () => {
      let n = 0;
      for (const m of state.byId.values()) if (inRange(m)) n++;
      return n;
    };
    const hasReachedFirst = () => {
      if (start.id === end.id) return true;
      if (!scroller) return true;
      const b = domBoundaryIds(scroller);
      if (sweepDir === 'up') {
        return start.isStarter
          ? !!scroller.querySelector(STARTER)
          : (!!b.first && cmpId(b.first, start.id) <= 0);
      }
      return end.isStarter
        ? !!scroller.querySelector(STARTER)
        : (!!b.last && cmpId(b.last, end.id) >= 0);
    };

    openSandbox();
    try {
      harvestSnapshot(scroller || document, ctx, state);
      if (!state.byId.has(second.id)) {
        harvestSnapshot(document, ctx, state);
      }

      let stoppedEarly = false;
      const needScroll = scroller
        && scroller.scrollHeight > scroller.clientHeight + 2
        && !hasReachedFirst()
        && countInRange() <= MAX_RANGE;

      if (needScroll) {
        const res = await runAutoHarvest(scroller, ctx, state, {
          which: 'range',
          directions: [sweepDir],
          max: MAX_RANGE,
          countFn: countInRange,
          stopWhen: hasReachedFirst,
          restoreMode: sweepDir === 'down' ? 'down-only' : 'from-bottom',
        });
        stoppedEarly = res.stoppedEarly;
      }

      // Backstop the first clicked message's author/avatar if it was a continuation message
      // sitting at the very top of the final swept page.
      const firstRec = state.byId.get(first.id);
      if (firstRec) {
        if (!firstRec.ownAuthor && !firstRec.hintAuthor && first.authorHint) {
          firstRec.hintAuthor = first.authorHint;
        }
        if (!firstRec.avatar && first.avatarHint) {
          firstRec.avatar = first.avatarHint;
        }
      }
      if (first.authorHint && first.avatarHint && !state.avatars.has(first.authorHint)) {
        state.avatars.set(first.authorHint, first.avatarHint);
      }

      return finalize(state, {
        anchorId: start.id,
        anchorIsStarter: start.isStarter,
        endId: end.id,
        endIsStarter: end.isStarter,
        max: MAX_RANGE,
        keepNewest: sweepDir === 'up',
        meta: {
          mode: 'range',
          startId: start.id,
          endId: end.id,
          ...(stoppedEarly ? { stoppedEarly: true } : {}),
        },
      });
    } finally {
      closeSandbox();
    }
  }

  // ---------------------------------------------------------------- render
  function toMarkdown(d) {
    const parts = [];
    if (d.mode === 'selection') parts.push('selection only');
    if (d.mode === 'anchored')  parts.push(`from ${d.anchorId} onward`);
    if (d.mode === 'range')     parts.push(`range ${d.startId}..${d.endId}`);
    if (d.truncated)            parts.push(`capped at ${d.cap || MAX_ANCHORED}`);
    if (d.stoppedEarly)         parts.push('stopped early');
    const scope = parts.length ? ` (${parts.join(', ')})` : '';

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

  function createProgressToast(onStop) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      z-index:2147483647;display:inline-flex;align-items:center;gap:10px;
      padding:9px 12px 9px 16px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;
      color:#fff;background:#5865f2;box-shadow:0 4px 16px rgba(0,0,0,.45)`;
    const text = document.createElement('span');
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.textContent = 'Stop (Esc)';
    stopBtn.style.cssText = `border:none;border-radius:5px;padding:3px 8px;cursor:pointer;
      font:600 12px/1.2 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.28)`;
    stopBtn.addEventListener('click', e => { e.stopPropagation(); onStop(); });
    el.append(text, stopBtn);
    document.body.appendChild(el);
    return {
      set: msg => { text.textContent = msg; },
      remove: () => el.remove(),
    };
  }

  async function emit(makeData, which = 'copy') {
    if (harvesting) {
      harvesting.stop();
      return;
    }
    try {
      const data = await makeData();
      const body = FORMAT === 'json' ? JSON.stringify(data, null, 2) : toMarkdown(data);
      const text = `<discord-transcript>\n${body}\n</discord-transcript>`;
      console.log(text);
      await copy(text);
      const notes = [];
      if (data.truncated)    notes.push(`capped at ${data.cap || MAX_ANCHORED}`);
      if (data.stoppedEarly) notes.push('stopped early');
      const note = notes.length ? ` (${notes.join(', ')})` : '';
      toast(`Copied ${data.messages.length} message(s)${note}`);
      flashFab(which);
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
  let setFabBusy = () => {};      // wired up by the floating buttons

  function startPicking(mode = 'pick') {
    if (harvesting) return;
    if (picking) {
      const same = picking.mode === mode;
      picking.stop();
      if (same) return;
    }

    const isRange = mode === 'range';
    const style = document.createElement('style');
    style.textContent = '*{cursor:crosshair !important}';
    const mk = css => { const d = document.createElement('div'); d.style.cssText = css; return d; };

    const head = mk(`position:fixed;pointer-events:none;z-index:2147483646;display:none;
      border:2px solid #5865f2;border-radius:6px;background:rgba(88,101,242,.18)`);
    // Persistent highlight for the first endpoint in range mode while picking the second.
    const anchorBox = mk(`position:fixed;pointer-events:none;z-index:2147483646;display:none;
      border:2px solid #12d18e;border-radius:6px;background:rgba(18,209,142,.16)`);
    // the rest of the range — messages are contiguous, so one rect beats 99 boxes
    const tail = mk(`position:fixed;pointer-events:none;z-index:2147483645;display:none;
      border-left:2px solid rgba(88,101,242,.5);background:rgba(88,101,242,.07)`);
    const hint = mk(`position:fixed;top:16px;left:50%;transform:translateX(-50%);
      z-index:2147483647;padding:8px 14px;border-radius:8px;pointer-events:none;
      font:13px/1.4 system-ui,sans-serif;color:#fff;background:${isRange ? '#7c3aed' : '#5865f2'};
      box-shadow:0 4px 14px rgba(0,0,0,.4)`);
    hint.textContent = isRange
      ? `Range: click first message (either end, max ${MAX_RANGE}). Esc to cancel.`
      : `Click a message — auto-scrolls from there down (max ${MAX_ANCHORED}). Esc to cancel.`;

    document.head.appendChild(style);
    document.body.append(tail, anchorBox, head, hint);

    let activeScroller = null;
    let hosts   = [];
    let current = null;
    let first   = null;   // populated after click #1 in range mode
    let dirty   = true;
    let frame   = 0;

    const hostAt = t => (t instanceof Element ? t.closest(`${MSG}, ${STARTER}`) : null);
    const hideHover = () => { head.style.display = tail.style.display = 'none'; };
    const placeBox = (el, r) => Object.assign(el.style, {
      display: 'block', top: `${r.top}px`, left: `${r.left}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });

    function findFirstEl(sc) {
      if (!first) return null;
      const byDom = first.domId && document.getElementById(first.domId);
      if (byDom && (!sc || sc.contains(byDom))) return byDom;
      if (first.isStarter) return (sc || document).querySelector(STARTER);
      return (sc || document).querySelector(`[id$="-${first.id}"]`);
    }

    function redrawAnchor(sc) {
      if (!first) { anchorBox.style.display = 'none'; return null; }
      const el = findFirstEl(sc);
      if (!el || !el.isConnected) { anchorBox.style.display = 'none'; return null; }
      const r = el.getBoundingClientRect();
      const sRect = sc?.getBoundingClientRect();
      if (sRect && (r.bottom <= sRect.top || r.top >= sRect.bottom)) {
        anchorBox.style.display = 'none';
        return el;
      }
      placeBox(anchorBox, r);
      return el;
    }

    function redraw() {
      const host = current;
      const sc = host?.isConnected ? scrollerFor(host) : activeScroller;
      const firstEl = redrawAnchor(sc);

      if (!host || !host.isConnected) return hideHover();

      if (dirty || sc !== activeScroller) {
        activeScroller = sc;
        hosts = messageHosts(sc || document);
        dirty = false;
      }

      // identity lookup, no id parsing — this runs on every mousemove
      let i = hosts.indexOf(host);
      if (i < 0) { hosts = messageHosts(sc || document); i = hosts.indexOf(host); }
      if (i < 0) return hideHover();

      const a = host.getBoundingClientRect();
      const sRect = sc?.getBoundingClientRect();
      const clipTop = sRect?.top ?? 0;
      const clipBottom = sRect?.bottom ?? Infinity;

      if (!isRange) {
        const visibleBelow = hosts.length - i;
        const count = Math.min(visibleBelow, MAX_ANCHORED);
        const b = hosts[i + count - 1].getBoundingClientRect();

        placeBox(head, a);
        const bottom = Math.min(b.bottom, clipBottom);
        if (bottom - a.bottom > 2) {
          Object.assign(tail.style, { display: 'block', top: `${a.bottom}px`, left: `${a.left}px`,
            width: `${a.width}px`, height: `${bottom - a.bottom}px` });
        } else {
          tail.style.display = 'none';
        }

        const moreBelow = hasMoreBelow(sc);
        if (count === MAX_ANCHORED) {
          hint.textContent = `${MAX_ANCHORED} messages from here (cap) — Esc to cancel`;
        } else if (moreBelow) {
          hint.textContent = `${count}+ messages from here (auto-scrolls down, max ${MAX_ANCHORED}) — Esc to cancel`;
        } else {
          hint.textContent = `${count} message${count === 1 ? '' : 's'} from here — Esc to cancel`;
        }
        return;
      }

      // Range mode — step 1 (choosing first endpoint)
      placeBox(head, a);
      if (!first) {
        tail.style.display = 'none';
        hint.textContent = `Range: click first message (either end, max ${MAX_RANGE}). Esc to cancel.`;
        return;
      }

      // Range mode — step 2 (choosing second endpoint)
      const fi = firstEl ? hosts.indexOf(firstEl) : -1;
      if (fi >= 0) {
        const lo = Math.min(fi, i), hi = Math.max(fi, i);
        const count = hi - lo + 1;
        const rLo = hosts[lo].getBoundingClientRect();
        const rHi = hosts[hi].getBoundingClientRect();
        const top = Math.max(rLo.top, clipTop);
        const bottom = Math.min(rHi.bottom, clipBottom);
        if (bottom - top > 2) {
          Object.assign(tail.style, { display: 'block', top: `${top}px`, left: `${a.left}px`,
            width: `${a.width}px`, height: `${bottom - top}px` });
        } else {
          tail.style.display = 'none';
        }
        hint.textContent = `Range: ${count} message${count === 1 ? '' : 's'} (start: ${first.label}) — click to copy · Esc cancels`;
      } else {
        const hid = messageId(host);
        const hoverIsNewer = !hid || cmpEndpoint(first, { id: hid, isStarter: !!host.closest(STARTER) }) <= 0;
        if (hoverIsNewer) {
          const top = clipTop;
          const bottom = Math.max(top, a.top);
          if (bottom - top > 2) {
            Object.assign(tail.style, { display: 'block', top: `${top}px`, left: `${a.left}px`,
              width: `${a.width}px`, height: `${bottom - top}px` });
          } else {
            tail.style.display = 'none';
          }
          hint.textContent = `Range: ${i + 1}+ messages back to ${first.label} (auto-scrolls up) — click to copy · Esc cancels`;
        } else {
          const top = a.bottom;
          const bottom = Math.max(top, clipBottom);
          if (bottom - top > 2) {
            Object.assign(tail.style, { display: 'block', top: `${top}px`, left: `${a.left}px`,
              width: `${a.width}px`, height: `${bottom - top}px` });
          } else {
            tail.style.display = 'none';
          }
          hint.textContent = `Range: ${hosts.length - i}+ messages down to ${first.label} (auto-scrolls down) — click to copy · Esc cancels`;
        }
      }
    }

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; redraw(); });
    };

    const onMove = e => {
      const host = hostAt(e.target);
      if (!host) { current = null; redrawAnchor(activeScroller); return hideHover(); }
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

      if (!isRange) {
        stop();
        emit(() => scrapeFrom(host), 'pick');
        return;
      }

      if (!first) {
        const sc = scrollerFor(host);
        let ctx;
        try { ctx = context(sc); } catch (err) { toast(err.message, false); stop(); return; }
        const anchor = describeRangeAnchor(host, sc, ctx);
        if (!anchor) { toast("Couldn't identify that message.", false); return; }
        first = anchor;
        activeScroller = sc;
        redraw();
        hint.textContent = `Start: ${first.label} — scroll & click end message (Esc cancels)`;
        return;
      }

      const startAnchor = first;
      stop();
      emit(() => scrapeRange(startAnchor, host), 'range');
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
      style.remove(); head.remove(); anchorBox.remove(); tail.remove(); hint.remove();
      picking = null;
      setPickActive(mode, false);
    }

    picking = { stop, mode };
    setPickActive(mode, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseup', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  // -------------------------------------------------------- floating buttons
  // Three tiny pills, absolutely overlaid in the empty leading corner of the
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
      .dmd-pick{border-radius:0;background:linear-gradient(135deg,#ffb03a,#ff5e62 60%,#ff2e88)}
      .dmd-pick:hover{box-shadow:0 2px 12px rgba(255,94,98,.6), inset 0 1px 0 rgba(255,255,255,.25)}
      .dmd-range{border-radius:0 11px 11px 0;background:linear-gradient(135deg,#a855f7,#7c3aed 55%,#db2777)}
      .dmd-range:hover{box-shadow:0 2px 12px rgba(168,85,247,.65), inset 0 1px 0 rgba(255,255,255,.25)}
      .dmd-btn.dmd-on{background:linear-gradient(135deg,#12d18e,#00b8d9);
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

    const copyBtn = btn('dmd-copy', `Copy conversation / selection as Markdown — auto-scrolls up to ${MAX_ALL} msgs (Alt+Shift+C · Esc stops)`,
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>
      </svg>`, 'md');

    const pickBtn = btn('dmd-pick', `Pick a start message, auto-scrolls down up to ${MAX_ANCHORED} msgs (Alt+Shift+X · Esc cancels/stops)`,
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <circle cx="12" cy="12" r="3.4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
      </svg>`, 'pick');

    const rangeBtn = btn('dmd-range', `Pick start & end messages (either order), auto-scrolls between them up to ${MAX_RANGE} msgs (Alt+Shift+R · Esc cancels/stops)`,
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 4H5v16h3M16 4h3v16h-3M9 12h6"/>
      </svg>`, 'range');

    copyBtn.addEventListener('click', () => {
      if (picking) picking.stop();
      emit(scrapeAll, 'copy');
    });
    pickBtn.addEventListener('click', () => {
      if (harvesting) { harvesting.stop(); return; }
      startPicking('pick');
    });
    rangeBtn.addEventListener('click', () => {
      if (harvesting) { harvesting.stop(); return; }
      startPicking('range');
    });

    wrap.append(copyBtn, pickBtn, rangeBtn);
    document.head.appendChild(css);
    document.body.appendChild(wrap);

    const btnFor = which => (which === 'copy' ? copyBtn : which === 'range' ? rangeBtn : pickBtn);
    setPickActive = (which, on) => btnFor(which).classList.toggle('dmd-on', on);
    setFabBusy = (which, on) => btnFor(which).classList.toggle('dmd-on', on);
    flashFab = which => {
      const b = btnFor(which);
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
    if (HOTKEY_ALL(e))   { e.preventDefault(); if (picking) picking.stop(); emit(scrapeAll, 'copy'); }
    if (HOTKEY_PICK(e))  { e.preventDefault(); if (!harvesting) startPicking('pick'); }
    if (HOTKEY_RANGE(e)) { e.preventDefault(); if (!harvesting) startPicking('range'); }
  }, true);

  window.dcopy = () => emit(scrapeAll, 'copy');
  window.dprobe = dprobe;
  console.info('[discord→md] ready — Alt+Shift+C all, Alt+Shift+X pick, Alt+Shift+R range. Debug: dprobe()');
})();

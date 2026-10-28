// Paseo mock kit: dev toolbars + tag engine. No configuration: everything is
// read from tags in the page. See ../README.md for the authoring guide.
//
// Two separate control groups, on purpose:
//   DESIGN    (top bar)    which design option you're looking at: sections, variants
//   SITUATION (bottom bar) where you're looking at it: theme, viewport, app state
(() => {
  const kitBase = new URL(".", document.currentScript.src);
  const devCss = document.createElement("link");
  devCss.rel = "stylesheet";
  devCss.href = new URL("dev.css", kitBase).href;
  devCss.addEventListener("load", () => layout());
  document.head.append(devCss);

  const VIEWPORTS = {
    desktop: { w: 1440, h: 900, label: "Desktop" },
    laptop: { w: 1024, h: 720, label: "Small desktop" },
    phone: { w: 390, h: 844, label: "Phone" },
  };
  const VIEWPORT_ALIASES = { wide: ["desktop", "laptop"] };
  const THEME_LABELS = {
    dark: "Paseo dark",
    pureBlack: "Pure black",
    light: "Paseo light",
    zinc: "Zinc",
    midnight: "Midnight",
    claude: "Claude",
    ghostty: "Ghostty",
  };
  const DEFAULT_THEMES = "dark pureBlack light";

  const html = document.documentElement;
  const exportMode = new URLSearchParams(location.search).has("export");
  const words = (s) => (s || "").trim().split(/\s+/).filter(Boolean);

  // "A: Composer pill — works everywhere | B: Muted line"
  function parseVariants(s) {
    return (s || "")
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const m = part.match(/^([^:]+?)\s*(?::\s*(.*?))?\s*(?:—\s*(.*))?$/);
        return { id: m[1].trim(), label: (m[2] || "").trim(), note: (m[3] || "").trim() };
      });
  }
  // "session: normal | empty | crashed; panel: closed | open=Files open"
  // A value shows as "<value> <axis>" ("normal session") unless it carries its
  // own wording after "=".
  const stateLabels = new Map(); // "axis\u0000value" → label
  function parseStates(s, into = new Map()) {
    for (const axis of (s || "").split(";")) {
      const [rawName, values] = axis.split(":");
      const name = rawName?.trim();
      if (!name) continue;
      const list = into.get(name) || [];
      for (const part of (values || "").split("|").map((x) => x.trim()).filter(Boolean)) {
        const [v, label] = part.split("=").map((x) => x.trim());
        if (label) stateLabels.set(name + "\u0000" + v, label);
        if (!list.includes(v)) list.push(v);
      }
      into.set(name, list);
    }
    return into;
  }
  const stateLabel = (axis, v) => stateLabels.get(axis + "\u0000" + v) || `${v} ${axis}`;
  // data-when="session: empty crashed; net: offline"
  function parseWhen(s) {
    const out = new Map();
    for (const clause of (s || "").split(";")) {
      const [name, values] = clause.split(":");
      if (name && name.trim()) out.set(name.trim(), words(values));
    }
    return out;
  }

  // ---------------------------------------------------------------- cycle button
  // <button data-cycle="Off | 30 min | 1 h"> steps through values, wrapping.
  // Its left third steps back, the rest steps forward; the hovered side shades
  // from its edge (and, with data-cycle-chevrons, its chevron lights up).
  // Width is that of the widest value, so it never jumps. Fires a "cycle"
  // event { value, index }; mirrors data-value. (Split idea from the Nilo
  // mock template's variants bar.)
  function enhanceCycle(el, onChange) {
    if (el.__cycle) return el.__cycle;
    const values = el.dataset.cycle.split("|").map((v) => v.trim()).filter(Boolean);
    const chevrons = el.hasAttribute("data-cycle-chevrons");
    el.classList.add("kit-cycle");
    el.textContent = "";
    const mk = (tag, cls, html) => {
      const n = document.createElement(tag);
      n.className = cls;
      if (html) n.innerHTML = html;
      return n;
    };
    const chev = (d) => `<svg viewBox="0 0 6 10" width="5" height="8" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const prev = mk("span", "kit-cycle-prev");
    const next = mk("span", "kit-cycle-next");
    const stack = mk("span", "kit-cycle-vals");
    const spans = values.map((v) => {
      const span = mk("span", "");
      span.textContent = v;
      stack.append(span);
      return span;
    });
    el.append(prev, next);
    if (chevrons) el.append(mk("em", "kit-cycle-l", chev("M5 1 1 5l4 4")));
    el.append(stack);
    if (chevrons) el.append(mk("em", "kit-cycle-r", chev("M1 1l4 4-4 4")));
    const at = (d) => values[(api.index + d + values.length) % values.length];
    const api = {
      values,
      index: 0,
      set(i, silent) {
        api.index = ((i % values.length) + values.length) % values.length;
        spans.forEach((s, j) => s.classList.toggle("kit-cycle-on", j === api.index));
        el.dataset.value = values[api.index];
        prev.title = "← " + at(-1);
        next.title = at(1) + " →";
        if (!silent) {
          el.dispatchEvent(new CustomEvent("cycle", { bubbles: true, detail: { value: values[api.index], index: api.index } }));
          onChange?.(values[api.index], api.index);
        }
      },
    };
    const start = values.indexOf(el.dataset.value);
    api.set(start < 0 ? 0 : start, true);
    el.addEventListener("click", (e) => {
      const back = e.target.closest?.(".kit-cycle-prev") || (e.target === el && e.offsetX < el.offsetWidth / 3);
      api.set(api.index + (back ? -1 : 1));
    });
    el.__cycle = api;
    return api;
  }

  // ---------------------------------------------------------------- page model
  const sectionEls = [...document.querySelectorAll("[data-section]")];
  const frame = document.createElement("div");
  frame.className = "mock-frame";
  if (sectionEls.length) {
    sectionEls.forEach((s) => frame.append(s));
  } else {
    // No sections: the whole body is one screen.
    const only = document.createElement("div");
    only.dataset.section = "main";
    [...document.body.childNodes].filter((n) => n.nodeName !== "SCRIPT").forEach((n) => only.append(n));
    frame.append(only);
    sectionEls.push(only);
  }

  const sections = sectionEls.map((el) => {
    let variants = parseVariants(el.dataset.variants);
    if (!variants.length) {
      const ids = [];
      el.querySelectorAll("[data-variant]").forEach((n) => words(n.dataset.variant).forEach((id) => ids.includes(id) || ids.push(id)));
      variants = ids.sort().map((id) => ({ id, label: "", note: "" }));
    }
    const axes = parseStates(html.dataset.states);
    parseStates(el.dataset.states, axes);
    el.querySelectorAll("[data-when]").forEach((n) => {
      for (const [axis, vals] of parseWhen(n.dataset.when)) {
        const list = axes.get(axis) || [];
        vals.forEach((v) => list.includes(v) || list.push(v));
        axes.set(axis, list);
      }
    });
    // <aside data-notes> renders beside the frame, not in it (README "Base and notes").
    const notes = el.querySelector("[data-notes]");
    notes?.remove();
    notes?.querySelectorAll("[data-note-for]").forEach((p) => {
      const num = document.createElement("b");
      num.className = "kit-note-num";
      num.textContent = p.dataset.noteFor;
      p.prepend(num);
    });
    return { id: el.dataset.section, title: el.dataset.title || el.dataset.section, el, variants, axes, notes };
  });
  // Base: plain Paseo without this mock's changes (variants, data-mod, slot contents).
  const hasDelta =
    sections.some((s) => s.variants.length) ||
    !!frame.querySelector("[data-mod],[data-base],[data-variant]") ||
    [...frame.querySelectorAll("[data-slot]")].some((s) => s.children.length);
  const hasNotes = sections.some((s) => s.notes || s.el.querySelector("[data-note]"));

  const themes = words(html.dataset.themes || DEFAULT_THEMES);
  const viewports = words(html.dataset.viewports || "desktop laptop phone");

  // ---------------------------------------------------------------- state + hash
  // picks: each section's last variant, so switching sections keeps every choice.
  const state = { section: sections[0].id, variant: null, theme: themes[0], vp: viewports[0], states: {}, picks: {}, base: false, notes: true, knobs: {} };

  function readHash() {
    const [path, query] = location.hash.slice(1).split("?");
    const [sec, variant] = (path || "").split("/");
    // The hash is the whole truth: anything it omits goes back to the default.
    state.section = sections.some((s) => s.id === sec) ? sec : sections[0].id;
    state.variant = variant || null;
    const q = new URLSearchParams(query || "");
    state.theme = themes.includes(q.get("theme")) ? q.get("theme") : themes[0];
    state.vp = viewports.includes(q.get("vp")) ? q.get("vp") : viewports[0];
    if (q.get("canvas")) html.dataset.canvas = q.get("canvas");
    else delete html.dataset.canvas;
    state.picks = {};
    for (const pair of (q.get("picks") || "").split(",")) {
      const [s, v] = pair.split(".");
      if (s && v) state.picks[s] = v;
    }
    if (state.variant) state.picks[state.section] = state.variant;
    else state.variant = state.picks[state.section] || null;
    state.states = {};
    for (const [k, v] of q) if (!["theme", "vp", "canvas", "picks", "data", "base", "notes", "knobs"].includes(k)) state.states[k] = v;
    state.data = q.get("data") || defaultData;
    state.base = q.get("base") === "1";
    state.notes = q.get("notes") !== "off";
    state.knobs = {};
    for (const pair of (q.get("knobs") || "").split(",")) {
      const i = pair.indexOf(":");
      if (i > 0) state.knobs[pair.slice(0, i)] = pair.slice(i + 1);
    }
  }
  function writeHash() {
    const q = new URLSearchParams();
    if (state.theme !== themes[0]) q.set("theme", state.theme);
    if (state.vp !== viewports[0]) q.set("vp", state.vp);
    const sec = current();
    for (const [axis, values] of sec.axes) if (state.states[axis] && state.states[axis] !== values[0]) q.set(axis, state.states[axis]);
    if (html.dataset.canvas) q.set("canvas", html.dataset.canvas);
    if (state.data !== defaultData) q.set("data", state.data);
    if (state.base) q.set("base", "1");
    if (hasNotes && !state.notes) q.set("notes", "off");
    const knobs = Object.entries(state.knobs).filter(([, v]) => v != null && v !== "");
    if (knobs.length) q.set("knobs", knobs.map(([k, v]) => k + ":" + v).join(","));
    const picks = sections
      .filter((s) => s.id !== state.section && state.picks[s.id] && state.picks[s.id] !== s.variants[0]?.id)
      .map((s) => s.id + "." + state.picks[s.id]);
    if (picks.length) q.set("picks", picks.join(","));
    const path = state.section + (state.variant ? "/" + state.variant : "");
    const qs = q.toString();
    history.replaceState(null, "", "#" + path + (qs ? "?" + qs : ""));
  }
  const current = () => sections.find((s) => s.id === state.section);

  // ---------------------------------------------------------------- data (kit/data.js)
  // Acme or live, a situation like theme. PNG export always renders Acme.
  const defaultData = html.dataset.defaultData === "live" ? "live" : "acme";
  const DATA_LABELS = { acme: "Acme data", live: "Live data" };
  let dataSets = { acme: null, live: null };
  let renderedData = null;
  function renderData() {
    if (exportMode || !dataSets.live) state.data = "acme";
    if (!["acme", "live"].includes(state.data)) state.data = "acme";
    if (!window.KitData || renderedData === state.data) return;
    renderedData = state.data;
    window.KitData.render(frame, dataSets[state.data]);
    renderIcons(frame);
  }

  // ---------------------------------------------------------------- apply
  const listeners = [];
  // Kit modules (appearance.js) add their own controls to the situation bar;
  // a mock's knobs on its chosen design go in the knob bar under the variants.
  const situationExtras = [];
  const knobControls = [];
  let shownAxes = new Set();
  function apply() {
    const sec = current();
    renderData();
    if (sec.variants.length && !sec.variants.some((v) => v.id === state.variant)) state.variant = sec.variants[0].id;
    if (!sec.variants.length) state.variant = null;
    state.picks[sec.id] = state.variant;
    for (const [axis, values] of sec.axes) if (!values.includes(state.states[axis])) state.states[axis] = values[0];

    frame.dataset.theme = state.theme;
    frame.dataset.vp = state.vp;
    frame.dataset.section = sec.id;
    if (state.variant && !state.base) frame.dataset.v = state.variant;
    else delete frame.dataset.v;
    // data-v-<section>: every section's pick at once, so one section can show another's choice.
    for (const s of sections) {
      if (!s.variants.length) continue;
      if (state.base) frame.removeAttribute("data-v-" + s.id);
      else frame.setAttribute("data-v-" + s.id, state.picks[s.id] || s.variants[0].id);
    }
    frame.classList.toggle("kit-base", state.base);
    html.classList.toggle("kit-base-on", state.base);
    for (const k of Object.keys(frame.dataset)) if (k.startsWith("state")) delete frame.dataset[k];
    for (const [axis] of sec.axes) frame.setAttribute("data-state-" + axis, state.states[axis]);
    html.dataset.theme = state.theme; // lets kit-styled controls outside the frame pick up tokens if wanted

    for (const s of sections) s.el.classList.toggle("kit-off", s !== sec);
    // An axis control is shown only if some element using it can currently
    // appear (e.g. a phone-only drawer axis hides on desktop).
    const structOff = new Set();
    const tagged = new Set();
    shownAxes = new Set();
    for (const n of sec.el.querySelectorAll("[data-variant],[data-viewport],[data-when],[data-mod],[data-base],[data-slot] > *")) {
      let struct = true;
      if (n.dataset.variant) struct &&= !state.base && words(n.dataset.variant).includes(state.variant);
      if (n.dataset.viewport) struct &&= words(n.dataset.viewport).flatMap((v) => VIEWPORT_ALIASES[v] || [v]).includes(state.vp);
      if (n.hasAttribute("data-mod") || n.parentElement.hasAttribute("data-slot")) struct &&= !state.base;
      if (n.hasAttribute("data-base")) struct &&= state.base;
      let on = struct;
      if (n.dataset.when) {
        const when = parseWhen(n.dataset.when);
        for (const [axis, vals] of when) {
          tagged.add(axis);
          on &&= vals.includes(state.states[axis]);
        }
        let reachable = struct;
        for (let p = n.parentElement; reachable && p && p !== sec.el; p = p.parentElement) if (structOff.has(p)) reachable = false;
        if (reachable) when.forEach((_, axis) => shownAxes.add(axis));
      }
      if (!struct) structOff.add(n);
      n.classList.toggle("kit-off", !on);
    }
    for (const [axis] of sec.axes) if (!tagged.has(axis)) shownAxes.add(axis);
    if (!exportMode) {
      writeHash();
      renderBars();
    }
    layout();
    // data-scroll="bottom": show the end of a scroll area, like a chat scrolled to the latest turn.
    sec.el.querySelectorAll('[data-scroll="bottom"]').forEach((n) => (n.scrollTop = n.scrollHeight));
    listeners.forEach((fn) => fn({ ...state, states: { ...state.states } }));
    document.dispatchEvent(new CustomEvent("mockchange", { detail: state }));
  }

  // ---------------------------------------------------------------- layout
  const stage = document.createElement("div");
  stage.className = "kit-stage";
  const label = document.createElement("div");
  label.className = "kit-frame-label";
  const holder = document.createElement("div");
  holder.className = "kit-frame-holder";
  holder.append(frame);
  // Review notes: numbered markers over the frame, the notes column beside it.
  const noteLayer = document.createElement("div");
  noteLayer.className = "kit-note-layer";
  frame.append(noteLayer);
  const notesCol = document.createElement("div");
  notesCol.className = "kit-notes";
  holder.append(notesCol);
  stage.append(label, holder);
  let notesFrame = 0;
  frame.addEventListener("scroll", () => (notesFrame ||= requestAnimationFrame(renderNotes)), true);

  // Hidden by a scrolled-away ancestor (chat, sidebar list)?
  function clipped(n, r) {
    for (let p = n.parentElement; p && p !== frame; p = p.parentElement) {
      if (getComputedStyle(p).overflow === "visible") continue;
      const q = p.getBoundingClientRect();
      if (r.bottom <= q.top || r.top >= q.bottom || r.right <= q.left || r.left >= q.right) return true;
    }
    return false;
  }
  function renderNotes() {
    notesFrame = 0;
    const sec = current();
    const on = hasNotes && state.notes && !exportMode;
    frame.classList.toggle("kit-notes-on", on);
    noteLayer.replaceChildren();
    notesCol.style.visibility = on && sec.notes ? "" : "hidden";
    if (!on) return;
    const fr = frame.getBoundingClientRect();
    const s = fr.width / frame.offsetWidth || 1;
    const shown = new Set();
    for (const n of sec.el.querySelectorAll("[data-note]")) {
      if (n.closest(".kit-off") || !n.getClientRects().length) continue;
      const r = n.getBoundingClientRect();
      if (clipped(n, r)) continue;
      shown.add(n.dataset.note);
      const m = el("span", "kit-note-mark", n.dataset.note);
      m.style.left = Math.max(2, (r.left - fr.left) / s - 9) + "px";
      m.style.top = Math.max(2, (r.top - fr.top) / s - 9) + "px";
      noteLayer.append(m);
    }
    if (sec.notes && notesCol.firstChild !== sec.notes) notesCol.replaceChildren(sec.notes);
    // Notes follow the same variant tags; a note whose marker is off screen dims.
    sec.notes?.querySelectorAll("[data-note-for]").forEach((p) => {
      let ok = true;
      if (p.dataset.variant) ok &&= words(p.dataset.variant).includes(state.variant);
      p.classList.toggle("kit-off", !ok);
      p.classList.toggle("kit-note-dim", !shown.has(p.dataset.noteFor));
    });
  }

  function layout() {
    const vp = VIEWPORTS[state.vp];
    frame.style.width = vp.w + "px";
    frame.style.height = vp.h + "px";
    if (exportMode) {
      frame.style.transform = "";
      return;
    }
    // Top stack, all slots reserved so nothing moves when switching section:
    // bar 1 = sections (identical everywhere), bar 2 = this section's variants
    // (its slot is kept, empty, on sections without variants), then the
    // caption line when any section has notes.
    // Base / Notes sit in the top-right corner. When the window is too narrow
    // for both, the top stack centres in the space left of them. Only the
    // first top bar shares their row, and it is the same on every section.
    const topStack = [designBar, variantBar, knobBar, caption];
    for (const b of topStack) {
      b.style.right = "";
      b.style.maxWidth = "";
    }
    const firstBar = !designBar.hidden ? designBar : !variantBar.hidden ? variantBar : null;
    if (!reviewBar.hidden && firstBar) {
      const rv = reviewBar.getBoundingClientRect();
      if (firstBar.getBoundingClientRect().right > rv.left - 12) {
        const right = window.innerWidth - rv.left + 12;
        for (const b of topStack) {
          b.style.right = right + "px";
          b.style.maxWidth = `calc(100vw - ${right + 16}px)`;
        }
      }
    }
    let y = 14;
    let slotH = 0;
    if (!designBar.hidden) {
      const r = designBar.getBoundingClientRect();
      slotH = r.height;
      y = r.bottom + 8;
    }
    if (!variantBar.hidden) {
      variantBar.style.top = y + "px";
      y += (slotH || variantBar.getBoundingClientRect().height) + 6;
    }
    if (!caption.hidden) {
      caption.style.top = y + "px";
      y += 16;
    }
    if (!knobBar.hidden) {
      if (!caption.hidden) y += 4;
      knobBar.style.top = y + "px";
      y += knobBar.getBoundingClientRect().height + 6;
    }
    const top = y + 46;
    const bottom = situationBar.hidden ? 14 : window.innerHeight - situationBar.getBoundingClientRect().top + 24;
    const availH = window.innerHeight - top - bottom;
    // The notes column's room is kept only while notes show; with notes off
    // the frame centres instead of sitting beside an empty column.
    const notesW = Math.round(Math.min(300, Math.max(200, window.innerWidth * 0.2)));
    const reserve = hasNotes && state.notes ? notesW + 24 : 0;
    const availW = window.innerWidth - 48 - reserve;
    const scale = Math.min(1, availW / vp.w, availH / vp.h);
    stage.style.paddingRight = reserve + "px";
    notesCol.style.width = notesW + "px";
    frame.style.transform = `scale(${scale})`;
    holder.style.width = vp.w * scale + "px";
    holder.style.height = vp.h * scale + "px";
    stage.style.top = top - 22 + "px";
    label.textContent = `${vp.label} · ${vp.w}×${vp.h}${scale < 1 ? ` · ${Math.round(scale * 100)}%` : ""}`;
    renderNotes();
  }

  // ---------------------------------------------------------------- bars
  const designBar = document.createElement("div");
  designBar.className = "kit-bar kit-design";
  // Second top bar: controls that exist only for the current section (its variants).
  const variantBar = document.createElement("div");
  variantBar.className = "kit-bar kit-design kit-design-2";
  // Third top bar: the mock's knobs (MockKit.addDesignControl), fine-tuning
  // within the chosen design. Values live in the hash as knobs=key:value,...
  const knobBar = document.createElement("div");
  knobBar.className = "kit-bar kit-design kit-design-3";
  // Variant note: a quiet line under the design bar, outside it, so the bar
  // keeps one width whatever variant is shown.
  const caption = document.createElement("div");
  caption.className = "kit-caption";
  const situationBar = document.createElement("div");
  situationBar.className = "kit-bar kit-situation";
  // Top-right corner: Base (plain Paseo) and Notes, on every mock with a design.
  const reviewBar = document.createElement("div");
  reviewBar.className = "kit-bar kit-review";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // items: { key, badge?, label?, title? }
  function segmented(items, activeKey, onPick) {
    const wrap = el("div", "kit-seg");
    for (const it of items) {
      const b = el("button", "kit-seg-btn" + (it.key === activeKey ? " kit-on" : ""));
      if (it.badge) b.append(el("b", null, it.badge));
      if (it.label) b.append(el("span", null, it.label));
      if (it.title) b.title = it.title;
      b.onclick = () => onPick(it.key);
      wrap.append(b);
    }
    return wrap;
  }
  function cycleControl(values, value, labels, onPick) {
    const b = el("button", "kit-cycle-btn");
    b.dataset.cycle = values.map((v) => labels[v] ?? v).join("|");
    b.dataset.value = labels[value] ?? value;
    b.setAttribute("data-cycle-chevrons", "");
    enhanceCycle(b, (_, i) => onPick(values[i]));
    return b;
  }

  function renderBars() {
    const sec = current();
    designBar.replaceChildren();
    if (sections.length > 1) {
      designBar.append(segmented(sections.map((s) => ({ key: s.id, label: s.title })), sec.id, (id) => set({ section: id })));
    }
    designBar.hidden = !designBar.childElementCount;

    // Base / Notes: in-place toggles, the same spot flips back.
    reviewBar.replaceChildren();
    const toggle = (label, key, on, title, onClick) => {
      const b = el("button", "kit-seg-btn kit-toggle" + (on ? " kit-on" : ""));
      b.append(el("span", null, label), el("kbd", null, key));
      b.title = title;
      b.onclick = onClick;
      return b;
    };
    if (hasDelta) reviewBar.append(toggle("Base", "b", state.base, "Plain Paseo, without this mock's changes (b)", () => set({ base: !state.base })));
    if (hasNotes) {
      const b = toggle("Notes", "n", state.notes, "What the design changes, how and why (n)", () => set({ notes: !state.notes }));
      b.disabled = !sec.notes && !sec.el.querySelector("[data-note]");
      reviewBar.append(b);
    }
    reviewBar.hidden = !reviewBar.childElementCount;

    // Variants: a row of buttons (an important choice, like sections);
    // data-variants-as="cycle" on the section asks for a cycle button instead.
    variantBar.replaceChildren();
    if (sec.variants.length) {
      if (sec.el.dataset.variantsAs === "cycle") {
        const ids = sec.variants.map((v) => v.id);
        const labels = Object.fromEntries(sec.variants.map((v) => [v.id, v.label ? `${v.id} · ${v.label}` : v.id]));
        variantBar.append(cycleControl(ids, state.variant, labels, (id) => set({ variant: id })));
      } else {
        variantBar.append(segmented(sec.variants.map((v) => ({ key: v.id, badge: v.id, label: v.label, title: v.note })), state.variant, (id) => set({ variant: id })));
      }
    }
    variantBar.hidden = !sections.some((s) => s.variants.length);
    variantBar.classList.toggle("kit-vacant", !sec.variants.length);
    knobBar.replaceChildren(...knobControls);
    knobBar.hidden = !knobControls.length;
    caption.hidden = !sections.some((s) => s.variants.some((v) => v.note));
    caption.textContent = sec.variants.find((v) => v.id === state.variant)?.note || "";

    // Every value names itself: "Pure black", "Phone", "normal session",
    // "closed panel". No separate labels in the bar.
    situationBar.replaceChildren();
    if (themes.length > 1) situationBar.append(cycleControl(themes, state.theme, THEME_LABELS, (v) => set({ theme: v })));
    if (viewports.length > 1) {
      const vpLabels = Object.fromEntries(viewports.map((v) => [v, VIEWPORTS[v].label]));
      situationBar.append(cycleControl(viewports, state.vp, vpLabels, (v) => set({ vp: v })));
    }
    if (dataSets.live) situationBar.append(cycleControl(["acme", "live"], state.data, DATA_LABELS, (v) => set({ data: v })));
    for (const [axis, values] of sec.axes) {
      if (values.length > 1 && shownAxes.has(axis)) {
        const labels = Object.fromEntries(values.map((v) => [v, stateLabel(axis, v)]));
        situationBar.append(cycleControl(values, state.states[axis], labels, (v) => set({ states: { ...state.states, [axis]: v } })));
      }
    }
    situationBar.append(...situationExtras);
    situationBar.hidden = !situationBar.childElementCount;
  }

  function set(patch) {
    // A section switch without an explicit variant returns to that section's last pick.
    if (patch.section && patch.section !== state.section && !("variant" in patch)) patch = { ...patch, variant: state.picks[patch.section] || null };
    Object.assign(state, patch);
    apply();
  }

  function step(list, cur, d) {
    const i = list.indexOf(cur);
    return list[(i + d + list.length) % list.length];
  }
  function onKey(e) {
    const t = e.target;
    if (t.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const sec = current();
    const ids = sec.variants.map((v) => v.id);
    if (e.key === "ArrowRight" && ids.length) set({ variant: step(ids, state.variant, 1) });
    else if (e.key === "ArrowLeft" && ids.length) set({ variant: step(ids, state.variant, -1) });
    else if (e.key === "ArrowDown" && sections.length > 1) set({ section: step(sections.map((s) => s.id), state.section, 1) });
    else if (e.key === "ArrowUp" && sections.length > 1) set({ section: step(sections.map((s) => s.id), state.section, -1) });
    else if (e.key === "t") set({ theme: step(themes, state.theme, e.shiftKey ? -1 : 1) });
    else if (e.key === "v") set({ vp: step(viewports, state.vp, e.shiftKey ? -1 : 1) });
    else if (e.key === "d" && dataSets.live) set({ data: state.data === "live" ? "acme" : "live" });
    else if (e.key === "b" && hasDelta) set({ base: !state.base });
    else if (e.key === "n" && hasNotes) set({ notes: !state.notes });
    else return;
    e.preventDefault();
  }

  // ---------------------------------------------------------------- mock interactions
  // The mock's own controls drive the same state as the bars, so the two never disagree:
  //   data-toggle="panel"          click steps that app-state axis to its next value
  //   data-set="drawer: closed"    click sets axes (";" joins several)
  //   data-pick="tabs"             click moves the highlight within that group
  //                                (whichever of is-active / is-selected the group uses)
  //   data-editable                you can type in it; Enter does nothing
  function wire() {
    frame.addEventListener("click", (e) => {
      const t = e.target.closest("[data-toggle],[data-set],[data-pick]");
      if (!t || !frame.contains(t)) return;
      const axes = current().axes;
      if (t.dataset.toggle) {
        const values = axes.get(t.dataset.toggle);
        if (values) set({ states: { ...state.states, [t.dataset.toggle]: step(values, state.states[t.dataset.toggle], 1) } });
      }
      if (t.dataset.set) {
        const patch = {};
        for (const [axis, vals] of parseWhen(t.dataset.set)) if (axes.has(axis)) patch[axis] = vals[0];
        set({ states: { ...state.states, ...patch } });
      }
      if (t.dataset.pick) {
        const group = [...frame.querySelectorAll(`[data-pick="${t.dataset.pick}"]`)];
        const cls = group.some((n) => n.classList.contains("is-selected")) ? "is-selected" : "is-active";
        group.forEach((n) => n.classList.toggle(cls, n === t));
      }
    });
    frame.querySelectorAll("[data-editable]").forEach((n) => {
      n.contentEditable = "plaintext-only";
      n.spellcheck = false;
      n.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
      });
      // keep :empty (placeholder) working after the text is deleted
      n.addEventListener("input", () => {
        if (!n.textContent) n.replaceChildren();
      });
    });
  }

  // ---------------------------------------------------------------- icons
  // <i data-icon="plus" data-size="14"></i> → Lucide SVG (Paseo's icon set,
  // stroke 1.5, default 16px). Classes on the <i> carry over.
  function icon(name, size = 16, cls = "") {
    const body = window.KitIcons?.[name];
    if (!body) return `<span class="icon icon-missing" title="unknown icon: ${name}">?</span>`;
    return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }
  function renderIcons(root = document) {
    root.querySelectorAll("i[data-icon]").forEach((n) => {
      n.outerHTML = icon(n.dataset.icon, Number(n.dataset.size) || 16, n.className);
    });
  }
  function loadScript(name) {
    return new Promise((ok) => {
      const s = document.createElement("script");
      s.src = new URL(name, kitBase).href;
      s.onload = s.onerror = ok;
      document.head.append(s);
    });
  }

  // navigator.clipboard exists only in secure contexts (https, localhost).
  // Mocks are opened over plain http by hostname, where it is undefined, so
  // fall back to execCommand; resolves false when neither works and the
  // caller must show the text for selecting by hand.
  async function copyText(text) {
    if (window.isSecureContext && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    return ok;
  }

  // ---------------------------------------------------------------- boot
  html.classList.add(exportMode ? "kit-export" : "kit");
  readHash();
  if (exportMode) {
    document.body.replaceChildren(frame);
  } else {
    document.body.replaceChildren(stage, designBar, variantBar, knobBar, caption, situationBar, reviewBar);
    window.addEventListener("resize", layout);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", () => {
      readHash();
      apply();
    });
  }
  Promise.all([loadScript("icons.js"), loadScript("icons-extra.js"), loadScript("appearance.js"), loadScript("data.js")])
    .then(() => window.KitData.load(new URL(".", location.href), kitBase, !exportMode))
    .then((sets) => {
    dataSets = sets;
    renderIcons(frame);
    frame.querySelectorAll("[data-cycle]").forEach((b) => enhanceCycle(b));
    wire();
    apply();
    window.MockKit = {
      state,
      sections: sections.map(({ id, title, variants, axes }) => ({ id, title, variants, axes: Object.fromEntries(axes) })),
      viewports: VIEWPORTS,
      set,
      onChange: (fn) => listeners.push(fn),
      enhanceCycle,
      addSituationControl: (n) => {
        situationExtras.push(n);
        apply();
      },
      addDesignControl: (n) => {
        knobControls.push(n);
        apply();
      },
      copyText,
      icon,
      renderIcons,
      data: () => dataSets[state.data],
    };
    document.dispatchEvent(new CustomEvent("mockready"));
  });
})();

// Paseo mock kit: the shell (design + situation controls, backdrop) and the
// tag engine. Tags in the page configure it; knobs and presets come from
// window.MockDesign. See ../README.md for the authoring guide and
// ../GLOSSARY.md for the words used here.
//
// Two separate control groups, on purpose:
//   DESIGN    (amber: top bars, or the top of the shell sidebar)
//             what is decided: sections, variants, references, presets, knobs
//   SITUATION (violet: bottom bar, or the bottom of the shell sidebar)
//             where it is seen: theme, viewport, region, scale, data, app state
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
  // Scale: "fit" shrinks the frames into the window (never enlarges); a
  // number is an exact magnification, crisp at whole numbers, and the stage
  // scrolls when the frames don't fit.
  const SCALE_LABELS = { fit: "Fit window", 1: "1:1 size", 2: "2× zoom", 3: "3× zoom", 4: "4× zoom" };
  const DEFAULT_SCALES = "fit 1 2 3";
  const SHELLS = ["bars", "sidebar"];
  const FRAME_GAP = 32;

  const html = document.documentElement;
  const exportMode = new URLSearchParams(location.search).has("export");
  const words = (s) => (s || "").trim().split(/\s+/).filter(Boolean);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------------------------------------------------------------- page model
  const sectionEls = [...document.querySelectorAll("[data-section]")];
  if (!sectionEls.length) {
    // No sections: the whole body is one screen.
    const only = document.createElement("div");
    only.dataset.section = "main";
    [...document.body.childNodes].filter((n) => n.nodeName !== "SCRIPT").forEach((n) => only.append(n));
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
  // Untouched copies of the screen: every reference frame starts from one.
  const pristine = sectionEls.map((n) => n.cloneNode(true));

  // Base: plain Paseo without this mock's changes (variants, data-mod, slot contents, knobs).
  let hasDelta =
    sections.some((s) => s.variants.length) ||
    sectionEls.some((s) => s.querySelector("[data-mod],[data-base],[data-variant]")) ||
    sectionEls.some((s) => [...s.querySelectorAll("[data-slot]")].some((slot) => slot.children.length));
  const hasNotes = sections.some((s) => s.notes || s.el.querySelector("[data-note]"));

  const themes = words(html.dataset.themes || DEFAULT_THEMES);
  const viewports = words(html.dataset.viewports || "desktop laptop phone");
  const scales = words(html.dataset.scales || DEFAULT_SCALES).filter((s) => s === "fit" || Number(s) > 0);
  // Regions: parts of the screen a frame can show alone (data-region="sidebar").
  const regionLabels = new Map([["screen", "Whole screen"]]);
  for (const s of sectionEls) {
    s.querySelectorAll("[data-region]").forEach((n) => {
      if (!regionLabels.has(n.dataset.region)) regionLabels.set(n.dataset.region, n.dataset.regionLabel || cap(n.dataset.region));
    });
  }
  const regions = html.dataset.regions ? words(html.dataset.regions).filter((r) => regionLabels.has(r)) : [...regionLabels.keys()];
  if (!regions.length) regions.push("screen");
  const defaultShell = SHELLS.includes(html.dataset.shell) ? html.dataset.shell : "bars";
  // References (frames beside the candidate) are offered once a mock asks for
  // them with data-reference on <html> or declares presets.
  const defaultRefs = words((html.dataset.reference || "").replace(/,/g, " "));

  // ---------------------------------------------------------------- design (window.MockDesign)
  // Knobs: declared controls within the chosen design; presets: named bundles
  // of knob values (optionally a variant). Read once, when the kit boots.
  let knobDefs = [];
  let knobGroups = [];
  let presets = [];
  let compareOn = html.hasAttribute("data-reference");
  const CSS_UNITS = /^(px|ms|s|%|em|rem|deg|vw|vh)$/;

  function normOptions(o) {
    if (Array.isArray(o)) return o.map((x) => (Array.isArray(x) ? { value: String(x[0]), label: String(x[1] ?? x[0]) } : { value: String(x), label: String(x) }));
    return Object.entries(o || {}).map(([value, label]) => ({ value, label: String(label) }));
  }
  function readDesign() {
    const cfg = window.MockDesign || {};
    let group = null;
    for (const raw of cfg.knobs || []) {
      if (raw.heading) {
        knobGroups.push((group = { title: raw.heading, knobs: [] }));
        continue;
      }
      const k = { ...raw };
      if (k.options) k.options = normOptions(k.options);
      k.type ||= k.options ? "choice" : typeof k.value === "boolean" ? "toggle" : /^#/.test(k.value || "") ? "color" : k.min != null && k.max != null ? "range" : "number";
      if (k.value === undefined) k.value = { range: k.min ?? 0, number: k.min ?? 0, toggle: false, choice: k.options?.[0]?.value, color: "#888888" }[k.type];
      k.value = coerce(k, k.value);
      if (!group) knobGroups.push((group = { title: "Knobs", knobs: [] }));
      group.knobs.push(k);
      knobDefs.push(k);
    }
    knobGroups = knobGroups.filter((g) => g.knobs.length);
    presets = (cfg.presets || []).filter((p) => p && p.id);
    if (knobDefs.length) hasDelta = true;
    if (presets.length) compareOn = true;
  }
  function coerce(k, v) {
    if (v === undefined || v === null || v === "") return k.value;
    switch (k.type) {
      case "range":
      case "number": {
        const n = Number(v);
        return Number.isFinite(n) ? n : k.value;
      }
      case "toggle":
        return v === true || v === "1" || v === "true" || v === "on";
      case "choice":
        return k.options.some((o) => o.value === String(v)) ? String(v) : k.value;
      case "color":
        return /^#[0-9a-f]{6}$/i.test(v) ? String(v).toLowerCase() : k.value;
      default:
        return String(v);
    }
  }
  const knobText = (k, v) => (k.type === "toggle" ? (v ? "1" : "0") : String(v));
  function cssValue(k, v) {
    if (k.type === "toggle") return v ? "1" : "0";
    if (k.type === "range" || k.type === "number") return v + (CSS_UNITS.test(k.unit || "") ? k.unit : "");
    return String(v);
  }
  // A preset sets only the knobs it lists; the rest keep the candidate's values,
  // so a reference frame differs from the candidate in exactly those knobs.
  function presetKnobs(p) {
    const out = { ...state.knobs };
    for (const k of knobDefs) if (p.knobs && k.key in p.knobs) out[k.key] = coerce(k, p.knobs[k.key]);
    return out;
  }
  const presetMatches = (p) => {
    if (p.variant && p.variant !== state.variant) return false;
    const mine = presetKnobs(p);
    return knobDefs.every((k) => mine[k.key] === state.knobs[k.key]);
  };
  function applyPreset(p) {
    const patch = { knobs: presetKnobs(p) };
    if (p.picks) patch.picks = { ...state.picks, ...p.picks };
    if (p.variant) patch.variant = p.variant;
    set(patch);
  }

  // ---------------------------------------------------------------- state + hash
  // picks: each section's last variant, so switching sections keeps every choice.
  const state = {
    section: sections[0].id,
    variant: null,
    theme: themes[0],
    vp: viewports[0],
    region: regions[0],
    scale: scales[0],
    shell: defaultShell,
    refs: [...defaultRefs],
    states: {},
    picks: {},
    base: false,
    notes: true,
    knobs: {},
  };
  const KIT_KEYS = ["theme", "vp", "canvas", "picks", "data", "base", "notes", "knobs", "region", "scale", "shell", "ref"];

  function readHash() {
    const [path, query] = location.hash.slice(1).split("?");
    const [sec, variant] = (path || "").split("/");
    // The hash is the whole truth: anything it omits goes back to the default.
    state.section = sections.some((s) => s.id === sec) ? sec : sections[0].id;
    state.variant = variant || null;
    const q = new URLSearchParams(query || "");
    state.theme = themes.includes(q.get("theme")) ? q.get("theme") : themes[0];
    state.vp = viewports.includes(q.get("vp")) ? q.get("vp") : viewports[0];
    state.region = regions.includes(q.get("region")) ? q.get("region") : regions[0];
    state.scale = scales.includes(q.get("scale")) ? q.get("scale") : scales[0];
    state.shell = SHELLS.includes(q.get("shell")) ? q.get("shell") : defaultShell;
    state.refs = q.has("ref") ? q.get("ref").split(",").filter((r) => r && r !== "none") : [...defaultRefs];
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
    for (const [k, v] of q) if (!KIT_KEYS.includes(k)) state.states[k] = v;
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
    if (state.region !== regions[0]) q.set("region", state.region);
    if (state.scale !== scales[0]) q.set("scale", state.scale);
    const sec = current();
    for (const [axis, values] of sec.axes) if (state.states[axis] && state.states[axis] !== values[0]) q.set(axis, state.states[axis]);
    if (html.dataset.canvas) q.set("canvas", html.dataset.canvas);
    if (state.data !== defaultData) q.set("data", state.data);
    if (state.base) q.set("base", "1");
    if (hasNotes && !state.notes) q.set("notes", "off");
    if (compareOn && state.refs.join(",") !== defaultRefs.join(",")) q.set("ref", state.refs.join(",") || "none");
    // Declared knobs are written only when they differ from their default;
    // a mock's own (undeclared) knobs are written as they are.
    const declared = new Map(knobDefs.map((k) => [k.key, k]));
    const knobs = Object.entries(state.knobs).flatMap(([key, v]) => {
      const k = declared.get(key);
      if (k) return v === k.value ? [] : [[key, knobText(k, v)]];
      return v != null && v !== "" ? [[key, v]] : [];
    });
    if (knobs.length) q.set("knobs", knobs.map(([k, v]) => k + ":" + v).join(","));
    const picks = sections
      .filter((s) => s.id !== state.section && state.picks[s.id] && state.picks[s.id] !== s.variants[0]?.id)
      .map((s) => s.id + "." + state.picks[s.id]);
    if (picks.length) q.set("picks", picks.join(","));
    if (state.shell !== defaultShell) q.set("shell", state.shell);
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
  function renderData(f) {
    if (!window.KitData || f.data === state.data) return;
    f.data = state.data;
    window.KitData.render(f.el, dataSets[state.data]);
    renderIcons(f.el);
  }

  // ---------------------------------------------------------------- frames
  // One frame per compared design. The candidate follows the design controls;
  // each reference frame shows Base, a preset or a variant beside it, in the
  // same situation. The candidate comes first in the DOM (so scripts that
  // query ".mock-frame" or an id get it) and last on screen, next to the
  // controls.
  function makeFrame(role, nodes) {
    const el = h("div", "mock-frame");
    el.dataset.frame = role;
    el.append(...nodes);
    const clip = h("div", "kit-frame-clip");
    clip.append(el);
    // The frame's design name; its line is kept whenever the mock offers
    // references, so adding one never moves the frames.
    const name = h("div", "kit-frame-name");
    const holder = h("div", "kit-frame-holder");
    holder.dataset.role = role;
    holder.append(name, clip);
    const secs = Object.fromEntries(nodes.map((n) => [n.dataset.section, n]));
    return { role, el, clip, holder, name, secs, data: null, design: null, rect: null };
  }
  const cand = makeFrame("candidate", sectionEls);
  cand.holder.style.order = "1000";
  const refFrames = [];
  let shownFrames = [cand];
  const listeners = [];
  const frameListeners = [];

  function prepareFrame(f) {
    renderIcons(f.el);
    f.el.querySelectorAll("[data-cycle]").forEach((b) => enhanceCycle(b));
    wire(f.el);
  }
  function refFrame(i) {
    while (refFrames.length <= i) {
      const f = makeFrame("reference", pristine.map((n) => n.cloneNode(true)));
      f.holder.style.order = String(refFrames.length);
      row.append(f.holder);
      prepareFrame(f);
      refFrames.push(f);
    }
    return refFrames[i];
  }
  const variantName = (v) => (v.label ? `${v.id} · ${v.label}` : v.id);
  // A frame's design. null = the candidate (follows the controls).
  function designFor(ref, sec) {
    const own = { ref: null, base: state.base, variant: state.variant, picks: { ...state.picks }, knobs: state.knobs, label: "" };
    if (!ref) return own;
    if (ref === "base") return { ...own, ref, base: true, label: "Base · plain Paseo" };
    const p = presets.find((x) => x.id === ref);
    if (p) {
      const variant = p.variant && sec.variants.some((v) => v.id === p.variant) ? p.variant : own.variant;
      return { ref, base: false, variant, picks: { ...own.picks, ...p.picks, [sec.id]: variant }, knobs: presetKnobs(p), label: p.label };
    }
    const v = sec.variants.find((x) => x.id === ref);
    if (v) return { ...own, ref, base: false, variant: v.id, picks: { ...own.picks, [sec.id]: v.id }, label: variantName(v) };
    return null;
  }
  function compareOptions(sec) {
    return ["", ...(hasDelta ? ["base"] : []), ...presets.map((p) => p.id), ...sec.variants.map((v) => v.id)];
  }
  const compareLabel = (sec, r) => (r ? `Beside: ${designFor(r, sec)?.label || r}` : "Nothing beside");
  function candidateName() {
    if (state.base) return "Base · plain Paseo";
    const parts = [];
    const v = current().variants.find((x) => x.id === state.variant);
    if (v) parts.push(variantName(v));
    if (knobDefs.length) parts.push(presets.find(presetMatches)?.label || "Own values");
    return parts.join(" · ") || "Candidate";
  }

  // Engine pass on one frame: hide what its design and the situation exclude.
  // Returns the app-state axes whose elements can currently appear.
  function applyFrame(f, d, sec) {
    const fr = f.el;
    f.design = d;
    fr.dataset.theme = state.theme;
    fr.dataset.vp = state.vp;
    fr.dataset.section = sec.id;
    if (d.variant && !d.base) fr.dataset.v = d.variant;
    else delete fr.dataset.v;
    // data-v-<section>: every section's pick at once, so one section can show another's choice.
    for (const s of sections) {
      if (!s.variants.length) continue;
      if (d.base) fr.removeAttribute("data-v-" + s.id);
      else fr.setAttribute("data-v-" + s.id, d.picks[s.id] || s.variants[0].id);
    }
    fr.classList.toggle("kit-base", d.base);
    if (d.ref) fr.dataset.ref = d.ref;
    for (const k of Object.keys(fr.dataset)) if (k.startsWith("state")) delete fr.dataset[k];
    for (const [axis] of sec.axes) fr.setAttribute("data-state-" + axis, state.states[axis]);
    // Knobs on the frame: data-knob-<key> for CSS selectors, plus the custom
    // property a knob names with css: "--x".
    for (const k of knobDefs) {
      const v = d.knobs[k.key];
      if (k.type === "toggle") fr.toggleAttribute("data-knob-" + k.key, !!v);
      else fr.setAttribute("data-knob-" + k.key, String(v));
      if (k.css) fr.style.setProperty(k.css, cssValue(k, v));
    }
    for (const s of sections) f.secs[s.id].classList.toggle("kit-off", s.id !== sec.id);
    // An axis control is shown only if some element using it can currently
    // appear (e.g. a phone-only drawer axis hides on desktop).
    const root = f.secs[sec.id];
    const structOff = new Set();
    const tagged = new Set();
    const reach = new Set();
    for (const n of root.querySelectorAll("[data-variant],[data-viewport],[data-when],[data-mod],[data-base],[data-slot] > *")) {
      let struct = true;
      if (n.dataset.variant) struct &&= !d.base && words(n.dataset.variant).includes(d.variant);
      if (n.dataset.viewport) struct &&= words(n.dataset.viewport).flatMap((v) => VIEWPORT_ALIASES[v] || [v]).includes(state.vp);
      if (n.hasAttribute("data-mod") || n.parentElement.hasAttribute("data-slot")) struct &&= !d.base;
      if (n.hasAttribute("data-base")) struct &&= d.base;
      let on = struct;
      if (n.dataset.when) {
        const when = parseWhen(n.dataset.when);
        for (const [axis, vals] of when) {
          tagged.add(axis);
          on &&= vals.includes(state.states[axis]);
        }
        let reachable = struct;
        for (let p = n.parentElement; reachable && p && p !== root; p = p.parentElement) if (structOff.has(p)) reachable = false;
        if (reachable) when.forEach((_, axis) => reach.add(axis));
      }
      if (!struct) structOff.add(n);
      n.classList.toggle("kit-off", !on);
    }
    for (const [axis] of sec.axes) if (!tagged.has(axis)) reach.add(axis);
    return reach;
  }
  // Public view of a frame, for scripts that render into every frame.
  const frameView = (f) => ({
    el: f.el,
    role: f.role,
    ref: f.design.ref,
    label: f.role === "candidate" ? candidateName() : f.design.label,
    base: f.design.base,
    variant: f.design.variant,
    picks: f.design.picks,
    knobs: f.design.knobs,
  });

  // ---------------------------------------------------------------- apply
  // Kit modules (appearance.js) add their own controls to the situation group;
  // MockKit.addDesignControl nodes join the design group after the knobs.
  const situationExtras = [];
  const knobControls = [];
  let shownAxes = new Set();
  function apply() {
    const sec = current();
    if (exportMode || !dataSets.live) state.data = "acme";
    if (!["acme", "live"].includes(state.data)) state.data = "acme";
    if (sec.variants.length && !sec.variants.some((v) => v.id === state.variant)) state.variant = sec.variants[0].id;
    if (!sec.variants.length) state.variant = null;
    state.picks[sec.id] = state.variant;
    for (const [axis, values] of sec.axes) if (!values.includes(state.states[axis])) state.states[axis] = values[0];
    if (!regions.includes(state.region)) state.region = regions[0];
    if (!scales.includes(String(state.scale))) state.scale = scales[0];
    state.scale = String(state.scale);
    if (!SHELLS.includes(state.shell)) state.shell = defaultShell;
    for (const k of knobDefs) state.knobs[k.key] = coerce(k, state.knobs[k.key]);
    state.refs = compareOn && !exportMode ? state.refs.filter((r) => compareOptions(sec).includes(r) && r) : [];

    html.dataset.theme = state.theme; // lets kit-styled controls outside the frame pick up tokens if wanted
    html.classList.toggle("kit-base-on", state.base);
    shownFrames = [...state.refs.map((_, i) => refFrame(i)), cand];
    refFrames.forEach((f, i) => (f.holder.hidden = i >= state.refs.length));
    for (const f of shownFrames) {
      renderData(f);
      const reach = applyFrame(f, designFor(f === cand ? null : state.refs[refFrames.indexOf(f)], sec), sec);
      if (f === cand) shownAxes = reach;
    }
    if (!exportMode) {
      mountShell();
      writeHash();
      renderBars();
    }
    listeners.forEach((fn) => fn({ ...state, states: { ...state.states } }));
    for (const fn of frameListeners) shownFrames.forEach((f) => fn(frameView(f)));
    document.dispatchEvent(new CustomEvent("mockchange", { detail: state }));
    layout();
    // data-scroll="bottom": show the end of a scroll area, like a chat scrolled to the latest turn.
    for (const f of shownFrames) f.secs[sec.id].querySelectorAll('[data-scroll="bottom"]').forEach((n) => (n.scrollTop = n.scrollHeight));
  }

  // ---------------------------------------------------------------- layout
  // The stage fills the window beside the shell sidebar (or under the shell
  // bars, which float over it) and scrolls when the frames are bigger. One
  // situation line (region, size, scale) sits over the row of frames, since
  // they all share the situation.
  const stage = h("div", "kit-stage");
  const content = h("div", "kit-stage-content");
  const situationLabel = h("div", "kit-frame-label");
  const row = h("div", "kit-frames");
  content.append(situationLabel, row);
  stage.append(content);
  row.style.gap = FRAME_GAP + "px";
  row.append(cand.holder);
  // Review notes: numbered markers over the candidate, the notes column beside it.
  const noteLayer = h("div", "kit-note-layer");
  cand.el.append(noteLayer);
  const notesCol = h("div", "kit-notes");
  cand.holder.append(notesCol);
  let notesFrame = 0;
  cand.el.addEventListener("scroll", () => (notesFrame ||= requestAnimationFrame(renderNotes)), true);

  // Hidden by a scrolled-away ancestor (chat, sidebar list)?
  function clipped(n, r) {
    for (let p = n.parentElement; p && p !== cand.el; p = p.parentElement) {
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
    cand.el.classList.toggle("kit-notes-on", on);
    noteLayer.replaceChildren();
    notesCol.style.visibility = on && sec.notes ? "" : "hidden";
    if (!on) return;
    const fr = cand.el.getBoundingClientRect();
    const s = fr.width / cand.el.offsetWidth || 1;
    const reg = cand.rect || { x: 0, y: 0, w: Infinity, h: Infinity };
    const shown = new Set();
    for (const n of sec.el.querySelectorAll("[data-note]")) {
      if (n.closest(".kit-off") || !n.getClientRects().length) continue;
      const r = n.getBoundingClientRect();
      if (clipped(n, r)) continue;
      const x = (r.left - fr.left) / s;
      const y = (r.top - fr.top) / s;
      // Outside the region the frame shows: not on screen.
      if (x + r.width / s <= reg.x || x >= reg.x + reg.w || y + r.height / s <= reg.y || y >= reg.y + reg.h) continue;
      shown.add(n.dataset.note);
      const m = h("span", "kit-note-mark", n.dataset.note);
      m.style.left = Math.max(reg.x + 2, x - 9) + "px";
      m.style.top = Math.max(reg.y + 2, y - 9) + "px";
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

  // The part of the frame's screen its region covers, in screen pixels.
  function regionRect(f, vp) {
    const full = { x: 0, y: 0, w: vp.w, h: vp.h, missing: false };
    if (state.region === "screen") return full;
    const root = f.secs[state.section];
    const n = [...root.querySelectorAll(`[data-region="${CSS.escape(state.region)}"]`)].find((x) => x.getClientRects().length);
    if (!n) return { ...full, missing: true };
    const fr = f.el.getBoundingClientRect();
    const s = fr.width / f.el.offsetWidth || 1;
    const r = n.getBoundingClientRect();
    return { x: Math.round((r.left - fr.left) / s), y: Math.round((r.top - fr.top) / s), w: Math.round(r.width / s), h: Math.round(r.height / s), missing: false };
  }
  function place(f, r, s) {
    f.rect = r;
    f.el.style.transform = `translate(${-r.x * s}px, ${-r.y * s}px) scale(${s})`;
    f.clip.style.width = r.w * s + "px";
    f.clip.style.height = r.h * s + "px";
    f.clip.classList.toggle("kit-phone", state.vp === "phone" && (state.region === "screen" || r.missing));
  }

  function layout() {
    if (!cand.design) return; // before the first apply()
    const vp = VIEWPORTS[state.vp];
    for (const f of shownFrames) {
      f.el.style.width = vp.w + "px";
      f.el.style.height = vp.h + "px";
    }
    if (exportMode) {
      place(cand, regionRect(cand, vp), 1);
      return;
    }
    const side = state.shell === "sidebar";
    const topStack = [designBar, variantBar, knobBar, caption];
    for (const b of [...topStack, situationBar]) {
      b.style.top = "";
      b.style.right = "";
      b.style.maxWidth = "";
    }
    let padTop = 28;
    let padBottom = 24;
    if (!side) {
      // Top stack, all slots reserved so nothing moves when switching section:
      // bar 1 = sections (identical everywhere), bar 2 = this section's variants
      // (its slot is kept, empty, on sections without variants), then the
      // caption line when any section has notes, then the knob bar.
      // Base / Notes / Sidebar sit in the top-right corner. When the window is
      // too narrow for both, the top stack centres in the space left of them.
      // Only the first top bar shares their row, and it is the same on every section.
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
      } else if (!reviewBar.hidden) {
        y = reviewBar.getBoundingClientRect().bottom + 8;
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
      padTop = y + 24;
      padBottom = situationBar.hidden ? 24 : window.innerHeight - situationBar.getBoundingClientRect().top + 24;
    }
    // The notes column's room is kept only while notes show; with notes off
    // the frames centre instead of sitting beside an empty column.
    const notesW = Math.round(Math.min(300, Math.max(200, window.innerWidth * 0.2)));
    const reserve = hasNotes && state.notes ? notesW + 24 : 0;
    content.style.padding = `${padTop}px ${24 + reserve}px ${padBottom}px 24px`;
    const availW = stage.clientWidth - 48 - reserve - FRAME_GAP * (shownFrames.length - 1);
    // Room above the frames: the situation line, plus the frame-name line when shown.
    const labelsH = 22 + (compareOn ? 22 : 0);
    const availH = stage.clientHeight - padTop - padBottom - labelsH;
    const rects = shownFrames.map((f) => regionRect(f, vp));
    const sumW = rects.reduce((a, r) => a + r.w, 0);
    const maxH = Math.max(...rects.map((r) => r.h));
    const s = state.scale === "fit" ? Math.max(0.05, Math.min(1, availW / sumW, availH / maxH)) : Number(state.scale);
    shownFrames.forEach((f, i) => place(f, rects[i], s));
    notesCol.style.width = notesW + "px";
    notesCol.style.maxHeight = Math.max(160, availH) + "px";
    const r = cand.rect;
    const scaleText = state.scale === "fit" ? (s < 1 ? ` · ${Math.round(s * 100)}%` : "") : ` · ${SCALE_LABELS[state.scale] || state.scale + "×"}`;
    const where = state.region === "screen" ? `${vp.label} · ${vp.w}×${vp.h}` : r.missing ? `${regionLabels.get(state.region)} not shown · ${vp.label} · ${vp.w}×${vp.h}` : `${regionLabels.get(state.region)} · ${r.w}×${r.h}`;
    situationLabel.textContent = where + scaleText;
    for (const f of shownFrames) {
      f.name.hidden = !compareOn;
      f.name.textContent = f === cand ? candidateName() : f.design.label;
      f.name.title = f === cand ? "Candidate: follows the design controls" : "Reference: " + f.design.label;
    }
    renderNotes();
    if (!pop.hidden) placePop();
  }

  // ---------------------------------------------------------------- shell
  // The same controls in one of two layouts (state.shell):
  //   bars:    design bars at the top, the situation bar at the bottom
  //   sidebar: one panel on the right, design above situation
  const designBar = h("div", "kit-bar kit-design");
  // Second top bar: controls that exist only for the current section (its variants).
  const variantBar = h("div", "kit-bar kit-design kit-design-2");
  // Third top bar: references, presets, knobs, Copy values, and any
  // MockKit.addDesignControl nodes: fine-tuning within the chosen design.
  // Knob values live in the hash as knobs=key:value,...
  const knobBar = h("div", "kit-bar kit-design kit-design-3");
  // Variant note: a quiet line under the design bar, outside it, so the bar
  // keeps one width whatever variant is shown.
  const caption = h("div", "kit-caption");
  const situationBar = h("div", "kit-bar kit-situation");
  // Top-right corner: Base (plain Paseo), Notes, and the shell layout switch.
  const reviewBar = h("div", "kit-bar kit-review");
  const sidebar = h("aside", "kit-sidebar");
  const sbHead = h("div", "kit-sb-head");
  const sbDesign = h("div", "kit-sb-group kit-sb-design");
  sbDesign.append(h("div", "kit-sb-title", "Design"));
  const sbSituation = h("div", "kit-sb-group kit-sb-situation");
  sbSituation.append(h("div", "kit-sb-title", "Situation"));
  sidebar.append(sbHead, sbDesign, sbSituation);
  sidebar.hidden = true;
  // One floating panel for knob groups (in bars) and Copy values.
  const pop = h("div", "kit-pop");
  pop.hidden = true;
  let popAnchor = null;

  // knobBar's parts, built once so a dragged slider is never replaced mid-drag.
  const compareSlot = h("div", "kit-compare");
  const presetsEl = h("div", "kit-presets");
  const knobsEl = h("div", "kit-knobs");
  const extrasEl = h("div", "kit-extras");
  const copyBtn = h("button", "kit-cycle-btn kit-copy-btn", "Copy values");
  copyBtn.title = "Copy the design's values (JSON + CSS)";
  knobBar.append(compareSlot, presetsEl, knobsEl, extrasEl, copyBtn);

  function openPop(anchor, content) {
    popAnchor?.classList.remove("kit-on");
    popAnchor = anchor;
    anchor.classList.add("kit-on");
    pop.replaceChildren(content);
    pop.hidden = false;
    placePop();
  }
  function closePop() {
    pop.hidden = true;
    popAnchor?.classList.remove("kit-on");
    popAnchor = null;
  }
  function placePop() {
    if (!popAnchor?.isConnected) return closePop();
    const r = popAnchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const ph = pop.offsetHeight;
    if (state.shell === "sidebar") {
      pop.style.left = Math.max(8, r.left - w - 12) + "px";
      pop.style.top = Math.max(8, Math.min(window.innerHeight - ph - 8, r.top + r.height / 2 - ph / 2)) + "px";
      return;
    }
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    pop.style.top = (r.top < window.innerHeight / 2 ? r.bottom + 8 : Math.max(8, r.top - 8 - ph)) + "px";
  }
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !popAnchor?.contains(e.target)) closePop();
  });
  // The shell sidebar's design group scrolls; a panel opened from it follows its button.
  sbDesign.addEventListener("scroll", () => pop.hidden || placePop(), { passive: true });

  // items: { key, badge?, label?, title? }
  function segmented(items, activeKey, onPick) {
    const wrap = h("div", "kit-seg");
    for (const it of items) {
      const b = h("button", "kit-seg-btn" + (it.key === activeKey ? " kit-on" : ""));
      b.dataset.key = it.key;
      if (it.badge) b.append(h("b", null, it.badge));
      if (it.label) b.append(h("span", null, it.label));
      if (it.title) b.title = it.title;
      b.onclick = () => onPick(it.key);
      wrap.append(b);
    }
    return wrap;
  }
  // sizers: more labels the button must be wide enough for (no jump when its values change)
  function cycleControl(values, value, labels, onPick, sizers = []) {
    const b = h("button", "kit-cycle-btn");
    b.dataset.cycle = values.map((v) => labels[v] ?? v).join("|");
    b.dataset.value = labels[value] ?? value;
    b.setAttribute("data-cycle-chevrons", "");
    enhanceCycle(b, (_, i) => onPick(values[i]));
    const stack = b.querySelector(".kit-cycle-vals");
    for (const t of sizers) stack.append(h("span", null, t));
    return b;
  }

  // ---------------------------------------------------------------- knobs
  function knobRow(k) {
    const id = "kit-knob-" + k.key;
    const row = h("div", "kit-knob kit-knob-" + k.type);
    const lab = h("label", "kit-knob-label", k.label || k.key);
    lab.htmlFor = id;
    if (k.unit) lab.append(h("span", "kit-knob-unit", " " + k.unit));
    row.title = k.hint || "";
    row.append(lab);
    const put = (v) => set({ knobs: { ...state.knobs, [k.key]: v } });
    const input = (type, cls) => {
      const n = h("input", cls);
      n.type = type;
      n.spellcheck = false;
      return n;
    };
    const free = (n) => document.activeElement !== n;
    if (k.type === "range" || k.type === "number") {
      const num = input("number", "kit-knob-num");
      if (k.step != null) num.step = k.step;
      if (k.min != null) num.min = k.min;
      if (k.max != null) num.max = k.max;
      num.oninput = () => num.value !== "" && Number.isFinite(Number(num.value)) && put(Number(num.value));
      if (k.type === "range") {
        const range = input("range", "kit-knob-range");
        range.id = id;
        Object.assign(range, { min: k.min, max: k.max, step: k.step ?? "any" });
        range.oninput = () => put(Number(range.value));
        row.append(range, num);
        k.sync = (v) => {
          if (free(range)) range.value = v;
          if (free(num)) num.value = v;
        };
      } else {
        num.id = id;
        row.append(num);
        k.sync = (v) => free(num) && (num.value = v);
      }
      k.inputs = row.querySelectorAll("input");
    } else if (k.type === "choice") {
      const seg = segmented(k.options.map((o) => ({ key: o.value, label: o.label })), k.value, put);
      seg.id = id;
      row.append(seg);
      k.sync = (v) => seg.querySelectorAll(".kit-seg-btn").forEach((b) => b.classList.toggle("kit-on", b.dataset.key === v));
      k.inputs = seg.querySelectorAll("button");
    } else if (k.type === "color") {
      const wrap = h("div", "kit-knob-swatch");
      const swatch = input("color");
      swatch.id = id;
      const hex = input("text", "kit-knob-hex");
      swatch.oninput = () => put(swatch.value);
      hex.onchange = () => put(coerce(k, hex.value.trim().replace(/^(?!#)/, "#")));
      wrap.append(swatch, hex);
      row.append(wrap);
      k.sync = (v) => {
        swatch.value = v;
        if (free(hex)) hex.value = v;
      };
      k.inputs = wrap.querySelectorAll("input");
    } else if (k.type === "toggle") {
      const box = input("checkbox");
      box.id = id;
      box.onchange = () => put(box.checked);
      row.append(box);
      k.sync = (v) => (box.checked = v);
      k.inputs = [box];
    }
    k.row = row;
    return row;
  }
  // Built once at boot; mountShell moves the same nodes between layouts.
  function buildKnobs() {
    if (presets.length) {
      presetsEl.append(h("span", "kit-sb-label", "Presets"));
      presetsEl.append(segmented(presets.map((p) => ({ key: p.id, label: p.label, title: p.note })), null, (id) => applyPreset(presets.find((p) => p.id === id))));
    }
    for (const g of knobGroups) {
      g.head = h("div", "kit-knob-head", g.title);
      g.body = h("div", "kit-knob-group");
      g.knobs.forEach((k) => g.body.append(knobRow(k)));
      g.button = h("button", "kit-cycle-btn kit-pop-btn");
      g.button.append(h("span", null, g.title), h("em", null, "▾"));
      g.button.onclick = () => (popAnchor === g.button ? closePop() : openPop(g.button, g.body));
    }
    copyBtn.onclick = copyValues;
  }
  function syncKnobs() {
    presetsEl.querySelectorAll(".kit-seg-btn").forEach((b) => b.classList.toggle("kit-on", presetMatches(presets.find((p) => p.id === b.dataset.key))));
    for (const k of knobDefs) {
      const v = state.knobs[k.key];
      k.sync(v);
      k.row.classList.toggle("kit-changed", v !== k.value);
      const on = k.enabled ? !!k.enabled(state.knobs) : true;
      k.row.classList.toggle("kit-knob-off", !on);
      k.inputs.forEach((n) => (n.disabled = !on));
    }
  }

  // Copy values: the design as JSON (+ the CSS custom properties knobs name),
  // copied when the browser allows it and always shown, selectable, beside the button.
  function valuesText() {
    const out = {};
    if (sections.length > 1) out.section = state.section;
    if (state.variant) out.variant = state.variant;
    const p = presets.find(presetMatches);
    if (p) out.preset = p.id;
    out.knobs = Object.fromEntries(knobDefs.map((k) => [k.key, state.knobs[k.key]]));
    let text = JSON.stringify(out, null, 2);
    const css = knobDefs.filter((k) => k.css).map((k) => `${k.css}: ${cssValue(k, state.knobs[k.key])};`);
    if (css.length) text += "\n\n/* CSS custom properties */\n" + css.join("\n");
    return text;
  }
  async function copyValues() {
    const text = valuesText();
    const status = h("div", "kit-copy-status", "Copying…");
    const ta = h("textarea", "kit-copy-text");
    ta.readOnly = true;
    ta.value = text;
    ta.rows = Math.min(18, text.split("\n").length);
    const box = h("div", "kit-copy");
    box.append(status, ta);
    openPop(copyBtn, box);
    const ok = await copyText(text);
    status.textContent = ok ? "Copied. The same values:" : "This browser blocks copying here (plain http). The text is selected: press Ctrl+C.";
    status.classList.toggle("kit-copy-failed", !ok);
    if (!ok) {
      ta.focus();
      ta.select();
    }
  }

  let mountedShell = null;
  function mountShell() {
    if (mountedShell === state.shell) return;
    mountedShell = state.shell;
    const side = state.shell === "sidebar";
    closePop();
    html.classList.toggle("kit-shell-sidebar", side);
    stage.style.right = side ? "var(--kit-sidebar-w)" : "0";
    if (side) {
      sbHead.append(reviewBar);
      sbDesign.append(designBar, variantBar, caption, knobBar);
      sbSituation.append(situationBar);
    } else {
      stage.after(designBar, variantBar, knobBar, caption, situationBar, reviewBar);
    }
    sidebar.hidden = !side;
    knobsEl.replaceChildren(...knobGroups.flatMap((g) => (side ? [g.head, g.body] : [g.button])));
  }

  function renderBars() {
    const sec = current();
    designBar.replaceChildren();
    if (sections.length > 1) {
      designBar.append(segmented(sections.map((s) => ({ key: s.id, label: s.title })), sec.id, (id) => set({ section: id })));
    }
    designBar.hidden = !designBar.childElementCount;

    // Base / Notes / Sidebar: in-place toggles, the same spot flips back.
    reviewBar.replaceChildren();
    const toggle = (label, key, on, title, onClick) => {
      const b = h("button", "kit-seg-btn kit-toggle" + (on ? " kit-on" : ""));
      b.append(h("span", null, label), h("kbd", null, key));
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
    const side = state.shell === "sidebar";
    const shellBtn = toggle("Sidebar", "s", side, side ? "Controls in bars above and below the frames (s)" : "Controls in a sidebar beside the frames (s)", () => set({ shell: side ? "bars" : "sidebar" }));
    shellBtn.classList.add("kit-shell-toggle");
    reviewBar.append(shellBtn);

    // Variants: a row of buttons (an important choice, like sections);
    // data-variants-as="cycle" on the section asks for a cycle button instead.
    variantBar.replaceChildren();
    if (sec.variants.length) {
      if (sec.el.dataset.variantsAs === "cycle") {
        const ids = sec.variants.map((v) => v.id);
        const labels = Object.fromEntries(sec.variants.map((v) => [v.id, variantName(v)]));
        variantBar.append(cycleControl(ids, state.variant, labels, (id) => set({ variant: id })));
      } else {
        variantBar.append(segmented(sec.variants.map((v) => ({ key: v.id, badge: v.id, label: v.label, title: v.note })), state.variant, (id) => set({ variant: id })));
      }
    }
    variantBar.hidden = !sections.some((s) => s.variants.length);
    variantBar.classList.toggle("kit-vacant", !sec.variants.length);
    caption.hidden = !sections.some((s) => s.variants.some((v) => v.note));
    caption.textContent = sec.variants.find((v) => v.id === state.variant)?.note || "";

    // Knob bar: what sits beside the candidate, presets, knob groups, the
    // mock's own design controls, Copy values.
    compareSlot.replaceChildren();
    if (compareOn) {
      const opts = compareOptions(sec);
      const labels = Object.fromEntries(opts.map((r) => [r, compareLabel(sec, r)]));
      const sizers = sections.flatMap((s) => s.variants.map((v) => `Beside: ${variantName(v)}`));
      compareSlot.append(cycleControl(opts, state.refs[0] || "", labels, (r) => set({ refs: r ? [r] : [] }), sizers));
      compareSlot.firstChild.title = "A reference frame beside the candidate, in the same situation (c)";
    }
    compareSlot.hidden = !compareOn;
    presetsEl.hidden = !presets.length;
    knobsEl.hidden = !knobGroups.length;
    extrasEl.hidden = !knobControls.length;
    copyBtn.hidden = !knobDefs.length;
    syncKnobs();
    knobBar.hidden = !(compareOn || presets.length || knobGroups.length || knobControls.length);

    // Every value names itself: "Pure black", "Phone", "normal session",
    // "closed panel". No separate labels in the bar.
    situationBar.replaceChildren();
    if (themes.length > 1) situationBar.append(cycleControl(themes, state.theme, THEME_LABELS, (v) => set({ theme: v })));
    if (viewports.length > 1) {
      const vpLabels = Object.fromEntries(viewports.map((v) => [v, VIEWPORTS[v].label]));
      situationBar.append(cycleControl(viewports, state.vp, vpLabels, (v) => set({ vp: v })));
    }
    if (regions.length > 1) situationBar.append(cycleControl(regions, state.region, Object.fromEntries(regionLabels), (v) => set({ region: v })));
    if (scales.length > 1) {
      const labels = Object.fromEntries(scales.map((v) => [v, SCALE_LABELS[v] || v + "× zoom"]));
      situationBar.append(cycleControl(scales, state.scale, labels, (v) => set({ scale: v })));
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
    const back = e.shiftKey ? -1 : 1;
    if (e.key === "ArrowRight" && ids.length) set({ variant: step(ids, state.variant, 1) });
    else if (e.key === "ArrowLeft" && ids.length) set({ variant: step(ids, state.variant, -1) });
    else if (e.key === "ArrowDown" && sections.length > 1) set({ section: step(sections.map((s) => s.id), state.section, 1) });
    else if (e.key === "ArrowUp" && sections.length > 1) set({ section: step(sections.map((s) => s.id), state.section, -1) });
    else if (e.key === "t") set({ theme: step(themes, state.theme, back) });
    else if (e.key === "v") set({ vp: step(viewports, state.vp, back) });
    else if (e.key === "r" && regions.length > 1) set({ region: step(regions, state.region, back) });
    else if (e.key === "z" && scales.length > 1) set({ scale: step(scales, state.scale, back) });
    else if (e.key === "d" && dataSets.live) set({ data: state.data === "live" ? "acme" : "live" });
    else if (e.key === "b" && hasDelta) set({ base: !state.base });
    else if (e.key === "n" && hasNotes) set({ notes: !state.notes });
    else if (e.key === "c" && compareOn) {
      const r = step(compareOptions(sec), state.refs[0] || "", back);
      set({ refs: r ? [r] : [] });
    } else if (e.key === "s") set({ shell: state.shell === "sidebar" ? "bars" : "sidebar" });
    else if (e.key === "Escape" && !pop.hidden) closePop();
    else return;
    e.preventDefault();
  }

  // ---------------------------------------------------------------- mock interactions
  // The mock's own controls drive the same state as the shell, so the two never disagree:
  //   data-toggle="panel"          click steps that app-state axis to its next value
  //   data-set="drawer: closed"    click sets axes (";" joins several)
  //   data-pick="tabs"             click moves the highlight within that group
  //                                (whichever of is-active / is-selected the group uses)
  //   data-editable                you can type in it; Enter does nothing
  function wire(frame) {
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
    document.body.replaceChildren(cand.clip);
  } else {
    document.body.replaceChildren(stage, designBar, variantBar, knobBar, caption, situationBar, reviewBar, sidebar, pop);
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
      readDesign();
      buildKnobs();
      prepareFrame(cand);
      apply();
      window.MockKit = {
        state,
        sections: sections.map(({ id, title, variants, axes }) => ({ id, title, variants, axes: Object.fromEntries(axes) })),
        viewports: VIEWPORTS,
        regions: Object.fromEntries(regions.map((r) => [r, regionLabels.get(r)])),
        knobs: knobDefs,
        presets,
        // The frames on screen, references first and the candidate last:
        // { el, role, ref, label, base, variant, picks, knobs }
        get frames() {
          return shownFrames.map(frameView);
        },
        set,
        onChange: (fn) => listeners.push(fn),
        // fn(frame) for every frame on screen, now and after every change:
        // render script-built content into each frame from its own design.
        onFrame: (fn) => {
          frameListeners.push(fn);
          shownFrames.forEach((f) => fn(frameView(f)));
        },
        enhanceCycle,
        addSituationControl: (n) => {
          situationExtras.push(n);
          apply();
        },
        addDesignControl: (n) => {
          knobControls.push(n);
          extrasEl.replaceChildren(...knobControls);
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

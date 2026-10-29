// Mock data: the parts of a mock that show data (sidebar rows, tabs, header,
// host, plugin content) render from one JSON file; everything else is plain HTML.
//
// Two sets per mock, same shape (README "Data: Acme or live"):
//   data.acme.json  fictional, safe to publish (fallback: kit/acme.json)
//   data.live.json  Acme with pieces of Stefan's real usage swapped in
//                   (tools/mock-data.mjs writes both into the mock's folder)
//
// Bindings, all resolved against the current item ("$.x" = the data root):
//   <template data-each="path" data-limit="6">  one copy per item, after the template
//   data-text="path"                            textContent
//   data-attrs="name=path; name2=path"          attribute; removed when empty/false
//   data-class="is-selected=path"               class toggled by truthiness
//   data-if="path"                              element hidden when falsy
(() => {
  const STATUS = {
    needs_input: { group: "needs-input", icon: "circle-alert", label: "Needs input", badge: "needs-input", dot: "warning" },
    failed: { group: "failed", icon: "circle-x", label: "Failed", badge: "failed", dot: "danger" },
    attention: { group: "ready", icon: "circle-check", label: "Ready to review", badge: "attention", dot: "success" },
    running: { group: "working", icon: "circle-dot", label: "Working", badge: "running", dot: "running" },
    done: { group: "done", icon: "circle-check", label: "Done", badge: null, dot: "" },
  };
  const ORDER = ["needs_input", "failed", "attention", "running", "done"];

  async function getJson(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }
  // Page data only when <html data-mock-data> says it exists: a fetch of a missing
  // file logs a 404 in the console, so mocks without it go straight to kit/acme.json.
  async function load(pageBase, kitBase, withLive) {
    const own = document.documentElement.hasAttribute("data-mock-data");
    const acme = (own && (await getJson(new URL("data.acme.json", pageBase)))) || (await getJson(new URL("acme.json", kitBase)));
    const live = own && withLive ? await getJson(new URL("data.live.json", pageBase)) : null;
    return { acme: acme && derive(acme), live: live && derive(live) };
  }

  // Derived views the starter binds to; the JSON keeps only facts.
  function derive(raw) {
    const d = structuredClone(raw);
    const projects = d.projects || {};
    const ws = (d.workspaces || []).map((w) => {
      const p = projects[w.project] || { name: w.project, color: "violet" };
      const st = STATUS[w.status] || STATUS.done;
      return {
        ...w,
        projectName: p.name,
        initial: p.initial || (p.name || "?")[0].toUpperCase(),
        projStyle: `--proj:var(--id-${p.color})`,
        badge: st.badge,
        dotClass: "dot" + (st.dot ? " " + st.dot : ""),
        selected: w.id === d.active,
        meta: w.status === "running" ? "" : w.ago || "",
      };
    });
    const groups = (list) => ({
      statusGroups: ORDER.map((s) => ({ ...STATUS[s], items: list.filter((w) => (STATUS[w.status] ? w.status : "done") === s) })).filter((g) => g.items.length),
      projectGroups: [...new Set(list.map((w) => w.project))].map((key) => {
        const items = list.filter((w) => w.project === key);
        return { name: items[0].projectName, initial: items[0].initial, projStyle: items[0].projStyle, items };
      }),
    });
    d.workspaces = ws;
    Object.assign(d, groups(ws));
    d.drawer = groups(ws.slice(0, d.drawerCount || 6));
    d.activeWorkspace = ws.find((w) => w.selected) || ws[0] || {};
    return d;
  }

  function get(scope, root, path) {
    if (path === ".") return scope;
    let v = path.startsWith("$.") ? root : scope;
    for (const k of (path.startsWith("$.") ? path.slice(2) : path).split(".")) v = v?.[k];
    return v;
  }
  const empty = (v) => v == null || v === false || v === "";

  // Template copies per rendered root (one per frame), filled during a render.
  const clonesByRoot = new WeakMap();
  let clones = [];
  function bindStatic(node, scope, root) {
    const q = (sel) => [...(node.matches?.(sel) ? [node] : []), ...node.querySelectorAll(sel)];
    for (const n of q("[data-if]")) n.classList.toggle("kit-data-off", empty(get(scope, root, n.dataset.if)));
    for (const n of q("[data-text]")) n.textContent = get(scope, root, n.dataset.text) ?? "";
    for (const n of q("[data-attrs]")) {
      for (const pair of n.dataset.attrs.split(";")) {
        const [name, path] = pair.split("=").map((s) => s.trim());
        if (!name) continue;
        const v = get(scope, root, path);
        if (empty(v)) n.removeAttribute(name);
        else n.setAttribute(name, v);
      }
    }
    for (const n of q("[data-class]")) {
      for (const pair of n.dataset.class.split(/\s+/).filter(Boolean)) {
        const [cls, path] = pair.split("=");
        n.classList.toggle(cls, !empty(get(scope, root, path)));
      }
    }
  }
  function bind(node, scope, root) {
    bindStatic(node, scope, root);
    for (const t of node.querySelectorAll("template[data-each]")) {
      let items = get(scope, root, t.dataset.each) || [];
      if (t.dataset.limit) items = items.slice(0, Number(t.dataset.limit));
      let after = t;
      for (const item of items) {
        const frag = t.content.cloneNode(true);
        const holder = document.createElement("div");
        holder.append(frag);
        bind(holder, item, root);
        for (const c of [...holder.childNodes]) {
          after.after(c);
          after = c;
          clones.push(c);
        }
      }
    }
  }
  // Static bindings outside templates are re-set on every render, so they need
  // no undo; template copies are removed and rebuilt. Each root (frame) keeps
  // its own copies, so rendering one frame never touches another.
  function render(root, data) {
    (clonesByRoot.get(root) || []).forEach((c) => c.remove());
    clones = [];
    if (data) bind(root, data, data);
    clonesByRoot.set(root, clones);
  }

  window.KitData = { load, render };
})();

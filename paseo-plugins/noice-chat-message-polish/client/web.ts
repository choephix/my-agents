import { Platform } from "react-native";
import type { FileMentionRecord } from "../shared/skills";
import { tagList, type Preferences } from "../shared/preferences";
import { isPlain, parseBlocks, segment, type Block, type Inline, type Segment } from "./parse";
import { SKILL_TOKEN } from "./skill-parse";
import type { SkillStore, SkillView } from "./skills";

// Web and desktop only. Paseo draws a sent message as one React Native Web Text marked
// data-message-text="true" inside [data-testid="user-message"] (0.12.0 components/message.tsx).
// The copy button and rewind read the message prop, never this DOM, so they keep the raw text.
//
// For a message with Markdown or a foldable tag block, the plugin hides Paseo's Text (kept in place,
// aria-hidden so Chat Find skips it) and draws its own copy right after it. The copy carries
// data-message-text="true" too, so Chat Find searches it and noice-omp-magic-keywords colours it;
// noice-omp-tree reads the first [data-message-text], which stays Paseo's original. Code blocks carry
// Paseo's data-paseo-markdown-* markers, so noice-chat-diff colours diff fences here as well.
// Plain messages are left untouched. React never reads the hidden Text's children, and a sibling
// it doesn't know about survives its updates; a removed or changed original is re-drawn.

const SOURCE = '[data-testid="user-message"] [data-message-text="true"]:not([data-ump-view])';
const PREFIX = "noice-chat-message-polish";
const CACHE_LIMIT = 400;

type Tree = { segments: Segment[]; blocks: Map<number, Block[]> } | null;
interface Drawn { key: string; view: HTMLElement; ariaHidden: string | null; bubble: HTMLElement | null }

export interface Polisher { apply(values: Preferences): void; dispose(): void }

/** Open-state slots next to the fold indices (0, 1, …): the skill header and each attached file. */
const SKILL_SLOT = -1;
const fileSlot = (index: number) => -2 - index;

export function startPolishing(onFocus: () => void, skills: SkillStore): Polisher {
  if (Platform.OS !== "web" || typeof document === "undefined") return { apply() {}, dispose() {} };
  const readCodeSize = () => {
    // Paseo keeps the code size the user picked in its web settings; the skill text follows it.
    let size = 12;
    try { size = Number(JSON.parse(localStorage.getItem("@paseo:app-settings") ?? "{}").codeFontSize) || 12; } catch { /* default */ }
    document.documentElement.style.setProperty("--ump-code-size", `${size}px`);
  };
  const focus = () => { readCodeSize(); onFocus(); };
  readCodeSize();
  window.addEventListener("focus", focus);
  const style = document.createElement("style");
  style.setAttribute("data-plugin", PREFIX);
  style.textContent = CSS;
  document.head.appendChild(style);

  let prefs: Preferences | null = null;
  let disposed = false;
  const drawn = new Map<HTMLElement, Drawn>();
  /** Which folds are open, per original, so a re-draw keeps them open. */
  const opened = new WeakMap<HTMLElement, Set<number>>();
  const cache = new Map<string, Tree>();
  const pending = new Set<HTMLElement>();
  let frame = 0;

  const treeFor = (raw: string, values: Preferences, force: boolean): Tree => {
    const cacheKey = `${force ? 1 : 0}${raw}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;
    const segments: Segment[] = !raw ? [] : values.foldTags
      ? segment(raw, { always: tagList(values.alwaysFold), never: tagList(values.neverFold) })
      : [{ kind: "text", text: raw }];
    const blocks = new Map<number, Block[]>();
    if (values.markdown) segments.forEach((part, index) => { if (part.kind === "text") blocks.set(index, parseBlocks(part.text)); });
    const folds = segments.some((part) => part.kind === "fold");
    const tree = force || folds || [...blocks.values()].some((parsed) => !isPlain(parsed)) ? { segments, blocks } : null;
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, tree);
    return tree;
  };

  const unmarkBubble = (bubble: HTMLElement | null) => {
    bubble?.removeAttribute("data-ump-skill");
    bubble?.removeAttribute("data-ump-only");
  };

  const restore = (source: HTMLElement) => {
    const entry = drawn.get(source);
    if (!entry) return;
    entry.view.remove();
    unmarkBubble(entry.bubble);
    source.removeAttribute("data-ump-src");
    if (entry.ariaHidden === null) source.removeAttribute("aria-hidden");
    else source.setAttribute("aria-hidden", entry.ariaHidden);
    drawn.delete(source);
  };

  const draw = (source: HTMLElement) => {
    if (!source.isConnected || !prefs) return restore(source);
    const raw = source.textContent ?? "";
    const skill = prefs.skills ? skills.view(raw) : null;
    const mention = prefs.skills ? skills.files(raw, skill) : null;
    const key = `${raw}\u0000${skill?.status ?? ""}\u0000${mention?.id ?? ""}`;
    const entry = drawn.get(source);
    if (entry && entry.key === key && entry.view.isConnected && source.nextSibling === entry.view) {
      if (entry.view.className !== `${source.className} ump`) entry.view.className = `${source.className} ump`;
      return;
    }
    // A loaded skill shows the text as the agent read it after `User:`: the token cut out.
    const text = skill && skill.status !== "unknown" ? skill.args : raw;
    const tree = treeFor(text, prefs, !!(skill || mention));
    if (!tree) return restore(source);
    const view = entry?.view ?? document.createElement("div");
    view.className = `${source.className} ump`;
    view.setAttribute("data-message-text", "true");
    view.setAttribute("data-ump-view", "");
    view.replaceChildren(...renderView(tree, source, skill, mention));
    if (source.nextSibling !== view) source.after(view);
    const bubble = source.parentElement;
    if (entry && entry.bubble !== bubble) unmarkBubble(entry.bubble);
    if (skill) bubble?.setAttribute("data-ump-skill", skill.status);
    else bubble?.removeAttribute("data-ump-skill");
    bubble?.toggleAttribute("data-ump-only", !!skill && skill.status !== "unknown" && !text);
    if (!entry) drawn.set(source, { key, view, ariaHidden: source.getAttribute("aria-hidden"), bubble });
    else Object.assign(entry, { key, bubble });
    source.setAttribute("data-ump-src", "");
    source.setAttribute("aria-hidden", "true");
  };

  const renderView = (tree: NonNullable<Tree>, source: HTMLElement, skill: SkillView | null, mention: FileMentionRecord | null): Node[] => {
    const open = opened.get(source) ?? new Set<number>();
    opened.set(source, open);
    const remember = (slot: number) => (isOpen: boolean) => { if (isOpen) open.add(slot); else open.delete(slot); };
    const body = renderTree(tree, open);
    if (skill) markSkillTokens(body, skill.status === "unknown");
    if (mention) markFileMentions(body, mention.files.map((file) => file.path));
    // The agent read this text right after the skill's `User:` line; a bare `/skill:name` has none.
    if (skill && skill.status !== "unknown" && body.length) addUserMarker(body);
    const nodes: Node[] = [];
    if (skill) nodes.push(renderSkillHead(skill, open.has(SKILL_SLOT), remember(SKILL_SLOT), skills));
    nodes.push(...body);
    mention?.files.forEach((file, index) => {
      nodes.push(renderFileRow(file, open.has(fileSlot(index)), remember(fileSlot(index)), () => skills.body(mention.agentId, mention.id, index)));
    });
    return nodes;
  };

  const renderTree = (tree: NonNullable<Tree>, open: Set<number>): HTMLElement[] => {
    return tree.segments.map((part, index) => {
      if (part.kind === "fold") return renderFold(part, open.has(index), (isOpen) => { if (isOpen) open.add(index); else open.delete(index); });
      const blocks = tree.blocks.get(index);
      if (!blocks) return el("div", { "data-paseo-markdown-tag": "p" }, [part.text]);
      return el("div", { class: "ump-md" }, renderBlocks(blocks));
    });
  };

  const flush = () => {
    frame = 0;
    if (disposed) return;
    for (const source of pending) draw(source);
    pending.clear();
  };
  const schedule = (source: HTMLElement) => {
    pending.add(source);
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const sweep = () => {
    for (const source of document.querySelectorAll<HTMLElement>(SOURCE)) schedule(source);
  };

  const observer = new MutationObserver((records) => {
    if (!prefs) return;
    let removed = false;
    for (const record of records) {
      const target = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target as HTMLElement;
      if (target?.hasAttribute("data-ump-src")) schedule(target);
      if (record.type !== "childList") continue;
      if (target?.hasAttribute("data-ump-view")) continue;
      if (record.removedNodes.length) removed = true;
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as HTMLElement;
        if (element.matches(SOURCE)) schedule(element);
        else for (const inner of element.querySelectorAll<HTMLElement>(SOURCE)) schedule(inner);
      }
    }
    if (removed) for (const source of [...drawn.keys()]) if (!source.isConnected) drawn.delete(source), opened.delete(source);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  // New answers from OMP's session files: re-judge every bubble (unchanged ones return early).
  skills.onChange(() => { if (prefs && !disposed) sweep(); });

  return {
    apply(values) {
      if (disposed) return;
      const changed = !prefs || JSON.stringify(prefs) !== JSON.stringify(values);
      prefs = values;
      if (!changed) return;
      cache.clear();
      for (const entry of drawn.values()) entry.key = "\u0000"; // force a re-draw with the new settings
      sweep();
    },
    dispose() {
      disposed = true;
      window.removeEventListener("focus", focus);
      document.documentElement.style.removeProperty("--ump-code-size");
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      for (const source of [...drawn.keys()]) restore(source);
      style.remove();
    },
  };
}

function el(tag: string, attrs: Record<string, string>, children: (Node | string)[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function renderBlocks(blocks: Block[]): HTMLElement[] {
  return blocks.map((block): HTMLElement => {
    switch (block.t) {
      case "p": return el("div", { "data-paseo-markdown-tag": "p", class: "ump-p" }, renderInline(block.inline));
      case "h": return el("div", { "data-paseo-markdown-tag": `h${block.level}`, class: "ump-h" }, renderInline(block.inline));
      case "hr": return el("hr", { class: "ump-hr" });
      case "quote": return el("blockquote", { class: "ump-quote" }, renderBlocks(block.blocks));
      case "code": return el("div", {
        "data-paseo-markdown-tag": "pre",
        ...(block.lang ? { "data-paseo-markdown-language": block.lang } : {}),
        class: "ump-pre",
        // Paseo's app-wide interface font skips [data-pmono] subtrees (its code-surface marker).
        "data-pmono": "",
      }, [el("div", { "data-paseo-markdown-tag": "code" }, [block.text])]);
      case "list": return el(block.ordered ? "ol" : "ul", {
        class: "ump-list",
        ...(block.ordered && block.start !== 1 ? { start: String(block.start) } : {}),
      }, block.items.map((item) => el("li", {}, renderBlocks(item))));
    }
  });
}

function renderInline(nodes: Inline[]): (Node | string)[] {
  return nodes.map((node) => {
    switch (node.t) {
      case "text": return node.text;
      case "code": return el("code", { class: "ump-code", "data-pmono": "" }, [node.text]);
      case "strong": return el("strong", {}, renderInline(node.children));
      case "em": return el("em", {}, renderInline(node.children));
      case "del": return el("del", {}, renderInline(node.children));
      case "link": return /^(https?:|mailto:)/i.test(node.href)
        ? el("a", { href: node.href, target: "_blank", rel: "noopener noreferrer", class: "ump-a" }, renderInline(node.children))
        : el("span", {}, renderInline(node.children));
    }
  });
}

const CHEVRON = "M9 6l6 6-6 6";

function renderFold(fold: Extract<Segment, { kind: "fold" }>, startOpen: boolean, remember: (open: boolean) => void): HTMLElement {
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("class", "ump-chev");
  chevron.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", CHEVRON);
  chevron.append(path);
  const head = el("div", { class: "ump-head", role: "button", tabindex: "0", "data-paseo-markdown-ignore": "true", "data-pmono": "" }, [
    chevron,
    el("span", { class: "ump-open" }, [fold.open]),
    el("span", { class: "ump-peek" }, [fold.body.replace(/\s+/g, " ").trim().slice(0, 300)]),
    el("span", { class: "ump-shut" }, [fold.close]),
  ]);
  head.title = fold.open;
  const box = el("div", { class: "ump-fold" }, [head]);
  const setOpen = (open: boolean) => {
    box.toggleAttribute("data-open", open);
    head.setAttribute("aria-expanded", String(open));
    if (open && box.childNodes.length === 1) {
      const foot = el("div", { class: "ump-head ump-foot", "data-paseo-markdown-ignore": "true", "data-pmono": "" }, [fold.close]);
      foot.addEventListener("click", toggle);
      box.append(el("div", { class: "ump-body", "data-pmono": "" }, [fold.body]), foot);
    }
    if (!open) while (box.childNodes.length > 1) box.lastChild!.remove();
  };
  function toggle() {
    const open = !box.hasAttribute("data-open");
    setOpen(open);
    remember(open);
  }
  setOpen(startOpen);
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
  return box;
}

// ---------------------------------------------------------------------------------------------
// Skills and attached files (Stefan's pick from a local mock page). The bubble
// shows what the agent got: a loaded skill tints the bubble and heads it; the header opens the
// skill text OMP sent; the text below is what followed `User:`, with its marker. Attached @files
// get a row after the text that opens the file as sent.

/** Lucide (Paseo's icon set) shapes on a 24-unit box; constant markup. */
const ICON = {
  chevron: '<path d="M9 6l6 6-6 6"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  slash: '<circle cx="12" cy="12" r="10"/><path d="M9 15l6-6"/>',
  clip: '<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
};

function icon(markup: string, className: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = markup;
  return svg;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

interface Piece { kind: "skill" | "none" | "file"; icon: string; label: string; sub?: string; title?: string; startOpen: boolean; remember(open: boolean): void; fill(box: HTMLElement): void }

/** A header that opens in place as one piece, like the fold rows: it stays put, its text steps down, the chevron goes full strength. */
function renderPiece(piece: Piece): HTMLElement {
  const head = el("div", { class: "ump-skh", role: "button", tabindex: "0", "data-paseo-markdown-ignore": "true" }, [
    icon(piece.icon, "ump-skic"),
    el("span", { class: "ump-skn" }, [piece.label]),
    ...(piece.sub ? [el("span", { class: "ump-sksub" }, [piece.sub])] : []),
    icon(ICON.chevron, "ump-skchev"),
  ]);
  if (piece.title) head.title = piece.title;
  const box = el("div", { class: `ump-sk ump-sk-${piece.kind}` }, [head]);
  const setOpen = (open: boolean) => {
    box.toggleAttribute("data-open", open);
    head.setAttribute("aria-expanded", String(open));
    if (open && box.childNodes.length === 1) piece.fill(box);
    if (!open) while (box.childNodes.length > 1) box.lastChild!.remove();
  };
  const toggle = () => {
    const open = !box.hasAttribute("data-open");
    setOpen(open);
    piece.remember(open);
  };
  setOpen(piece.startOpen);
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
  return box;
}

/** Fills an opened piece with text fetched from the server, unless it was closed meanwhile. */
function fillFrom(box: HTMLElement, load: () => Promise<string | null>, split?: (text: string) => [string, string]) {
  const peek = el("div", { class: "ump-skp", "data-pmono": "" }, ["…"]);
  box.append(peek);
  void load().then((text) => {
    if (peek.parentNode !== box) return;
    if (text === null) {
      peek.className = "ump-skp ump-sknote";
      peek.removeAttribute("data-pmono");
      peek.textContent = "OMP's session file couldn't be read, so this can't be shown.";
      return;
    }
    const [main, tail] = split ? split(text) : [text, ""];
    peek.textContent = main;
    if (tail) box.append(el("div", { class: "ump-skt", "data-pmono": "" }, [tail]));
  });
}

function note(box: HTMLElement, text: string) {
  box.append(el("div", { class: "ump-skp ump-sknote" }, [text]));
}

function renderSkillHead(skill: SkillView, startOpen: boolean, remember: (open: boolean) => void, skills: SkillStore): HTMLElement {
  if (skill.status === "unknown") {
    return renderPiece({ kind: "none", icon: ICON.slash, label: "no skill loaded", startOpen, remember, fill: (box) => note(box,
      `“${skill.name}” isn't a skill OMP could load, so this went as a plain message: no skill text and no User: line. Every /skill: in it is just text, so no later one loaded either.`) });
  }
  return renderPiece({ kind: "skill", icon: ICON.bulb, label: skill.name, startOpen, remember, fill: (box) => {
    if (skill.status === "pending") return note(box, "OMP hasn't recorded this message yet. Close and open again in a moment.");
    const { agentId, id } = skill.record;
    // The skill-directory lines stay below the scroll area, right above the text that followed them.
    fillFrom(box, () => skills.body(agentId, id), (text) => {
      const cut = text.lastIndexOf("\n[Skill directory:");
      return cut === -1 ? [text, ""] : [text.slice(0, cut), text.slice(cut + 1)];
    });
  } });
}

function renderFileRow(file: FileMentionRecord["files"][number], startOpen: boolean, remember: (open: boolean) => void, load: () => Promise<string | null>): HTMLElement {
  return renderPiece({ kind: "file", icon: ICON.clip, label: baseName(file.path), sub: `attached after your message · ${file.lines} lines`, title: file.path, startOpen, remember, fill: (box) => fillFrom(box, load) });
}

/** Text nodes outside code and fold rows, collected before any is replaced. */
function proseText(roots: HTMLElement[]): Text[] {
  const found: Text[] = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.closest("code, .ump-pre, .ump-fold")) found.push(node as Text);
    }
  }
  return found;
}

/** Every `/skill:` token left in the text is plain words to the agent; the first one of an unloaded message wasn't a skill at all. */
function markSkillTokens(body: HTMLElement[], firstIsUnknown: boolean) {
  let first = firstIsUnknown;
  for (const node of proseText(body)) {
    const text = node.data;
    if (!text.includes("/skill:")) continue;
    const parts: (Node | string)[] = [];
    let last = 0;
    SKILL_TOKEN.lastIndex = 0;
    for (const match of text.matchAll(SKILL_TOKEN)) {
      const start = match.index + match[1]!.length;
      const end = match.index + match[0].length;
      parts.push(text.slice(last, start), el("span", { class: "ump-tok" }, [text.slice(start, end)]),
        el("span", { class: "ump-toktag", "aria-hidden": "true", "data-tag": first ? "not a skill" : "not loaded" }));
      first = false;
      last = end;
    }
    if (!parts.length) continue;
    parts.push(text.slice(last));
    node.replaceWith(...parts);
  }
}

const MENTION = /(^|\s)@(\S+)/g;

/** `@path` stays in the text the agent reads; a file OMP attached shows as a chip there. */
function markFileMentions(body: HTMLElement[], paths: string[]) {
  for (const node of proseText(body)) {
    const text = node.data;
    if (!text.includes("@")) continue;
    const parts: (Node | string)[] = [];
    let last = 0;
    for (const match of text.matchAll(MENTION)) {
      const token = match[2]!.replace(/[.,;:!?)\]]+$/, "");
      const relative = token.replace(/^\.?\//, "");
      const path = paths.find((candidate) => candidate === token || candidate.endsWith(`/${relative}`));
      if (!path) continue;
      const start = match.index + match[1]!.length;
      parts.push(text.slice(last, start), el("span", { class: "ump-fchip", title: path }, [icon(ICON.file, "ump-fchic"), baseName(path)]));
      last = start + 1 + token.length;
    }
    if (!parts.length) continue;
    parts.push(text.slice(last));
    node.replaceWith(...parts);
  }
}

/** Small-caps "User" before the first word; a list or code block can't share its row, so it gets its own. */
function addUserMarker(body: HTMLElement[]) {
  const marker = el("span", { class: "ump-user", "aria-hidden": "true", "data-paseo-markdown-ignore": "true" });
  const first = body[0]!;
  const block = first.classList.contains("ump-md") ? first.firstElementChild : first;
  if (block instanceof HTMLElement && block.matches('[data-paseo-markdown-tag="p"], .ump-h')) block.prepend(marker);
  else body.unshift(el("div", { class: "ump-user-row" }, [marker]));
}

// Colours mix the bubble's own text colour, so every theme works without per-theme values.
const MIX = (percent: number) => `color-mix(in srgb, currentColor ${percent}%, transparent)`;
const CSS = `
[data-ump-src] { display: none !important; }
.ump { display: block !important; }
.ump > * + *, .ump-md > * + *, .ump-quote > * + * { margin-top: 8px; }
.ump-list li > * + *, .ump-list li + li { margin-top: 2px; }
.ump-h { font-weight: 600; }
.ump-hr { border: 0; border-top: 1px solid ${MIX(18)}; margin: 4px 0; }
/* Quotes step back from your own words: 12 px on a ×1.3 line (picked from mocks, 2026-10-25). */
.ump-quote { margin: 0; padding-left: 10px; border-left: 3px solid ${MIX(22)}; color: ${MIX(80)}; font-size: 12px; line-height: 1.3; }
/* margin: 0 above would also drop the 8 px block gap before a quote; this puts it back. */
.ump-md > * + .ump-quote, .ump-quote > * + .ump-quote { margin-top: 8px; }
.ump-list { margin: 0; padding-left: 20px; }
.ump-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86em; padding: 1px 4px; border-radius: 4px; background: ${MIX(10)}; }
/* Long lines wrap rather than widen the bubble past a narrow window. */
.ump-pre { background: ${MIX(7)}; border-radius: 8px; padding: 10px 12px; }
.ump-pre > div { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.ump-a { color: inherit; text-decoration: underline; text-decoration-color: ${MIX(45)}; text-underline-offset: 2px; }
/* Fold line (Stefan's pick B, opened as one piece "B1"): the header never moves; when open its
   text steps down and the chevron goes full strength; the body is the same tint at half. */
.ump-fold { border-radius: 8px; overflow: hidden; }
.ump-fold + .ump-fold { margin-top: 4px; }
.ump-head { display: flex; align-items: center; gap: 6px; height: 28px; box-sizing: border-box; padding: 0 10px 0 8px; background: ${MIX(7)}; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; cursor: pointer; user-select: none; -webkit-user-select: none; white-space: nowrap; }
.ump-head:hover { background: ${MIX(10)}; }
.ump-head:focus-visible { outline: 1px solid ${MIX(45)}; outline-offset: -1px; border-radius: 8px; }
.ump-chev { width: 12px; height: 12px; flex: none; fill: none; stroke: ${MIX(52)}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 120ms ease; }
.ump-fold[data-open] .ump-chev { transform: rotate(90deg); stroke: currentColor; }
/* One clamped line instead of nowrap: long text still sizes a wide bubble, but can't force the
   bubble wider than a narrow window (nowrap text can't shrink below its full width). The clamp
   draws the ellipsis; break-all fills the line to its edge, so no gap opens before the next part. */
.ump-open, .ump-peek { min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden; white-space: normal; word-break: break-all; }
.ump-open, .ump-shut { color: ${MIX(78)}; }
/* The tags keep their full text first; only a very long opening tag gets cut. The preview takes
   what is left and the closing tag follows it directly. */
.ump-open { flex: none; max-width: 70%; }
.ump-peek { flex: 0 1 auto; color: ${MIX(32)}; }
.ump-shut { flex: none; }
.ump-fold[data-open] .ump-peek, .ump-fold[data-open] .ump-shut { display: none; }
.ump-fold[data-open] .ump-open, .ump-foot { color: ${MIX(52)}; }
.ump-foot { padding-left: 26px; }
/* width 0 + min-width 100%: opening never widens the bubble; the body wraps to the header's width. */
.ump-body { width: 0; min-width: 100%; box-sizing: border-box; max-height: 320px; overflow: auto; padding: 8px 12px 10px 26px; background: ${MIX(3.5)}; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
/* ---- Skills: the bubble takes a very slight tint of the theme's accent (Paseo's own CSS variables,
   plugin themes included) only when a skill loaded. */
[data-ump-skill="loaded"], [data-ump-skill="pending"] { background-color: color-mix(in srgb, var(--colors-accent-bright, currentColor) 9%, var(--colors-surface3, transparent)) !important; }
.ump > .ump-sk-skill, .ump > .ump-sk-none { margin: -6px -8px 0; }
.ump > :is(.ump-sk-skill, .ump-sk-none) + * { margin-top: 10px; }
.ump > .ump-sk-file { margin: 10px -8px -6px; }
.ump > .ump-sk-file + .ump-sk-file { margin-top: 4px; }
[data-ump-only] .ump > .ump-sk-skill { margin-bottom: -6px; }
/* While a skill or file is open, the bubble takes at least half the chat's width (320 px on a
   narrow window), so a short message doesn't squeeze the opened text into a thin column. Paseo's
   bubble sits in a content-sized column inside the full-width message row: widen that column, then
   let the bubble fill it. */
[data-testid="user-message"] > :has(> * > [data-ump-view] > .ump-sk[data-open]) { min-width: min(100%, max(50%, 320px)) !important; }
:has(> [data-ump-view] > .ump-sk[data-open]) { align-self: stretch !important; }
.ump-sk { border-radius: 8px; overflow: hidden; }
.ump-skh { display: flex; align-items: center; gap: 6px; height: 26px; box-sizing: border-box; padding: 0 8px; font-size: 12px; line-height: 16px; cursor: pointer; user-select: none; -webkit-user-select: none; white-space: nowrap; }
.ump-skh:hover { background: ${MIX(7)}; }
.ump-skh:focus-visible { outline: 1px solid ${MIX(45)}; outline-offset: -1px; border-radius: 8px; }
.ump-skic, .ump-fchic { width: 12px; height: 12px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ump-sk-skill .ump-skic { color: color-mix(in srgb, var(--colors-accent-bright, currentColor) 85%, var(--colors-surface3, transparent)); }
.ump-sk-none .ump-skic, .ump-sk-file .ump-skic { color: ${MIX(38)}; }
.ump-skn { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: ${MIX(58)}; }
.ump-sksub { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: ${MIX(38)}; }
.ump-sksub::before { content: "·"; margin-right: 6px; }
.ump-skchev { width: 12px; height: 12px; flex: none; margin-left: auto; fill: none; stroke: ${MIX(38)}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 120ms ease; }
/* Opened: the header stays, its text steps down, the chevron turns and goes full strength. */
.ump-sk[data-open] { background: ${MIX(3.5)}; }
.ump-sk[data-open] > .ump-skh { background: ${MIX(7)}; }
.ump-sk[data-open] > .ump-skh .ump-skn { color: ${MIX(38)}; }
.ump-sk[data-open] > .ump-skh .ump-skchev { transform: rotate(90deg); stroke: currentColor; }
/* The skill text OMP sent: Paseo's code size, lines spaced with it (×1.5, as Paseo's diff view). */
.ump-skp, .ump-skt { width: 0; min-width: 100%; box-sizing: border-box; padding: 8px 12px 10px 26px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: var(--ump-code-size, 12px); line-height: calc(var(--ump-code-size, 12px) * 1.5); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.ump-skp { max-height: 320px; overflow: auto; color: ${MIX(82)}; }
.ump-skt { padding-top: 6px; border-top: 1px solid ${MIX(7)}; color: ${MIX(58)}; }
.ump-sknote { font-family: inherit; font-size: 12px; line-height: 18px; color: ${MIX(58)}; white-space: normal; }
/* What followed the skill's User: line. */
.ump-user { margin-right: 7px; font-size: 0.87em; font-variant-caps: all-small-caps; font-weight: 600; letter-spacing: 0.06em; color: ${MIX(38)}; user-select: none; -webkit-user-select: none; }
.ump-user::before { content: "User"; }
.ump-user-row { display: block; width: fit-content; }
.ump > .ump-user-row + * { margin-top: 3px; }
.ump-tok { text-decoration: underline dashed ${MIX(38)}; text-underline-offset: 4px; text-decoration-thickness: 1px; }
.ump-toktag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 6px; font-size: 11px; line-height: 17px; color: ${MIX(58)}; background: ${MIX(7)}; vertical-align: 1px; white-space: nowrap; user-select: none; -webkit-user-select: none; }
.ump-toktag::before { content: attr(data-tag); }
.ump-fchip { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px 0 5px; border-radius: 6px; background: ${MIX(7)}; font-size: 0.9em; vertical-align: 1px; }
.ump-fchic { color: ${MIX(58)}; }
/* ---- Motion, CSS only: hover and open tints fade, opened content fades in (@starting-style), the
   bubble eases to its wider width and to its skill tint. Closing is instant: the content is removed. */
.ump-head, .ump-skh, .ump-skn { transition: background-color 120ms ease, color 120ms ease; }
.ump-body, .ump-foot, .ump-skp, .ump-skt { transition: opacity 140ms ease; }
@starting-style { .ump-body, .ump-foot, .ump-skp, .ump-skt { opacity: 0; } }
:has(> [data-ump-view]) { transition: background-color 160ms ease; }
[data-testid="user-message"] > :has(> * > [data-ump-view]) { transition: min-width 160ms ease; }
@media (prefers-reduced-motion: reduce) { .ump *, :has(> [data-ump-view]), [data-testid="user-message"] > * { transition: none !important; } }
`;

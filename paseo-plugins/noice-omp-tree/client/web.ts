import type { TreeState, Turn } from "../shared/tree";
import type { TreeSnapshot, TreeStore } from "./store";
import { copyToClipboard } from "./clipboard";

/**
 * Web and desktop only: Paseo 0.12 has no plugin slot under a message, so this adds DOM next to
 * Paseo's own buttons (React Native Web turns testID into data-testid):
 * - a branch icon after Fork in each assistant turn's footer ("Continue from here"; not on the
 *   newest turn) and after Rewind in each user message's row ("Re-ask from here"), unless
 *   Settings → Show branch buttons on messages is off;
 * - a right-click menu on messages (Shift+right-click, a text selection, links and inputs keep
 *   the browser's menu), unless Settings → Branch menu on right-click is off;
 * - the strip above the composer ("N messages summarized · Undo · ×", or with Settings →
 *   Summarize when going back off, "N messages set aside · Summarize them · Undo · ×"), progress
 *   ("Switching branch…", "Summarizing…") and toasts.
 * Rows carry no message ids, so the user rows on screen are lined up in order with the user
 * messages of the chat's current path from the server (see `alignment`). A row that lines up with
 * none says so in a toast and moves nothing.
 * Colors come from Paseo's CSS variables (--colors-*), so every theme applies.
 */

export interface WebActions {
  store: TreeStore;
  /** Opens a chat in Paseo (through the plugin screen that holds the client navigation). */
  openAgent(agentId: string): void;
}

const ATTR = "data-session-tree";
const ICON = {
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  tree: '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  text: '<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
};
const svg = (name: keyof typeof ICON, size = 14) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const CSS = `
.stp-ib{display:inline-flex;align-items:center;justify-content:center;padding:4px;margin:0;border:0;background:transparent;cursor:pointer;color:var(--colors-foreground-muted);position:relative;flex:none;font:inherit}
.stp-ib:hover{color:var(--colors-foreground)}
.stp-ib[hidden]{display:none}
.stp-ib[data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:-4px;background:var(--colors-surface1);border:1px solid var(--colors-surface2);color:var(--colors-foreground);font-size:12px;line-height:16px;padding:3px 8px;border-radius:6px;white-space:nowrap;box-shadow:0 4px 8px rgba(0,0,0,.25);z-index:50;pointer-events:none}
.stp-pop{position:fixed;z-index:2147483000;background:var(--colors-surface1);border:1px solid var(--colors-surface2);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:4px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--colors-foreground)}
.stp-mi{display:flex;align-items:center;gap:8px;min-height:27px;padding:4px 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;border:0;background:transparent;color:inherit;width:100%;text-align:left;font-family:inherit}
.stp-mi:hover,.stp-mi:focus-visible{background:var(--colors-interaction-highlight);outline:none}
.stp-mi svg{color:var(--colors-foreground-muted)}
.stp-mi .stp-sub{margin-left:auto;padding-left:14px;font-size:12px;color:var(--colors-foreground-extra-muted)}
.stp-sep{height:1px;background:var(--colors-surface2);margin:4px -4px}
.stp-dock{position:fixed;z-index:40;display:flex;align-items:center;gap:8px;background:var(--colors-surface1);border:1px solid var(--colors-surface2);border-radius:10px;padding:4px 4px 4px 12px;min-height:36px;box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:var(--colors-foreground-muted);white-space:nowrap;box-shadow:0 4px 8px rgba(0,0,0,.2)}
.stp-dock.stp-col{flex-direction:column;align-items:stretch;padding:8px 8px 8px 12px;gap:8px;white-space:normal}
.stp-row{display:flex;align-items:center;gap:8px;min-width:0}
.stp-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.stp-xm{color:var(--colors-foreground-extra-muted)}
.stp-tb{border:0;background:transparent;color:var(--colors-foreground);font:inherit;font-size:13px;padding:4px 8px;border-radius:6px;cursor:pointer}
.stp-tb:hover{background:var(--colors-interaction-highlight)}
.stp-dock .stp-ib{padding:5px;border-radius:6px}
.stp-dock .stp-ib:hover{background:var(--colors-interaction-highlight)}
.stp-in{flex:1;min-width:0;font:inherit;font-size:13px;line-height:17px;padding:5px 8px;border-radius:6px;border:1px solid var(--colors-surface2);background:var(--colors-surface0);color:var(--colors-foreground);outline:none}
.stp-in:focus{border-color:var(--colors-foreground-extra-muted)}
.stp-in::placeholder{color:var(--colors-foreground-extra-muted)}
.stp-pri{border:1px solid transparent;background:var(--colors-foreground);color:var(--colors-background);font:inherit;font-size:13px;line-height:17px;padding:5px 11px;border-radius:7px;cursor:pointer}
.stp-spin{width:12px;height:12px;border-radius:50%;border:1.5px solid currentColor;border-right-color:transparent;display:inline-block;flex:none;animation:stp-rot .8s linear infinite;box-sizing:border-box}
@keyframes stp-rot{to{transform:rotate(360deg)}}
.stp-dim{position:fixed;z-index:39;background:var(--colors-surface0);opacity:.6;cursor:progress}
.stp-toast{position:fixed;z-index:2147483001;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:var(--colors-surface1);border:1px solid var(--colors-surface2);border-radius:10px;padding:7px 12px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:12.5px;color:var(--colors-foreground);box-shadow:0 4px 8px rgba(0,0,0,.3);white-space:nowrap;pointer-events:none}
.stp-toast .stp-m{color:var(--colors-foreground-muted)}
.stp-toast.stp-err svg{color:var(--colors-status-danger)}
`;

const norm = (text: string) => text.replace(/\s+/g, " ").trim();
/** Same message text, allowing for a row that shows only the start of a long message. */
const sameText = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 40 && (a.startsWith(b) || b.startsWith(a)));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.setAttribute(ATTR, "");
  if (html) node.innerHTML = html;
  return node;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** The chat shown in a pane: the selected agent tab of the same pane. */
function agentOf(scroll: Element): string | null {
  const pane = scroll.closest('[data-testid^="workspace-pane-"]');
  const tabs = pane?.querySelectorAll('[data-testid^="workspace-tab-agent_"][aria-selected="true"]') ?? [];
  const tab = tabs.length === 1 ? tabs[0] : document.querySelectorAll('[data-testid^="workspace-tab-agent_"][aria-selected="true"]').length === 1
    ? document.querySelector('[data-testid^="workspace-tab-agent_"][aria-selected="true"]')
    : null;
  return tab?.getAttribute("data-testid")?.slice("workspace-tab-agent_".length) ?? null;
}

function visible(node: Element): boolean {
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

const userText = (row: Element) => norm(row.querySelector("[data-message-text]")?.textContent ?? "");
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** A user row, or a reply footer with the first words of the reply shown above it. */
type Item = { node: Element; user: true; text: string } | { node: Element; user: false; head: string[] };
/** A user message or a reply (its first words) of the path, in order. */
type Step = { turn: Turn; user: true; text: string } | { turn: Turn; user: false; words: string[] };

function matches(item: Item, step: Step): boolean {
  if (item.user || step.user) return item.user && step.user && !!item.text && sameText(item.text, step.text);
  if (!item.head.length) return false;
  // The reply's opening words, in order. Markdown on screen drops some source words (link targets,
  // code-fence languages), so the source may have extra words; one shown word may be missing.
  let found = 0;
  let at = 0;
  for (const word of item.head) {
    const next = step.words.indexOf(word, at);
    if (next < 0) continue;
    found++;
    at = next + 1;
  }
  return found >= item.head.length - (item.head.length > 4 ? 1 : 0);
}

/**
 * Lines up what the screen shows (user rows and reply footers, in order) with the user messages
 * and replies of the current path: longest common subsequence. Order matters because Paseo mounts
 * only part of a long chat, with gaps, so "the user row above a footer" can belong to an older
 * turn; and because /prose distills a chat by replaying its messages after a reset, so the path
 * holds them twice while the screen shows one copy. Where the screen could stand for either copy,
 * the newer one wins: that is the one OMP's context holds. Computed once per state and DOM list.
 */
const alignments = new WeakMap<TreeState, { nodes: Element[]; map: Map<Element, Turn> }>();
function alignment(scroll: Element, state: TreeState): Map<Element, Turn> {
  const nodes = [...scroll.querySelectorAll('[data-testid="user-message"],[data-testid="assistant-message"],[data-testid="assistant-fork-menu-trigger"]')];
  const cached = alignments.get(state);
  if (cached && cached.nodes.length === nodes.length && cached.nodes.every((node, index) => node === nodes[index])) return cached.map;
  const items: Item[] = [];
  let reply = "";
  for (const node of nodes) {
    const kind = node.getAttribute("data-testid");
    if (kind === "assistant-message") reply = node.textContent ?? "";
    else {
      items.push(kind === "user-message" ? { node, user: true, text: userText(node) } : { node, user: false, head: words(reply).slice(0, 12) });
      reply = "";
    }
  }
  const steps: Step[] = state.turns.flatMap(turn => [
    ...(turn.userText ? [{ turn, user: true as const, text: norm(turn.userText) }] : []),
    ...(turn.replyText ? [{ turn, user: false as const, words: words(turn.replyText).slice(0, 80) }] : []),
  ]);
  const n = items.length;
  const w = steps.length + 1;
  const hit = new Uint8Array((n + 1) * w);
  // lcs[i * w + j]: longest match of items[0..i) with steps[0..j).
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j < w; j++) {
      hit[i * w + j] = matches(items[i - 1], steps[j - 1]) ? 1 : 0;
      lcs[i * w + j] = hit[i * w + j] ? lcs[(i - 1) * w + j - 1] + 1 : Math.max(lcs[(i - 1) * w + j], lcs[i * w + j - 1]);
    }
  }
  const map = new Map<Element, Turn>();
  for (let i = n, j = w - 1; i > 0 && j > 0; ) {
    if (hit[i * w + j] && lcs[i * w + j] === lcs[(i - 1) * w + j - 1] + 1) {
      map.set(items[i - 1].node, steps[j - 1].turn);
      i--;
      j--;
    } else if (lcs[(i - 1) * w + j] >= lcs[i * w + j - 1]) i--;
    else j--;
  }
  alignments.set(state, { nodes, map });
  return map;
}

/** The turn of a user row or a reply footer, or null when it lines up with nothing on the path. */
function turnOf(scroll: Element, node: Element, state: TreeState): Turn | null {
  return alignment(scroll, state).get(node) ?? null;
}

/** Whether a footer belongs to the newest turn (continuing from it would change nothing). */
function isNewest(scroll: Element, trigger: Element, state: TreeState, map = alignment(scroll, state)): boolean {
  const turn = map.get(trigger);
  if (turn) return turn === state.turns.at(-1);
  const items = [...scroll.querySelectorAll('[data-testid="user-message"],[data-testid="assistant-fork-menu-trigger"]')];
  return items.at(-1) === trigger;
}

export function startWeb({ store, openAgent }: WebActions): () => void {
  const style = el("style", "");
  style.textContent = CSS;
  document.head.appendChild(style);

  const watching = new Map<string, () => void>();
  let snapshot: TreeSnapshot = store.getSnapshot();
  let menu: HTMLElement | null = null;
  const docks = new Map<string, { node: HTMLElement; key: string; dim: HTMLElement | null }>();
  let frame = 0;
  /** Strips follow their chat's scroll area and composer: placed again when either changes size, and on each scan. */
  const resized = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(place);
  });
  let observed: Element[] = [];
  let scanQueued = false;

  /** Visible chat scrollers with their agent ids. */
  function chats(): { scroll: Element; agentId: string }[] {
    return [...document.querySelectorAll('[data-testid="agent-chat-scroll"]')].flatMap(scroll => {
      const agentId = visible(scroll) ? agentOf(scroll) : null;
      return agentId ? [{ scroll, agentId }] : [];
    });
  }

  function iconButton(kind: "assistant" | "user", size: number): HTMLButtonElement {
    const button = el("button", "stp-ib", svg("branch", size));
    button.type = "button";
    button.dataset.stpKind = kind;
    const label = kind === "assistant" ? "Continue from here · keeps the rest" : "Re-ask from here · copies the text";
    button.dataset.tip = label;
    button.setAttribute("aria-label", label);
    return button;
  }

  function inject(scroll: Element, state: TreeState | undefined): void {
    // Settings → Show branch buttons on messages off (or not read yet): remove them live.
    if (!state?.supported || !snapshot.display?.showMessageButtons) {
      scroll.querySelectorAll(`.stp-ib[${ATTR}]`).forEach(node => node.remove());
      return;
    }
    // One alignment for all footers: each lookup lists the chat's message nodes again.
    const map = alignment(scroll, state);
    for (const trigger of scroll.querySelectorAll('[data-testid="assistant-fork-menu-trigger"]')) {
      const wrap = trigger.parentElement;
      if (!wrap?.parentElement) continue;
      let button = wrap.nextElementSibling;
      if (!(button instanceof HTMLButtonElement) || button.dataset.stpKind !== "assistant") {
        button = iconButton("assistant", Number(trigger.querySelector("svg")?.getAttribute("width")) || 14);
        wrap.after(button);
      }
      (button as HTMLButtonElement).hidden = isNewest(scroll, trigger, state, map);
    }
    for (const row of scroll.querySelectorAll('[data-testid="user-message-trailing-row"]')) {
      if (row.querySelector(".stp-ib")) continue;
      const rewind = row.querySelector('[data-testid="rewind-menu-trigger"]');
      const button = iconButton("user", Number(rewind?.querySelector("svg")?.getAttribute("width")) || 14);
      const anchor = rewind?.parentElement?.parentElement === row ? rewind.parentElement : null;
      if (anchor) anchor.after(button);
      else row.appendChild(button);
    }
  }

  function scan(): void {
    scanQueued = false;
    // Paseo's compact (phone) layout has no panes and no agent tabs to tell which chat a row is in.
    store.setCompact(!document.querySelector('[data-testid^="workspace-pane-"]') && !!document.querySelector('[data-testid="agent-chat-scroll"]'));
    const seen = new Set<string>();
    for (const { scroll, agentId } of chats()) {
      seen.add(agentId);
      if (!watching.has(agentId)) watching.set(agentId, store.watch(agentId));
      inject(scroll, snapshot.states.get(agentId));
    }
    for (const [agentId, unwatch] of watching) {
      if (seen.has(agentId)) continue;
      unwatch();
      watching.delete(agentId);
    }
    renderDocks();
    showNotices();
  }

  function queueScan(): void {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  }

  function busyReason(state: TreeState | undefined, agentId: string): string | null {
    if (!state?.supported) return "Branches work only in OMP chats.";
    if (state.op || snapshot.starting.has(agentId)) return "A branch switch is still running.";
    if (state.busy) return "The agent is busy. Try again when it has finished.";
    return null;
  }

  function continueFrom(agentId: string, turn: Turn | null): void {
    const state = snapshot.states.get(agentId);
    const reason = busyReason(state, agentId);
    if (reason) return store.notify(agentId, reason, undefined, true);
    if (!turn?.lastId) return store.notify(agentId, "Could not match this reply to the saved chat, so nothing moved.", undefined, true);
    void store.goto(agentId, "continue", turn.lastId);
  }

  function reask(agentId: string, turn: Turn | null): void {
    const state = snapshot.states.get(agentId);
    const reason = busyReason(state, agentId);
    if (reason) return store.notify(agentId, reason, undefined, true);
    if (!turn?.userId || !turn.userText) return store.notify(agentId, "Could not match this message to the saved chat, so nothing moved.", undefined, true);
    // Copy inside the click: browsers allow clipboard writes only during a user gesture.
    void copyToClipboard(turn.userText);
    store.notify(agentId, "Copied — paste to re-ask", "the old path is kept");
    void store.goto(agentId, "reask", turn.userId);
  }

  async function openInTab(agentId: string, entryId: string, before: boolean, text?: string): Promise<void> {
    if (text) void copyToClipboard(text);
    const child = await store.openTab(agentId, entryId, before);
    if (!child) return;
    store.notify(agentId, "Opened in a new tab", text ? "message copied — paste to re-ask" : "with the chat up to this reply");
    openAgent(child);
  }

  function onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (menu && !(target && menu.contains(target))) closeMenu();
    const button = target?.closest<HTMLButtonElement>(`.stp-ib[${ATTR}][data-stp-kind]`);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const scroll = button.closest('[data-testid="agent-chat-scroll"]');
    const agentId = scroll && agentOf(scroll);
    const state = agentId ? snapshot.states.get(agentId) : undefined;
    if (!scroll || !agentId || !state) return;
    if (button.dataset.stpKind === "assistant") {
      const trigger = button.previousElementSibling?.querySelector('[data-testid="assistant-fork-menu-trigger"]');
      continueFrom(agentId, trigger ? turnOf(scroll, trigger, state) : null);
    } else {
      const row = button.closest('[data-testid="user-message"]');
      reask(agentId, row ? turnOf(scroll, row, state) : null);
    }
  }

  function closeMenu(): void {
    menu?.remove();
    menu = null;
  }

  function onContextMenu(event: MouseEvent): void {
    closeMenu();
    if (!snapshot.display?.contextMenu) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || event.shiftKey) return;
    const scroll = target.closest('[data-testid="agent-chat-scroll"]');
    if (!scroll || target.closest("a[href], input, textarea, [contenteditable=true]")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    const agentId = agentOf(scroll);
    const state = agentId ? snapshot.states.get(agentId) : undefined;
    if (!agentId || !state?.supported) return;

    const items: { icon: keyof typeof ICON; label: string; sub?: string; run: () => void }[] = [];
    const userRow = target.closest('[data-testid="user-message"]');
    if (userRow) {
      const turn = turnOf(scroll, userRow, state);
      items.push({ icon: "pencil", label: "Re-ask from here", sub: "copies the text", run: () => reask(agentId, turn) });
      if (turn?.userId) items.push({ icon: "external", label: "Open in new tab", run: () => void openInTab(agentId, turn.userId!, true, turn.userText ?? undefined) });
    } else {
      // An assistant turn: everything up to its footer. Past the last footer is the turn still running.
      const footers = [...scroll.querySelectorAll('[data-testid="user-message"],[data-testid="assistant-fork-menu-trigger"]')];
      const next = footers.find(node => target.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (!target.closest('[data-testid="assistant-message"], [data-testid="tool-call-badge"]') && next?.getAttribute("data-testid") !== "assistant-fork-menu-trigger") return;
      const trigger = next?.getAttribute("data-testid") === "assistant-fork-menu-trigger" ? next : null;
      const turn = trigger ? turnOf(scroll, trigger, state) : null;
      const newest = trigger ? isNewest(scroll, trigger, state) : true;
      if (!newest) items.push({ icon: "branch", label: "Continue from here", sub: "keeps the rest", run: () => continueFrom(agentId, turn) });
      if (turn?.lastId) items.push({ icon: "external", label: "Open in new tab", run: () => void openInTab(agentId, turn.lastId!, false) });
    }
    items.push({ icon: "tree", label: "Show branches", run: () => store.openSheet(agentId) });
    event.preventDefault();

    menu = el("div", "stp-pop");
    menu.setAttribute("role", "menu");
    for (const item of items) {
      const row = el("button", "stp-mi", `${svg(item.icon, 16)}<span>${escapeHtml(item.label)}</span>${item.sub ? `<span class="stp-sub">${escapeHtml(item.sub)}</span>` : ""}`);
      row.setAttribute("role", "menuitem");
      row.addEventListener("click", clickEvent => {
        clickEvent.stopPropagation();
        closeMenu();
        item.run();
      });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
    menu.querySelector<HTMLElement>(".stp-mi")?.focus();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && menu) {
      event.stopPropagation();
      closeMenu();
    }
  }

  /** What the strip above a chat's composer says, or null for no strip. */
  function dockModel(agentId: string): { key: string; html: string; col?: boolean; dim?: boolean } | null {
    const state = snapshot.states.get(agentId);
    if (!state?.supported) return null;
    const starting = snapshot.starting.get(agentId);
    const op = state.op;
    const kind = op?.kind ?? starting;
    if (op?.phase === "summarizing" || (!op && starting === "summarize")) {
      return {
        key: "summarizing",
        html: `<span class="stp-spin"></span><span class="stp-grow">Summarizing what you left…</span><button class="stp-tb" data-act="cancel">Cancel</button>`,
      };
    }
    if (op || starting) {
      const text = kind === "summarize" ? "Putting the summary at the branch point…" : "Switching branch…";
      return { key: `switching-${text}`, html: `<span class="stp-spin"></span><span class="stp-grow">${text}</span>`, dim: true };
    }
    if (snapshot.summarized.has(agentId)) {
      return { key: "summarized", html: `${svg("check", 13)}<span>Summary added at the branch point</span><span class="stp-xm stp-grow">· the agent sees it</span>` };
    }
    const offer = state.offer;
    if (!offer) return null;
    const n = offer.setAside;
    const what = `${n} message${n === 1 ? "" : "s"}`;
    if (offer.summarized) {
      return {
        key: `summarized-${n}`,
        html: `${svg("check", 13)}<span class="stp-grow">${what} summarized at the branch point</span><button class="stp-tb" data-act="undo">Undo</button><button class="stp-ib" data-act="x" aria-label="Dismiss">${svg("x", 13)}</button>`,
      };
    }
    if (snapshot.focusOpen.has(agentId)) {
      return {
        key: `focus-${n}`,
        col: true,
        html: `<div class="stp-row">${svg("text", 13)}<span class="stp-grow">Summarize the ${what} you left</span><button class="stp-ib" data-act="x" aria-label="Close">${svg("x", 13)}</button></div>`
          + `<div class="stp-row"><input class="stp-in" data-act="focus" placeholder="Focus the summary on… (optional)" aria-label="Focus for the summary"><button class="stp-pri" data-act="go">Summarize</button></div>`,
      };
    }
    return {
      key: `offer-${n}`,
      html: `${svg("undo", 13)}<span class="stp-grow">${what} set aside</span><button class="stp-tb" data-act="ask">Summarize them</button><button class="stp-tb" data-act="undo">Undo</button><button class="stp-ib" data-act="x" aria-label="Dismiss">${svg("x", 13)}</button>`,
    };
  }

  function onDockClick(agentId: string, event: MouseEvent): void {
    const action = (event.target instanceof Element ? event.target.closest<HTMLElement>("[data-act]") : null)?.dataset.act;
    if (!action) return;
    if (action === "ask") store.setFocusOpen(agentId, true);
    else if (action === "x") {
      if (snapshot.focusOpen.has(agentId)) store.setFocusOpen(agentId, false);
      else void store.dismiss(agentId);
    } else if (action === "undo") void store.goto(agentId, "undo");
    else if (action === "cancel") void store.cancel(agentId);
    else if (action === "go") {
      const input = docks.get(agentId)?.node.querySelector<HTMLInputElement>("input.stp-in");
      void store.summarize(agentId, input?.value ?? "");
    }
  }

  function renderDocks(): void {
    const shown = new Set<string>();
    for (const { agentId } of chats()) {
      const model = dockModel(agentId);
      if (!model) continue;
      shown.add(agentId);
      let dock = docks.get(agentId);
      if (dock?.key !== model.key) {
        dock?.node.remove();
        dock?.dim?.remove();
        const node = el("div", `stp-dock${model.col ? " stp-col" : ""}`, model.html);
        node.addEventListener("click", event => onDockClick(agentId, event));
        node.addEventListener("keydown", event => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void store.summarize(agentId, event.target.value);
          } else if (event.key === "Escape") {
            event.stopPropagation();
            store.setFocusOpen(agentId, false);
          }
        });
        document.body.appendChild(node);
        const dim = model.dim ? el("div", "stp-dim") : null;
        if (dim) document.body.appendChild(dim);
        dock = { node, key: model.key, dim };
        docks.set(agentId, dock);
        node.querySelector<HTMLInputElement>("input.stp-in")?.focus();
      }
    }
    for (const [agentId, dock] of docks) {
      if (shown.has(agentId)) continue;
      dock.node.remove();
      dock.dim?.remove();
      docks.delete(agentId);
    }
    if ((docks.size || observed.length) && !frame) frame = requestAnimationFrame(place);
  }

  /** Keeps strips above their composer (and dims the chat while it switches). */
  function place(): void {
    frame = 0;
    const byAgent = new Map(chats().map(chat => [chat.agentId, chat.scroll]));
    const targets: Element[] = [];
    for (const [agentId, dock] of docks) {
      const scroll = byAgent.get(agentId);
      const pane = scroll?.closest('[data-testid^="workspace-pane-"]') ?? scroll?.parentElement?.parentElement;
      // A pane keeps hidden tabs mounted: take the composer that is on screen.
      const composer = [...(pane?.querySelectorAll('[data-testid="message-input-root"]') ?? [])].find(visible);
      if (!scroll || !composer) {
        dock.node.style.display = "none";
        continue;
      }
      targets.push(scroll, composer);
      const box = composer.getBoundingClientRect();
      // Composer pills (Tree, links, …) sit in a row right above the composer: keep the strip above them.
      let top = box.top;
      for (const button of pane!.querySelectorAll("button, [role=button]")) {
        if (dock.node.contains(button)) continue;
        const rect = button.getBoundingClientRect();
        if (rect.height > 0 && rect.height < 48 && rect.bottom <= box.top + 1 && rect.bottom > box.top - 56 && rect.left < box.right && rect.right > box.left) {
          top = Math.min(top, rect.top);
        }
      }
      Object.assign(dock.node.style, {
        display: "", left: `${box.left}px`, width: `${box.width}px`, top: "", bottom: `${window.innerHeight - top + 6}px`,
      });
      if (dock.dim) {
        const area = scroll.getBoundingClientRect();
        Object.assign(dock.dim.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px` });
      }
    }
    // observe() reports a size at once, so observing the same nodes again here would loop.
    if (targets.length !== observed.length || targets.some((node, i) => node !== observed[i])) {
      resized.disconnect();
      targets.forEach(node => resized.observe(node));
      observed = targets;
    }
  }

  const shownNotices = new Set<number>();
  function showNotices(): void {
    // A taken notice leaves the snapshot; its key is only needed until then.
    for (const key of shownNotices) if (!snapshot.notices.some(notice => notice.key === key)) shownNotices.delete(key);
    for (const notice of snapshot.notices) {
      if (shownNotices.has(notice.key)) continue;
      shownNotices.add(notice.key);
      store.takeNotice(notice.key);
      const scroll = chats().find(chat => chat.agentId === notice.agentId)?.scroll;
      const area = scroll?.getBoundingClientRect();
      const toast = el(
        "div",
        `stp-toast${notice.error ? " stp-err" : ""}`,
        `${svg(notice.error ? "alert" : "check", 13)}<span>${escapeHtml(notice.text)}</span>${notice.sub ? `<span class="stp-m">· ${escapeHtml(notice.sub)}</span>` : ""}`,
      );
      toast.style.left = `${area ? area.left + area.width / 2 : window.innerWidth / 2}px`;
      toast.style.top = `${(area?.top ?? 0) + 12}px`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), notice.error ? 4_000 : 2_600);
    }
  }

  const observer = new MutationObserver(mutations => {
    // Not for our own nodes, or every scan would trigger the next, nor for nodes inside a reply:
    // a streaming reply adds them many times a second, the buttons sit outside it, and its first
    // words are read for alignment once its turn's fork button arrives.
    if (mutations.every(m =>
      (m.target as Element).closest('[data-testid="assistant-message"]') ||
      [...m.addedNodes, ...m.removedNodes].every(node => node instanceof Element && node.hasAttribute(ATTR)))) return;
    queueScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = store.subscribe(() => {
    snapshot = store.getSnapshot();
    queueScan();
  });
  document.addEventListener("click", onClick, true);
  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", closeMenu);
  queueScan();

  return () => {
    observer.disconnect();
    resized.disconnect();
    unsubscribe();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", onContextMenu);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", closeMenu);
    cancelAnimationFrame(frame);
    closeMenu();
    watching.forEach(unwatch => unwatch());
    document.querySelectorAll(`[${ATTR}]`).forEach(node => node.remove());
  };
}

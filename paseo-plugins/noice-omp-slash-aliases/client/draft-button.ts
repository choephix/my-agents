/**
 * Web only: an `Instructions` pill beside the draft composer (a "New agent" tab before its first
 * message), next to Paseo's `Import session` pill, which only draft tabs have. Paseo has no plugin
 * surface there, so the pill is a copy of that one and its editor is a small popover built here.
 * Sending the first message unmounts the pill's row (`isSubmitting`), and the copy with it.
 *
 * One observer on the page's child list reads only the nodes each change adds (a streaming reply
 * adds a few small ones), looking for a newly mounted `Import session` pill.
 */
const PILL = '[data-testid="composer-import-agent-pill"]';
const BUTTON = "noice-next-chat-draft-button";
const POPOVER = "noice-next-chat-editor";
const TITLE = "Instructions for the next chat";

export interface DraftEditorData {
  armed: { text: string; expiresAt: number } | null;
  lastUsed: { title: string | null; text: string; at: number } | null;
}
export interface DraftButtonsPort {
  armed(workspaceId: string): boolean;
  load(workspaceId: string): Promise<DraftEditorData>;
  /** Arms `text` (`""` disarms). */
  save(workspaceId: string, text: string): Promise<void>;
}

const CSS = `
.ncx-pop{position:fixed;z-index:2147483000;box-sizing:border-box;width:min(420px,calc(100vw - 16px));display:flex;flex-direction:column;gap:8px;padding:12px;
  background:var(--colors-surface1);border:1px solid var(--colors-surface2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);
  color:var(--colors-foreground);font:13px/19px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.ncx-title{font-weight:600}
.ncx-pop textarea{box-sizing:border-box;width:100%;min-height:140px;max-height:320px;resize:vertical;padding:8px;border-radius:6px;font:inherit;
  border:1px solid var(--colors-surface2);background:var(--colors-surface0);color:var(--colors-foreground);outline:none}
.ncx-pop textarea:focus{border-color:var(--colors-accent-bright)}
.ncx-pop textarea::placeholder{color:var(--colors-foreground-muted)}
.ncx-note{font-size:12px;line-height:16px;color:var(--colors-foreground-muted)}
.ncx-note[hidden]{display:none}
.ncx-link{color:var(--colors-accent-bright);cursor:pointer}
.ncx-err{font-size:12px;line-height:16px;color:#e5484d}
.ncx-err:empty{display:none}
.ncx-row{display:flex;justify-content:flex-end;gap:8px}
.ncx-btn{padding:6px 12px;border-radius:6px;font:inherit;cursor:pointer;border:1px solid var(--colors-surface2);background:transparent;color:var(--colors-foreground)}
.ncx-btn:hover:not(:disabled){background:var(--colors-surface2)}
.ncx-btn.ncx-pri{border-color:var(--colors-accent);background:var(--colors-accent);color:var(--colors-accent-foreground)}
.ncx-btn:disabled{opacity:.5;cursor:default}
`;

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** The workspace on screen: Paseo's routes are `/h/<host>/workspace/<id>`. */
const currentWorkspace = () => /\/workspace\/([^/?#]+)/.exec(location.pathname)?.[1];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function startDraftButtons(port: DraftButtonsPort): { relabel(): void; stop(): void } {
  const style = element("style", "");
  style.textContent = CSS;
  document.head.appendChild(style);
  let popover: { node: HTMLElement; close(): void } | undefined;

  const relabel = () => {
    const workspaceId = currentWorkspace();
    const armed = workspaceId ? port.armed(workspaceId) : false;
    for (const button of document.querySelectorAll<HTMLElement>(`[data-testid="${BUTTON}"]`)) {
      const text = button.lastElementChild as HTMLElement | null;
      if (!text) continue;
      text.textContent = armed ? "Instructions ✓" : "+ Instructions";
      text.style.color = armed ? "var(--colors-accent-bright)" : "";
    }
  };

  const open = (anchor: HTMLElement) => {
    popover?.close();
    const workspaceId = currentWorkspace();
    if (!workspaceId) return;
    const node = element("div", "ncx-pop");
    node.dataset.testid = POPOVER;
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", TITLE);
    const box = element("textarea", "");
    box.placeholder = "Loading…";
    box.disabled = true;
    const note = element("div", "ncx-note");
    const last = element("div", "ncx-note");
    last.hidden = true;
    const error = element("div", "ncx-err");
    const clear = element("button", "ncx-btn", "Clear");
    const arm = element("button", "ncx-btn ncx-pri", "Arm");
    clear.disabled = arm.disabled = true;
    const row = element("div", "ncx-row");
    row.append(clear, arm);
    node.append(element("div", "ncx-title", TITLE), box, note, last, error, row);

    let data: DraftEditorData | undefined;
    let busy = false;
    const update = () => {
      clear.disabled = busy || !data?.armed;
      arm.disabled = busy || !data || !box.value.trim() || box.value === data.armed?.text;
      box.disabled = busy || !data;
    };
    const commit = (text: string) => {
      busy = true;
      error.textContent = "";
      update();
      port.save(workspaceId, text).then(close, (reason: unknown) => {
        busy = false;
        error.textContent = errorText(reason);
        update();
      });
    };
    box.addEventListener("input", update);
    clear.addEventListener("click", () => commit(""));
    arm.addEventListener("click", () => commit(box.value));
    // Paseo handles some keys globally (Escape interrupts the agent); keep the popover's to itself.
    node.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape") close();
    });
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
    };
    function close() {
      document.removeEventListener("pointerdown", outside, true);
      node.remove();
      if (popover?.node === node) popover = undefined;
    }

    const rect = anchor.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - Math.min(420, innerWidth - 16) - 8))}px`;
    node.style.bottom = `${innerHeight - rect.top + 8}px`;
    document.body.appendChild(node);
    document.addEventListener("pointerdown", outside, true);
    popover = { node, close };
    box.focus();

    port.load(workspaceId).then(
      loaded => {
        data = loaded;
        if (!box.value) box.value = loaded.armed?.text ?? "";
        box.placeholder = "A role or brief for the next chat";
        note.textContent = loaded.armed
          ? `Armed until ${clock(loaded.armed.expiresAt)}. The next chat you start in this workspace gets it in its system prompt, for good.`
          : "Arm it, then start a new chat in this workspace within 30 minutes: that chat gets it in its system prompt, for good. Chats started by agents don't take it; nor do Copilot, Cursor, Grok or Antigravity chats.";
        if (loaded.lastUsed) {
          const used = loaded.lastUsed;
          const copy = element("span", "ncx-link", "Copy into the box");
          copy.addEventListener("click", () => {
            box.value = used.text;
            update();
          });
          last.append(`Last used by “${used.title?.trim() || "New agent"}” at ${clock(used.at)} · `, copy);
          last.hidden = false;
        }
        update();
        box.focus();
      },
      (reason: unknown) => {
        error.textContent = errorText(reason);
      },
    );
  };

  const make = (pill: HTMLElement) => {
    const button = pill.cloneNode(true) as HTMLElement;
    button.dataset.testid = BUTTON;
    button.setAttribute("aria-label", TITLE);
    button.title = TITLE;
    button.querySelector("svg")?.parentElement?.remove();
    button.style.marginLeft = "6px";
    button.addEventListener("click", event => {
      event.stopPropagation();
      if (popover?.node.isConnected) popover.close();
      else open(button);
    });
    return button;
  };
  const place = (root: ParentNode) => {
    let placed = false;
    for (const pill of root.querySelectorAll<HTMLElement>(PILL)) {
      const row = pill.parentElement;
      if (!row || row.querySelector(`[data-testid="${BUTTON}"]`)) continue;
      row.appendChild(make(pill));
      placed = true;
    }
    if (placed) relabel();
  };

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(PILL)) place(node.parentElement?.parentElement ?? node);
        else if (node.firstElementChild) place(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  place(document);

  return {
    relabel,
    stop() {
      observer.disconnect();
      popover?.close();
      style.remove();
      document.querySelectorAll(`[data-testid="${BUTTON}"]`).forEach(button => button.remove());
    },
  };
}

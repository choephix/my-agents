/**
 * Web only: an `Instructions` button beside the draft composer (a "New agent" tab before its first
 * message), next to Paseo's `Import session` pill, which only draft tabs have. Paseo has no plugin
 * surface there, so the button is a copy of that pill with its own label.
 *
 * Watching stays narrow: the workspace screen for `aria-selected` changes only (a tab switch), and
 * the pane of a selected draft tab (childList) while one is selected, for the pill to appear. With
 * no draft tab selected, only the attribute watch is attached. Sending the first message unmounts
 * the pill's row (`isSubmitting`), and the button with it.
 */
const PANE = '[data-testid^="workspace-pane-"]';
const SELECTED_DRAFT = '[data-testid^="workspace-tab-draft_"][aria-selected="true"]';
const PILL = '[data-testid="composer-import-agent-pill"]';
const BUTTON = "noice-next-chat-draft-button";
/** How far up from the header button to look for the workspace screen holding the panes. */
const MAX_DEPTH = 16;

export interface DraftButtons {
  setArmed(armed: boolean, accent: string): void;
  stop(): void;
}

/** `anchor`: a node in the workspace header (the header button's icon). */
export function watchDraftComposers(anchor: HTMLElement, onPress: () => void): DraftButtons | undefined {
  const ancestors: HTMLElement[] = [];
  for (let node = anchor.parentElement; node && ancestors.length < MAX_DEPTH; node = node.parentElement) ancestors.push(node);
  const top = ancestors.at(-1);
  if (!top) return undefined;
  /** The workspace screen: the nearest ancestor holding the panes. */
  let screen: HTMLElement | undefined;
  let label = "+ Instructions";
  let color = "";
  let frame = 0;

  const show = (button: HTMLElement) => {
    const text = button.lastElementChild as HTMLElement | null;
    if (text && text.textContent !== label) text.textContent = label;
    if (text && text.style.color !== color) text.style.color = color;
  };
  const make = (pill: HTMLElement) => {
    const button = pill.cloneNode(true) as HTMLElement;
    button.dataset.testid = BUTTON;
    button.setAttribute("aria-label", "Instructions for the next chat");
    button.title = "Instructions for the next chat";
    button.querySelector("svg")?.parentElement?.remove();
    button.style.marginLeft = "6px";
    button.addEventListener("click", event => {
      event.stopPropagation();
      onPress();
    });
    return button;
  };
  const sync = () => {
    frame = 0;
    if (!screen) {
      screen = ancestors.find(node => node.querySelector(PANE));
      if (!screen) return;
      tabs.disconnect();
      tabs.observe(screen, { attributes: true, attributeFilter: ["aria-selected"], subtree: true });
    }
    drafts.disconnect();
    for (const tab of screen.querySelectorAll(SELECTED_DRAFT)) {
      const pane = tab.closest<HTMLElement>(PANE);
      if (!pane) continue;
      drafts.observe(pane, { childList: true, subtree: true });
      for (const pill of pane.querySelectorAll<HTMLElement>(PILL)) {
        const row = pill.parentElement;
        if (!row) continue;
        const button = row.querySelector<HTMLElement>(`[data-testid="${BUTTON}"]`) ?? row.appendChild(make(pill));
        show(button);
      }
    }
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(sync);
  };
  const drafts = new MutationObserver(schedule);
  const tabs = new MutationObserver(schedule);
  // After in-app navigation the header mounts before the panes: until they appear, watch for them.
  tabs.observe(top, { childList: true, subtree: true });
  sync();

  return {
    setArmed(armed, accent) {
      label = armed ? "Instructions ✓" : "+ Instructions";
      color = armed ? accent : "";
      screen?.querySelectorAll<HTMLElement>(`[data-testid="${BUTTON}"]`).forEach(show);
    },
    stop() {
      tabs.disconnect();
      drafts.disconnect();
      cancelAnimationFrame(frame);
      screen?.querySelectorAll(`[data-testid="${BUTTON}"]`).forEach(button => button.remove());
    },
  };
}

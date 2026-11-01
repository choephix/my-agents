import type { PluginButtonBehavior, PluginButtonContentProps, PluginButtonIcon, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { Dimensions } from "react-native";

// The same file sits in every noice plugin that had composer pills (plugins install separately); keep the copies identical.

/** Paseo's compact (phone) layout is below its `md` breakpoint. */
const COMPACT_WIDTH = 600;

export interface MenuChat {
  agentId: string;
  workspaceId: string;
  /** The tab's title, plus any state the pill showed. */
  title: string;
  createdAt: string;
  behavior: PluginButtonBehavior;
}

/** A tab's title as Paseo shows it; untitled chats read "New agent". */
export const tabTitle = (title: string | null | undefined) => title?.trim() || "New agent";

/**
 * Phone layouts get no composer pills from us: there, Paseo lists header buttons as rows of the
 * workspace ⋯ menu, so a pill's action becomes one such row per workspace. Header buttons don't know
 * which tab is open, so the row opens the workspace's chats, newest first; with a single chat it acts
 * on that chat directly. Wide layouts get no row. `onLayout` runs after the layout switches.
 */
export function startPhoneMenu(client: PluginClientContext, button: { id: string; title: string; icon: PluginButtonIcon }, onLayout: () => void) {
  let compact = Dimensions.get("window").width < COMPACT_WIDTH;
  let chats: readonly MenuChat[] = [];
  const rows = new Map<string, { registration: PluginButtonRegistration; key: string }>();
  const sync = () => {
    const byWorkspace = new Map<string, MenuChat[]>();
    for (const chat of compact ? chats : []) byWorkspace.set(chat.workspaceId, [...(byWorkspace.get(chat.workspaceId) ?? []), chat]);
    for (const [workspaceId, row] of rows) {
      if (byWorkspace.has(workspaceId)) continue;
      row.registration.remove();
      rows.delete(workspaceId);
    }
    for (const [workspaceId, list] of byWorkspace) {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      // Behaviors are fixed per chat, so only the chats and their titles decide whether the row changes.
      const key = list.map(chat => `${chat.agentId} ${chat.title}`).join("\n");
      const row = rows.get(workspaceId);
      if (row?.key === key) continue;
      const behavior: PluginButtonBehavior = list.length === 1
        ? list[0].behavior
        // Paseo takes ids matching /^[a-z][a-z0-9-]*$/; agent ids are lowercase UUIDs, which may start with a digit.
        : { kind: "menu", items: list.map(chat => ({ kind: "item", id: `chat-${chat.agentId}`, title: chat.title, behavior: chat.behavior })) };
      if (row) {
        row.registration.update({ behavior });
        row.key = key;
      } else {
        rows.set(workspaceId, { registration: client.addHeaderButton({ id: button.id, workspaceId, button: { ...button, behavior } }), key });
      }
    }
  };
  const resize = Dimensions.addEventListener("change", ({ window }) => {
    if (compact === window.width < COMPACT_WIDTH) return;
    compact = !compact;
    sync();
    onLayout();
  });
  return {
    get compact() {
      return compact;
    },
    set(next: readonly MenuChat[]) {
      chats = next;
      sync();
    },
    stop() {
      resize.remove();
      rows.forEach(row => row.registration.remove());
      rows.clear();
    },
  };
}

const bound = new WeakMap<ComponentType<PluginButtonContentProps>, Map<string, ComponentType<PluginButtonContentProps>>>();

/** A pill's popover opened for one chat from the ⋯ menu: the same component each time, so an open page keeps its state. */
export function popoverFor(Content: ComponentType<PluginButtonContentProps>, agentId: string, workspaceId: string): PluginButtonBehavior {
  const perChat = bound.get(Content) ?? new Map<string, ComponentType<PluginButtonContentProps>>();
  bound.set(Content, perChat);
  let Chat = perChat.get(agentId);
  if (!Chat) {
    Chat = props => <Content {...props} context="agent" workspaceId={workspaceId} agentId={agentId} />;
    perChat.set(agentId, Chat);
  }
  return { kind: "popover", Content: Chat };
}

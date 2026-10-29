import { settingsRpc } from "@getpaseo/plugin";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { AppState } from "react-native";
import { viewSettings } from "../shared/view";

export interface HeaderButtons {
  /** Shows or hides every workspace's button at once (Settings → Show header button). */
  setVisible(visible: boolean): void;
  stop(): void;
}

/**
 * An icon-only History button in every workspace header that opens the Past sessions panel in
 * the explorer sidebar, next to the chat. Header buttons are registered per workspace, so this
 * follows Paseo's workspace directory and adds or removes buttons as workspaces come and go.
 * Settings → Show header button hides them all (`visible: false`).
 */
export function startHeaderButtons(client: PluginClientContext, panelId: string): HeaderButtons {
  const buttons = new Map<string, PluginButtonRegistration>();
  let visible = true;

  const add = (workspaceId: string) => {
    if (buttons.has(workspaceId)) return;
    try {
      buttons.set(
        workspaceId,
        client.addHeaderButton({
          id: "past-sessions",
          workspaceId,
          button: {
            title: "Past sessions",
            icon: "History",
            visible,
            behavior: { kind: "action", onPress: () => client.openPanel(panelId, { workspaceId, location: "explorer" }) },
          },
        }),
      );
    } catch (error) {
      console.warn("[noice-past-sessions] header button failed", error);
    }
  };
  const remove = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  };
  const replace = (ids: ReadonlySet<string>) => {
    for (const id of [...buttons.keys()]) if (!ids.has(id)) remove(id);
    for (const id of ids) add(id);
  };
  const setVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    for (const registration of buttons.values()) registration.update({ visible });
  };

  const lifetime = new AbortController();
  const load = async () => {
    const first = await client.paseo.workspaces.list({ subscribe: {} });
    const ids = new Set(first.entries.map((workspace) => workspace.id));
    // The daemon pages at 200; follow the cursor so every workspace gets its button.
    let pageInfo = first.pageInfo;
    while (pageInfo.hasMore && pageInfo.nextCursor && !lifetime.signal.aborted) {
      const page = await client.paseo.workspaces.list({ page: { limit: 200, cursor: pageInfo.nextCursor } });
      for (const workspace of page.entries) ids.add(workspace.id);
      pageInfo = page.pageInfo;
    }
    if (lifetime.signal.aborted) {
      void first.subscription.release();
      return;
    }
    replace(ids);
    first.subscription.subscribe({
      snapshot: (snapshot) => replace(new Set(snapshot.entries.map((workspace) => workspace.id))),
      update: (message) => {
        if (message.type !== "workspace_update") return;
        const update = message.payload;
        if (update.kind === "upsert") add(update.workspace.id);
        else remove(update.id);
      },
    });
    lifetime.signal.addEventListener("abort", () => void first.subscription.release());
  };
  void load().catch((error: unknown) => {
    if (!lifetime.signal.aborted) console.warn("[noice-past-sessions] workspace subscription failed", error);
  });

  // Read at start and when the app comes back to the foreground (another device may have changed
  // it); this device's settings screen applies it on save. Unreadable settings keep the buttons.
  const readSetting = () =>
    client.rpc(settingsRpc(viewSettings.id).read, {}).then(
      (result) => {
        if (lifetime.signal.aborted) return;
        const parsed = result.status === "ready" ? viewSettings.schema.safeParse(result.values) : null;
        setVisible(parsed?.success ? parsed.data.showHeaderButton : true);
      },
      (error: unknown) => console.warn("[noice-past-sessions] reading settings failed", error),
    );
  void readSetting();
  const appState = AppState.addEventListener("change", (state) => state === "active" && void readSetting());

  return {
    setVisible,
    stop() {
      lifetime.abort();
      appState.remove();
      for (const id of [...buttons.keys()]) remove(id);
    },
  };
}

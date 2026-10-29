import type { PluginButtonRegistration, PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsInput, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { settingsRpc } from "@getpaseo/plugin";
import { useState } from "react";
import { AppState, Text, View } from "react-native";
import { linksForWorkspace } from "../shared/links";
import { DEFAULT_WEBSHARE_FOLDER, headerSettings, webshareSettings } from "../shared/settings";
import type { AgentListener, AgentSummary } from "./agents";
import { createLinksPage } from "./page";
import { keepWorkspaceSubagents, LinksStore, type WorkspaceLinks } from "./store";

export const PANEL_ID = "links";

/**
 * The workspace links page (a workspace panel, opened as a tab in the workspace's main area) and
 * an icon-only header button per workspace that opens it. Settings → **Show header button** turns
 * the buttons off and on at once, on every workspace; **Show composer pill** does the same for
 * `pills`. The settings screen also edits the webshare mapping (`WebshareSettings`).
 *
 * A workspace's links are fetched when its links page becomes visible; again when one of its agents
 * finishes a turn, is closed or renamed while the page is on screen, else on next show. Nothing
 * polls while idle, and the header button itself fetches nothing.
 */
export function startWorkspaceLinks(client: PluginClientContext, pills: { setVisible(visible: boolean): void }) {
  const store = new LinksStore<WorkspaceLinks>((workspaceId, subagents) => client.rpc(linksForWorkspace, { workspaceId, subagents }), keepWorkspaceSubagents);
  /** Visible links pages per workspace. */
  const onScreen = new Map<string, number>();
  /** Workspaces whose agents changed while nothing of theirs was on screen: refetch on next show. */
  const stale = new Set<string>();

  /** Marks a workspace on screen until the returned function runs; `refresh` fetches now (a page), else only when needed. */
  const show = (workspaceId: string, refresh: boolean) => {
    onScreen.set(workspaceId, (onScreen.get(workspaceId) ?? 0) + 1);
    if (stale.delete(workspaceId) || refresh || !store.get(workspaceId).data) void store.refresh(workspaceId);
    return () => {
      const left = (onScreen.get(workspaceId) ?? 1) - 1;
      if (left) onScreen.set(workspaceId, left);
      else onScreen.delete(workspaceId);
    };
  };
  const touch = (workspaceId: string) => {
    if (onScreen.has(workspaceId)) void store.refresh(workspaceId);
    else if (store.get(workspaceId).data) stale.add(workspaceId);
  };

  // Header buttons, one per workspace, following the daemon's workspace directory.
  const buttons = new Map<string, PluginButtonRegistration>();
  let visible = true;
  const add = (workspaceId: string) => {
    if (buttons.has(workspaceId)) return;
    try {
      const registration = client.addHeaderButton({
        id: "links",
        workspaceId,
        button: {
          title: "Links in this workspace",
          icon: "Link",
          visible,
          behavior: { kind: "action", onPress: () => client.openPanel(PANEL_ID, { workspaceId }) },
        },
      });
      buttons.set(workspaceId, registration);
    } catch (error) {
      console.warn("[noice-links-list] header button failed", error);
    }
  };
  const removeButton = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
    stale.delete(workspaceId);
    store.forget(workspaceId);
  };
  const setVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    for (const registration of buttons.values()) registration.update({ visible });
  };

  const lifetime = new AbortController();
  const followWorkspaces = async () => {
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
    const replace = (next: ReadonlySet<string>) => {
      for (const id of [...buttons.keys()]) if (!next.has(id)) removeButton(id);
      for (const id of next) add(id);
    };
    replace(ids);
    first.subscription.subscribe({
      snapshot: (snapshot) => replace(new Set(snapshot.entries.map((workspace) => workspace.id))),
      update: (message) => {
        if (message.type !== "workspace_update") return;
        const update = message.payload;
        if (update.kind === "upsert") add(update.workspace.id);
        else removeButton(update.id);
      },
    });
    lifetime.signal.addEventListener("abort", () => void first.subscription.release());
  };
  void followWorkspaces().catch((error: unknown) => {
    if (!lifetime.signal.aborted) console.warn("[noice-links-list] workspace subscription failed", error);
  });

  /** Applies Settings → Show header button and Show composer pill. */
  const apply = ({ showHeaderButton, showComposerPill }: { showHeaderButton: boolean; showComposerPill: boolean }) => {
    setVisible(showHeaderButton);
    pills.setVisible(showComposerPill);
  };
  // Read at start and when the app comes back to the foreground (another device may have changed
  // them); this device's settings screen applies them on save.
  const readSetting = () =>
    client.rpc(settingsRpc(headerSettings.id).read, {}).then(
      (result) => {
        const parsed = result.status === "ready" ? headerSettings.schema.safeParse(result.values) : null;
        apply(parsed?.success ? parsed.data : { showHeaderButton: true, showComposerPill: true });
      },
      (error: unknown) => console.warn("[noice-links-list] reading settings failed", error),
    );
  void readSetting();
  const appState = AppState.addEventListener("change", (state) => state === "active" && void readSetting());

  function ButtonsSettings({ theme }: PluginSurfaceProps) {
    const settings = useSettings(headerSettings);
    if (settings.status !== "ready") {
      return <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>{settings.status === "loading" ? "Loading…" : settings.error}</Text>;
    }
    const save = (values: Partial<typeof settings.values>) => {
      const next = { ...settings.values, ...values };
      void settings.save(next, settings.revision).then((ok) => ok && apply(next));
    };
    return (
      <SettingsSection title="Buttons">
        <SettingsSwitch
          label="Show header button"
          hint="The links button in each workspace's header; it opens that workspace's links as a tab."
          value={settings.values.showHeaderButton}
          disabled={settings.saving}
          onValueChange={(value) => save({ showHeaderButton: value })}
        />
        <SettingsSwitch
          label="Show composer pill"
          hint="The links pill in each chat's composer, which opens that chat's links."
          value={settings.values.showComposerPill}
          disabled={settings.saving}
          onValueChange={(value) => save({ showComposerPill: value })}
        />
      </SettingsSection>
    );
  }

  function SettingsScreen(props: PluginSurfaceProps) {
    return (
      <View style={{ gap: 16 }}>
        <ButtonsSettings {...props} />
        <WebshareSettings {...props} />
      </View>
    );
  }

  // Agents changing what a workspace's page shows: a finished turn, a closed or renamed tab.
  const agents = new Map<string, { workspaceId: string; status: string; closed: boolean; title: string | null }>();
  const observe = (agent: AgentSummary, initial: boolean) => {
    const before = agents.get(agent.id);
    if (!agent.workspaceId || agent.internal) {
      agents.delete(agent.id);
      return;
    }
    const now = { workspaceId: agent.workspaceId, status: agent.status, closed: !!agent.archivedAt, title: agent.title ?? null };
    agents.set(agent.id, now);
    if (initial || !before) return;
    const turnEnded = before.status === "running" && now.status !== "running";
    if (turnEnded || before.closed !== now.closed || before.title !== now.title) touch(now.workspaceId);
  };
  const agentListener: AgentListener = {
    replace(list) {
      for (const agent of list) observe(agent, true);
    },
    update: (agent) => observe(agent, false),
    remove(agentId) {
      const before = agents.get(agentId);
      agents.delete(agentId);
      if (before) touch(before.workspaceId);
    },
  };

  return {
    Page: createLinksPage(store, show),
    SettingsScreen,
    agents: agentListener,
    stop() {
      lifetime.abort();
      appState.remove();
      for (const id of [...buttons.keys()]) removeButton(id);
    },
  };
}

/** Webshare origin and folder, saved together; the server picks them up on its next fetch. */
function WebshareSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(webshareSettings);
  const [origin, setOrigin] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>{settings.status === "loading" ? "Loading…" : settings.error}</Text>;
  }
  const next = { ...settings.values, origin: (origin ?? settings.values.origin).trim(), folder: (folder ?? settings.values.folder).trim() };
  const changed = next.origin !== settings.values.origin || next.folder !== settings.values.folder;
  return (
    <SettingsSection
      title="Webshare"
      info="Files in the webshare folder become links on the webshare origin: they open in the browser instead of copying their path. Changes apply from the next fetch."
    >
      <SettingsInput
        label="Webshare origin"
        hint="e.g. http://myhost:8080; empty turns mapping off"
        initialValue={settings.values.origin}
        placeholder="http://localhost:8080"
        onChangeText={setOrigin}
      />
      <SettingsInput
        label="Webshare folder"
        hint={`The folder that origin serves; ~ is the daemon user's home. Empty means ${DEFAULT_WEBSHARE_FOLDER}`}
        initialValue={settings.values.folder}
        placeholder={DEFAULT_WEBSHARE_FOLDER}
        onChangeText={setFolder}
      />
      <SettingsAction
        label={changed ? "Unsaved changes" : "Saved"}
        actionLabel={settings.saving ? "Saving…" : "Save"}
        disabled={settings.saving || !changed}
        error={settings.saveError}
        onPress={() =>
          void settings.save(next, settings.revision).then((ok) => {
            if (!ok) return;
            setOrigin(null);
            setFolder(null);
          })
        }
      />
    </SettingsSection>
  );
}

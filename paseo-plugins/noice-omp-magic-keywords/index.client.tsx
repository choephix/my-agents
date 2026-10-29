import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createSettingsScreen } from "./client/settings";
import { isWeb, startKeywordShimmer } from "./client/web";
import { preferences, type Preferences } from "./shared/preferences";

// Paseo keeps rendering every message and the composer itself; the plugin only paints colours over
// the keywords it finds on screen, which needs the page's DOM (web and desktop).
export default function contribute(client: PluginClientContext) {
  if (!isWeb) return () => {};

  const settings = settingsRpc(preferences.id);
  // Nothing is coloured until the saved settings arrive.
  const engine = startKeywordShimmer();
  let disposed = false;
  let edits = 0;
  const apply = (values: Preferences) => {
    // The settings screen's effect can still run while the plugin is being torn down.
    if (disposed) return;
    edits += 1;
    engine.setPreferences(values);
  };
  const refresh = () => {
    const editsAtStart = edits;
    client.rpc(settings.read, {}).then((result) => {
      if (disposed || result.status !== "ready" || edits !== editsAtStart) return; // a save landed while this read was in flight
      const parsed = preferences.schema.safeParse(result.values);
      if (parsed.success) engine.setPreferences(parsed.data);
    }, (error: unknown) => console.error("[noice-omp-magic-keywords] settings read failed", error));
  };
  refresh();
  window.addEventListener("focus", refresh);

  const screen = client.addSettingsScreen({
    id: "keywords",
    title: "OMP magic keywords",
    icon: "Sparkles",
    Component: createSettingsScreen(apply),
  });
  const configure = client.addCommandCenterItem({
    id: "configure",
    title: "OMP magic keywords settings",
    icon: "Sparkles",
    keywords: ["ultrathink", "orchestrate", "workflowz", "jevify", "keyword", "shimmer"],
    context: "global",
    onSelect({ openSettings }) { openSettings("keywords"); },
  });

  // Agent → provider, so keywords are coloured only in chats whose agent acts on them.
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (!disposed && update.kind === "upsert") engine.agent(update.agent.id, update.agent.provider);
  });
  void (async () => {
    let cursor: string | undefined;
    do {
      const page = await client.paseo.agents.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      if (disposed) return;
      for (const { agent } of page.entries) engine.agent(agent.id, agent.provider);
      cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    } while (cursor);
  })().catch(() => { /* Agents missing from the directory fall back to the provider in React props, else every keyword. */ });

  return () => {
    disposed = true;
    unsubscribe();
    configure();
    screen();
    window.removeEventListener("focus", refresh);
    engine.dispose();
  };
}

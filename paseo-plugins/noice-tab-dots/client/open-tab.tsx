import { useEffect } from "react";
import { View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";

/** Screen id the row dots open; its params say which tab. */
export const OPEN_TAB_SCREEN = "open-tab";

/**
 * A blank screen that opens one agent tab and is replaced by it. Plugins can open a tab only
 * from a screen's `navigation`, so a dot click passes through here. Each click carries a nonce,
 * so it opens once even if the screen renders again.
 */
export function createOpenTabScreen() {
  const opened = new Set<string>();
  return function OpenTab({ params, navigation, theme }: PluginScreenProps) {
    const { agentId, serverId, nonce } = params;
    useEffect(() => {
      // Older hosts give no `navigation`: stay on the blank screen rather than fake history.
      if (!agentId || !nonce || !navigation) return;
      const key = `${serverId ?? ""}:${agentId}:${nonce}`;
      if (opened.has(key)) return;
      // Not during the commit that mounts this screen: the app's navigation ref is null then,
      // so a layout effect's request is dropped. One task later the ref is back.
      const timer = setTimeout(() => {
        if (opened.has(key)) return;
        opened.add(key);
        navigation.openAgent(serverId ? { agentId, serverId } : { agentId });
      }, 0);
      return () => clearTimeout(timer);
    }, [agentId, serverId, nonce, navigation]);
    return <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }} />;
  };
}

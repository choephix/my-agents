import { useEffect } from "react";
import { Platform, Text } from "react-native";
import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { interceptAgentLinks } from "./client/web";

/** DOM listeners have no navigation; this screen opens the tab through the host's. */
function OpenLink({ navigation, params, theme }: PluginScreenProps) {
  const { serverId, agentId } = params;
  useEffect(() => {
    if (agentId) navigation?.openAgent({ agentId, serverId });
  }, [navigation, serverId, agentId]);
  return (
    <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>
      {navigation ? "Opening the tab…" : "This Paseo client cannot open tabs from plugins."}
    </Text>
  );
}

export default function contribute(client: PluginClientContext) {
  if (Platform.OS !== "web") return () => {};
  const screen = client.addScreen({ id: "open", title: "Opening tab", Component: OpenLink });
  const stop = interceptAgentLinks(({ serverId, agentId }) =>
    client.openScreen({ screenId: "open", params: { serverId, agentId } }),
  );
  return () => {
    stop();
    screen();
  };
}

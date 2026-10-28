import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DeskScreen, DeskSidebarItem, SCREEN_ID } from "./client/screen";
import { setClient } from "./client/store";

export default function contribute(client: PluginClientContext) {
  setClient(client);
  const cleanups = [
    client.addScreen({ id: SCREEN_ID, title: "Vizier desk", Component: DeskScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Vizier desk", Component: DeskSidebarItem }),
    client.addCommandCenterItem({
      id: "open-desk",
      title: "Vizier desk",
      icon: "Inbox",
      keywords: ["desk", "asks", "vizier", "doing", "blocking"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: SCREEN_ID });
      },
    }),
  ];
  return () => {
    for (const cleanup of cleanups) void cleanup();
    setClient(null);
  };
}

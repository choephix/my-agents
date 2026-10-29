import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DeskScreen, DeskSidebarItem, SCREEN_ID } from "./client/screen";
import { setClient } from "./client/store";

export default function contribute(client: PluginClientContext) {
  setClient(client);
  const cleanups = [
    client.addScreen({ id: SCREEN_ID, title: "Nilometer", Component: DeskScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Nilometer", Component: DeskSidebarItem }),
    client.addCommandCenterItem({
      id: "open-nilometer",
      title: "Nilometer",
      icon: "Inbox",
      keywords: ["nilometer", "inbox", "doing", "priority", "memos"],
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

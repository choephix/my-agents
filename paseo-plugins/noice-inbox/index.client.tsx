import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createInbox } from "./client/inbox";
import { createInboxUi, createOpenScreen, OPEN_SCREEN } from "./client/ui";

export default function contribute(client: PluginClientContext) {
  const inbox = createInbox(client);
  const { SidebarItem } = createInboxUi(inbox);
  const removeScreen = client.addScreen({ id: OPEN_SCREEN, title: "Opening agent", Component: createOpenScreen() });
  const removeItem = client.addSidebarHeaderItem({ id: "notifications", title: "Notifications", Component: SidebarItem });
  return () => {
    removeItem();
    removeScreen();
    inbox.dispose();
  };
}

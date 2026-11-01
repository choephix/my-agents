import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings, type PluginPopoverProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, SidebarRow } from "@getpaseo/plugin/client/ui";
import { useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { settings } from "../shared/contracts";
import { BotForm } from "./form";
import type { Hub, Hubs } from "./hubs";

/** Paseo's blue for work in progress; there is no theme token for it. */
const RUNNING = "#60A5FA";

/** The bot opened last from the strip or menu: the plugin can't see which workspace is on screen. */
let current: string | null = null;
const currentListeners = new Set<() => void>();
const setCurrent = (agentId: string) => {
  current = agentId;
  for (const listener of currentListeners) listener();
};
const useCurrent = () => useSyncExternalStore(listener => { currentListeners.add(listener); return () => { currentListeners.delete(listener); }; }, () => current);

function Badge({ hub, theme }: { hub: Hub; theme: PluginTheme }) {
  const color = hub.running ? RUNNING : hub.unread ? theme.colors.statusSuccess : null;
  if (!color) return null;
  return <View style={{ position: "absolute", right: 1, bottom: 1, width: 7, height: 7, borderRadius: 4, backgroundColor: color, borderWidth: 1, borderColor: theme.colors.surface0 }} />;
}

const status = (hub: Hub) => [hub.running ? `${hub.running} running` : "", hub.unread ? `${hub.unread} new answer${hub.unread === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");

export function createStrip(hubs: Hubs, open: (agentId: string) => void) {
  const openHub = (agentId: string) => { setCurrent(agentId); open(agentId); };

  function NewBot({ theme, close }: PluginPopoverProps) {
    return <BotForm theme={theme} close={close} onCreated={openHub} />;
  }

  /** Phone: the list of bots plus New bot, in the drawer's sheet. */
  function BotsMenu({ theme, close }: PluginPopoverProps) {
    const list = hubs.use();
    const [creating, setCreating] = useState(false);
    if (creating) return <BotForm theme={theme} close={close} onCreated={openHub} />;
    const row = { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 };
    return (
      <View style={{ gap: 2 }}>
        {list.map(hub => (
          <Pressable key={hub.agentId} accessibilityRole="button" onPress={() => { close(); openHub(hub.agentId); }} style={row}>
            <View><Text style={{ fontSize: 22, color: theme.colors.foreground }}>{hub.emoji}</Text><Badge hub={hub} theme={theme} /></View>
            <View>
              <Text style={{ color: theme.colors.foreground, fontSize: 15 }}>{hub.name}</Text>
              {status(hub) ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{status(hub)}</Text> : null}
            </View>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={row}>
          <View style={{ width: 26, alignItems: "center" }}><Icon name="Plus" size={18} color={theme.colors.foregroundMuted} /></View>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 15 }}>New bot</Text>
        </Pressable>
      </View>
    );
  }

  function Tile({ hub, theme, active }: { hub: Hub; theme: PluginTheme; active: boolean }) {
    const [hover, setHover] = useState(false);
    const label = [hub.name, status(hub)].filter(Boolean).join(" · ");
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => openHub(hub.agentId)}
        onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        style={{ width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: active ? theme.colors.surface2 : "transparent" }}>
        <Text style={{ fontSize: 17, color: theme.colors.foreground, opacity: active || hover ? 1 : 0.55 }}>{hub.emoji}</Text>
        <Badge hub={hub} theme={theme} />
      </Pressable>
    );
  }

  /** Under Schedules: a strip of bot tiles on wide layouts, one Bots row on phones. */
  return function BotsStrip({ theme, layout, openPopover }: PluginSidebarItemProps) {
    const list = hubs.use();
    const active = useCurrent();
    const prefs = useSettings(settings);
    const showRobot = prefs.status !== "ready" || prefs.values.showRobot;
    if (layout.compact) {
      const running = list.reduce((sum, hub) => sum + hub.running, 0);
      return <SidebarRow icon="Bot" label="Bots" onPress={() => openPopover(BotsMenu)}
        trailing={running ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{running} running</Text> : undefined} />;
    }
    return (
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, paddingHorizontal: 12, paddingVertical: 4 }}>
        {showRobot ? <View accessibilityLabel="Bots" style={{ width: 22, alignItems: "center" }}><Icon name="Bot" size={15} color={theme.colors.foregroundMuted} /></View> : null}
        {list.map(hub => <Tile key={hub.agentId} hub={hub} theme={theme} active={hub.agentId === active} />)}
        <Pressable accessibilityRole="button" accessibilityLabel="New bot" onPress={() => openPopover(NewBot)}
          style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
          <Icon name="Plus" size={15} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
    );
  };
}

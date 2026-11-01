import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings, type PluginPopoverProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, View } from "react-native";
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

function Badge({ hub, theme, ring = theme.colors.surface0, size = 7 }: { hub: Hub; theme: PluginTheme; ring?: string; size?: number }) {
  const color = hub.running ? RUNNING : hub.unread ? theme.colors.statusSuccess : null;
  if (!color) return null;
  return <View pointerEvents="none" style={{ position: "absolute", right: 0, bottom: 0, width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 1.5, borderColor: ring }} />;
}

/** Strip geometry: tiles sit on the sidebar's 28 px row; the emoji keeps its 17 px. */
const TILE = 24;
const SCALE = 1.2;

const luma = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].reduce((sum, at, i) => sum + parseInt(hex.slice(at, at + 2), 16) * [0.3, 0.59, 0.11][i], 0) : null;
/**
 * The plugin theme has no sidebar colour. In Paseo's light theme the sidebar is surface2, in dark a
 * shade below surface0, so the darker of the two stands in for it (the badge ring's colour).
 */
const sidebarColor = ({ colors }: PluginTheme) => (luma(colors.surface2) ?? 0) < (luma(colors.surface0) ?? 0) ? colors.surface2 : colors.surface0;
/** The selected tile: surface2 is the sidebar itself in the light theme, so the border colour. */
const selectedColor = (theme: PluginTheme) => theme.colors.border;

/** Web only: CSS transitions on the emoji, fast in and a little slower out, both easing out. */
const ease = (ms: number) => ({ transitionProperty: "transform, opacity", transitionDuration: `${ms}ms`, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" });

/** `prefers-reduced-motion` (React Native Web reads the media query): end states without transitions. */
function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduce(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => { live = false; subscription.remove(); };
  }, []);
  return reduce;
}

/**
 * A ring only for keyboard focus. On web a click focuses the tile too; the browser's own
 * `:focus-visible` tells the two apart. Native has no such query: any focus there is the keyboard's.
 */
function useKeyboardFocus() {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    handlers: {
      onFocus: ({ nativeEvent }: { nativeEvent: unknown }) => {
        const target = nativeEvent && typeof nativeEvent === "object" && "target" in nativeEvent ? nativeEvent.target : null;
        const query = target && typeof target === "object" && "matches" in target && typeof target.matches === "function" ? target.matches.bind(target) : null;
        setFocused(query ? query(":focus-visible") === true : true);
      },
      onBlur: () => setFocused(false),
    },
  };
}

const focusRing = (theme: PluginTheme, focused: boolean) => focused ? { outlineWidth: 2, outlineStyle: "solid" as const, outlineColor: theme.colors.accent, outlineOffset: 0 } : null;

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

  function Tile({ hub, theme, active, motion }: { hub: Hub; theme: PluginTheme; active: boolean; motion: boolean }) {
    const [hover, setHover] = useState(false);
    const { focused, handlers } = useKeyboardFocus();
    const label = [hub.name, status(hub)].filter(Boolean).join(" · ");
    const lifted = active || hover;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => openHub(hub.agentId)} {...handlers}
        onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        style={{ width: TILE, height: TILE, borderRadius: 6, alignItems: "center", justifyContent: "center", zIndex: hover ? 2 : active ? 1 : 0,
          backgroundColor: active ? selectedColor(theme) : "transparent", ...focusRing(theme, focused) }}>
        {/* Scaled by transform, so the tile keeps its size; it doesn't catch the pointer, so its edge never flickers. */}
        <View pointerEvents="none" style={{ transform: [{ scale: lifted ? SCALE : 1 }], opacity: lifted ? 1 : 0.55,
          ...(motion && Platform.OS === "web" ? ease(hover ? 120 : 240) : null) }}>
          <Text style={{ fontSize: 17, color: theme.colors.foreground }}>{hub.emoji}</Text>
        </View>
        <Badge hub={hub} theme={theme} size={8} ring={active ? selectedColor(theme) : sidebarColor(theme)} />
      </Pressable>
    );
  }

  function NewBotButton({ theme, onPress }: { theme: PluginTheme; onPress(): void }) {
    const [hover, setHover] = useState(false);
    const { focused, handlers } = useKeyboardFocus();
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="New bot" onPress={onPress} {...handlers}
        onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        style={{ width: TILE, height: TILE, borderRadius: 6, alignItems: "center", justifyContent: "center", ...focusRing(theme, focused) }}>
        <Icon name="Plus" size={14} color={hover ? theme.colors.foreground : theme.colors.foregroundMuted} />
      </Pressable>
    );
  }

  /** Under Schedules: a strip of bot tiles on wide layouts, one Bots row on phones. */
  return function BotsStrip({ theme, layout, openPopover }: PluginSidebarItemProps) {
    const list = hubs.use();
    const active = useCurrent();
    const motion = !useReduceMotion();
    const prefs = useSettings(settings);
    const showRobot = prefs.status !== "ready" || prefs.values.showRobot;
    if (layout.compact) {
      const running = list.reduce((sum, hub) => sum + hub.running, 0);
      return <SidebarRow icon="Bot" label="Bots" onPress={() => openPopover(BotsMenu)}
        trailing={running ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{running} running</Text> : undefined} />;
    }
    // 28 px tall like the rows above; the robot centres on their icon column and the tiles start
    // where their labels do.
    return (
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 1, paddingHorizontal: 12, paddingVertical: 2 }}>
        {showRobot ? <View accessibilityLabel="Bots" style={{ width: 22, marginRight: 3, alignItems: "center" }}><Icon name="Bot" size={14} color={theme.colors.foregroundMuted} /></View> : null}
        {list.map(hub => <Tile key={hub.agentId} hub={hub} theme={theme} active={hub.agentId === active} motion={motion} />)}
        <NewBotButton theme={theme} onPress={() => openPopover(NewBot)} />
      </View>
    );
  };
}

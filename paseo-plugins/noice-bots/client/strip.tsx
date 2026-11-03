import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings, type PluginPopoverProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { settings } from "../shared/contracts";
import { BotForm } from "./form";
import type { Hub, Hubs } from "./hubs";
import { ReadingHost } from "./reading";

/** Paseo's blue for work in progress; there is no theme token for it. */
const RUNNING = "#60A5FA";

/**
 * Web: the workspace on screen comes from the URL (`…/workspace/<id>`), followed through the
 * Navigation API's `currententrychange` (fires on every in-app navigation; no polling), so leaving
 * a bot unselects its tile. Native has neither, so the bot opened last from the strip stands in
 * there.
 */
/** The slice of the browser's Navigation API used here; React Native's types don't declare it. */
interface BrowserNavigation extends EventTarget { readonly currentEntry: { readonly url: string | null } | null }
const web: object = Platform.OS === "web" ? globalThis : {};
// Checked to be an EventTarget; the DOM types that would describe the rest aren't loaded here.
const navigationApi = "navigation" in web && web.navigation instanceof EventTarget ? web.navigation as BrowserNavigation : undefined;
const workspaceInUrl = () => {
  const id = /\/workspace\/([^/?#]+)/.exec(navigationApi?.currentEntry?.url ?? "")?.[1];
  return id ? decodeURIComponent(id) : null;
};
const subscribeUrl = (listener: () => void) => {
  navigationApi?.addEventListener("currententrychange", listener);
  return () => navigationApi?.removeEventListener("currententrychange", listener);
};
let current: string | null = null;
const currentListeners = new Set<() => void>();
const setCurrent = (agentId: string) => {
  current = agentId;
  for (const listener of currentListeners) listener();
};
const subscribeCurrent = (listener: () => void) => { currentListeners.add(listener); return () => { currentListeners.delete(listener); }; };
/** Whether a hub's tile is the selected one. */
const useSelected: () => (hub: Hub) => boolean = navigationApi
  ? () => { const shown = useSyncExternalStore(subscribeUrl, workspaceInUrl); return hub => hub.workspaceId === shown; }
  : () => { const opened = useSyncExternalStore(subscribeCurrent, () => current); return hub => hub.agentId === opened; };

function Badge({ hub, theme, ring, size }: { hub: Hub; theme: PluginTheme; ring: string; size: number }) {
  const color = hub.running ? RUNNING : hub.unread ? theme.colors.statusSuccess : null;
  if (!color) return null;
  return <View pointerEvents="none" style={{ position: "absolute", right: 0, bottom: 0, width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 1.5, borderColor: ring }} />;
}

/**
 * Strip geometry: tiles sit on the sidebar's row (28 px wide, 36 px on phones); the emoji's line box
 * is the tile, in every state. On phones the robot sits on the rows' 18 px icon column and the
 * tiles start where their labels do.
 */
const WIDE = { row: 28, tile: 24, emoji: 17, badge: 8, plus: 14, pad: 12, robot: 14, robotGap: 3 };
const PHONE = { row: 36, tile: 32, emoji: 22, badge: 9, plus: 18, pad: 14, robot: 18, robotGap: 6 };
type Geometry = typeof WIDE;

const luma = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].reduce((sum, at, i) => sum + parseInt(hex.slice(at, at + 2), 16) * [0.3, 0.59, 0.11][i], 0) : null;
/**
 * The plugin theme has no sidebar colour. In Paseo's light theme the sidebar is surface2, in dark a
 * shade below surface0, so the darker of the two stands in for it (the badge ring's colour).
 */
const sidebarColor = ({ colors }: PluginTheme) => (luma(colors.surface2) ?? 0) < (luma(colors.surface0) ?? 0) ? colors.surface2 : colors.surface0;
/** The selected tile: surface2 is the sidebar itself in the light theme, so the border colour. */
const selectedColor = (theme: PluginTheme) => theme.colors.border;

/** Web only: a CSS transition on the emoji's opacity, fast in and a little slower out, both easing out. */
const ease = (ms: number) => ({ transitionProperty: "opacity", transitionDuration: `${ms}ms`, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" });

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

type OpenScreen = PluginSidebarItemProps["openScreen"];

export function createStrip(hubs: Hubs, wake: (id: string) => Promise<void>) {
  /** Through the item's (or its popover's) openScreen, which closes the phone drawer first. */
  const openHub = (openScreen: OpenScreen, agentId: string) => {
    setCurrent(agentId);
    openScreen({ screenId: "open", params: { agentId, nonce: String(Date.now()) } });
  };

  function NewBot({ theme, close, openScreen }: PluginPopoverProps) {
    return <BotForm theme={theme} close={close} onCreated={agentId => openHub(openScreen, agentId)} />;
  }

  function Tile({ hub, theme, active, motion, size, onPress }: { hub: Hub; theme: PluginTheme; active: boolean; motion: boolean; size: Geometry; onPress(): void }) {
    const [hover, setHover] = useState(false);
    const { focused, handlers } = useKeyboardFocus();
    const label = [hub.name, status(hub)].filter(Boolean).join(" · ");
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} {...handlers}
        onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        style={{ width: size.tile, height: size.tile, borderRadius: 6, alignItems: "center", justifyContent: "center",
          backgroundColor: active ? selectedColor(theme) : "transparent", ...focusRing(theme, focused) }}>
        {/* Hover and selection change colour only: the emoji's box is the tile's, whatever the font's metrics. */}
        <Text style={{ width: size.tile, height: size.tile, lineHeight: size.tile, fontSize: size.emoji, textAlign: "center", color: theme.colors.foreground,
          opacity: active || hover ? 1 : 0.55, ...(motion && Platform.OS === "web" ? ease(hover ? 120 : 240) : null) }}>{hub.emoji}</Text>
        <Badge hub={hub} theme={theme} size={size.badge} ring={active ? selectedColor(theme) : sidebarColor(theme)} />
      </Pressable>
    );
  }

  function NewBotButton({ theme, size, onPress }: { theme: PluginTheme; size: Geometry; onPress(): void }) {
    const [hover, setHover] = useState(false);
    const { focused, handlers } = useKeyboardFocus();
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="New bot" onPress={onPress} {...handlers}
        onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
        style={{ width: size.tile, height: size.tile, borderRadius: 6, alignItems: "center", justifyContent: "center", marginLeft: "auto", ...focusRing(theme, focused) }}>
        <Icon name="Plus" size={size.plus} color={hover ? theme.colors.foreground : theme.colors.foregroundMuted} />
      </Pressable>
    );
  }

  /**
   * Under Schedules: a strip of bot tiles. Wide layouts wrap it; phones scroll it sideways, with
   * scrolling on only while the tiles overflow, so a swipe over a strip that fits still closes the
   * drawer (Android: the strip's own scroll wins once it starts).
   */
  function StripRow({ theme, layout, openScreen, openPopover }: PluginSidebarItemProps) {
    const list = hubs.use();
    const selected = useSelected();
    const motion = !useReduceMotion();
    const prefs = useSettings(settings);
    const [width, setWidth] = useState(0);
    const [content, setContent] = useState(0);
    const showRobot = prefs.status !== "ready" || prefs.values.showRobot;
    const size = layout.compact ? PHONE : WIDE;
    // Nothing but the row until the robot setting and the bots are known, so nothing shifts in.
    const settled = prefs.status !== "loading" && hubs.loaded();
    if (!settled) return <View style={{ height: size.row }} />;
    // The robot centres on the rows' icon column and the tiles start where their labels do.
    const robot = showRobot
      ? <View accessibilityLabel="Bots" style={{ width: 22, marginRight: size.robotGap, alignItems: "center" }}><Icon name="Bot" size={size.robot} color={theme.colors.foregroundMuted} /></View>
      : null;
    const tiles = <>
      {list.map(hub => <Tile key={hub.agentId} hub={hub} theme={theme} active={selected(hub)} motion={motion} size={size} onPress={() => void hubs.restore(hub)
        .catch(error => console.error(`noice-bots: restoring ${hub.name}'s hub failed`, error))
        .then(() => openHub(openScreen, hub.agentId))} />)}
      <NewBotButton theme={theme} size={size} onPress={() => openPopover(NewBot)} />
    </>;
    if (!layout.compact) {
      return (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 1, paddingHorizontal: size.pad, paddingVertical: (size.row - size.tile) / 2 }}>
          {robot}{tiles}
        </View>
      );
    }
    return (
      <View style={{ flexDirection: "row", alignItems: "center", height: size.row, paddingLeft: size.pad }}>
        {robot}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={content > width + 0.5} style={{ flex: 1 }}
          onLayout={event => setWidth(event.nativeEvent.layout.width)} onContentSizeChange={contentWidth => setContent(contentWidth)}
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", gap: 1, paddingRight: size.pad }}>
          {tiles}
        </ScrollView>
      </View>
    );
  }

  /** The strip also hosts the 🌙 modal (`reading.tsx`): it is mounted wherever the sidebar is. */
  return function BotsStrip(props: PluginSidebarItemProps) {
    return <><ReadingHost theme={props.theme} compact={props.layout.compact} wake={wake} /><StripRow {...props} /></>;
  };
}

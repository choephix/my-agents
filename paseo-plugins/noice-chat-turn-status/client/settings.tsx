import { Children, type ReactNode, useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import {
  LIVE_NAMES, LIVE_STYLES, type Preferences, preferences, SPINNER_NAMES, SPINNERS, TIME_NAMES, TIME_STYLES,
} from "../shared/preferences";
import {
  type DemoColors, type El, mountFooterDemo, mountLiveDemo, mountSpinnerDemo, mountTimeDemo, retainCatalogStyle,
} from "./web";

type Theme = PluginSurfaceProps["theme"];

/** An empty span the web renderer creates; `mount` fills it with live DOM and returns its cleanup. */
function Live({ mount, deps }: { mount: (host: El) => () => void; deps: readonly unknown[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // The plugin is compiled without the DOM library; on web the ref is a real element.
    const host = ref.current as unknown as El | null;
    return host ? mount(host) : undefined;
    // `deps` is the caller's dependency list; `mount` closes over the same values.
  }, deps);
  return <span ref={ref} />;
}

function Grid({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5 }}>
      {Children.map(children, (child) => <View style={{ width: `${100 / columns}%`, padding: 5 }}>{child}</View>)}
    </View>
  );
}

function Tile({ theme, label, selected, onPress, height, children }: {
  theme: Theme; label: string; selected: boolean; onPress(): void; height: number; children: ReactNode;
}) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.surface2 : colors.surface1,
        paddingTop: 14,
        paddingBottom: 10,
        paddingHorizontal: 8,
        alignItems: "center",
        gap: 8,
        overflow: "hidden",
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ height, maxWidth: "100%", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>{children}</View>
      <Text numberOfLines={1} style={{ fontSize: 12, color: selected ? colors.foreground : colors.foregroundMuted, fontWeight: selected ? "600" : "400" }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A slice of a chat turn: two faint lines of reply, then the footer exactly as configured. */
function Preview({ theme, values, demo }: { theme: Theme; values: Preferences; demo: DemoColors }) {
  const { colors } = theme;
  const line = (width: `${number}%`) => (
    <View style={{ height: 7, width, borderRadius: 4, backgroundColor: colors.foregroundMuted, opacity: 0.16 }} />
  );
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, padding: 18, gap: 10 }}>
      {line("82%")}
      {line("56%")}
      <View style={{ marginTop: 6, minHeight: 24, justifyContent: "center" }}>
        <Live deps={[values.spinner, values.live, values.time, demo.fg, demo.muted]} mount={(host) => mountFooterDemo(host, values, demo)} />
      </View>
    </View>
  );
}

export function createSettingsScreen(apply: (values: Preferences) => void) {
  return function WorkingIndicatorSettings({ theme, layout }: PluginSurfaceProps) {
    const settings = useSettings(preferences);
    const values = settings.status === "ready" ? settings.values : null;
    useEffect(() => retainCatalogStyle(), []);
    useEffect(() => { if (values) apply(values); }, [values]);

    if (settings.status === "loading") {
      return <SettingsSection title="Working indicator"><SettingsCard><SettingsRow label="Loading…" /></SettingsCard></SettingsSection>;
    }
    if (settings.status === "error") {
      return <SettingsSection title="Working indicator"><SettingsCard>
        <SettingsAction label="Unable to load settings" hint={settings.error} actionLabel="Retry" onPress={settings.reload} />
      </SettingsCard></SettingsSection>;
    }
    if (settings.status === "invalid") {
      return <SettingsSection title="Working indicator"><SettingsCard>
        <SettingsAction label="Saved settings are unreadable" hint="Reset restores the defaults" actionLabel="Reset"
          disabled={settings.saving} onPress={settings.reset} />
      </SettingsCard></SettingsSection>;
    }

    const current = settings.values;
    const pick = (patch: Partial<Preferences>) => void settings.save({ ...current, ...patch }, settings.revision);
    const { colors } = theme;
    const fgRgb = colors.foreground.match(/\d+/g)?.map(Number) ?? [];
    const demo: DemoColors = {
      fg: colors.foreground,
      muted: colors.foregroundMuted,
      bg: colors.surface1,
      light: fgRgb.length >= 3 ? 0.2126 * fgRgb[0]! + 0.7152 * fgRgb[1]! + 0.0722 * fgRgb[2]! < 128 : false,
    };
    const narrow = layout.compact;

    return (
      <View style={{ gap: 8 }}>
        <SettingsSection title="Preview">
          <Preview theme={theme} values={current} demo={demo} />
        </SettingsSection>

        <SettingsSection title="Spinner">
          <Grid columns={narrow ? 3 : 4}>
            {SPINNERS.map((id) => (
              <Tile key={id} theme={theme} label={SPINNER_NAMES[id]} selected={current.spinner === id} height={30} onPress={() => pick({ spinner: id })}>
                <Live deps={[id, demo.fg, demo.bg]} mount={(host) => mountSpinnerDemo(host, id, demo, 22)} />
              </Tile>
            ))}
          </Grid>
        </SettingsSection>

        <SettingsSection title="Live activity">
          <Grid columns={narrow ? 2 : 3}>
            {LIVE_STYLES.map((style) => (
              <Tile key={style} theme={theme} label={LIVE_NAMES[style]} selected={current.live === style} height={22} onPress={() => pick({ live: style })}>
                <Live deps={[style, demo.fg, demo.muted]} mount={(host) => mountLiveDemo(host, style, demo, 12)} />
              </Tile>
            ))}
          </Grid>
        </SettingsSection>

        <SettingsSection title="Elapsed time">
          <Grid columns={narrow ? 3 : 5}>
            {TIME_STYLES.map((style) => (
              <Tile key={style} theme={theme} label={TIME_NAMES[style]} selected={current.time === style} height={22} onPress={() => pick({ time: style })}>
                <Live deps={[style, demo.fg, demo.muted]} mount={(host) => mountTimeDemo(host, style, demo, 13)} />
              </Tile>
            ))}
          </Grid>
        </SettingsSection>
      </View>
    );
  };
}

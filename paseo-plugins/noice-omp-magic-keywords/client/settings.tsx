import { useEffect } from "react";
import { Text, View } from "react-native";
import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { type Preferences, preferences, SCOPE_NAMES, SCOPES, STYLE_NAMES, STYLES } from "../shared/preferences";
import { keywordColor, type Tone } from "./color";
import { MAGIC_KEYWORDS } from "./keywords";

type Theme = PluginSurfaceProps["theme"];

const TITLE = "OMP magic keywords";
const STYLE_OPTIONS = STYLES.map((value) => ({ value, label: STYLE_NAMES[value] }));
const SCOPE_OPTIONS = SCOPES.map((value) => ({ value, label: SCOPE_NAMES[value] }));

/** The four words with OMP's hue sweep frozen in place, colored as still mode colors them in the chat. */
function Preview({ theme }: { theme: Theme }) {
  const { colors } = theme;
  // Theme colors arrive as `#rrggbb` or `rgb(r, g, b)`. A dark foreground means a light background,
  // which needs the darker tone.
  const hex = /^#([0-9a-f]{6})$/i.exec(colors.foreground.trim())?.[1];
  const rgb = hex ? [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) : colors.foreground.match(/\d+/g)?.map(Number) ?? [];
  const tone: Tone = rgb.length >= 3 && 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]! < 128 ? "light" : "dark";
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, padding: 18 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 8 }}>
        {MAGIC_KEYWORDS.map(({ word, hue: [from, to] }) => (
          <Text key={word} accessibilityLabel={word} style={{ fontSize: 16, fontWeight: "600" }}>
            {[...word].map((char, i, chars) => {
              const hue = (from + ((to - from) * i) / chars.length) % 360;
              return <Text key={i} style={{ color: keywordColor(hue, tone) }}>{char}</Text>;
            })}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function createSettingsScreen(apply: (values: Preferences) => void) {
  return function MagicKeywordsSettings({ theme }: PluginSurfaceProps) {
    const settings = useSettings(preferences);
    const values = settings.status === "ready" ? settings.values : null;
    useEffect(() => { if (values) apply(values); }, [values]);

    if (settings.status === "loading") {
      return <SettingsSection title={TITLE}><SettingsCard><SettingsRow label="Loading…" /></SettingsCard></SettingsSection>;
    }
    if (settings.status === "error") {
      return <SettingsSection title={TITLE}><SettingsCard>
        <SettingsAction label="Unable to load settings" hint={settings.error} actionLabel="Retry" onPress={settings.reload} />
      </SettingsCard></SettingsSection>;
    }
    if (settings.status === "invalid") {
      return <SettingsSection title={TITLE}><SettingsCard>
        <SettingsAction label="Saved settings are unreadable" hint="Reset restores the defaults" actionLabel="Reset"
          disabled={settings.saving} onPress={settings.reset} />
      </SettingsCard></SettingsSection>;
    }

    const current = settings.values;
    const pick = (patch: Partial<Preferences>) => void settings.save({ ...current, ...patch }, settings.revision);

    return (
      <View style={{ gap: 8 }}>
        <SettingsSection
          title={TITLE}
          info="The four words change how an OMP agent works on your message; Claude Code also honors ultrathink."
        >
          <SettingsCard>
            <SettingsSelect
              testID="noice-omp-magic-keywords-sent"
              label="Sent messages"
              hint="Also the chat outline's hover preview"
              value={current.sent}
              options={STYLE_OPTIONS}
              disabled={settings.saving}
              onValueChange={(sent) => pick({ sent })}
            />
            <SettingsSelect
              testID="noice-omp-magic-keywords-composer"
              label="While typing"
              value={current.composer}
              options={STYLE_OPTIONS}
              disabled={settings.saving}
              onValueChange={(composer) => pick({ composer })}
            />
            <SettingsSelect
              testID="noice-omp-magic-keywords-scope"
              label="Which chats"
              hint="Claude Code chats: ultrathink only"
              value={current.scope}
              options={SCOPE_OPTIONS}
              disabled={settings.saving}
              onValueChange={(scope) => pick({ scope })}
            />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="Preview">
          <Preview theme={theme} />
        </SettingsSection>
      </View>
    );
  };
}

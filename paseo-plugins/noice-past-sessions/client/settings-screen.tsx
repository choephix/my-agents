import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { ComponentType } from "react";
import { Text } from "react-native";
import { viewSettings } from "../shared/view";

/** Settings → Plugins → noice-past-sessions; `applyHeaderButton` shows or hides the header buttons once saved. */
export function createSettingsScreen(applyHeaderButton: (visible: boolean) => void): ComponentType<PluginSurfaceProps> {
  return function SettingsScreen({ theme }: PluginSurfaceProps) {
    const settings = useSettings(viewSettings);
    if (settings.status !== "ready") {
      return <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>{settings.status === "loading" ? "Loading…" : settings.error}</Text>;
    }
    return (
      <SettingsSection title="Buttons">
        <SettingsSwitch
          label="Show header button"
          hint="The History button in each workspace's header; it opens Past sessions in the explorer sidebar. The sidebar row and the Command Center entry stay either way."
          value={settings.values.showHeaderButton}
          disabled={settings.saving}
          onValueChange={(value) =>
            // The whole object: a missing field would fall back to its default.
            void settings.save({ ...settings.values, showHeaderButton: value }, settings.revision).then((ok) => ok && applyHeaderButton(value))
          }
        />
      </SettingsSection>
    );
  };
}

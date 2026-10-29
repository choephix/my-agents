import { Text } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { preferences } from "../shared/preferences";

export function ContextSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const style = { color: theme.colors.foreground };
  if (settings.status === "loading") return <Text style={style}>Loading settings…</Text>;
  if (settings.status !== "ready") return <SettingsSection title="Side agent">
    <Text accessibilityRole="alert" style={style}>{settings.error}</Text>
    <SettingsAction label="Reload settings" actionLabel="Reload" onPress={settings.reload} />
    {settings.status === "invalid" ? <SettingsAction label="Restore fork default" actionLabel="Reset" onPress={settings.reset} /> : null}
  </SettingsSection>;
  return <SettingsSection title="Side agent">
    <SettingsCard>
      <SettingsSelect label="Default mode" value={settings.values.defaultMode}
        options={[{ label: "Fork — curated chat history", value: "fork" }, { label: "Full — complete OMP memory", value: "full" }]}
        disabled={settings.saving}
        onValueChange={defaultMode => { void settings.save({ defaultMode }, settings.revision); }} />
    </SettingsCard>
    <Text style={style}>Fork is cheaper: newest curated chat history, up to 100,000 characters, without tool outputs. Full copies OMP memory and artifacts through the last completed turn; the parent's current unfinished turn is excluded. Override with /side --fork or /side --full.</Text>
    {settings.saveError ? <Text accessibilityRole="alert" style={style}>{settings.saveError}</Text> : null}
  </SettingsSection>;
}

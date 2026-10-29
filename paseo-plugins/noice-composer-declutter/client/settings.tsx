import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { preferences, type Preferences } from "../shared/preferences";

// Sanctioned web global; absent or platform-less on React Native.
declare const navigator: { platform?: string } | undefined;
const platform = typeof navigator === "undefined" ? "" : navigator?.platform ?? "";
const apple = Platform.OS === "ios" || /Mac|iPhone|iPad/.test(platform);
const dictationKeys = apple ? "⌘D" : "Ctrl+D";
const voiceKeys = apple ? "⌘⇧D" : "Ctrl+Shift+D";

const CONTROLS: ReadonlyArray<{ key: keyof Preferences; label: string; hint: string }> = [
  { key: "hideThinking", label: "Thinking effort", hint: "Still in the command center: Thinking" },
  { key: "hideMode", label: "Access mode", hint: "Still in the command center: Mode; Shift+Tab cycles it" },
  { key: "hideFastMode", label: "Fast mode", hint: "Still in the command center: Fast" },
  { key: "hideOtherFeatures", label: "Other provider toggles", hint: "Such as plan mode; only plan mode is in the command center" },
  { key: "hideDictation", label: "Dictation", hint: `Only while idle; ${dictationKeys} still starts it` },
  { key: "hideVoice", label: "Voice mode", hint: `Only while idle; ${voiceKeys} still starts it` },
];

const INFO =
  "Hidden controls keep working through the command center and shortcuts. Applies to the web " +
  "and desktop apps; other open windows catch up when they regain focus.";

export function createSettingsScreen(apply: (values: Preferences) => void) {
  return function ComposerControlsSettings() {
    const settings = useSettings(preferences);
    const [lastToggled, setLastToggled] = useState<keyof Preferences | null>(null);
    const values = settings.status === "ready" ? settings.values : null;
    useEffect(() => { if (values) apply(values); }, [values]);

    let body;
    if (settings.status === "loading") {
      body = <SettingsRow label="Loading..." />;
    } else if (settings.status === "error") {
      body = <SettingsAction label="Unable to load settings" hint={settings.error} actionLabel="Retry" onPress={settings.reload} />;
    } else if (settings.status === "invalid") {
      body = <SettingsAction
        label="Saved settings are unreadable"
        hint="Reset shows every control again"
        actionLabel="Reset"
        disabled={settings.saving}
        onPress={settings.reset}
      />;
    } else {
      body = CONTROLS.map(({ key, label, hint }) => <SettingsSwitch
        key={key}
        label={label}
        hint={hint}
        error={key === lastToggled ? settings.saveError : null}
        value={settings.values[key]}
        disabled={settings.saving}
        onValueChange={(value) => {
          setLastToggled(key);
          void settings.save({ ...settings.values, [key]: value }, settings.revision);
        }}
      />);
    }
    return <SettingsSection title="Hide in the prompt bar" info={INFO}>
      <SettingsCard>{body}</SettingsCard>
    </SettingsSection>;
  };
}

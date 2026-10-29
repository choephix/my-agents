import { useEffect, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { preferences, type Preferences, type TweakId } from "../shared/preferences";

export const SWITCHES: ReadonlyArray<{ id: TweakId; label: string; hint: string }> = [
  { id: "compactSidebar", label: "Compact sidebar rows", hint: "Rows 28px instead of 36px, headers 32px; windows 720px and wider" },
  { id: "fileWrap", label: "Wrap long lines in the file pane", hint: "Files opened in a pane wrap instead of scrolling sideways" },
  { id: "linkColours", label: "Link colours by kind", hint: "Agent, web and file links in chat each get their own colour" },
];

const INFO =
  "Each switch applies at once in the web and desktop apps; other open windows follow within a " +
  "moment. The phone app is not affected.";

export function createSettingsScreen(apply: (values: Preferences) => void) {
  return function TweaksSettings() {
    const settings = useSettings(preferences);
    const [lastToggled, setLastToggled] = useState<TweakId | null>(null);
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
        hint="Reset turns every tweak back on"
        actionLabel="Reset"
        disabled={settings.saving}
        onPress={settings.reset}
      />;
    } else {
      body = SWITCHES.map(({ id, label, hint }) => <SettingsSwitch
        key={id}
        label={label}
        hint={hint}
        error={id === lastToggled ? settings.saveError : null}
        value={settings.values[id]}
        disabled={settings.saving}
        onValueChange={(value) => {
          setLastToggled(id);
          void settings.save({ ...settings.values, [id]: value }, settings.revision);
        }}
      />);
    }
    return <SettingsSection title="Tweaks" info={INFO}>
      <SettingsCard>{body}</SettingsCard>
    </SettingsSection>;
  };
}

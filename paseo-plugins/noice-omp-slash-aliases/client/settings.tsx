import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { preferences, type Preferences } from "../shared/preferences";

const TITLE = "OMP slash commands";

/** `onSaved` gets the stored values, so this client's `/` menu follows at once. */
export function createSettingsScreen(onSaved: (values: Preferences) => void) {
  return function SlashAliasSettings() {
    const settings = useSettings(preferences);
    if (settings.status === "loading") return <SettingsSection title={TITLE}><SettingsCard><SettingsRow label="Loading…" /></SettingsCard></SettingsSection>;
    if (settings.status === "error") {
      return <SettingsSection title={TITLE}><SettingsCard>
        <SettingsAction label="Unable to load settings" hint={settings.error} actionLabel="Retry" onPress={settings.reload} />
      </SettingsCard></SettingsSection>;
    }
    if (settings.status === "invalid") {
      return <SettingsSection title={TITLE}><SettingsCard>
        <SettingsAction label="Saved settings are unreadable" hint="Reset restores the defaults" actionLabel="Reset" disabled={settings.saving} onPress={settings.reset} />
      </SettingsCard></SettingsSection>;
    }
    const save = (change: Partial<Preferences>) => {
      const values = { ...settings.values, ...change };
      void settings.save(values, settings.revision).then(saved => saved && onSaved(values));
    };
    return <SettingsSection title={TITLE} info="/omfg, /queue and /btw are always on.">
      <SettingsCard>
        <SettingsSwitch label="/tan command" hint="Offers /tan and runs OMP's background tangent without interrupting the reply. Off: /tan is not in the / menu; typed anyway, OMP still starts the tangent but a running reply is cut off. Earlier /tan rows show either way."
          value={settings.values.tan} disabled={settings.saving} error={settings.saveError}
          onValueChange={tan => save({ tan })} />
      </SettingsCard>
    </SettingsSection>;
  };
}

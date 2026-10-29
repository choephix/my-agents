import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { preferences } from "../shared/preferences";

export function NilometerSettings() {
  const settings = useSettings(preferences);
  if (settings.status !== "ready") return <SettingsSection title="Nilometer"><SettingsCard><SettingsInput label="Mainframe token" hint="Loading…" initialValue="" disabled onChangeText={() => {}} /></SettingsCard></SettingsSection>;
  return <SettingsSection title="Nilometer" info="Paste the token from the Mainframe token file. It is required for settling, answering and starring memos."><SettingsCard><SettingsInput label="Mainframe token" hint="Stored per Paseo host; reads stay open without it." initialValue={settings.values.token} secureTextEntry onChangeText={(token) => void settings.save({ token }, settings.revision)} /></SettingsCard></SettingsSection>;
}

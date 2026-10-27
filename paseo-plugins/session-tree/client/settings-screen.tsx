import type { ComponentType } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { displaySettings } from "../shared/settings";

/** Which branch actions show. `onSaved` refreshes this client's chat list, which carries the settings. */
export function createSettingsScreen(onSaved: () => void): ComponentType<PluginSurfaceProps> {
  return function SettingsScreen({ theme }: PluginSurfaceProps) {
    const settings = useSettings(displaySettings);
    if (settings.status !== "ready") {
      return <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>{settings.status === "loading" ? "Loading…" : settings.error}</Text>;
    }
    const { showComposerPill, showMessageButtons, contextMenu, summarizeOnBack } = settings.values;
    /** Saves the whole object (a missing field would fall back to its default), then refreshes the chats. */
    const save = (values: Partial<typeof settings.values>) =>
      settings.save({ ...settings.values, ...values }, settings.revision).then(ok => {
        if (ok) onSaved();
        return ok;
      });
    return (
      <View style={{ gap: 16 }}>
        <SettingsSection title="Branch actions" info="/tree opens the branch list in any OMP chat, whatever is switched off here.">
          <SettingsSwitch
            label="Show composer pill"
            hint="The Tree pill above each OMP chat's composer. Off, it shows only while the branch list that /tree opened is up (and, in the phone apps, for a moment to show a toast)."
            value={showComposerPill}
            disabled={settings.saving}
            onValueChange={value => void save({ showComposerPill: value })}
          />
          <SettingsSwitch
            label="Show branch buttons on messages"
            hint="Continue from here (reply footers) and Re-ask from here (your messages). Web and desktop."
            value={showMessageButtons}
            disabled={settings.saving}
            onValueChange={value => void save({ showMessageButtons: value })}
          />
          <SettingsSwitch
            label="Branch menu on right-click"
            hint="Off leaves the browser's own menu on messages. Web and desktop."
            value={contextMenu}
            disabled={settings.saving}
            onValueChange={value => void save({ contextMenu: value })}
          />
          <SettingsSwitch
            label="Summarize when going back"
            hint="Continue from here, Re-ask and switching branches put a summary of what you leave at the branch point, like OMP's /tree with Summarize. Takes one model call. Off, the chat moves at once and offers Summarize them afterwards."
            value={summarizeOnBack}
            disabled={settings.saving}
            onValueChange={value => void save({ summarizeOnBack: value })}
          />
        </SettingsSection>
      </View>
    );
  };
}

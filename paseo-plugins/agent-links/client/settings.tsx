import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { settings } from "../shared/settings";

/** Settings → Plugins → Agent links. `apply` turns previews on or off in this app at once. */
export function createSettingsScreen(apply: (previews: boolean) => void) {
  return function AgentLinksSettings() {
    const state = useSettings(settings);
    const ready = state.status === "ready";
    useEffect(() => {
      if (state.status === "ready") apply(state.values.previews);
    }, [state]);
    return (
      <SettingsSection title="Agent links" info="Links to Paseo chat tabs open the tab in this window on web and desktop.">
        <SettingsCard>
          <SettingsSwitch
            label="Preview linked chats"
            hint="A chat link on a line of its own shows the latest messages of that chat. Off: links look as usual."
            value={ready ? state.values.previews : false}
            disabled={!ready || state.saving}
            onValueChange={value => {
              if (state.status !== "ready") return;
              apply(value);
              void state.save({ previews: value }, state.revision);
            }}
          />
        </SettingsCard>
      </SettingsSection>
    );
  };
}

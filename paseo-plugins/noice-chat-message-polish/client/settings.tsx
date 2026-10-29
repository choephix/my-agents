import { useEffect, useRef } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSwitch, type SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import { DEFAULTS, preferences, type Preferences } from "../shared/preferences";

const INFO =
  "Your own sent messages in the web and desktop apps. Copy and rewind always use the original " +
  "text. Phone apps are unchanged.";
const SAVE_DELAY_MS = 600;

export function createSettingsScreen(apply: (values: Preferences) => void) {
  return function PolishSettings() {
    const settings = useSettings(preferences);
    const values = settings.status === "ready" ? settings.values : null;
    const always = useRef<SettingsInputHandle>(null);
    const never = useRef<SettingsInputHandle>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => { if (values) apply(values); }, [values]);
    useEffect(() => () => clearTimeout(timer.current), []);

    if (settings.status === "loading") return <SettingsSection title="My messages"><SettingsCard><SettingsRow label="Loading…" /></SettingsCard></SettingsSection>;
    if (settings.status === "error") {
      return <SettingsSection title="My messages"><SettingsCard>
        <SettingsAction label="Unable to load settings" hint={settings.error} actionLabel="Retry" onPress={settings.reload} />
      </SettingsCard></SettingsSection>;
    }
    if (settings.status === "invalid") {
      return <SettingsSection title="My messages"><SettingsCard>
        <SettingsAction label="Saved settings are unreadable" hint="Reset restores the defaults" actionLabel="Reset" disabled={settings.saving} onPress={settings.reset} />
      </SettingsCard></SettingsSection>;
    }
    const current = settings.values;
    const save = (next: Preferences) => void settings.save(next, settings.revision);
    const saveLater = (key: "alwaysFold" | "neverFold", text: string) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => save({ ...current, [key]: text }), SAVE_DELAY_MS);
    };
    const resetLists = () => {
      always.current?.replaceText(DEFAULTS.alwaysFold);
      never.current?.replaceText(DEFAULTS.neverFold);
      clearTimeout(timer.current);
      save({ ...current, alwaysFold: DEFAULTS.alwaysFold, neverFold: DEFAULTS.neverFold });
    };
    return <>
      <SettingsSection title="My messages" info={INFO}>
        <SettingsCard>
          <SettingsSwitch label="Fold tag blocks" hint="Long <tag>…</tag> blocks become a fold line. Click to open."
            value={current.foldTags} disabled={settings.saving} error={settings.saveError}
            onValueChange={(foldTags) => save({ ...current, foldTags })} />
          <SettingsSwitch label="Render Markdown" hint="Bold, lists, code, links, quotes."
            value={current.markdown} disabled={settings.saving}
            onValueChange={(markdown) => save({ ...current, markdown })} />
          <SettingsSwitch label="Quiet slash commands" hint="A one-line /command loses its bubble; OMP's own answer shows as a muted code block."
            value={current.commands} disabled={settings.saving}
            onValueChange={(commands) => save({ ...current, commands })} />
          <SettingsSwitch label="Show skills as the agent got them" hint="A /skill: message gets a tinted bubble and a header that opens the skill text OMP sent. @files show what was attached."
            value={current.skills} disabled={settings.saving}
            onValueChange={(skills) => save({ ...current, skills })} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Tags · comma-separated">
        <SettingsCard>
          <SettingsInput ref={always} label="Always fold" hint="Even when only one line" initialValue={current.alwaysFold}
            placeholder="attachments, system-notice" onChangeText={(text) => saveLater("alwaysFold", text)} />
          <SettingsInput ref={never} label="Never fold" hint="Always left as text" initialValue={current.neverFold}
            placeholder="div, span, br" onChangeText={(text) => saveLater("neverFold", text)} />
          <SettingsAction label="Reset both lists" actionLabel="Reset to defaults" disabled={settings.saving} onPress={resetLists} />
        </SettingsCard>
      </SettingsSection>
    </>;
  };
}

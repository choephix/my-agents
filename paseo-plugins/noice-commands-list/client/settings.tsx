import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { settings as definition, type Settings } from "../shared/settings";

const FOLDERS: { key: "claude" | "cursor" | "omp" | "codex"; label: string; hint: string }[] = [
  { key: "claude", label: ".claude/commands", hint: "Claude Code: in the project and ~/.claude/commands" },
  { key: "cursor", label: ".cursor/commands", hint: "Cursor: in the project and ~/.cursor/commands" },
  { key: "omp", label: ".omp/commands", hint: "OMP: in the project and ~/.omp/agent/commands" },
  { key: "codex", label: "Codex prompts", hint: "~/.codex/prompts" },
];

/** `onSaved` gets the values the host stored, so the pill and the `/` menu follow at once. */
export function createSettingsScreen(onSaved: (values: Settings) => void) {
  return function AgentCommandsSettings({ theme }: PluginSurfaceProps) {
    const state = useSettings(definition);
    const muted = { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 };
    if (state.status === "loading") return <Text style={muted}>Loading settings…</Text>;
    if (state.status !== "ready") return <SettingsSection title="Agent commands">
      <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{state.error}</Text>
      <SettingsAction label="Reload settings" actionLabel="Reload" onPress={state.reload} />
      {state.status === "invalid" ? <SettingsAction label="Restore the defaults" actionLabel="Reset" onPress={state.reset} /> : null}
    </SettingsSection>;
    const save = (change: Partial<Settings>) => {
      const values = { ...state.values, ...change };
      void state.save(values, state.revision).then((saved) => saved && onSaved(values));
    };
    return <>
      <SettingsSection title="Extra folders" info="Besides .agents/commands (this project, then ~/.agents/commands). A project folder beats one in ~, .agents beats these; the first file of a name wins.">
        <SettingsCard>
          {FOLDERS.map(({ key, label, hint }) => (
            <SettingsSwitch key={key} label={label} hint={hint} value={state.values[key]} disabled={state.saving} onValueChange={(on) => save({ [key]: on })} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="List">
        <SettingsCard>
          <SettingsSwitch label="Show cmds pill" hint="The cmds pill next to every chat's message box; the / menu switch below works either way"
            value={state.values.pill} disabled={state.saving} onValueChange={(pill) => save({ pill })} />
          <SettingsSwitch label="Project / User groups" hint="Headings split this project's commands from yours in ~"
            value={state.values.groups} disabled={state.saving} onValueChange={(groups) => save({ groups })} />
          <SettingsSwitch label="Commands in the / menu" hint="Type /name and arguments, Enter: the plugin fills $ARGUMENTS, $@, $1… (or appends the arguments) and sends the text"
            value={state.values.slashMenu} disabled={state.saving} onValueChange={(slashMenu) => save({ slashMenu })} />
        </SettingsCard>
      </SettingsSection>
      {state.saveError ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{state.saveError}</Text> : null}
    </>;
  };
}

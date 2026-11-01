import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { settings as definition } from "../shared/contracts";

const options = (values: number[], current: number, unit: string) =>
  [...new Set([...values, current])].sort((a, b) => a - b).map(value => ({ label: `${value} ${unit}`, value: String(value) }));

export function BotsSettings({ theme }: PluginSurfaceProps) {
  const state = useSettings(definition);
  const muted = { color: theme.colors.foregroundMuted };
  if (state.status === "loading") return <Text style={muted}>Loading settings…</Text>;
  if (state.status !== "ready") return <SettingsSection title="Bots">
    <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{state.error}</Text>
    <SettingsAction label="Reload settings" actionLabel="Reload" onPress={state.reload} />
    {state.status === "invalid" ? <SettingsAction label="Restore the defaults" actionLabel="Reset" onPress={state.reset} /> : null}
  </SettingsSection>;
  const save = (change: Partial<typeof state.values>) => { void state.save({ ...state.values, ...change }, state.revision); };
  return <SettingsSection title="Bots">
    <SettingsCard>
      <SettingsSwitch label="Show robot icon before bots" value={state.values.showRobot} disabled={state.saving} onValueChange={showRobot => save({ showRobot })} />
      <SettingsSelect label="Threads running at once, per bot" hint="More wait as queued and start in order."
        value={String(state.values.maxRunning)} options={options([1, 2, 4, 8, 16], state.values.maxRunning, "")} disabled={state.saving}
        onValueChange={value => save({ maxRunning: Number(value) })} />
      <SettingsSelect label="Read-only after" hint="Then the thread's agent is deleted; its saved copy stays, without Wake."
        value={String(state.values.readOnlyDays)} options={options([1, 3, 7, 14, 30], state.values.readOnlyDays, "days")} disabled={state.saving}
        onValueChange={value => save({ readOnlyDays: Number(value) })} />
    </SettingsCard>
    {state.saveError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{state.saveError}</Text> : null}
  </SettingsSection>;
}

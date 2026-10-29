import { useState } from "react";
import { Text } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { OMP_DEFAULT_MODEL, settings as definition, type Automatic, type Provider, type Settings } from "../shared/settings";

const OPTIONS: { label: string; value: Automatic }[] = [
  { label: "Off", value: "off" },
  { label: "After the first reply", value: "first" },
  { label: "After every reply", value: "every" },
];

const EXPLAIN: Record<Automatic, string> = {
  off: "Titles change only when you retitle a tab.",
  first: "A new tab is named once its conversation has a subject.",
  every: "A new tab is named once its conversation has a subject, and renamed when the subject moves on. One model call per reply.",
};

const PROVIDERS: { label: string; value: Provider }[] = [
  { label: "Claude Code", value: "claude" },
  { label: "OMP", value: "omp" },
];

const PROVIDER_HINT: Record<Provider, string> = {
  claude: "Claude Haiku through the Claude Code CLI's login.",
  omp: "The model below through OMP's logins, without your OMP context files, skills, rules or persona.",
};

// Seconds; a value outside these (written by hand, 5–120) is listed too, so the select shows it.
const TIMEOUTS = [20, 40, 60, 120];
const timeoutOptions = (current: number) => [...new Set([...TIMEOUTS, current])].sort((a, b) => a - b).map(seconds => ({ label: `${seconds} s`, value: String(seconds) }));

export function TitlesSettings({ theme }: PluginSurfaceProps) {
  const state = useSettings(definition);
  // The model being typed; saved only with Save, so a half-typed name never names a tab.
  const [draft, setDraft] = useState<string | null>(null);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 };
  if (state.status === "loading") return <Text style={muted}>Loading settings…</Text>;
  if (state.status !== "ready") return <SettingsSection title="Titles">
    <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{state.error}</Text>
    <SettingsAction label="Reload settings" actionLabel="Reload" onPress={state.reload} />
    {state.status === "invalid" ? <SettingsAction label="Restore the default" actionLabel="Reset" onPress={state.reset} /> : null}
  </SettingsSection>;
  const save = (change: Partial<Settings>) => { void state.save({ ...state.values, ...change }, state.revision); };
  const model = draft?.trim() ?? state.values.ompModel;
  return <SettingsSection title="Titles">
    <SettingsCard>
      <SettingsSelect label="Automatic titles" hint={EXPLAIN[state.values.automatic]} value={state.values.automatic} options={OPTIONS}
        disabled={state.saving} onValueChange={automatic => save({ automatic })} />
      <SettingsSwitch label="Automatic workspace titles" hint="A new workspace is named once its first tab has a subject, in the style of the project's other workspaces."
        value={state.values.workspaces} disabled={state.saving} onValueChange={workspaces => save({ workspaces })} />
      <SettingsSelect label="Model provider" hint={PROVIDER_HINT[state.values.provider]} value={state.values.provider} options={PROVIDERS}
        disabled={state.saving} onValueChange={provider => { setDraft(null); save({ provider }); }} />
      {state.values.provider === "omp" ? <>
        <SettingsInput label="Model" hint={`provider/id as "omp models" lists it, or a role such as @tiny. Default ${OMP_DEFAULT_MODEL}, the model the prompts were tuned on.`}
          initialValue={state.values.ompModel} placeholder={OMP_DEFAULT_MODEL} disabled={state.saving} onChangeText={setDraft} />
        <SettingsAction label={model === state.values.ompModel ? `Using ${state.values.ompModel}` : `Use ${model || "…"}`} actionLabel="Save"
          disabled={state.saving || !model || model === state.values.ompModel} onPress={() => save({ ompModel: model })} />
      </> : null}
      <SettingsSelect label="Timeout" hint="How long a title request may take before it is given up, for either provider. A slow model or a busy login may need longer."
        value={String(state.values.timeout)} options={timeoutOptions(state.values.timeout)}
        disabled={state.saving} onValueChange={timeout => save({ timeout: Number(timeout) })} />
    </SettingsCard>
    <Text style={muted}>Names you set by hand are never changed automatically. Retitle (Ctrl+Shift+Alt+T, ⌘K, /retitle) always picks a new title; for the workspace, ⌘K → Retitle workspace or /retitle-workspace.</Text>
    {state.saveError ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{state.saveError}</Text> : null}
  </SettingsSection>;
}

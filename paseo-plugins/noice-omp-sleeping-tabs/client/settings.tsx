import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import type { RpcOutput } from "@getpaseo/plugin";
import { configureRpc, type KeptAwakeReason, overviewRpc } from "../shared/rpc";
import { formatFreed } from "./format";

/** While the screen is open; nothing polls once it closes. */
const POLL_MS = 15_000;
const DEFAULT_IDLE_MINUTES = 60;
const PRESETS = [
  { label: "30 minutes", value: "30" },
  { label: "1 hour", value: "60" },
  { label: "2 hours", value: "120" },
  { label: "4 hours", value: "240" },
];
const CUSTOM = "custom";
const REASONS: Record<KeptAwakeReason, string> = {
  running: "running",
  permission: "waiting for permission",
  background_work: "background job",
  open_in_client: "open on a device",
};

function minutesLabel(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} min`;
}

export function SleepSettings({ theme }: PluginSurfaceProps) {
  const readOverview = useRpc(overviewRpc);
  const configure = useRpc(configureRpc);
  const toast = useToast();
  const [overview, setOverview] = useState<RpcOutput<typeof overviewRpc> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  const load = useCallback(async () => {
    try {
      setOverview(await readOverview({}));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [readOverview]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const muted = { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 };

  if (!overview) {
    return (
      <SettingsSection title="Now">
        <SettingsCard>
          {loadError
            ? <SettingsAction label="Couldn't read the sleep state" hint={loadError} actionLabel="Retry" onPress={() => void load()} />
            : <SettingsRow label="Loading…" />}
        </SettingsCard>
      </SettingsSection>
    );
  }
  if (!overview.supported) {
    // The page header already names the plugin; one muted line, nothing else.
    return <Text style={muted}>This Paseo server can't sleep agents.</Text>;
  }

  const providers = overview.providers;
  const enabled = providers.some((entry) => entry.enabled);
  const idleMinutes = (providers.find((entry) => entry.enabled) ?? providers[0])?.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  const options = PRESETS.some((preset) => preset.value === String(idleMinutes))
    ? PRESETS
    : [...PRESETS, { label: minutesLabel(idleMinutes), value: String(idleMinutes) }];

  const save = async (next: { enabled: boolean; idleMinutes: number }) => {
    setSaving(true);
    try {
      const result = await configure(next);
      setOverview((current) => (current ? { ...current, providers: result.providers } : current));
      setCustomOpen(false);
    } catch (error) {
      toast.error(`Sleeping tabs: couldn't save. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const freed = formatFreed(overview.freedBytes);
  const unmeasured = overview.asleep - overview.measured;
  const asleepHint = [
    overview.measured > 0 ? "Memory each chat used when it went to sleep, added up." : "",
    unmeasured > 0 ? `${unmeasured} closed by a restart ${unmeasured === 1 ? "isn't" : "aren't"} measured.` : "",
  ].filter(Boolean).join(" ");
  const kept = overview.keptAwake;

  return (
    <>
      <SettingsSection title="Now">
        <SettingsCard>
          <SettingsRow
            label={overview.asleep === 0 ? "Nothing asleep" : `${overview.asleep} asleep${freed ? ` · ${freed} freed` : ""}`}
            hint={asleepHint || undefined}
          />
          {kept.length > 0 ? (
            <SettingsRow
              label={`${kept.length} kept awake`}
              hint={kept.map((entry) => `${entry.title}: ${REASONS[entry.reason]}`).join(" · ")}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Settings">
        <SettingsCard>
          <SettingsSwitch
            label="Sleep idle chats"
            hint="Closes an OMP chat after it sits idle, to free its memory. The conversation stays readable. Sending a message or pressing Wake starts it again."
            value={enabled}
            disabled={saving}
            onValueChange={(value) => void save({ enabled: value, idleMinutes })}
          />
          <SettingsSelect
            label="Sleep after"
            hint="Never sleeps a chat that is running, waiting for permission, running a background job or open on a device."
            value={customOpen ? CUSTOM : String(idleMinutes)}
            options={[...options, { label: "Custom…", value: CUSTOM }]}
            disabled={saving || !enabled}
            onValueChange={(value) => {
              if (value === CUSTOM) {
                setCustomText(String(idleMinutes));
                setCustomOpen(true);
                return;
              }
              setCustomOpen(false);
              void save({ enabled, idleMinutes: Number(value) });
            }}
          />
          {customOpen && enabled ? (
            <SettingsInput
              label="Minutes"
              hint="Whole minutes, 1 to 10080 (a week)."
              initialValue={customText}
              placeholder="45"
              disabled={saving}
              onChangeText={setCustomText}
            />
          ) : null}
          {customOpen && enabled ? (
            <SettingsAction
              label={`Sleep after ${customText.trim() || "…"} min`}
              actionLabel="Apply"
              disabled={saving || !/^\d+$/.test(customText.trim()) || Number(customText) < 1 || Number(customText) > 10_080}
              onPress={() => void save({ enabled, idleMinutes: Number(customText.trim()) })}
            />
          ) : null}
        </SettingsCard>
        <Text style={muted}>
          {`Applies to ${providers.map((entry) => entry.provider).join(", ") || "no OMP provider yet"}.`}
        </Text>
      </SettingsSection>
    </>
  );
}

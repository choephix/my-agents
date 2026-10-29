import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { type DotAlign, type DotOrder, type DotSize, preferences, type Preferences, type ShowMode } from "../shared/preferences";

const SHOW_OPTIONS: { label: string; value: ShowMode }[] = [
  { label: "Unread", value: "unread" },
  { label: "Unread and running", value: "unread-running" },
  { label: "Every tab", value: "all" },
];
const SIZE_OPTIONS: { label: string; value: DotSize }[] = [
  { label: "Regular", value: "regular" },
  { label: "Small", value: "small" },
];
const ALIGN_OPTIONS: { label: string; value: DotAlign }[] = [
  { label: "Right edge", value: "edge" },
  { label: "Steady", value: "steady" },
  { label: "Left", value: "left" },
];
const ORDER_OPTIONS: { label: string; value: DotOrder }[] = [
  { label: "Tab order", value: "tab" },
  { label: "Waiting first", value: "waiting" },
];
const INFO =
  "One dot per tab in the sidebar's workspace rows, in tab order unless set to waiting first; sub-agents are left out. " +
  "Green: finished, unread. Red: error. Amber: waiting for permission. Blue, pulsing unless turned off: running. " +
  "Gray: read. Hover a dot for the tab's title; click it to open that tab. Web and desktop apps only.";

const PHONE_INFO =
  "On phones, an \"Unread\" row at the top of the sidebar shows while any tab waits on you: one dot per such tab " +
  "across all workspaces. Tap it for the list; tap a tab to open it. \"Every tab\" lists unread and running tabs here.";

export function createSettingsScreen(apply: (values: Preferences) => void) {
  return function TabDotsSettings() {
    const settings = useSettings(preferences);
    const toast = useToast();
    // The user's last choice, shown (and applied to the dots) before the host has saved it.
    const [draft, setDraft] = useState<Preferences | null>(null);
    const stored = settings.status === "ready" ? settings.values : null;
    // `useSettings` hands out a fresh object each render; compare by content.
    const storedKey = stored ? JSON.stringify(stored) : null;
    useEffect(() => {
      if (!stored) return;
      if (draft && JSON.stringify(draft) !== storedKey) return;
      setDraft(null);
      apply(stored);
    }, [storedKey]);

    if (settings.status === "loading") {
      return <SettingsSection title="Tab dots"><SettingsCard><SettingsRow label="Loading..." /></SettingsCard></SettingsSection>;
    }
    if (settings.status === "error") {
      return <SettingsSection title="Tab dots"><SettingsCard>
        <SettingsAction label="Unable to load settings" hint={settings.error} actionLabel="Retry" onPress={settings.reload} />
      </SettingsCard></SettingsSection>;
    }
    if (settings.status === "invalid") {
      return <SettingsSection title="Tab dots"><SettingsCard>
        <SettingsAction label="Saved settings are unreadable" hint="Reset restores the defaults" actionLabel="Reset"
          disabled={settings.saving} onPress={settings.reset} />
      </SettingsCard></SettingsSection>;
    }
    const current = draft ?? settings.values;
    const save = (patch: Partial<Preferences>) => {
      const next = { ...current, ...patch };
      setDraft(next);
      apply(next);
      void settings.save(next, settings.revision).then((ok) => {
        if (ok) return;
        setDraft(null);
        apply(settings.values);
        toast.show("Tab dots: couldn't save that setting; nothing changed", { variant: "error" });
      });
    };
    return <SettingsSection title="Tab dots" info={Platform.OS === "web" ? INFO : PHONE_INFO}>
      <SettingsCard>
        <SettingsSwitch label="Show tab dots" value={current.enabled} disabled={settings.saving}
          error={settings.saveError} onValueChange={(enabled) => save({ enabled })} />
        <SettingsSelect label="Which tabs" hint="Unread: finished, failed or waiting for permission"
          value={current.show} options={SHOW_OPTIONS} disabled={settings.saving || !current.enabled}
          onValueChange={(show) => save({ show })} />
        <SettingsSelect label="Dot size" hint="Regular: 5 px · Small: 4 px; up to 8 dots either way"
          value={current.size} options={SIZE_OPTIONS} disabled={settings.saving || !current.enabled}
          onValueChange={(size) => save({ size })} />
        {Platform.OS === "web" ? <>
          <SettingsSwitch label="Replace the time" hint="Rows with dots hide their last-activity time"
            value={current.replaceTime} disabled={settings.saving || !current.enabled}
            onValueChange={(replaceTime) => save({ replaceTime })} />
          <SettingsSelect label="Dot position" hint="Right edge: where the time was; moves left while the row's menu shows on hover · Steady: right, never moves · Left: right after the title"
            value={current.align} options={ALIGN_OPTIONS} disabled={settings.saving || !current.enabled}
            onValueChange={(align) => save({ align })} />
          <SettingsSelect label="Dot order" hint="Waiting first: tabs waiting on you, then running ones, then read ones"
            value={current.order} options={ORDER_OPTIONS} disabled={settings.saving || !current.enabled}
            onValueChange={(order) => save({ order })} />
          <SettingsSwitch label="Animate running dots" hint="Off: running dots stay solid. Reduced motion always stops the pulse"
            value={current.animate} disabled={settings.saving || !current.enabled}
            onValueChange={(animate) => save({ animate })} />
        </> : null}
      </SettingsCard>
    </SettingsSection>;
  };
}

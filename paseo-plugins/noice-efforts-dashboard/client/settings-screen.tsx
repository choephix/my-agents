import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsInput, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import { COMMITS_SHOWN_CHOICES, folderSettings } from "../shared/settings";
import { fetchOverview } from "./runtime";

const COMMITS_OPTIONS = COMMITS_SHOWN_CHOICES.map((count) => ({ label: String(count), value: String(count) }));

/** `a, b` or one per line → `["a", "b"]`. */
function folderList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((folder) => folder.trim())
    .filter(Boolean);
}

/** Folders scanned and skipped besides the `.scratch` of Paseo's workspaces, which pills show, and how many commits. */
export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(folderSettings);
  const [extraDraft, setExtraDraft] = useState<string | null>(null);
  const [excludedDraft, setExcludedDraft] = useState<string | null>(null);
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>{settings.status === "loading" ? "Loading…" : settings.error}</Text>;
  }
  const { extraFolders, excludedFolders, showHeaderButton, showComposerPill, commitsShown } = settings.values;
  const savedExtra = extraFolders.join(", ");
  const savedExcluded = excludedFolders.join(", ");
  const extra = extraDraft ?? savedExtra;
  const excluded = excludedDraft ?? savedExcluded;
  const dirty = extra !== savedExtra || excluded !== savedExcluded;
  /** Saves the whole object (a missing field would fall back to its default), then refreshes the pills. */
  const save = (values: Partial<typeof settings.values>) =>
    settings.save({ ...settings.values, ...values }, settings.revision).then((ok) => {
      if (ok) void fetchOverview().catch(() => undefined);
      return ok;
    });
  const saveFolders = () =>
    void save({ extraFolders: folderList(extra), excludedFolders: folderList(excluded) }).then((ok) => {
      if (!ok) return;
      setExtraDraft(null);
      setExcludedDraft(null);
    });
  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title="Buttons">
        <SettingsSwitch
          label="Show header button"
          hint="The effort pill in each workspace's header. The Efforts tab and the sidebar row stay either way."
          value={showHeaderButton}
          disabled={settings.saving}
          onValueChange={(value) => void save({ showHeaderButton: value })}
        />
        <SettingsSwitch
          label="Show composer pill"
          hint="The effort pill above each chat's composer, on phones and narrow windows. Off by default."
          value={showComposerPill}
          disabled={settings.saving}
          onValueChange={(value) => void save({ showComposerPill: value })}
        />
      </SettingsSection>
      <SettingsSection
        title="Folders"
        info="Efforts are the folders in .scratch. The .scratch of every Paseo workspace is read (symlinks resolved, so worktrees share the same efforts). __share__ copies and anything under an excluded folder are skipped unless listed in Extra folders."
      >
        <SettingsInput
          label="Extra folders"
          hint="Comma-separated. A .scratch folder or a folder that holds one, e.g. ~/workspace/acme-app"
          initialValue={savedExtra}
          placeholder="~/workspace/acme-app"
          onChangeText={setExtraDraft}
          error={settings.saveError}
        />
        <SettingsInput
          label="Excluded folders"
          hint="Comma-separated absolute or ~/ paths. Everything under them is skipped unless listed in Extra folders, e.g. ~/workspace/acme-app/test/fixtures"
          initialValue={savedExcluded}
          placeholder="~/workspace/acme-app/test/fixtures"
          onChangeText={setExcludedDraft}
        />
        <SettingsAction
          label={dirty ? "Unsaved changes" : "Saved"}
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={settings.saving || !dirty}
          onPress={saveFolders}
        />
      </SettingsSection>
      <SettingsSection title="Files & commits">
        <SettingsSelect
          label="Commits shown"
          hint="How many of the effort's newest commits its Files & commits page lists."
          value={String(commitsShown)}
          options={COMMITS_OPTIONS}
          disabled={settings.saving}
          onValueChange={(value) => void save({ commitsShown: Number(value) })}
        />
      </SettingsSection>
    </View>
  );
}

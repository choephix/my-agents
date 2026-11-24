import { useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import { boxStatusRpc, type SlipboxSettings, slipboxSettings } from "../shared/settings";

const TITLE = "Slip-box";

type StatusState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      folder: string | null;
      source: "setting" | "env" | "desk-config" | "md-embed" | "none";
      exists: boolean;
      slipCount: number;
    };

function sourceNote(source: "setting" | "env" | "desk-config" | "md-embed" | "none"): string {
  switch (source) {
    case "setting":
      return "from plugin setting";
    case "env":
      return "from SLIPBOX_DIR";
    case "desk-config":
      return "from slipbox-desk config";
    case "md-embed":
      return "from md-embed config";
    case "none":
      return "";
  }
}

function isValidFolderInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^~?(?:\/|\\)/.test(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed);
}

function formatStatusHint(status: StatusState): string {
  if (status.kind === "loading") return "Checking folder…";
  if (status.kind === "error") return status.message;
  if (!status.folder) {
    return "No folder configured. Enter an absolute path below or set SLIPBOX_DIR on the daemon host.";
  }
  const from = sourceNote(status.source);
  if (!status.exists) return `Folder not found: ${status.folder} (${from}).`;
  const count = status.slipCount === 1 ? "1 slip" : `${status.slipCount} slips`;
  return `${status.folder} (${from}) · ${count}`;
}

export function SlipboxSettingsScreen() {
  const settings = useSettings(slipboxSettings);
  const fetchStatus = useRpc(boxStatusRpc);
  const [draftFolder, setDraftFolder] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ kind: "loading" });

  const refreshStatus = useCallback(() => {
    setStatus({ kind: "loading" });
    void fetchStatus({})
      .then((result) => setStatus({ kind: "ready", ...result }))
      .catch((error: unknown) => {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not check slip-box folder.",
        });
      });
  }, [fetchStatus]);

  const revision = settings.status === "ready" ? settings.revision : "";
  useEffect(() => {
    if (settings.status === "ready") refreshStatus();
  }, [settings.status, revision, refreshStatus]);

  if (settings.status === "loading") {
    return (
      <SettingsSection title={TITLE}>
        <SettingsCard>
          <SettingsRow label="Loading…" />
        </SettingsCard>
      </SettingsSection>
    );
  }

  if (settings.status === "error") {
    return (
      <SettingsSection title={TITLE}>
        <SettingsCard>
          <SettingsAction
            label="Unable to load settings"
            hint={settings.error}
            actionLabel="Retry"
            onPress={settings.reload}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  if (settings.status === "invalid") {
    return (
      <SettingsSection title={TITLE}>
        <SettingsCard>
          <SettingsAction
            label="Saved settings are unreadable"
            hint="Reset restores the defaults."
            actionLabel="Reset"
            disabled={settings.saving}
            onPress={settings.reset}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const save = (patch: Partial<SlipboxSettings>) => {
    const next: SlipboxSettings = { ...settings.values, ...patch };
    void settings.save(next, settings.revision).then((saved) => {
      if (saved) refreshStatus();
    });
  };

  const folderError =
    draftFolder !== null && !isValidFolderInput(draftFolder)
      ? "Use an absolute path or start with ~/."
      : settings.saveError;
  const trimmedDraft = draftFolder?.trim() ?? null;
  const folderDirty =
    trimmedDraft !== null &&
    trimmedDraft !== settings.values.boxFolder &&
    isValidFolderInput(trimmedDraft);

  return (
    <SettingsSection
      title={TITLE}
      info="Attach, view, settle, and capture Markdown notes from a slip-box folder."
    >
      <SettingsCard>
        <SettingsRow label="Active folder" hint={formatStatusHint(status)} />
        <SettingsInput
          label="Slip-box folder"
          hint="Absolute path (or ~/…) on this host. Leave empty to auto-detect from SLIPBOX_DIR, ~/.config/slipbox-desk/settings.json, or ~/.omp/agent/md-embed.json."
          initialValue={settings.values.boxFolder}
          placeholder="~/slipbox"
          error={folderError}
          onChangeText={setDraftFolder}
          disabled={settings.saving}
        />
        {folderDirty ? (
          <SettingsAction
            label={trimmedDraft ? `Use ${trimmedDraft}` : "Use automatic detection"}
            actionLabel="Save"
            disabled={settings.saving}
            onPress={() => {
              const nextFolder = trimmedDraft;
              setDraftFolder(null);
              save({ boxFolder: nextFolder });
            }}
          />
        ) : null}
        <SettingsSwitch
          label="Include captures"
          hint="Show notes from captures/ in the attachment picker."
          value={settings.values.includeCaptures}
          disabled={settings.saving}
          onValueChange={(includeCaptures) => save({ includeCaptures })}
        />
        <SettingsSwitch
          label="Include scraps and efforts"
          hint="Show notes from scraps/ and efforts/ in the attachment picker."
          value={settings.values.includeAgentNotes}
          disabled={settings.saving}
          onValueChange={(includeAgentNotes) => save({ includeAgentNotes })}
        />
        <SettingsSwitch
          label="Include settled slips"
          hint="Show slips with a settled: front matter field. Open memos still rank first."
          value={settings.values.includeSettled}
          disabled={settings.saving}
          onValueChange={(includeSettled) => save({ includeSettled })}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

import type { PluginTheme } from "@getpaseo/plugin";
import {
  type PluginComposer,
  type PluginComposerItemProps,
  type PluginIconProps,
  useComposer,
  useRpc,
} from "@getpaseo/plugin/client";
import { Action, Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { INSTRUCTIONS_METADATA_KEY, nextChatLastUsed, SYSTEM_PROMPT_PROVIDERS } from "../shared/next-chat";
import { BODY } from "./markdown-view";
import type { OmpProviders } from "./omp-providers";
import { tabTitle } from "./phone-menu";

const TITLE = "Instructions for this chat";
const SMALL = { fontSize: 12, lineHeight: 16 };
const BUILTIN_SYSTEM_PROMPT_PROVIDERS = new Set<string>(SYSTEM_PROMPT_PROVIDERS);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

interface LastUsed {
  agentId: string;
  title: string | null;
  text: string;
  at: number;
}

function Button({
  theme,
  label,
  primary,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => ({
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: primary ? colors.accent : colors.border,
        backgroundColor: primary ? colors.accent : hovered ? colors.surface2 : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={[BODY, { color: primary ? colors.accentForeground : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function DraftInstructionsControl({
  composer,
  theme,
  providers,
}: {
  composer: PluginComposer;
  theme: PluginTheme;
  providers: OmpProviders;
}) {
  const { colors } = theme;
  const fetchLastUsed = useRpc(nextChatLastUsed);
  const raw = composer.agent.metadata[INSTRUCTIONS_METADATA_KEY];
  const saved = typeof raw === "string" ? raw : "";
  const hasInstructions = saved.trim().length > 0;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [lastUsed, setLastUsed] = useState<LastUsed | null>(null);
  const [providerSupported, setProviderSupported] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const provider = composer.agent.provider;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchLastUsed({}).then(
      result => {
        if (!cancelled) setLastUsed(result.lastUsed);
      },
      () => {},
    );
    if (!provider || BUILTIN_SYSTEM_PROMPT_PROVIDERS.has(provider)) {
      setProviderSupported(true);
    } else {
      void providers.isOmp(provider).then(
        supported => {
          if (!cancelled) setProviderSupported(supported);
        },
        () => {
          if (!cancelled) setProviderSupported(true);
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [open, provider, fetchLastUsed, providers]);

  const handleOpen = useCallback(() => {
    setDraft(saved);
    setError(undefined);
    setOpen(true);
  }, [saved]);

  const commit = useCallback(
    (value: string | null) => {
      setBusy(true);
      setError(undefined);
      composer.setMetadata({ [INSTRUCTIONS_METADATA_KEY]: value }).then(
        () => {
          setBusy(false);
          setOpen(false);
        },
        reason => {
          setError(errorText(reason));
          setBusy(false);
        },
      );
    },
    [composer],
  );

  const ArmedIcon = useMemo(
    () =>
      function ArmedInstructionsIcon({ size }: PluginIconProps) {
        return <Icon name="ScrollText" size={size} color={colors.accent} />;
      },
    [colors.accent],
  );
  const modalIcon = useMemo(() => <Icon name="ScrollText" size={18} color={colors.foreground} />, [colors.foreground]);

  return (
    <>
      <Action
        title={hasInstructions ? "Instructions ✓" : "Instructions"}
        icon={hasInstructions ? ArmedIcon : "ScrollText"}
        onPress={handleOpen}
      />
      <Modal title={TITLE} icon={modalIcon} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          <View style={{ gap: 10 }}>
            <TextInput
              multiline
              autoFocus
              editable={!busy}
              value={draft}
              onChangeText={setDraft}
              placeholder="A role or brief for this chat"
              placeholderTextColor={colors.foregroundMuted}
              style={[
                BODY,
                {
                  minHeight: 140,
                  maxHeight: 320,
                  padding: 8,
                  borderWidth: 1,
                  borderRadius: 6,
                  borderColor: colors.border,
                  color: colors.foreground,
                  backgroundColor: colors.surface0,
                  textAlignVertical: "top",
                },
              ]}
            />
            <Text style={[SMALL, { color: colors.foregroundMuted }]}>
              {hasInstructions
                ? "Included in this chat's system prompt for good (survives compaction). Sent with your first message."
                : "Added to this chat's system prompt for good (survives compaction). Applies only to this draft."}
            </Text>
            {provider && !providerSupported ? (
              <Text style={[SMALL, { color: colors.statusWarning }]}>
                {`Note: ${provider} ignores Paseo's system prompt (OMP, Claude Code, Codex, OpenCode and Pi use it).`}
              </Text>
            ) : null}
            {lastUsed ? (
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => setDraft(lastUsed.text)}>
                <Text style={[SMALL, { color: colors.foregroundMuted }]} numberOfLines={1}>
                  Last used by “{tabTitle(lastUsed.title)}” at {clock(lastUsed.at)} ·{" "}
                  <Text style={{ color: colors.accent }}>Copy into the box</Text>
                </Text>
              </Pressable>
            ) : null}
            {error ? <Text style={[SMALL, { color: colors.statusDanger }]}>{error}</Text> : null}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <Button
                theme={theme}
                label="Clear"
                disabled={busy || (!hasInstructions && !draft.trim())}
                onPress={() => (hasInstructions ? commit(null) : setDraft(""))}
              />
              <Button
                theme={theme}
                label="Save"
                primary
                disabled={busy || !draft.trim() || draft === saved}
                onPress={() => commit(draft)}
              />
            </View>
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}

/**
 * Composer item for draft and New workspace composers: attaches per-chat system instructions to
 * agent metadata so `agent.create.before` appends them to that exact chat's `systemPrompt`.
 * Renders nothing on running agents, so it takes no toolbar room there.
 */
export function createNextChatComposerItem(providers: OmpProviders) {
  return function NextChatComposerItem({ theme }: PluginComposerItemProps) {
    const composer = useComposer();
    if (composer.context === "agent") return null;
    return <DraftInstructionsControl composer={composer} theme={theme} providers={providers} />;
  };
}

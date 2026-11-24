import { type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SLIP_KINDS, type SlipKind } from "../shared/frontmatter";
import { createSlipRpc } from "../shared/panel";

interface CreatedResult {
  absolutePath: string;
  relativePath: string;
  wikiName: string;
  title: string;
  kind: string;
  emoji: string;
}

const VALID_KINDS = new Set<string>(SLIP_KINDS);

function initialKind(raw: string | undefined): SlipKind {
  return raw && VALID_KINDS.has(raw) ? (raw as SlipKind) : "note";
}

export function CaptureSlipScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const createSlip = useRpc(createSlipRpc);
  const toast = useToast();

  const [kind, setKind] = useState<SlipKind>(() => initialKind(params.kind));
  const [title, setTitle] = useState(() => params.title ?? "");
  const [emoji, setEmoji] = useState("");
  const [about, setAbout] = useState(() => params.about ?? "");
  const [body, setBody] = useState(() => params.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedResult | null>(null);

  const canSave = title.trim().length > 0 && !saving;

  const handleSave = useCallback(async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createSlip({
        title: title.trim(),
        body: body.trim() || undefined,
        kind,
        emoji: emoji.trim() || undefined,
        about: about.trim() || undefined,
        from: params.agentId ? `session:${params.agentId}` : undefined,
        agentId: params.agentId || undefined,
      });
      setCreated(result);
      toast.show(`Saved [[${result.wikiName}]]`, { variant: "success" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [title, body, kind, emoji, about, params.agentId, saving, createSlip, toast]);

  const resetForm = useCallback(() => {
    setTitle("");
    setEmoji("");
    setBody("");
    setError(null);
    setCreated(null);
  }, []);

  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      scrollContent: {
        padding: layout.compact ? 16 : 24,
        alignItems: "center" as const,
      },
      frame: {
        width: "100%" as const,
        maxWidth: 680,
        gap: 16,
      },
      fieldGroup: {
        gap: 6,
      },
      label: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      kindRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
      },
      kindPill: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      kindPillActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      kindText: {
        color: theme.colors.foreground,
        fontSize: 12,
        fontWeight: "500" as const,
      },
      kindTextActive: {
        color: theme.colors.accentForeground,
        fontWeight: "600" as const,
      },
      titleRow: {
        flexDirection: "row" as const,
        gap: 8,
      },
      input: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        fontSize: 14,
      },
      titleInput: {
        flex: 1,
      },
      emojiInput: {
        width: 68,
        textAlign: "center" as const,
      },
      bodyInput: {
        minHeight: 160,
        textAlignVertical: "top" as const,
      },
      errorText: {
        color: theme.colors.statusDanger,
        fontSize: 13,
      },
      buttonRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 10,
      },
      primaryBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      primaryBtnDisabled: {
        opacity: 0.5,
      },
      primaryBtnText: {
        color: theme.colors.accentForeground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      secondaryBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      secondaryBtnText: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "500" as const,
      },
      resultCard: {
        padding: 16,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        gap: 10,
      },
      resultTitle: {
        color: theme.colors.foreground,
        fontSize: 16,
        fontWeight: "600" as const,
      },
      resultPath: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
    }),
    [theme, layout.compact],
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={styles.frame}>
        {created ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>
              {created.emoji ? `${created.emoji} ` : ""}
              {created.title}
            </Text>
            <Text selectable style={styles.resultPath}>
              {created.relativePath} · [[{created.wikiName}]]
            </Text>
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const link = `[[${created.wikiName}]]`;
                  void copyText(link)
                    .then(() => toast.show(`Copied ${link}`, { variant: "info" }))
                    .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
                }}
                style={styles.secondaryBtn}
              >
                <Icon name="Copy" size={14} color={theme.colors.foregroundMuted} />
                <Text style={styles.secondaryBtnText}>Copy [[{created.wikiName}]]</Text>
              </Pressable>
              {params.agentId && navigation?.openAgent ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.openAgent({ agentId: params.agentId })}
                  style={styles.secondaryBtn}
                >
                  <Icon name="ArrowLeft" size={14} color={theme.colors.foregroundMuted} />
                  <Text style={styles.secondaryBtnText}>Back to chat</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" onPress={resetForm} style={styles.primaryBtn}>
                <Icon name="Plus" size={14} color={theme.colors.accentForeground} />
                <Text style={styles.primaryBtnText}>New another</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Kind</Text>
              <View style={styles.kindRow}>
                {SLIP_KINDS.map((option) => {
                  const active = option === kind;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setKind(option)}
                      style={[styles.kindPill, active ? styles.kindPillActive : undefined]}
                    >
                      <Text style={[styles.kindText, active ? styles.kindTextActive : undefined]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Title and optional emoji</Text>
              <View style={styles.titleRow}>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Short summary of the slip"
                  placeholderTextColor={theme.colors.foregroundMuted}
                  style={[styles.input, styles.titleInput]}
                />
                <TextInput
                  value={emoji}
                  onChangeText={setEmoji}
                  placeholder="🏷️"
                  placeholderTextColor={theme.colors.foregroundMuted}
                  style={[styles.input, styles.emojiInput]}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>About (optional project folder)</Text>
              <TextInput
                value={about}
                onChangeText={setAbout}
                placeholder="~/workspace/project"
                placeholderTextColor={theme.colors.foregroundMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Body (Markdown)</Text>
              <TextInput
                multiline
                value={body}
                onChangeText={setBody}
                placeholder="Write notes, findings, or [[links]]…"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={[styles.input, styles.bodyInput]}
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                disabled={!canSave}
                onPress={() => void handleSave()}
                style={[styles.primaryBtn, !canSave ? styles.primaryBtnDisabled : undefined]}
              >
                <Icon name="StickyNote" size={15} color={theme.colors.accentForeground} />
                <Text style={styles.primaryBtnText}>{saving ? "Saving…" : "Save slip"}</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

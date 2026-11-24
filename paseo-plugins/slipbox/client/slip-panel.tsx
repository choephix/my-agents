import type { PluginTheme } from "@getpaseo/plugin";
import {
  PluginFileConflictError,
  PluginFileDeletedError,
  type PluginFilePanelProps,
  useRpc,
  useTabState,
} from "@getpaseo/plugin/client";
import {
  copyText,
  ExternalLink,
  Icon,
  Loading,
  Markdown,
  ScrollView,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { z } from "zod";
import {
  buildFileLinkUrl,
  escapeMarkdownLinkLabel,
  extractWikiReferences,
  parseSlipMarkdown,
  type ResolvedWikiTarget,
  rewriteInlineWikiLinks,
  segmentSlipBody,
  setSlipSettled,
  type SlipBodySegment,
} from "../shared/frontmatter";
import { resolveSlipContextRpc } from "../shared/panel";

const tabViewSchema = z.object({ view: z.enum(["preview", "source"]) });
const DEFAULT_TAB_VIEW = { view: "preview" } as const;

const KNOWN_SLIP_KEYS = new Set([
  "kind",
  "emoji",
  "about",
  "from",
  "source",
  "owner",
  "due",
  "settled",
  "settled_by",
  "settled_as",
  "extracted",
  "answered",
  "delivery",
]);

const HEADER_DISPLAY_KEYS = new Set([
  "kind",
  "emoji",
  "about",
  "from",
  "source",
  "due",
  "settled",
  "settled_by",
  "settled_as",
  "owner",
  "title",
]);

interface SlipContextData {
  boxFolder: string | null;
  inBox: boolean;
  relativePath: string | null;
  folder: string | null;
  wikiName: string | null;
  resolved: Record<string, ResolvedWikiTarget>;
  embedPreviews: Record<string, string>;
  backlinks: Array<{
    path: string;
    relativePath: string;
    wikiName: string;
    title: string;
    emoji: string;
    kind: string;
    settled: string;
  }>;
}

const EMPTY_CONTEXT: SlipContextData = {
  boxFolder: null,
  inBox: false,
  relativePath: null,
  folder: null,
  wikiName: null,
  resolved: {},
  embedPreviews: {},
  backlinks: [],
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function kindAccentColor(kind: string, theme: PluginTheme): string {
  switch (kind) {
    case "ask":
    case "get":
    case "promise":
      return theme.colors.statusWarning;
    case "proposal":
    case "track":
      return theme.colors.accent;
    case "read":
      return theme.colors.statusSuccess;
    default:
      return theme.colors.foregroundMuted;
  }
}

function shortAboutLabel(about: string): string {
  const trimmed = about.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return trimmed;
  return parts.slice(-2).join("/");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function EmbeddedSlipCard({
  segment,
  theme,
}: {
  segment: Extract<SlipBodySegment, { kind: "embed" }>;
  theme: PluginTheme;
}) {
  const { resolved, fragment, label } = segment;
  const isSettled = Boolean(resolved.settled);
  const [expanded, setExpanded] = useState(!isSettled);

  const headerLink = useMemo(() => {
    const url = buildFileLinkUrl(resolved.path, fragment);
    return `[${escapeMarkdownLinkLabel(label)}](<${url}>)`;
  }, [resolved.path, fragment, label]);

  const accent = kindAccentColor(resolved.kind ?? "note", theme);

  const styles = useMemo(
    () => ({
      card: {
        marginVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 3,
        borderLeftColor: isSettled ? theme.colors.foregroundMuted : accent,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: expanded ? 1 : 0,
        borderBottomColor: theme.colors.border,
      },
      headerLeft: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        minWidth: 0,
      },
      linkWrap: {
        flexShrink: 1,
      },
      metaRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 5,
        backgroundColor: theme.colors.surface2,
      },
      badgeText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
      },
      toggleBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 6,
      },
      toggleText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
      body: {
        paddingHorizontal: 12,
        paddingVertical: 10,
      },
      emptyText: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
      },
    }),
    [theme, accent, isSettled, expanded],
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.linkWrap}>
            <Markdown>{headerLink}</Markdown>
          </View>
          {resolved.kind ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{resolved.kind}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? `Collapse ${label}` : `Expand ${label}`}
            onPress={() => setExpanded((prev) => !prev)}
            style={styles.toggleBtn}
          >
            <Icon
              name={expanded ? "ChevronDown" : "ChevronRight"}
              size={14}
              color={theme.colors.foregroundMuted}
            />
            <Text style={styles.toggleText}>
              {isSettled ? (resolved.settledAs === "saved" ? "saved" : "settled") : expanded ? "Hide" : "Show"}
            </Text>
          </Pressable>
        </View>
      </View>
      {expanded ? (
        <View style={styles.body}>
          {resolved.previewMarkdown ? (
            <Markdown>{resolved.previewMarkdown}</Markdown>
          ) : (
            <Text style={styles.emptyText}>Empty note.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function SlipFilePanel({ file, tab, theme, layout }: PluginFilePanelProps) {
  const [viewState, setViewState] = useTabState(tab, tabViewSchema, DEFAULT_TAB_VIEW);
  const resolveContext = useRpc(resolveSlipContextRpc);
  const toast = useToast();

  const [diskText, setDiskText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [deleted, setDeleted] = useState(false);

  const [draft, setDraft] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pendingSettleText, setPendingSettleText] = useState<string | null>(null);

  const [context, setContext] = useState<SlipContextData>(EMPTY_CONTEXT);
  const [backlinksOpen, setBacklinksOpen] = useState(false);

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const setDirtyFlag = useCallback(
    (next: boolean) => {
      dirtyRef.current = next;
      setDirty(next);
      tab.setModified(next);
    },
    [tab],
  );

  const loadFromDisk = useCallback(async () => {
    try {
      const next = await file.readText();
      setDiskText(next);
      setDraft(next);
      setDirtyFlag(false);
      setConflict(false);
      setPendingSettleText(null);
      setDeleted(false);
      setLoadError(null);
    } catch (error) {
      if (error instanceof PluginFileDeletedError) {
        setDeleted(true);
      }
      setLoadError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [file, setDirtyFlag]);

  useEffect(() => {
    setDiskText(null);
    setDraft("");
    setDirtyFlag(false);
    setConflict(false);
    setPendingSettleText(null);
    setDeleted(false);
    setLoadError(null);
    setContext(EMPTY_CONTEXT);

    void loadFromDisk();
    const unwatch = file.watch((event) => {
      if (event.type === "deleted") {
        setDeleted(true);
        return;
      }
      if (dirtyRef.current) {
        setConflict(true);
        return;
      }
      void loadFromDisk();
    });
    return () => {
      unwatch();
      tab.setModified(false);
    };
  }, [file, loadFromDisk, setDirtyFlag, tab]);

  const fallbackTitle = useMemo(() => file.name.replace(/\.(md|markdown)$/i, ""), [file.name]);
  const currentText = diskText ?? "";
  const parsed = useMemo(() => parseSlipMarkdown(currentText, fallbackTitle), [currentText, fallbackTitle]);

  const wikiRefs = useMemo(() => {
    const bodyRefs = extractWikiReferences(parsed.contentWithoutFrontMatter);
    const fromValue = parsed.frontMatter.from ?? "";
    const fromRefs = fromValue ? extractWikiReferences(fromValue) : { linkTargets: [], embedRequests: [] };
    const targets = [...new Set([...bodyRefs.linkTargets, ...fromRefs.linkTargets])].sort();
    const embedRequests = bodyRefs.embedRequests;
    const key = JSON.stringify({ targets, embedRequests });
    return { targets, embedRequests, key };
  }, [parsed.contentWithoutFrontMatter, parsed.frontMatter.from]);

  useEffect(() => {
    if (diskText === null) return;
    let active = true;
    void resolveContext({
      filePath: file.path,
      targets: wikiRefs.targets,
      embedRequests: wikiRefs.embedRequests,
      includeBacklinks: true,
    })
      .then((result) => {
        if (active) setContext(result);
      })
      .catch(() => {
        // Non-fatal: the panel still renders local Markdown cleanly if RPC is unavailable.
      });
    return () => {
      active = false;
    };
  }, [file.path, diskText !== null, wikiRefs.key, resolveContext]);

  const hasSlipFrontMatter = useMemo(
    () => parsed.frontMatterEntries.some((entry) => KNOWN_SLIP_KEYS.has(entry.key)),
    [parsed.frontMatterEntries],
  );
  const isSlip = context.inBox || hasSlipFrontMatter;
  const isCapture = context.folder === "captures" || parsed.frontMatter.kind === "capture";
  const isSettled = Boolean(parsed.frontMatter.settled);
  const isSaved = parsed.frontMatter.settled_as === "saved";
  const wikiName = context.wikiName ?? fallbackTitle;

  const commitWrite = useCallback(
    async (nextText: string, options: { force?: boolean; successMessage?: string } = {}) => {
      setSaving(true);
      try {
        await file.writeText(nextText, { force: options.force });
        setDiskText(nextText);
        setDraft(nextText);
        setDirtyFlag(false);
        setConflict(false);
        setPendingSettleText(null);
        setDeleted(false);
        if (options.successMessage) {
          toast.show(options.successMessage, { variant: "success" });
        }
      } catch (error) {
        if (error instanceof PluginFileConflictError) {
          setConflict(true);
          setPendingSettleText(nextText);
          toast.error("File changed on disk. Reload or overwrite.");
        } else if (error instanceof PluginFileDeletedError) {
          setDeleted(true);
          toast.error("File was deleted on disk.");
        } else {
          toast.error(messageOf(error));
        }
      } finally {
        setSaving(false);
      }
    },
    [file, setDirtyFlag, toast],
  );

  const handleSettleAction = useCallback(
    (mode: "settle" | "save" | "reopen") => {
      if (diskText === null || saving || isCapture) return;
      const base = dirty ? draft : diskText;
      const updated = setSlipSettled(base, { mode });
      const successMessage =
        mode === "reopen" ? "Slip reopened" : mode === "save" ? "Slip saved and settled" : "Slip settled";
      void commitWrite(updated, { successMessage });
    },
    [diskText, draft, dirty, saving, isCapture, commitWrite],
  );

  const handleCopyWikiLink = useCallback(() => {
    const link = `[[${wikiName}]]`;
    void copyText(link)
      .then(() => toast.show(`Copied ${link}`, { variant: "info" }))
      .catch((error) => toast.error(messageOf(error)));
  }, [wikiName, toast]);

  const segments = useMemo(
    () => segmentSlipBody(parsed.contentWithoutFrontMatter, context.resolved, context.embedPreviews),
    [parsed.contentWithoutFrontMatter, context.resolved, context.embedPreviews],
  );

  const fromMarkdown = useMemo(() => {
    const rawFrom = parsed.frontMatter.from;
    if (!rawFrom) return null;
    if (!rawFrom.includes("[[")) return null;
    const rewritten = rewriteInlineWikiLinks(rawFrom, context.resolved);
    return rewritten !== rawFrom ? rewritten : null;
  }, [parsed.frontMatter.from, context.resolved]);

  const extraFrontMatter = useMemo(
    () => parsed.frontMatterEntries.filter((entry) => !HEADER_DISPLAY_KEYS.has(entry.key)),
    [parsed.frontMatterEntries],
  );

  const monoFont = Platform.OS === "ios" ? "Menlo" : Platform.OS === "android" ? "monospace" : "monospace";
  const kind = parsed.frontMatter.kind ?? (context.folder === "captures" ? "capture" : context.folder === "scraps" ? "scrap" : "");
  const kindColor = kindAccentColor(kind || "note", theme);

  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.colors.surface0,
      },
      toolbar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        flexWrap: "wrap" as const,
        gap: 8,
        paddingHorizontal: layout.compact ? 12 : 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      segmented: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        padding: 2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      segBtn: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
      },
      segBtnActive: {
        backgroundColor: theme.colors.surface2,
      },
      segLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "500" as const,
      },
      segLabelActive: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      toolbarActions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 6,
      },
      actionBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      actionBtnPrimary: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      actionBtnDisabled: {
        opacity: 0.5,
      },
      actionText: {
        color: theme.colors.foreground,
        fontSize: 12,
        fontWeight: "500" as const,
      },
      actionTextPrimary: {
        color: theme.colors.accentForeground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      banner: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 10,
        paddingHorizontal: layout.compact ? 12 : 16,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface1,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      bannerText: {
        flex: 1,
        color: theme.colors.statusWarning,
        fontSize: 12,
      },
      bannerLink: {
        color: theme.colors.accent,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      scroll: {
        flex: 1,
      },
      scrollContent: {
        paddingHorizontal: layout.compact ? 14 : 24,
        paddingVertical: layout.compact ? 14 : 20,
        alignItems: "center" as const,
      },
      frame: {
        width: "100%" as const,
        maxWidth: 780,
        gap: 14,
      },
      metaCard: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        padding: layout.compact ? 12 : 14,
        gap: 8,
      },
      pillRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 8,
      },
      emoji: {
        fontSize: 18,
      },
      pill: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      kindDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: kindColor,
      },
      pillText: {
        color: theme.colors.foreground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      statusTextOpen: {
        color: theme.colors.statusSuccess,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      statusTextSettled: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "500" as const,
      },
      dueText: {
        color: theme.colors.statusWarning,
        fontSize: 12,
        fontWeight: "500" as const,
      },
      mutedMeta: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
      metaDetails: {
        gap: 4,
      },
      metaLine: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 6,
      },
      metaKey: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      metaValue: {
        color: theme.colors.foreground,
        fontSize: 12,
      },
      bodyWrap: {
        gap: 4,
      },
      backlinksCard: {
        marginTop: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      backlinksHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: 12,
        paddingVertical: 10,
      },
      backlinksTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      backlinksList: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 6,
      },
      backlinkRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      sourceWrap: {
        flex: 1,
        minHeight: 0,
        padding: layout.compact ? 12 : 16,
        gap: 10,
      },
      sourceInput: {
        flex: 1,
        minHeight: 240,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        fontFamily: monoFont,
        fontSize: 13,
        lineHeight: 20,
        textAlignVertical: "top" as const,
      },
      errorWrap: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: 24,
        gap: 10,
      },
      errorText: {
        color: theme.colors.statusDanger,
        fontSize: 14,
        textAlign: "center" as const,
      },
    }),
    [theme, layout.compact, kindColor, monoFont],
  );

  if (diskText === null && !loadError) {
    return (
      <View style={styles.root}>
        <Loading />
      </View>
    );
  }

  if (diskText === null && loadError) {
    return (
      <View style={styles.root}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{deleted ? "This slip was deleted on disk." : loadError.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadFromDisk()} style={styles.actionBtn}>
            <Text style={styles.actionText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const showMetadataCard = isSlip && (parsed.hasFrontMatter || context.inBox);

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.segmented}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: viewState.view === "preview" }}
            onPress={() => setViewState({ view: "preview" })}
            style={[styles.segBtn, viewState.view === "preview" ? styles.segBtnActive : undefined]}
          >
            <Text style={[styles.segLabel, viewState.view === "preview" ? styles.segLabelActive : undefined]}>
              Preview
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: viewState.view === "source" }}
            onPress={() => setViewState({ view: "source" })}
            style={[styles.segBtn, viewState.view === "source" ? styles.segBtnActive : undefined]}
          >
            <Text style={[styles.segLabel, viewState.view === "source" ? styles.segLabelActive : undefined]}>
              Source{dirty ? " •" : ""}
            </Text>
          </Pressable>
        </View>

        <View style={styles.toolbarActions}>
          {isSlip ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Copy [[${wikiName}]]`}
              onPress={handleCopyWikiLink}
              style={styles.actionBtn}
            >
              <Icon name="Copy" size={13} color={theme.colors.foregroundMuted} />
              <Text style={styles.actionText}>[[link]]</Text>
            </Pressable>
          ) : null}

          {viewState.view === "source" && !isCapture && dirty ? (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => {
                  setDraft(diskText ?? "");
                  setDirtyFlag(false);
                  setConflict(false);
                }}
                style={[styles.actionBtn, saving ? styles.actionBtnDisabled : undefined]}
              >
                <Text style={styles.actionText}>Revert</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void commitWrite(draft, { successMessage: "Saved" })}
                style={[styles.actionBtn, styles.actionBtnPrimary, saving ? styles.actionBtnDisabled : undefined]}
              >
                <Text style={styles.actionTextPrimary}>{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
            </>
          ) : null}

          {isSlip && !isCapture && !deleted ? (
            isSettled ? (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => handleSettleAction("reopen")}
                style={[styles.actionBtn, saving ? styles.actionBtnDisabled : undefined]}
              >
                <Icon name="RotateCcw" size={13} color={theme.colors.foregroundMuted} />
                <Text style={styles.actionText}>Reopen</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => handleSettleAction("settle")}
                  style={[styles.actionBtn, saving ? styles.actionBtnDisabled : undefined]}
                >
                  <Icon name="Check" size={13} color={theme.colors.statusSuccess} />
                  <Text style={styles.actionText}>Settle</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => handleSettleAction("save")}
                  style={[styles.actionBtn, saving ? styles.actionBtnDisabled : undefined]}
                >
                  <Icon name="BookmarkCheck" size={13} color={theme.colors.accent} />
                  <Text style={styles.actionText}>{layout.compact ? "Save" : "Save & settle"}</Text>
                </Pressable>
              </>
            )
          ) : null}
        </View>
      </View>

      {deleted ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>This file was deleted on disk.</Text>
        </View>
      ) : null}

      {conflict ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>The file changed on disk since you started editing.</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadFromDisk()}>
            <Text style={styles.bannerLink}>Reload</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void commitWrite(pendingSettleText ?? draft, { force: true, successMessage: "Overwrote file" })
            }
          >
            <Text style={styles.bannerLink}>Overwrite</Text>
          </Pressable>
        </View>
      ) : null}

      {viewState.view === "source" ? (
        <View style={styles.sourceWrap}>
          {isCapture ? (
            <Text style={styles.mutedMeta}>Captures are read-only by convention.</Text>
          ) : null}
          <TextInput
            multiline
            editable={!isCapture && !deleted}
            value={draft}
            onChangeText={(next) => {
              setDraft(next);
              setDirtyFlag(next !== diskText);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={styles.sourceInput}
          />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.frame}>
            {showMetadataCard ? (
              <View style={styles.metaCard}>
                <View style={styles.pillRow}>
                  {parsed.frontMatter.emoji ? <Text style={styles.emoji}>{parsed.frontMatter.emoji}</Text> : null}
                  {kind ? (
                    <View style={styles.pill}>
                      <View style={styles.kindDot} />
                      <Text style={styles.pillText}>{kind}</Text>
                    </View>
                  ) : null}
                  {!isCapture ? (
                    <View style={styles.pill}>
                      <Text style={isSettled ? styles.statusTextSettled : styles.statusTextOpen}>
                        {isSettled
                          ? `${isSaved ? "saved" : "settled"} · ${parsed.frontMatter.settled}`
                          : "open"}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.pill}>
                      <Text style={styles.statusTextSettled}>read-only capture</Text>
                    </View>
                  )}
                  {parsed.frontMatter.due ? (
                    <View style={styles.pill}>
                      <Text style={styles.dueText}>due {parsed.frontMatter.due}</Text>
                    </View>
                  ) : null}
                  {context.relativePath ? <Text style={styles.mutedMeta}>{context.relativePath}</Text> : null}
                </View>

                {parsed.frontMatter.about ||
                parsed.frontMatter.from ||
                parsed.frontMatter.source ||
                parsed.frontMatter.settled_by ||
                extraFrontMatter.length > 0 ? (
                  <View style={styles.metaDetails}>
                    {parsed.frontMatter.about ? (
                      <View style={styles.metaLine}>
                        <Text style={styles.metaKey}>about</Text>
                        <Text selectable style={styles.metaValue}>
                          {shortAboutLabel(parsed.frontMatter.about)}
                        </Text>
                      </View>
                    ) : null}
                    {parsed.frontMatter.from ? (
                      <View style={styles.metaLine}>
                        <Text style={styles.metaKey}>from</Text>
                        {fromMarkdown ? (
                          <Markdown>{fromMarkdown}</Markdown>
                        ) : (
                          <Text selectable style={styles.metaValue}>
                            {parsed.frontMatter.from}
                          </Text>
                        )}
                      </View>
                    ) : null}
                    {parsed.frontMatter.source ? (
                      <View style={styles.metaLine}>
                        <Text style={styles.metaKey}>source</Text>
                        {isHttpUrl(parsed.frontMatter.source) ? (
                          <ExternalLink href={parsed.frontMatter.source}>{parsed.frontMatter.source}</ExternalLink>
                        ) : (
                          <Text selectable style={styles.metaValue}>
                            {parsed.frontMatter.source}
                          </Text>
                        )}
                      </View>
                    ) : null}
                    {parsed.frontMatter.settled_by ? (
                      <View style={styles.metaLine}>
                        <Text style={styles.metaKey}>settled by</Text>
                        <Text selectable style={styles.mutedMeta}>
                          {parsed.frontMatter.settled_by}
                        </Text>
                      </View>
                    ) : null}
                    {extraFrontMatter.map((entry) => (
                      <View key={entry.key} style={styles.metaLine}>
                        <Text style={styles.metaKey}>{entry.key}</Text>
                        <Text selectable style={styles.mutedMeta}>
                          {entry.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.bodyWrap}>
              {segments.map((segment, index) =>
                segment.kind === "markdown" ? (
                  <Markdown key={`md-${index}`}>{segment.text}</Markdown>
                ) : (
                  <EmbeddedSlipCard key={`embed-${segment.target}-${index}`} segment={segment} theme={theme} />
                ),
              )}
            </View>

            {context.backlinks.length > 0 ? (
              <View style={styles.backlinksCard}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setBacklinksOpen((prev) => !prev)}
                  style={styles.backlinksHeader}
                >
                  <Text style={styles.backlinksTitle}>
                    Referenced by {context.backlinks.length} {context.backlinks.length === 1 ? "slip" : "slips"}
                  </Text>
                  <Icon
                    name={backlinksOpen ? "ChevronDown" : "ChevronRight"}
                    size={15}
                    color={theme.colors.foregroundMuted}
                  />
                </Pressable>
                {backlinksOpen ? (
                  <View style={styles.backlinksList}>
                    {context.backlinks.map((item) => {
                      const label = item.emoji ? `${item.emoji} ${item.title}` : item.title;
                      const md = `[${escapeMarkdownLinkLabel(label)}](<${buildFileLinkUrl(item.path)}>)`;
                      return (
                        <View key={item.relativePath} style={styles.backlinkRow}>
                          <Markdown>{md}</Markdown>
                          <Text style={styles.mutedMeta}>
                            {item.kind}
                            {item.settled ? " · settled" : ""}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

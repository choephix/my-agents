import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginTimelineItemProps, useAgent } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { TanIdSchema, type TanState } from "../shared/tan";
import { IconButton, useNow } from "./btw-sheet";
import type { OmpProviders } from "./omp-providers";
import { formatDuration, formatElapsed } from "./btw-store";
import { plainText } from "./markdown";
import { BODY, MarkdownView, UI_FONT } from "./markdown-view";

/*
 * /tan in an OMP chat becomes one row: your words in a dashed bubble on your side, and
 * under it the tangent's call line (agent, status, what it is doing), which opens to its
 * steps or its result. Its sources (see index.client.tsx):
 * - live: Paseo's echo of the `/tan …` send;
 * - reloaded chats, and live at the agent's next turn when it was busy: OMP's
 *   `background-tan-dispatch` record. A live echo row for the same tangent wins.
 * Paseo's plugin API cannot transform notifications, so OMP's "Background job … has
 * completed" notice stays as it is.
 */

export const TanRowData = z.object({
  source: z.enum(["echo", "dispatch"]),
  tanId: TanIdSchema.optional(),
  work: z.string().optional(),
});
export type TanRowData = z.infer<typeof TanRowData>;

export interface TanRpc {
  status(agentId: string, tanId: string | undefined, at: number): Promise<TanState | null>;
}

const SMALL = { fontSize: 12, lineHeight: 18, fontFamily: UI_FONT };
const LINE = { fontSize: 13, lineHeight: 20, fontFamily: UI_FONT };
const POLL_MS = 1000;
/** A row whose tangent is not found yet (its file is still being written) retries this often. */
const MISSING_RETRIES = 10;

/**
 * The live echo row that shows each tangent on this client (`agentId/tanId` → its time).
 * Paseo can echo one send twice (the composer's `/follow-up /tan …` and OMP's `/tan …`),
 * and a busy chat later adds OMP's dispatch record; only the first echo row draws.
 */
const echoRows = new Map<string, number>();
const echoListeners = new Set<() => void>();
function claimEchoRow(key: string, at: number) {
  if (echoRows.has(key)) return;
  echoRows.set(key, at);
  for (const listener of echoListeners) listener();
}
function subscribeEchoRows(listener: () => void) {
  echoListeners.add(listener);
  return () => void echoListeners.delete(listener);
}

/** Last known states, so a row scrolled back into view (remounted) does not flash empty. */
const known = new Map<string, TanState>();

function useTanState(rpc: TanRpc, agentId: string, tanId: string | undefined, at: number, enabled: boolean): TanState | null {
  const key = `${agentId}/${tanId ?? `@${at}`}`;
  const [state, setState] = useState<TanState | null>(() => known.get(key) ?? null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    let misses = 0;
    const load = async () => {
      const next = await rpc.status(agentId, tanId, at).catch(() => null);
      if (cancelled) return;
      if (next) {
        known.set(key, next);
        setState(next);
      } else misses += 1;
      if (next ? next.status === "running" : misses < MISSING_RETRIES) timer = setTimeout(load, POLL_MS);
    };
    const cached = known.get(key);
    if (!cached || cached.status === "running") void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rpc, agentId, tanId, at, key, enabled]);
  return state;
}

/** `#rrggbb` / `#rgb` with an alpha; other colour forms unchanged. */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex;
  return `#${full}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

function statusLabel(state: TanState | null, now: number, at: number): string {
  if (!state) return "starting…";
  const took = state.durationMs === undefined ? "" : formatDuration(state.durationMs);
  switch (state.status) {
    case "running":
      return `running ${formatElapsed(now - (state.startedAt || at))}`;
    case "done":
      return took ? `done in ${took}` : "done";
    case "failed":
      return took ? `failed after ${took}` : "failed";
    case "stopped":
      return took ? `stopped after ${took}` : "stopped";
  }
}

/** The muted second half of the call line: the newest step while running, else the result's first line. */
function peek(state: TanState | null): string {
  if (!state) return "";
  if (state.status === "running") {
    const step = state.steps.at(-1);
    return step ? (step.tool ? `${step.tool} · ${step.text}` : step.text) : "";
  }
  if (state.result) return plainText(state.result).split("\n")[0].replace(/^(?:[•*-]|\d+\.)\s+/, "");
  return state.status === "stopped" ? "no result; the chat's OMP process ended or restarted" : "";
}

function Steps({ state, theme }: { state: TanState; theme: PluginTheme }) {
  const muted = theme.colors.foregroundMuted;
  if (!state.steps.length) return <Text style={[SMALL, { color: muted }]}>Starting…</Text>;
  return (
    <View style={styles.steps}>
      {state.steps.map((step, index) => {
        const current = index === state.steps.length - 1;
        return (
          <View key={index} style={styles.step}>
            <View style={styles.stepMark}>
              {current ? <ActivityIndicator size={10} color={muted} /> : <View style={[styles.dot, { backgroundColor: withAlpha(muted, 0.5) }]} />}
            </View>
            <Text numberOfLines={1} style={[SMALL, styles.flex, { color: muted, opacity: current ? 1 : 0.8 }]}>
              {step.tool ? <Text style={{ color: theme.colors.foreground, opacity: 0.75 }}>{step.tool} </Text> : null}
              <Text style={step.tool ? null : { fontStyle: "italic" }}>{step.text}</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function useCopy(text: string) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    copyText(text).then(
      () => setCopied(true),
      () => toast.error("Could not copy. Select the text and copy it instead."),
    );
  return { copied, copy };
}

export function createTanRow(rpc: TanRpc, providers: OmpProviders) {
  return function TanRow({ agentId, item, timestamp, theme, layout }: PluginTimelineItemProps<TanRowData>) {
    const data = item.data;
    const at = timestamp.getTime();
    const touch = layout.compact || layout.platform !== "web";
    // The echo of a plugin /tan send to another provider is just that provider's message.
    const provider = useAgent(agentId, agent => agent.provider);
    const providerIsOmp = useSyncExternalStore(providers.subscribe, () => (provider ? providers.peek(provider) : undefined));
    const omp = data.source === "dispatch" || providerIsOmp === true;
    const state = useTanState(rpc, agentId, data.tanId, at, omp);
    const tanId = data.tanId ?? state?.tanId;
    const key = tanId ? `${agentId}/${tanId}` : undefined;
    useEffect(() => {
      if (data.source === "echo" && key) claimEchoRow(key, at);
    }, [data.source, key, at]);
    const shadowed = useSyncExternalStore(subscribeEchoRows, () => {
      const claim = key ? echoRows.get(key) : undefined;
      return claim !== undefined && (data.source === "dispatch" || claim !== at);
    });
    const [open, setOpen] = useState(false);
    const [rowHovered, setRowHovered] = useState(false);
    const [bubbleHovered, setBubbleHovered] = useState(false);
    const [nameHovered, setNameHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const work = state?.work || data.work || "";
    const yours = useCopy(work);
    const result = useCopy(state?.result ?? "");
    const now = useNow(state?.status === "running");
    if (shadowed) return null;
    if (!omp) {
      return provider && providerIsOmp === false ? (
        <View style={[styles.echo, { backgroundColor: theme.colors.surface2 }]}>
          <Text selectable style={[BODY, { color: theme.colors.foreground }]}>{`/tan ${data.work ?? ""}`}</Text>
        </View>
      ) : null;
    }

    const muted = theme.colors.foregroundMuted;
    const failed = state?.status === "failed";
    const lineColor = failed ? theme.colors.statusDanger : muted;
    const peekText = peek(state);
    // The full id, model and run time; the closed line shows the model only while its name is hovered.
    const meta = [state?.tanId, state?.model, state && state.status !== "running" && state.durationMs !== undefined ? formatDuration(state.durationMs) : undefined]
      .filter(Boolean)
      .join(" · ");
    const showActions = touch || rowHovered || focused;
    const icon =
      state?.status === "running" || !state ? (
        <ActivityIndicator size={11} color={muted} />
      ) : (
        <Icon name={failed ? "CircleAlert" : "CornerDownRight"} size={12} color={lineColor} />
      );

    return (
      <View style={styles.root} onPointerEnter={() => setRowHovered(true)} onPointerLeave={() => setRowHovered(false)}>
        {work ? (
          <View
            style={[styles.bubble, { borderColor: withAlpha(muted, 0.45) }]}
            onPointerEnter={() => setBubbleHovered(true)}
            onPointerLeave={() => setBubbleHovered(false)}
          >
            <Text selectable style={[BODY, styles.bubbleText, { color: bubbleHovered ? theme.colors.foreground : muted }]}>
              {work}
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Hide the tangent's details" : "Show the tangent's details"}
          onPress={() => setOpen(value => !value)}
          style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.line, hovered && { backgroundColor: theme.colors.surface2 }]}
        >
          <View style={styles.icon}>{icon}</View>
          <Text style={[LINE, styles.tag, { color: muted }]}>tan</Text>
          {tanId ? (
            <View onPointerEnter={() => setNameHovered(true)} onPointerLeave={() => setNameHovered(false)}>
              <Text numberOfLines={1} style={[SMALL, { color: muted, opacity: 0.75 }]}>
                {nameHovered && state?.model ? `Tan-${tanId.slice(-4)} · ${state.model}` : `Tan-${tanId.slice(-4)}`}
              </Text>
            </View>
          ) : null}
          <Text style={[SMALL, { color: muted, opacity: 0.5 }]}>·</Text>
          <Text style={[SMALL, styles.status, { color: failed ? theme.colors.statusDanger : muted }]}>{statusLabel(state, now, at)}</Text>
          {peekText && !open ? (
            <>
              <Text style={[SMALL, { color: muted, opacity: 0.5 }]}>·</Text>
              <Text numberOfLines={1} style={[SMALL, styles.flex, { color: lineColor, opacity: 0.8 }]}>
                {peekText}
              </Text>
            </>
          ) : (
            <View style={styles.flex} />
          )}
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={muted} />
          <View style={{ opacity: showActions && work ? 1 : 0 }} pointerEvents={showActions && work ? "auto" : "none"}>
            <IconButton
              icon={yours.copied ? "Check" : "Copy"}
              label={yours.copied ? "Copied" : "Copy your text"}
              onPress={() => void yours.copy()}
              onFocusChange={setFocused}
              theme={theme}
            />
          </View>
        </Pressable>
        {open && state ? (
          <View style={[styles.rail, { borderColor: withAlpha(theme.colors.foregroundMuted, 0.25) }]}>
            {state.status === "running" ? (
              <>
                <Steps state={state} theme={theme} />
                {meta ? (
                  <Text selectable numberOfLines={1} style={[SMALL, styles.foot, { color: muted, opacity: 0.8 }]}>
                    {meta}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                {state.result ? <MarkdownView source={state.result} theme={theme} /> : null}
                <View style={styles.foot}>
                  <Text selectable numberOfLines={1} style={[SMALL, styles.flex, { color: muted, opacity: 0.8 }]}>
                    {meta}
                  </Text>
                  {state.result ? (
                    <IconButton
                      icon={result.copied ? "Check" : "Copy"}
                      label={result.copied ? "Copied" : "Copy result"}
                      onPress={() => void result.copy()}
                      theme={theme}
                    />
                  ) : null}
                </View>
              </>
            )}
          </View>
        ) : null}
      </View>
    );
  };
}

const styles = StyleSheet.create({
  root: { gap: 2, marginVertical: 2 },
  bubble: { alignSelf: "flex-end", maxWidth: "78%", borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  line: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, marginHorizontal: -6, minHeight: 26, borderRadius: 6 },
  icon: { width: 14, alignItems: "center" },
  tag: { fontWeight: "600" },
  status: { flexShrink: 0 },
  flex: { flex: 1, minWidth: 0 },
  rail: { marginLeft: 6, marginTop: 2, marginBottom: 4, paddingLeft: 14, paddingVertical: 2, borderLeftWidth: 2 },
  steps: { gap: 2 },
  step: { flexDirection: "row", alignItems: "center", gap: 7 },
  stepMark: { width: 12, alignItems: "center" },
  dot: { width: 4, height: 4, borderRadius: 2 },
  foot: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  echo: { alignSelf: "flex-end", maxWidth: "78%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
});

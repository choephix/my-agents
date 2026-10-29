import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type TextInput as NativeTextInput, type ViewStyle } from "react-native";
import { Interactive } from "./interactive";
import { Bar, Glyph, LABEL, ROW, SMALL, type Palette } from "./marks";
import { onSlash, tooltip } from "./web";

/** A full-width pressable row with hover and pressed states. */
export function RowButton(props: {
  c: Palette;
  onPress?(): void;
  style?: StyleProp<ViewStyle>;
  hot?: boolean;
  label?: string;
  title?: string;
  /** Web hover, used to read ahead what `onPress` opens. */
  onHoverIn?(): void;
  onHoverOut?(): void;
  children: ReactNode;
}) {
  const { c } = props;
  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={props.label}
      ref={props.title ? tooltip(props.title) : undefined}
      disabled={!props.onPress}
      onPress={props.onPress}
      onHoverIn={props.onHoverIn}
      onHoverOut={props.onHoverOut}
      style={({ hovered, pressed, focused }) => {
        const live = !!props.onPress;
        return [
          props.style,
          props.hot ? { backgroundColor: live && (hovered || pressed) ? c.hoverHot : c.s2 } : live && pressed ? { backgroundColor: c.press } : live && hovered ? { backgroundColor: c.hover } : null,
          focused ? { outlineColor: c.accent, outlineStyle: "solid", outlineWidth: 2, outlineOffset: -2 } : null,
        ];
      }}
    >
      {props.children}
    </Interactive>
  );
}

export function IconButton(props: { c: Palette; icon: string; label: string; onPress(): void; size?: number; active?: boolean; flip?: boolean }) {
  const { c } = props;
  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={props.label}
      ref={tooltip(props.label)}
      onPress={props.onPress}
      hitSlop={6}
      style={({ hovered, pressed }) => [
        styles.iconButton,
        props.active || pressed ? { backgroundColor: c.press } : hovered ? { backgroundColor: c.hover } : null,
      ]}
    >
      <View style={props.flip ? { transform: [{ scaleX: -1 }] } : undefined}>
        <Icon name={props.icon} size={props.size ?? 14} color={c.muted} />
      </View>
    </Interactive>
  );
}

export function Button(props: {
  c: Palette;
  label: string;
  onPress(): void;
  kind?: "primary" | "normal" | "ghost";
  icon?: string;
  busy?: boolean;
  title?: string;
  onHoverIn?(): void;
  big?: boolean;
}) {
  const { c } = props;
  const kind = props.kind ?? "normal";
  const color = kind === "primary" ? c.accentFg : kind === "ghost" ? c.muted : c.fg;
  return (
    <Interactive
      accessibilityRole="button"
      ref={props.title ? tooltip(props.title) : undefined}
      disabled={props.busy}
      onPress={props.onPress}
      onHoverIn={props.onHoverIn}
      style={({ hovered, pressed }) => [
        styles.button,
        props.big ? { height: 34, paddingHorizontal: 14 } : null,
        kind === "primary"
          ? { backgroundColor: c.accent, borderColor: c.accent, opacity: pressed || props.busy ? 0.75 : hovered ? 0.9 : 1 }
          : kind === "ghost"
            ? { borderColor: "transparent", backgroundColor: pressed ? c.press : hovered ? c.hover : "transparent" }
            : { borderColor: c.border, backgroundColor: pressed ? c.press : hovered ? c.hover : c.s0 },
      ]}
    >
      {props.icon ? <Icon name={props.icon} size={13} color={color} /> : null}
      <Text numberOfLines={1} style={{ ...SMALL, color, fontWeight: kind === "primary" ? "500" : "400" }}>
        {props.busy ? `${props.label}…` : props.label}
      </Text>
    </Interactive>
  );
}

/** Back row of a drill-in page: `‹ acme-task` and optional controls on the right. */
export function BackRow({ c, label, onBack, right }: { c: Palette; label: string; onBack(): void; right?: ReactNode }) {
  return (
    <View style={[styles.back, { borderBottomColor: c.border }]}>
      <Interactive
        accessibilityRole="button"
        accessibilityLabel={`Back to ${label}`}
        onPress={onBack}
        style={({ hovered, pressed }) => [styles.backButton, pressed ? { backgroundColor: c.press } : hovered ? { backgroundColor: c.hover } : null]}
      >
        <Icon name="ChevronLeft" size={14} color={c.muted} />
        <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, flexShrink: 1 }}>
          {label}
        </Text>
      </Interactive>
      <View style={styles.grow} />
      {right}
    </View>
  );
}

/** `▸ Name  count  •  tail` — a fold header, border on top. */
export function FoldHeader(props: {
  c: Palette;
  name: string;
  count?: string | number;
  open: boolean;
  onToggle(): void;
  tail?: ReactNode;
  right?: ReactNode;
  first?: boolean;
}) {
  const { c } = props;
  return (
    <View style={[styles.fold, { borderTopColor: c.border, borderTopWidth: props.first ? 0 : StyleSheet.hairlineWidth }]}>
      <Interactive
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        onPress={props.onToggle}
        style={({ hovered, pressed }) => [styles.foldPress, pressed ? { backgroundColor: c.press } : hovered ? { backgroundColor: c.hover } : null]}
      >
        <Icon name={props.open ? "ChevronDown" : "ChevronRight"} size={11} color={c.muted} />
        <Text numberOfLines={1} style={{ ...ROW, color: c.fg, flexShrink: 0 }}>
          {props.name}
        </Text>
        {props.count !== undefined ? <Text style={{ ...SMALL, color: c.muted, flexShrink: 0 }}>{props.count}</Text> : null}
        {!props.open && props.tail ? (
          <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, flex: 1, minWidth: 0 }}>
            {props.tail}
          </Text>
        ) : (
          <View style={styles.grow} />
        )}
      </Interactive>
      {props.right}
    </View>
  );
}

/** Small label above a group: `Blocked · 1`. */
export function GroupLabel({ c, text }: { c: Palette; text: string }) {
  return <Text style={{ ...LABEL, color: c.muted, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 2 }}>{text}</Text>;
}

/** `▬ 0/9 done · 8 ready · 1 blocked` in words; the bar drops out when narrow. */
export function CountsLine(props: {
  c: Palette;
  counts: { total: number; done: number; ready: number; claimed: number; blocked: number; parked: number };
  narrow?: boolean;
}) {
  const { c, counts } = props;
  if (!counts.total) return null;
  const rest = (
    [
      ["ready", counts.ready],
      ["claimed", counts.claimed],
      ["blocked", counts.blocked],
      ["parked", counts.parked],
    ] as const
  ).filter(([, count]) => count > 0);
  return (
    <View style={styles.line}>
      {props.narrow ? null : <Bar done={counts.done} total={counts.total} c={c} />}
      <Text numberOfLines={1} style={{ ...SMALL, color: c.muted, flexShrink: 1 }}>
        <Text style={{ color: c.fg, fontWeight: "500" }}>
          {counts.done}/{counts.total} done
        </Text>
        {rest.map(([word, count]) => ` · ${count} ${word}`).join("")}
      </Text>
    </View>
  );
}

/** Search field; `/` focuses it on web while `slash` is true, shown as a kbd hint. */
export function SearchField(props: {
  c: Palette;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  slash?: boolean;
  compact?: boolean;
  onSubmit?(): void;
}) {
  const { c } = props;
  const input = useRef<NativeTextInput>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => (props.slash ? onSlash(() => input.current?.focus()) : undefined), [props.slash]);
  return (
    <View
      style={[
        styles.search,
        { height: props.compact ? 34 : 28, backgroundColor: c.s1, borderColor: focused ? c.accent : c.border },
      ]}
    >
      <Icon name="Search" size={14} color={c.muted} />
      <TextInput
        ref={input}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={c.muted}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={props.onSubmit}
        autoCorrect={false}
        autoCapitalize="none"
        style={[styles.searchInput, { color: c.fg }, Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null]}
      />
      {props.value ? (
        <Interactive
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => props.onChange("")}
          hitSlop={6}
          style={({ hovered, pressed }) => [styles.clear, pressed ? { backgroundColor: c.press } : hovered ? { backgroundColor: c.hoverS1 } : null]}
        >
          <Icon name="X" size={13} color={c.muted} />
        </Interactive>
      ) : props.slash && Platform.OS === "web" && !props.compact ? (
        <Text style={[styles.kbd, { color: c.muted, borderColor: c.border, backgroundColor: c.s0 }]}>/</Text>
      ) : null}
    </View>
  );
}

/** A ticket row: glyph, number, title, tail. */
export function TicketRow(props: {
  c: Palette;
  state: Parameters<typeof Glyph>[0]["state"];
  num: string;
  title: string;
  tail?: string;
  next?: boolean;
  onPress?(): void;
  big?: boolean;
  /** Popover rows: 24 px tall, 6 px inset. */
  compact?: boolean;
  /** Drawn muted like a blocked ticket (popover: open but untouched for a week). */
  faded?: boolean;
  label?: string;
  onHoverIn?(): void;
  onHoverOut?(): void;
}) {
  const { c } = props;
  const dim = props.faded || props.state === "blocked" || props.state === "parked" || props.state === "done";
  return (
    <RowButton
      c={c}
      onPress={props.onPress}
      onHoverIn={props.onHoverIn}
      onHoverOut={props.onHoverOut}
      hot={props.next}
      label={props.label ?? `${props.num} ${props.title}`}
      style={[styles.ticket, props.big ? { height: 40, paddingHorizontal: 14 } : props.compact ? { height: 24, paddingHorizontal: 6 } : null]}
    >
      <Glyph state={props.state} c={c} />
      <Text style={{ ...SMALL, width: 18, flexShrink: 0, color: props.next ? c.fg : c.muted, fontVariant: ["tabular-nums"] }}>{props.num}</Text>
      <Text
        numberOfLines={1}
        style={{
          ...(props.big ? { fontSize: 15, lineHeight: 20 } : ROW),
          color: dim ? c.muted : c.fg,
          fontWeight: props.next ? "500" : "400",
          flexShrink: 1,
        }}
      >
        {props.title}
      </Text>
      <View style={styles.grow} />
      {props.tail ? (
        <Text numberOfLines={1} style={{ ...SMALL, color: props.next ? c.fg : c.muted, opacity: props.next ? 0.85 : 1, flexShrink: 0, paddingLeft: 6 }}>
          {props.tail}
        </Text>
      ) : null}
    </RowButton>
  );
}

export const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 },
  iconButton: { width: 24, height: 24, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  back: { flexDirection: "row", alignItems: "center", gap: 2, height: 34, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { flexDirection: "row", alignItems: "center", gap: 4, height: 26, paddingHorizontal: 4, borderRadius: 6, flexShrink: 1 },
  fold: { flexDirection: "row", alignItems: "center" },
  foldPress: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 12 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth * 2 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 13, paddingVertical: 0 },
  kbd: { fontSize: 11, lineHeight: 15, paddingHorizontal: 5, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth * 2 },
  clear: { width: 20, height: 20, borderRadius: 4, alignItems: "center", justifyContent: "center", marginRight: -4 },
  ticket: { flexDirection: "row", alignItems: "center", gap: 8, height: 26, paddingHorizontal: 12 },
});

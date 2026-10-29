import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Interactive } from "./interactive";
import { Bar, Glyph, LABEL, type Palette } from "./marks";

function LegendRow({ c, sym, text }: { c: Palette; sym: ReactNode; text: string }) {
  return (
    <View style={styles.legendRow}>
      <View style={styles.sym}>{sym}</View>
      <Text style={{ fontSize: 12.5, lineHeight: 16, color: c.fg, flex: 1 }}>{text}</Text>
    </View>
  );
}

/** Every mark the plugin draws, once. */
export function Legend({ c, global }: { c: Palette; global?: boolean }) {
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4 }}>
      <Text style={{ ...LABEL, color: c.muted, marginVertical: 3 }}>Legend</Text>
      <LegendRow c={c} sym={<Glyph state="ready" c={c} />} text="open, nothing blocks it" />
      <LegendRow
        c={c}
        sym={<Text style={{ ...LABEL, color: c.fg }}>next</Text>}
        text="lowest-numbered open ticket nothing blocks and no agent has claimed"
      />
      <LegendRow c={c} sym={<Glyph state="blocked" c={c} />} text="blocked by an open ticket" />
      <LegendRow c={c} sym={<Glyph state="claimed" c={c} />} text="claimed (an agent is on it)" />
      <LegendRow c={c} sym={<Glyph state="parked" c={c} />} text="parked" />
      <LegendRow c={c} sym={<Glyph state="done" c={c} />} text="done (resolved / closed)" />
      {global ? null : (
        <LegendRow
          c={c}
          sym={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Icon name="GitBranch" size={12} color={c.muted} />
              <Text style={{ ...LABEL, color: c.amber }}>3</Text>
            </View>
          }
          text="files & commits; amber: files not committed"
        />
      )}
      <LegendRow c={c} sym={<Bar done={4} total={12} c={c} width={30} />} text="share of tickets done" />
      <LegendRow
        c={c}
        sym={
          <Text style={{ ...LABEL, color: c.muted, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.border, borderRadius: 5, paddingHorizontal: 4 }}>
            Edu?
          </Text>
        }
        text="suggested workspace, not bound (a name chip with ?)"
      />
      {global ? <LegendRow c={c} sym={<View style={{ width: 3, height: 14, backgroundColor: c.fg }} />} text="the effort you came from" /> : null}
    </View>
  );
}

export interface MenuItem {
  icon: string;
  label: string;
  hint?: string;
  muted?: boolean;
  onPress(): void;
}

/** An anchored menu drawn inside the surface, closed by tapping outside it. */
export function Menu(props: { c: Palette; items: MenuItem[]; legend?: "panel" | "global"; onClose(): void; top: number; width?: number }) {
  const { c } = props;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable accessibilityLabel="Close menu" style={StyleSheet.absoluteFill} onPress={props.onClose} />
      <View
        style={[
          styles.menu,
          { top: props.top, width: props.width ?? 280, backgroundColor: c.s0, borderColor: c.border, shadowColor: "#000" },
        ]}
      >
        {props.items.map((item) => (
          <Interactive
            key={item.label}
            accessibilityRole="menuitem"
            onPress={() => {
              props.onClose();
              item.onPress();
            }}
            style={({ hovered, pressed }) => [styles.item, pressed ? { backgroundColor: c.press } : hovered ? { backgroundColor: c.hover } : null]}
          >
            <Icon name={item.icon} size={13} color={c.muted} />
            <Text numberOfLines={1} style={{ fontSize: 13, color: item.muted ? c.muted : c.fg, flexShrink: 1 }}>
              {item.label}
            </Text>
            {item.hint ? (
              <Text numberOfLines={1} style={{ ...LABEL, color: c.muted, marginLeft: "auto", flexShrink: 1, paddingLeft: 8 }}>
                {item.hint}
              </Text>
            ) : null}
          </Interactive>
        ))}
        {props.items.length && props.legend ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 5 }} /> : null}
        {props.legend ? <Legend c={c} global={props.legend === "global"} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22, paddingVertical: 2 },
  sym: { width: 40, alignItems: "center", flexShrink: 0 },
  menu: {
    position: "absolute",
    right: 8,
    zIndex: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingVertical: 6,
    shadowOpacity: 0.35,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  item: { flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingHorizontal: 12 },
});

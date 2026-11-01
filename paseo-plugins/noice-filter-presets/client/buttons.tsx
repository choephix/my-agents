import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Pressable, Text } from "react-native";
import type { Choice } from "./data";

export const labelStyle = { fontSize: 9.5, lineHeight: 12, letterSpacing: 0.8, textTransform: "uppercase" } as const;

/** Small-caps labels; the active one sits on a 2px accent bar (no hairline: Paseo already draws dividers here). */
export function PresetButtons({ theme, choices, active, onSelect }: {
  theme: PluginHostProps["theme"];
  choices: Choice[];
  active: string;
  onSelect(id: string): void;
}) {
  return <>{choices.map(({ id, name }) => {
    const on = active === id;
    return <Pressable key={id} testID={`filter-preset-${id}`} accessibilityRole="button"
      accessibilityLabel={`Filter preset: ${name}`} accessibilityState={{ selected: on }} onPress={() => onSelect(id)}
      hitSlop={{ top: 6, bottom: 2, left: 4, right: 4 }}
      style={{ paddingTop: 3, paddingBottom: 2, borderBottomWidth: 2, borderBottomColor: on ? theme.colors.accent : "transparent" }}>
      {(state) => <Text style={{
        ...labelStyle, fontWeight: on ? "600" : "500",
        // react-native-web adds `hovered` to the pressable state; native never sets it.
        color: on || ("hovered" in state && state.hovered === true) ? theme.colors.foreground : theme.colors.foregroundMuted,
      }}>{name}</Text>}
    </Pressable>;
  })}</>;
}

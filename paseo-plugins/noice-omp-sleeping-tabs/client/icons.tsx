import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text } from "react-native";

/** 💤 in the pill's icon slot (Lucide has no "zzz"). */
export function SleepIcon({ size }: PluginButtonIconProps) {
  return <Text style={{ fontSize: Math.round(size * 0.86), lineHeight: size + 2 }}>💤</Text>;
}

export function WakeFailedIcon({ size, theme }: PluginButtonIconProps) {
  return <Icon name="TriangleAlert" size={size} color={theme.colors.statusDanger} />;
}

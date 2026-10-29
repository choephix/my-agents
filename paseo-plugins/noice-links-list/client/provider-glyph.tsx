import { Icon } from "@getpaseo/plugin/client/react-native";
import { Image, Platform } from "react-native";
import { PROVIDER_MARKS } from "./provider-marks";

/**
 * A tab's provider mark as Paseo draws it on its tabs: the built-in mark, else Bot. Marks are SVG
 * data URIs, which only web images render; native apps show Bot (as in `noice-past-sessions`).
 */
export function ProviderGlyph({ provider, size, color }: { provider: string; size: number; color: string }) {
  const svg = PROVIDER_MARKS[provider];
  if (!svg || Platform.OS !== "web") return <Icon name="Bot" size={size} color={color} />;
  // react-native-web percent-encodes `;utf8,` SVG data URIs itself; pre-encoding would double it.
  const uri = `data:image/svg+xml;utf8,${svg.replaceAll("currentColor", color)}`;
  return <Image source={{ uri }} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />;
}

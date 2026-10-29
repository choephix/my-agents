import { usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { Image, Platform } from "react-native";
import { PROVIDER_MARKS } from "./provider-marks";

/** Provider id → `iconSvg` the daemon ships for plugin providers (e.g. Antigravity). */
export function useSnapshotIcons(): ReadonlyMap<string, string> {
  const paseo = usePaseo();
  const { data } = useQuery({
    queryKey: ["provider-snapshot-icons"],
    queryFn: async () => {
      const snapshot = await paseo.providers.snapshot();
      return new Map(snapshot.entries.flatMap((entry) => (entry.iconSvg ? [[entry.provider, entry.iconSvg]] : [])));
    },
    staleTime: 10 * 60_000,
  });
  return data ?? EMPTY;
}
const EMPTY: ReadonlyMap<string, string> = new Map();

interface Props {
  /** Read by the `noice-provider-icons` plugin (with `serverId`) to repaint the Bot fallback. */
  provider: string;
  serverId: string;
  snapshotSvg: string | undefined;
  size: number;
  color: string;
}

/**
 * The provider's mark as Paseo draws it: built-in mark, else the daemon's SVG, else Bot.
 * Marks are SVG data URIs, which only web images render; phones show Bot.
 */
export function ProviderGlyph({ provider, snapshotSvg, size, color }: Props) {
  const svg = PROVIDER_MARKS[provider] ?? snapshotSvg;
  if (!svg || Platform.OS !== "web") return <Icon name="Bot" size={size} color={color} />;
  // react-native-web percent-encodes `;utf8,` SVG data URIs itself; pre-encoding would double it.
  const uri = `data:image/svg+xml;utf8,${svg.replaceAll("currentColor", color)}`;
  return <Image source={{ uri }} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />;
}

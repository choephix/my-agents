import { Platform } from "react-native";

/** The DOM this module touches; the plugin's tsconfig has no DOM lib. */
interface PressTarget {
  closest?(selector: string): unknown;
}

/** Web: whether a press landed on a link, so a link inside an agent card wins over the card. */
export function pressedLink(event: unknown): boolean {
  if (Platform.OS !== "web" || !event || typeof event !== "object" || !("target" in event)) return false;
  const target = event.target as PressTarget | null; // a DOM node on web
  return typeof target?.closest === "function" && !!target.closest("a[href]");
}

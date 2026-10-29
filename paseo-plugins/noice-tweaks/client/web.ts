import { Platform } from "react-native";
import { preferences, type Preferences, type TweakId } from "../shared/preferences";
import * as compactSidebar from "./compact-sidebar";
import * as fileWrap from "./file-wrap";
import * as linkColours from "./link-colours";

/** A tweak starts only when its switch is on; the function it returns undoes everything it did. */
export type Start = () => () => void;
export type Features = Record<TweakId, Start>;

export const FEATURES: Features = {
  compactSidebar: compactSidebar.start,
  fileWrap: fileWrap.start,
  linkColours: linkColours.start,
};

// Sanctioned web global; the rest of the plugin is compiled without the DOM library.
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const isWeb = Platform.OS === "web" && typeof document !== "undefined";
declare const document: unknown;

/** The switches as last applied in this browser, so a page load styles the sidebar before the
 *  daemon's settings arrive instead of jumping. The daemon's values win once they are read. */
export const CACHE_KEY = "paseo-plugin:noice-tweaks:switches";

function cachedSwitches(): Preferences | undefined {
  try {
    const parsed = preferences.schema.safeParse(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export interface Tweaks {
  apply(values: Preferences): void;
  dispose(): void;
}

/** Starts and stops each tweak to match its switch. Every start and stop is fenced, so one
 *  tweak failing leaves the others running. Nothing starts until switches are known. */
export function startTweaks(features: Features = FEATURES): Tweaks {
  if (!isWeb) return { apply() {}, dispose() {} };

  const running = new Map<TweakId, () => void>();
  const set = (id: TweakId, on: boolean) => {
    const stop = running.get(id);
    if (on && !stop) {
      try {
        running.set(id, features[id]());
      } catch (error) {
        console.error(`[noice-tweaks] ${id} failed to start`, error);
      }
    } else if (!on && stop) {
      running.delete(id);
      try {
        stop();
      } catch (error) {
        console.error(`[noice-tweaks] ${id} failed to stop`, error);
      }
    }
  };
  const setAll = (values: Preferences) => {
    for (const id of Object.keys(features) as TweakId[]) set(id, values[id]);
  };

  const cached = cachedSwitches();
  if (cached) setAll(cached);

  return {
    apply(values) {
      setAll(values);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(values)); } catch { /* Private browsing can deny storage. */ }
    },
    dispose() {
      for (const id of [...running.keys()]) set(id, false);
    },
  };
}

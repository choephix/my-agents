import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/presets";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  return () => {};
}

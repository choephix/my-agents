import type { PluginServerContext } from "@getpaseo/plugin/server";
import { settings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(settings);
  return () => {};
}

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readFileWindow } from "./server/read-file";
import { preferences, readEmbedFile } from "./shared/preferences";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  server.handle(readEmbedFile, readFileWindow);
  return () => {};
}

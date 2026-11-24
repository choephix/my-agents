import { stat } from "node:fs/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { resolveBoxFolder } from "./server/config";
import { SlipIndex } from "./server/index";
import { searchSlips } from "./server/search";
import { searchSlipsRpc } from "./shared/attachments";
import { boxStatusRpc, DEFAULT_SETTINGS, type SlipboxSettings, slipboxSettings } from "./shared/settings";

async function directoryExists(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(slipboxSettings);
  const index = new SlipIndex();

  const readSettings = async (): Promise<SlipboxSettings> => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : DEFAULT_SETTINGS;
  };

  server.handle(searchSlipsRpc, async ({ query }) => {
    const current = await readSettings();
    const resolved = await resolveBoxFolder(current.boxFolder);
    if (!resolved.folder) {
      if (resolved.source === "setting") {
        throw new Error("Slip-box folder setting must be an absolute path (or start with ~/).");
      }
      throw new Error("Set the slip-box folder in Settings -> Plugins -> Slip-box (or SLIPBOX_DIR).");
    }
    if (!(await directoryExists(resolved.folder))) {
      throw new Error(`Slip-box folder not found: ${resolved.folder}`);
    }
    const slips = await index.list(resolved.folder, current);
    return searchSlips(slips, query);
  });

  server.handle(boxStatusRpc, async () => {
    const current = await readSettings();
    const resolved = await resolveBoxFolder(current.boxFolder);
    if (!resolved.folder) {
      return { folder: null, source: resolved.source, exists: false, slipCount: 0 };
    }
    const exists = await directoryExists(resolved.folder);
    if (!exists) {
      return { folder: resolved.folder, source: resolved.source, exists: false, slipCount: 0 };
    }
    const slips = await index.list(resolved.folder, current);
    return { folder: resolved.folder, source: resolved.source, exists: true, slipCount: slips.length };
  });

  return () => {
    index.clear();
  };
}

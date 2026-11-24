import { stat } from "node:fs/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { resolveBoxFolder } from "./server/config";
import { createSlipFile } from "./server/create";
import { SlipIndex } from "./server/index";
import { resolveSlipContext } from "./server/resolve";
import { searchSlips } from "./server/search";
import { searchSlipsRpc } from "./shared/attachments";
import { createSlipRpc, resolveSlipContextRpc, SLIP_CREATED_TIMELINE_KIND } from "./shared/panel";
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

  const requireBoxFolder = async (): Promise<{ folder: string; current: SlipboxSettings }> => {
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
    return { folder: resolved.folder, current };
  };

  server.handle(searchSlipsRpc, async ({ query }) => {
    const { folder, current } = await requireBoxFolder();
    const slips = await index.list(folder, current);
    return searchSlips(slips, query);
  });

  server.handle(resolveSlipContextRpc, async ({ filePath, targets, embedRequests, includeBacklinks }) => {
    const current = await readSettings();
    const resolved = await resolveBoxFolder(current.boxFolder);
    return resolveSlipContext({
      boxFolder: resolved.folder,
      filePath,
      targets,
      embedRequests,
      includeBacklinks,
      index,
    });
  });

  server.handle(createSlipRpc, async (input, { paseo }) => {
    const { folder } = await requireBoxFolder();
    const created = await createSlipFile({
      boxFolder: folder,
      title: input.title,
      body: input.body,
      kind: input.kind,
      emoji: input.emoji,
      about: input.about,
      from: input.from,
    });

    if (input.agentId) {
      try {
        await paseo.agents.ref(input.agentId).timeline.append({
          type: "plugin",
          id: `slip-created:${created.wikiName}`,
          kind: SLIP_CREATED_TIMELINE_KIND,
          version: 1,
          data: {
            absolutePath: created.absolutePath,
            relativePath: created.relativePath,
            wikiName: created.wikiName,
            title: created.title,
            kind: created.kind,
            emoji: created.emoji,
          },
        });
      } catch (error) {
        console.warn("Could not append slip confirmation row to timeline:", error);
      }
    }

    return created;
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

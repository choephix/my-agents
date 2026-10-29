import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import path from "node:path";
import { BindingStore } from "./server/bindings";
import { EffortsService } from "./server/efforts";
import { bindRpc, detailRpc, overviewRpc, readRpc, searchRpc } from "./shared/rpc";
import { folderSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const dataDir = path.join(process.env.PASEO_HOME ?? path.join(homedir(), ".paseo"), "plugin-data", "efforts-dashboard");
  const service = new EffortsService(new BindingStore(path.join(dataDir, "bindings.json")), server.registerSettings(folderSettings));
  server.handle(overviewRpc, (input, context) => service.overview(input, context));
  server.handle(detailRpc, (input) => service.detail(input));
  server.handle(readRpc, (input) => service.read(input));
  server.handle(searchRpc, (input, context) => service.search(input, context));
  server.handle(bindRpc, (input) => service.bind(input));
  return () => {};
}

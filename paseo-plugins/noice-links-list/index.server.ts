import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { createLinksService, type LinksService } from "./server/service";
import { linksForAgent, linksForWorkspace } from "./shared/links";
import { headerSettings, webshareSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(headerSettings);
  const settings = server.registerSettings(webshareSettings);
  /** The service for the current webshare settings; a change starts a new one, whose cache is empty (cached links hold mapped URLs). */
  let current: { key: string; service: LinksService } | undefined;
  const getService = async () => {
    const webshare = await settings.read();
    if (webshare.status !== "ready") throw new Error(webshare.error);
    const { origin, folder } = webshare.values;
    const key = JSON.stringify([origin, folder]);
    if (current?.key !== key) current = { key, service: createLinksService(homedir(), origin, folder) };
    return current.service;
  };
  server.handle(linksForAgent, async (input, { paseo }) => (await getService()).forAgent(input, paseo));
  server.handle(linksForWorkspace, async (input, { paseo }) => (await getService()).forWorkspace(input, paseo));
  return () => {};
}

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startChoices } from "./client/web";

export default function contribute(client: PluginClientContext) {
  return startChoices(client);
}

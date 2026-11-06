import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startChoices } from "./client/web";

export default function contribute(_client: PluginClientContext) {
  return startChoices();
}

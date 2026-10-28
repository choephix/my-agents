import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startSimpleQuote } from "./client/web";

// Client-only: a floating Quote button over text selected in a chat (web and desktop).
export default function contribute(_client: PluginClientContext) {
  return startSimpleQuote();
}

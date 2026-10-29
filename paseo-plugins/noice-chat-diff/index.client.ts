import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startDiffHighlighting } from "./client/web";

// Client-only: no timeline transformer, so Paseo keeps rendering every message natively and this
// plugin only colors the diff code blocks it finds on screen (web and desktop).
export default function contribute(_client: PluginClientContext) {
  return startDiffHighlighting();
}

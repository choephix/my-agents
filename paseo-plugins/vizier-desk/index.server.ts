import type { PluginServerContext } from "@getpaseo/plugin/server";
import { deskRead } from "./shared/desk";

/** Axalon Mainframe, on this machine; it owns the desk parser and the GitHub snapshot the PR colours come from. */
const DESK_JSON = "http://127.0.0.1:7070/desk.json";

export default function contribute(server: PluginServerContext) {
  server.handle(deskRead, async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10_000);
    try {
      const response = await fetch(DESK_JSON, { signal: abort.signal }).catch(() => {
        throw new Error(`Mainframe isn't answering at ${DESK_JSON}`);
      });
      if (!response.ok) throw new Error(`Mainframe answered ${response.status} for ${DESK_JSON}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  });
  return () => {};
}

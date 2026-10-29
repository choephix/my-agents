import type { PluginServerContext } from "@getpaseo/plugin/server";
import { deskRead } from "./shared/desk";
import { inboxWrite, preferences } from "./shared/preferences";

/** Axalon Mainframe, on this machine; it owns the desk parser and Nilometer write API. */
const MAINFRAME = "http://127.0.0.1:7070";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  server.handle(deskRead, async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10_000);
    try {
      const response = await fetch(`${MAINFRAME}/desk.json`, { signal: abort.signal }).catch(() => {
        throw new Error(`Mainframe isn't answering at ${MAINFRAME}`);
      });
      if (!response.ok) throw new Error(`Mainframe answered ${response.status} for /desk.json`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  });
  server.handle(inboxWrite, async (input) => {
    const response = await fetch(`${MAINFRAME}/api/inbox/${encodeURIComponent(input.name)}/${input.action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: input.outcome, reply: input.reply, answerId: input.answerId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, name: input.name, error: body.message || body.error || `Mainframe answered ${response.status}` };
    return { ok: true, name: input.name, starred: body.starred, settled: body.settled, sendError: body.sendError, watcherErrors: body.watcherErrors };
  });
  return () => {};
}
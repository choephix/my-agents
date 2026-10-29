#!/usr/bin/env node
// Writes a mock's two data sets into its folder:
//   data.acme.json  kit/acme.json + the mock's own Acme content (data.mjs `acme`)
//   data.live.json  that same Acme, with pieces of Stefan's real Paseo usage swapped in
//
//   node tools/mock-data.mjs ~/www/webshare/pages/<mock>
//
// Live data is read from the files under ~/.paseo/projects and ~/.paseo/agents.
// Read-only: no daemon request, so nothing is woken, loaded or changed.
//
// Swapped in (base): the most recent workspaces (title, project, status, age),
// their projects (name, Paseo's colour for that project), the active workspace,
// its chats as tabs, the host name. Kept Acme: everything else, chat text included.
//
// A mock's plugin content follows the same pattern in <mock>/data.mjs:
//   export const acme = { efforts: [...] };              // merged over kit/acme.json
//   export async function live(data, ctx) { return { efforts: ... }; }  // merged over the live set
// ctx: { home, paseoHome, readJson(path) }.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, hostname } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const mockDir = resolve(process.argv[2] || ".");
const kitDir = join(dirname(fileURLToPath(import.meta.url)), "..", "kit");
const home = homedir();
const paseoHome = process.env.PASEO_HOME || join(home, ".paseo");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const pluginPath = join(mockDir, "data.mjs");
const plugin = existsSync(pluginPath) ? await import(pathToFileURL(pluginPath).href) : {};
const acme = { ...readJson(join(kitDir, "acme.json")), ...(plugin.acme || {}) };

// ------------------------------------------------------------------ Paseo rules
// Colour: styles/identity-colors.ts deriveIdentityColorName over the project's
// placement view key, JSON.stringify([serverId, projectId]) (projects/workspace-structure.ts).
const COLORS = ["violet", "sky", "emerald", "orange", "pink", "indigo", "teal", "red", "amber", "blue"];
function colorFor(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
// Status: protocol/src/agent-state-bucket.ts, aggregated most urgent first
// (utils/sidebar-agent-state.ts STATUS_BUCKET_PRIORITY).
function bucket(a) {
  if (a.attentionReason === "permission") return "needs_input";
  if (a.lastStatus === "error" || a.attentionReason === "error") return "failed";
  if (a.lastStatus === "running") return "running";
  if (a.requiresAttention) return "attention";
  return "done";
}
const PRIORITY = ["needs_input", "failed", "running", "attention", "done"];
function ago(ms) {
  const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

function liveBase() {
  const serverId = readFileSync(join(paseoHome, "server-id"), "utf8").trim();
  const projects = new Map(readJson(join(paseoHome, "projects/projects.json")).filter((p) => !p.archivedAt).map((p) => [p.projectId, p]));
  const agentsDir = join(paseoHome, "agents");
  const agents = readdirSync(agentsDir).flatMap((d) => {
    try {
      return readdirSync(join(agentsDir, d)).filter((f) => f.endsWith(".json")).map((f) => readJson(join(agentsDir, d, f)));
    } catch {
      return [];
    }
  }).filter((a) => !a.archivedAt && !a.internal && a.workspaceId);
  const byWs = Map.groupBy(agents, (a) => a.workspaceId);
  const time = (s) => (s ? Date.parse(s) : 0);

  const ws = readJson(join(paseoHome, "projects/workspaces.json"))
    .filter((w) => !w.archivedAt && !w.background && projects.has(w.projectId))
    .map((w) => {
      const list = byWs.get(w.workspaceId) || [];
      const last = Math.max(time(w.updatedAt), ...list.map((a) => time(a.lastActivityAt)));
      const status = PRIORITY.find((b) => list.some((a) => bucket(a) === b)) || "done";
      return { w, list, last, status };
    })
    .sort((a, b) => b.last - a.last)
    .slice(0, acme.workspaces.length);

  const outProjects = {};
  for (const { w } of ws) {
    const p = projects.get(w.projectId);
    outProjects[w.projectId] = { name: p.customName || p.displayName, color: colorFor(JSON.stringify([serverId, w.projectId])) };
  }
  const active = ws[0];
  const tabs = (active?.list || [])
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .slice(-4)
    .map((a) => ({ title: a.title || "New chat" }));
  if (tabs.length) {
    const newest = active.list.reduce((x, y) => (time(y.lastActivityAt) > time(x.lastActivityAt) ? y : x));
    const i = tabs.findIndex((t) => t.title === (newest.title || "New chat"));
    tabs[Math.max(0, i)].active = true;
  }
  return {
    host: hostname(),
    active: active?.w.workspaceId,
    projects: outProjects,
    workspaces: ws.map(({ w, last, status }) => ({
      id: w.workspaceId,
      title: w.title || w.displayName,
      project: w.projectId,
      status,
      ago: ago(last),
    })),
    ...(tabs.length ? { tabs } : {}),
  };
}

const live = { ...acme, ...liveBase() };
if (plugin.live) Object.assign(live, await plugin.live(live, { home, paseoHome, readJson }));

writeFileSync(join(mockDir, "data.acme.json"), JSON.stringify(acme, null, 2) + "\n");
writeFileSync(join(mockDir, "data.live.json"), JSON.stringify(live, null, 2) + "\n");
console.log(`wrote data.acme.json and data.live.json in ${mockDir} (${live.workspaces.length} live workspaces)`);
const page = join(mockDir, "index.html");
if (existsSync(page) && !/<html[^>]*\sdata-mock-data[\s>=]/.test(readFileSync(page, "utf8")))
  console.log("index.html lacks data-mock-data on <html>: the kit won't load these files until it has it");

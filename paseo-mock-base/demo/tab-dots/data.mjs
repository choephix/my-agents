// tab-dots demo data: every workspace row carries its tabs (chats) with each
// tab's state, as "state:Title|state:Title" (read, finished, error,
// permission, running). `node tools/mock-data.mjs demo/tab-dots` writes
// data.acme.json and data.live.json from this.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ws = (id, title, project, status, ago, tabs) => ({ id, title, project, status, ago, tabs: tabs.join("|") });

export const acme = {
  active: "rust-rewrite",
  projects: {
    "left-pad": { name: "left-pad", color: "orange" },
    homestead: { name: "homestead", color: "teal" },
    neovim: { name: "neovim", color: "emerald" },
    adulting: { name: "adulting", color: "amber" },
  },
  workspaces: [
    ws("rust-rewrite", "Rewrite left-pad in Rust", "left-pad", "attention", "4m", ["read:Benchmarks", "finished:Hot path allocations", "read:Changelog"]),
    ws("crates-io", "Publish to crates.io", "left-pad", "done", "1h", ["read:Cargo metadata", "read:README badges", "read:Release notes"]),
    ws("port-tests", "Port the test suite", "left-pad", "running", "", ["read:Fixtures", "running:Port unit tests", "read:CI matrix", "running:Port fuzz tests", "read:Coverage"]),
    ws("plant-robot", "Plant-watering robot", "homestead", "failed", "12m", ["read:Wiring diagram", "error:Flash firmware", "read:Pump sizing", "permission:Install drivers", "read:Soil sensor", "read:Parts list"]),
    ws("sourdough", "Sourdough", "homestead", "running", "", ["read:Starter feeding", "read:Hydration maths", "running:Bake schedule", "read:Flour comparison", "read:Oven temps", "finished:Crumb photos", "read:Banneton sizes", "running:Shopping list", "read:Proofing box", "read:Scoring patterns", "read:Rye variant", "read:Discard recipes", "read:Notes"]),
    ws("fence", "Fence planning", "homestead", "done", "2d", []),
    ws("exit-vim", "Exit Vim, finally", "neovim", "done", "25m", ["read::wq research"]),
    ws("lua-config", "Lua config cleanup", "neovim", "done", "3h", ["read:Plugins audit", "read:Keymaps", "read:LSP setup", "read:Statusline", "read:Colours", "read:Startup time", "read:Snippets"]),
    ws("tax-return", "Tax return, again", "adulting", "needs_input", "1d", ["read:Receipts", "permission:Bank export", "read:Deductions"]),
  ],
};

// Live: each live workspace's chats as its tabs, oldest first, with the state
// tab-dots gives them (the same buckets as tools/mock-data.mjs).
function tabState(a) {
  if (a.attentionReason === "permission") return "permission";
  if (a.lastStatus === "error" || a.attentionReason === "error") return "error";
  if (a.lastStatus === "running") return "running";
  if (a.requiresAttention) return "finished";
  return "read";
}
export async function live(data, { paseoHome, readJson }) {
  const dir = join(paseoHome, "agents");
  const agents = readdirSync(dir).flatMap((d) => {
    try {
      return readdirSync(join(dir, d)).filter((f) => f.endsWith(".json")).map((f) => readJson(join(dir, d, f)));
    } catch {
      return [];
    }
  }).filter((a) => !a.archivedAt && !a.internal && a.workspaceId);
  const byWs = Map.groupBy(agents, (a) => a.workspaceId);
  const time = (s) => (s ? Date.parse(s) : 0);
  return {
    workspaces: data.workspaces.map((w) => ({
      ...w,
      tabs: (byWs.get(w.id) || [])
        .sort((a, b) => time(a.createdAt) - time(b.createdAt))
        .map((a) => `${tabState(a)}:${(a.title || "New chat").replace(/\|/g, "/")}`)
        .join("|"),
    })),
  };
}

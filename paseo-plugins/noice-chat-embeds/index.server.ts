import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readAsset, readFileWindow, resolveNames, vaultRoot } from "./server/read-file";
import { preferences, readChatRepo, readEmbedAsset, readEmbedFile, resolveVaultNames } from "./shared/preferences";

const run = promisify(execFile);

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  // Read per request: no copy to keep in sync, and nothing runs while idle.
  const vault = async () => {
    const state = await settings.read();
    return state.status === "ready" ? vaultRoot(state.values.vaultFolder) : null;
  };
  server.handle(readEmbedFile, async (input, context) => readFileWindow(input, context, await vault()));
  server.handle(readEmbedAsset, async (input, context) => readAsset(input, context, await vault()));
  server.handle(resolveVaultNames, async (input) => resolveNames(input, await vault()));
  server.handle(readChatRepo, async ({ agentId }, { paseo }) => {
    const agent = await paseo.agents.ref(agentId).refresh();
    if (!agent) return { url: null };
    try {
      const { stdout } = await run("git", ["-C", agent.agent.cwd, "remote", "get-url", "origin"], { timeout: 5000 });
      // git@github.com:o/r.git, ssh://git@github.com/o/r, https://github.com/o/r.git
      const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(stdout.trim());
      return { url: match ? `https://github.com/${match[1]}/${match[2]}` : null };
    } catch {
      return { url: null };
    }
  });
  return () => {};
}

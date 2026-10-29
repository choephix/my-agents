import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readAsset, readFileWindow } from "./server/read-file";
import { preferences, readChatRepo, readEmbedAsset, readEmbedFile } from "./shared/preferences";

const run = promisify(execFile);

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  server.handle(readEmbedFile, readFileWindow);
  server.handle(readEmbedAsset, readAsset);
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

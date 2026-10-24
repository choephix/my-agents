import type { PluginSettings } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseDecision } from "../shared/agent-titles.mjs";
import { settings, type Settings } from "../shared/settings";
import { PROMPTS, WORKSPACE_PROMPTS, type TitleSituation, type WorkspaceSituation } from "./prompts";
import { DATA_DIR } from "./rename";

const TIMEOUT_MS = 20_000;

// What the model sees besides the conversation: the workspace's other tabs, "title"
// for the every-reply check, "rejected" for a manual retitle.
export type Sibling = string | { title: string; note: string };
export type TitleRequest = { workspace: string; siblings: Sibling[]; conversation: string; title?: string; rejected?: string[] };

// For a workspace: this project's other workspaces (marked like sibling tabs) and
// the most recently active ones of other projects; "tabs" and "rejected" for a manual retitle.
export type WorkspaceTitleRequest = { projectName: string; project: Sibling[]; elsewhere: { title: string; project: string }[]; conversation: string; tabs?: string[]; rejected?: string[] };

export type ModelChoice = Pick<Settings, "provider" | "ompModel">;

// The settings' model, or the defaults while the settings file is unreadable, so Retitle still works.
export async function modelChoice(preferences: PluginSettings<typeof settings.schema>): Promise<ModelChoice> {
  const state = await preferences.read();
  return state.status === "ready" ? state.values : settings.schema.parse({});
}

export const decideTitle = (model: ModelChoice, situation: TitleSituation, request: TitleRequest) => ask(model, PROMPTS[situation], request);
export const decideWorkspaceTitle = (model: ModelChoice, situation: WorkspaceSituation, request: WorkspaceTitleRequest) => ask(model, WORKSPACE_PROMPTS[situation], request);

// The same prompt and request either way; the answer is parsed the same way.
async function ask(model: ModelChoice, systemPrompt: string, request: object) {
  const input = JSON.stringify(request);
  return parseDecision(model.provider === "omp" ? await askOmp(model.ompModel, systemPrompt, input) : await askClaude(systemPrompt, input));
}

// Claude Haiku through Stefan's Claude Code subscription login: no tools, MCP,
// customizations or saved session.
function askClaude(systemPrompt: string, input: string) {
  // No telemetry, update checks or flag fetches for a one-shot title call: about
  // 1 s less per call (1.3 s before the answer, 0.7 s exit flush after it).
  const env = { ...subprocessEnv(), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
  const args = ["-p", "--model", "haiku", "--safe-mode", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--system-prompt", systemPrompt, "--output-format", "text"];
  return run("Claude CLI", claudeCommand(env.PATH), args, env, input).then(({ stdout }) => stdout);
}

// Windows: execFile can't run npm's `claude.cmd` shim, so run the `claude.exe` it wraps.
// A native install (`claude.exe` on PATH) resolves as `claude` already.
function claudeCommand(searchPath = "") {
  if (process.platform !== "win32") return "claude";
  for (const dir of searchPath.split(delimiter)) {
    const exe = join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (dir && existsSync(exe)) return exe;
  }
  return "claude";
}

// OMP with its own logins. Its CLI flags can't drop the generated project
// context (workstation, ~/.omp/agent/AGENTS.md, completion rules) or the hidden
// companions of a prompt, so this extension replaces the whole system prompt and
// keeps only the request. Thinking: adaptive at medium effort with no thinking
// text sent back (omitThinking), the request the Claude CLI makes for Haiku; a
// role (`@tiny`) keeps its own level.
const OMP_ISOLATION = `// Written by the Titles Paseo plugin (server/model.ts) before its first OMP call of each run.
const prompt = process.env.PASEO_TITLES_SYSTEM_PROMPT;
if (!prompt) throw new Error("PASEO_TITLES_SYSTEM_PROMPT is not set");
// The date and working-directory reminder OMP adds to the first user message, wherever the provider's payload puts it.
const strip = value => Array.isArray(value) ? value.filter(item => !(typeof item?.text === "string" && item.text.startsWith("<system-reminder>\\nToday:"))).map(strip)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, strip(item)])) : value;
export default function (pi) {
  // Only the plugin's prompt: no persona, workstation, context files, skills or rules.
  pi.on("before_agent_start", () => ({ systemPrompt: prompt }));
  // Only the request: no magic-keyword notices or @file attachments.
  pi.on("context", event => ({ messages: event.messages.filter(message => message.role === "user") }));
  // No date and working-directory reminder.
  pi.on("before_provider_request", event => strip(event.payload));
}
`;
const OMP_OVERLAY = "# Written by the Titles Paseo plugin (server/model.ts).\nomitThinking: true\n";
let ompFiles: Promise<{ extension: string; overlay: string }> | null = null;
// Both files sit in Titles' data directory, written once per plugin run.
const writeOmpFiles = () => ompFiles ??= (async () => {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const files = { extension: join(DATA_DIR, "omp-isolation.mjs"), overlay: join(DATA_DIR, "omp-overlay.yml") };
  for (const [file, text] of [[files.extension, OMP_ISOLATION], [files.overlay, OMP_OVERLAY]]) {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, file);
  }
  return files;
})().catch(error => { ompFiles = null; throw error; });

async function askOmp(model: string, systemPrompt: string, input: string) {
  const { extension, overlay } = await writeOmpFiles();
  const env = { ...subprocessEnv(), PASEO_TITLES_SYSTEM_PROMPT: systemPrompt };
  const args = ["-p", "--no-session", "--no-title", "--no-tools", "--no-lsp", "--no-skills", "--no-rules", "--no-prewalk",
    "--no-extensions", "-e", extension, "--config", overlay, "--model", model, ...(model.startsWith("@") ? [] : ["--thinking", "medium"])];
  // Run from the data directory: from the temp directory (25,000 entries here)
  // OMP's repository scan took 1.8 s of its 2.2 s startup.
  const { stdout, stderr } = await run("OMP", "omp", args, env, input, DATA_DIR);
  // OMP goes on without an extension it couldn't load; that answer saw Stefan's context, so drop it.
  const failed = stderr.split("\n").find(line => line.startsWith("Failed to load extension"));
  if (failed) throw new Error(`OMP failed: ${failed.slice(0, 160)}`);
  return stdout;
}

// Never an inherited API key or 3P routing. Service-launched daemons may omit
// the native install directory (Claude, OMP) from PATH.
function subprocessEnv() {
  const env = { ...process.env };
  const nativeBin = join(homedir(), ".local", "bin");
  const path = (env.PATH ?? "").split(delimiter);
  if (!path.includes(nativeBin)) env.PATH = [...path, nativeBin].join(delimiter);
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDECODE$|CLAUDE_CODE_OAUTH_TOKEN$)/.test(key)) delete env[key];
  }
  return env;
}

// A failure carries the CLI's first error line (OMP's "Working..." status line skipped).
function run(name: string, command: string, args: string[], env: NodeJS.ProcessEnv, input: string, cwd = tmpdir()) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(command, args, { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });
      const cause = error as NodeJS.ErrnoException & { killed?: boolean };
      if (cause.code === "ENOENT") reject(new Error(`${name} not found on the daemon's PATH`));
      else if (cause.killed) reject(new Error(`${name} took longer than ${TIMEOUT_MS / 1000} s`));
      else {
        const line = [stderr, stdout, error.message].flatMap(text => text.split("\n")).map(text => text.trim()).find(text => text && text !== "Working...");
        reject(new Error(`${name} failed: ${(line ?? "").slice(0, 160)}`));
      }
    });
    child.stdin?.end(input);
  });
}

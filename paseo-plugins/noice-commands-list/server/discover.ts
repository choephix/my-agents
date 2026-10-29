import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { firstOfEachName, parseCommandFile, type Command, type CommandScope, type CommandSource, type ParsedCommandFile } from "../shared/commands";
import type { Settings } from "../shared/settings";

export interface Folder {
  dir: string;
  scope: CommandScope;
  source: CommandSource;
}

type ExtraSource = Exclude<CommandSource, "agents">;
/** Optional folders in precedence order: project folder (null: none), then the one in `~`. */
const EXTRA: readonly { source: ExtraSource; project: string | null; user: string }[] = [
  { source: "claude", project: ".claude/commands", user: ".claude/commands" },
  { source: "cursor", project: ".cursor/commands", user: ".cursor/commands" },
  { source: "omp", project: ".omp/commands", user: ".omp/agent/commands" },
  { source: "codex", project: null, user: ".codex/prompts" },
];

/**
 * The agent's cwd and its parents up to the git root, nearest first (a worktree's `.git` file
 * counts too). Without a git root only the cwd itself. `~` is never a project folder.
 */
export async function projectDirs(cwd: string, home: string): Promise<string[]> {
  const start = path.resolve(cwd);
  const chain: string[] = [];
  for (let dir = start; ; dir = path.dirname(dir)) {
    chain.push(dir);
    if (await stat(path.join(dir, ".git")).then(() => true, () => false)) break;
    if (path.dirname(dir) === dir) return start === home ? [] : [start];
  }
  return chain.filter((dir) => dir !== home);
}

/**
 * Where commands are read from, first match of a name wins: project `.agents/commands` (nearest
 * first), `~/.agents/commands`, then each switched-on extra folder in the project, then in `~`.
 */
export async function commandFolders(cwd: string, enabled: Pick<Settings, ExtraSource>, home = homedir()): Promise<Folder[]> {
  const projects = await projectDirs(cwd, home);
  const extras = EXTRA.filter((extra) => enabled[extra.source]);
  return [
    ...projects.map((dir): Folder => ({ dir: path.join(dir, ".agents/commands"), scope: "project", source: "agents" })),
    { dir: path.join(home, ".agents/commands"), scope: "user", source: "agents" },
    ...extras.flatMap(({ source, project }) =>
      project ? projects.map((dir): Folder => ({ dir: path.join(dir, project), scope: "project", source })) : []),
    ...extras.map(({ source, user }): Folder => ({ dir: path.join(home, user), scope: "user", source })),
  ];
}

/** Parsed files by path, kept while their mtime and size stay the same. */
const parsed = new Map<string, { key: string; file: ParsedCommandFile }>();

async function readCommand(file: string): Promise<ParsedCommandFile | null> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  const key = `${info.mtimeMs}:${info.size}`;
  const cached = parsed.get(file);
  if (cached?.key === key) return cached.file;
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  const entry = { key, file: parseCommandFile(text) };
  parsed.set(file, entry);
  return entry.file;
}

/** `*.md` files at the folder's top level (symlinks followed), by name. */
export async function readFolder(folder: Folder): Promise<Command[]> {
  const names = await readdir(folder.dir).catch(() => [] as string[]);
  const commands = await Promise.all(
    names
      .filter((name) => name.endsWith(".md") && name.length > 3 && !name.startsWith("."))
      .sort()
      .map(async (name) => {
        const file = path.join(folder.dir, name);
        const command = await readCommand(file);
        return command ? { ...command, name: name.slice(0, -3), scope: folder.scope, source: folder.source, path: file } : null;
      }),
  );
  return commands.filter((command): command is Command => command !== null);
}

/** The commands an agent in `cwd` sees: one per name (the first folder wins), sorted by name. */
export async function discoverCommands(cwd: string, enabled: Pick<Settings, ExtraSource>, home = homedir()): Promise<Command[]> {
  const folders = await commandFolders(cwd, enabled, home);
  const found = (await Promise.all(folders.map(readFolder))).flat();
  return firstOfEachName(found).sort((a, b) => a.name.localeCompare(b.name));
}

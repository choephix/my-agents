import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type BoxFolderSource = "setting" | "env" | "desk-config" | "md-embed" | "none";

export interface ResolvedBoxFolder {
  folder: string | null;
  source: BoxFolderSource;
}

export interface ResolveBoxFolderOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/** Expand a leading `~` and resolve an absolute path; returns null for empty or relative values. */
export function resolveAbsoluteFolder(raw: string, home = homedir()): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const expanded = trimmed.replace(/^~(?=$|[\\/])/, home);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : null;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readFirstDeskBoxPath(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const boxes = (parsed as { boxes?: unknown }).boxes;
  if (!Array.isArray(boxes) || boxes.length === 0) return null;
  const first = boxes[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const boxPath = (first as { path?: unknown }).path;
  return typeof boxPath === "string" && boxPath.trim() ? boxPath : null;
}

function readMdEmbedVaultPath(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const vaultFolder = (parsed as { vaultFolder?: unknown }).vaultFolder;
  return typeof vaultFolder === "string" && vaultFolder.trim() ? vaultFolder : null;
}

/**
 * Resolve the slip-box folder in priority order:
 * 1. Explicit `boxFolder` plugin setting
 * 2. `SLIPBOX_DIR` environment variable
 * 3. First box in `~/.config/slipbox-desk/settings.json`
 * 4. `vaultFolder` in `~/.omp/agent/md-embed.json`
 */
export async function resolveBoxFolder(
  settingFolder: string,
  options: ResolveBoxFolderOptions = {},
): Promise<ResolvedBoxFolder> {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;

  if (settingFolder.trim()) {
    return { folder: resolveAbsoluteFolder(settingFolder, home), source: "setting" };
  }

  const envFolder = env.SLIPBOX_DIR?.trim() ?? "";
  if (envFolder) {
    const resolved = resolveAbsoluteFolder(envFolder, home);
    if (resolved) return { folder: resolved, source: "env" };
  }

  const deskConfig = await readJsonFile(path.join(home, ".config", "slipbox-desk", "settings.json"));
  const deskPath = readFirstDeskBoxPath(deskConfig);
  if (deskPath) {
    const resolved = resolveAbsoluteFolder(deskPath, home);
    if (resolved) return { folder: resolved, source: "desk-config" };
  }

  const mdEmbedConfig = await readJsonFile(path.join(home, ".omp", "agent", "md-embed.json"));
  const mdEmbedPath = readMdEmbedVaultPath(mdEmbedConfig);
  if (mdEmbedPath) {
    const resolved = resolveAbsoluteFolder(mdEmbedPath, home);
    if (resolved) return { folder: resolved, source: "md-embed" };
  }

  return { folder: null, source: "none" };
}

import { cp, lstat, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SessionTree } from "./session-file";

/**
 * Writes a new OMP session file holding only the path root → `entryId` of `source`,
 * like OMP's own branch-to-new-session (header records `parentSession`, prompt-cache
 * key kept). The artifact folder is copied too, as noice-side-agent's full-memory copy does.
 */
export async function copyBranch(source: string, lines: string[], tree: SessionTree, entryId: string): Promise<string> {
  if (!source.startsWith("/") || !source.endsWith(".jsonl")) throw new Error("The chat's OMP session file is unavailable.");
  const keep = new Set(tree.path(entryId).map(entry => entry.id));
  if (!keep.has(entryId)) throw new Error("That message is not in this chat any more.");
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  let header = false;
  const out: string[] = [];
  for (const line of lines) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (value.type === "session") {
      out.push(JSON.stringify({
        ...value, id, timestamp, parentSession: value.id,
        providerPromptCacheKey: value.providerPromptCacheKey ?? value.id,
      }));
      header = true;
    } else if (typeof value.id !== "string" || keep.has(value.id)) {
      out.push(line);
    }
  }
  if (!header) throw new Error("Invalid OMP session header.");
  const destination = join(dirname(source), `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  await writeFile(destination, `${out.join("\n")}\n`, { flag: "wx", mode: 0o600 });
  try {
    const artifacts = source.slice(0, -6);
    const info = await lstat(artifacts).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isDirectory() && !info.isSymbolicLink()) {
      await cp(artifacts, destination.slice(0, -6), {
        recursive: true, errorOnExist: true, force: false,
        filter: async path => !(await lstat(path)).isSymbolicLink(),
      });
    }
    return destination;
  } catch (error) {
    await removeCopy(destination);
    throw error;
  }
}

export async function removeCopy(file: string): Promise<void> {
  await rm(file, { force: true });
  await rm(file.slice(0, -6), { recursive: true, force: true });
}

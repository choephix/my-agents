import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Per-chat instructions live in `~/.omp/agent/session-instructions/<OMP session id>.md`; the OMP
 * extension `session-instructions` appends them to the chat's system prompt (keep in sync).
 */
const DIR = join(homedir(), ".omp", "agent", "session-instructions");
/** OMP names session files `<timestamp>_<session id>.jsonl`. */
const SESSION_ID = /_([A-Za-z0-9][A-Za-z0-9-]{0,127})\.jsonl$/;

/** The instructions file for an OMP session file; undefined for anything else. */
export function instructionsFile(sessionFile: string): string | undefined {
  const id = SESSION_ID.exec(sessionFile)?.[1];
  return id ? join(DIR, `${id}.md`) : undefined;
}

export async function readInstructions(file: string): Promise<string> {
  return readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
}

/**
 * Clearing writes an empty file rather than deleting it: a chat copied from another (/prose, a fork)
 * takes its source's instructions only while it has no file of its own.
 */
export async function writeInstructions(file: string, text: string): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text.trim() ? text : "");
  await rename(temp, file);
}

export async function removeInstructions(file: string): Promise<void> {
  await rm(file, { force: true });
}

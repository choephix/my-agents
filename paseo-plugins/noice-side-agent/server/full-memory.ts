import { cp, lstat, open, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const entrySchema = z.object({
  type: z.string(), id: z.string().optional(),
  message: z.object({
    role: z.string(), stopReason: z.string().optional(),
    content: z.union([z.string(), z.array(z.object({ type: z.string() }).passthrough())]),
  }).passthrough().optional(),
}).passthrough();

export async function copyCompletedSession(source: string, contextNote: string): Promise<string> {
  if (!source.startsWith("/") || !source.endsWith(".jsonl")) throw new Error("Parent OMP session path is unavailable.");
  const handle = await open(source, "r");
  let bytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Parent OMP session is not a regular file.");
    bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    bytes = bytes.subarray(0, offset);
  } finally { await handle.close(); }
  // Never parse an unterminated JSONL fragment from a parent mid-write.
  const newline = bytes.lastIndexOf(10);
  if (newline < 0) throw new Error("Parent has no complete session records yet.");
  const lines = bytes.subarray(0, newline + 1).toString("utf8").trimEnd().split("\n");
  const entries = lines.map(line => entrySchema.parse(JSON.parse(line)));
  const boundary = entries.findLastIndex(entry => {
    const message = entry.type === "message" ? entry.message : undefined;
    return message?.role === "assistant" && ["stop", "length"].includes(message.stopReason ?? "")
      && (!Array.isArray(message.content) || !message.content.some(block => block.type === "toolCall"));
  });
  if (boundary < 0) throw new Error("No completed parent turn to copy; use /side --fork or retry after a completed reply.");
  entries.length = boundary + 1;
  const headerIndex = entries.findIndex(entry => entry.type === "session");
  if (headerIndex < 0 || typeof entries[headerIndex].id !== "string") throw new Error("Invalid OMP session header.");
  const header = entries[headerIndex];
  const timestamp = new Date().toISOString();
  const id = randomUUID();
  entries[headerIndex] = {
    ...header, id, timestamp, parentSession: header.id,
    providerPromptCacheKey: header.providerPromptCacheKey ?? header.id,
  };
  const parentEntryId = entries.at(-1)?.id;
  if (!parentEntryId) throw new Error("Completed OMP turn has no entry ID.");
  let noteId: string;
  do { noteId = randomUUID().slice(0, 8); } while (entries.some(entry => entry.id === noteId));
  // OMP replays this into model context. Paseo displays it as an expandable
  // side-fork row; appending it does not invoke a model turn.
  entries.push({
    type: "custom_message", id: noteId, parentId: parentEntryId, timestamp,
    customType: "side-fork", content: contextNote, display: true, attribution: "agent",
  });
  const destination = join(dirname(source), `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  await writeFile(destination, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  try {
    const artifacts = source.slice(0, -6);
    const info = await lstat(artifacts).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Parent artifacts must be a regular directory.");
      await cp(artifacts, destination.slice(0, -6), {
        recursive: true, errorOnExist: true, force: false,
        filter: async path => {
          if ((await lstat(path)).isSymbolicLink()) throw new Error("Full-memory copying refuses symlinked artifacts.");
          return true;
        },
      });
    }
    return destination;
  } catch (error) { await removeSessionCopy(destination); throw error; }
}

export async function removeSessionCopy(file: string): Promise<void> {
  await rm(file, { force: true });
  await rm(file.slice(0, -6), { recursive: true, force: true });
}

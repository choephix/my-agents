import { open, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readEmbedFile, type EmbedReadErrorCode } from "../shared/preferences";

const MAX_BYTES = 64 * 1024;
const CHUNK_BYTES = 16 * 1024;

function error(code: EmbedReadErrorCode, message: string): RpcOutput<typeof readEmbedFile> {
  return { status: "error", code, message };
}

function isAllowed(resolved: string, cwd: string): boolean {
  const relative = path.relative(cwd, resolved);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolvePath(requested: string, cwd: string): string {
  const expanded = requested.replace(/^~(?=$|[\\/])/, homedir());
  return path.resolve(cwd, expanded);
}

function decode(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export async function readFileWindow(
  input: RpcInput<typeof readEmbedFile>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof readEmbedFile>> {
  const agent = await paseo.agents.ref(input.agentId).refresh();
  if (!agent) return error("disallowed", "This chat is no longer available.");

  const cwd = path.resolve(agent.agent.cwd);
  const resolved = resolvePath(input.path, cwd);
  if (!isAllowed(resolved, cwd)) return error("disallowed", "That file is outside the chat's working directory.");

  const start = input.lineStart ?? 1;
  const requestedEnd = input.lineEnd;
  if (requestedEnd !== undefined && requestedEnd < start) return error("invalid-range", "The requested line range is invalid.");

  let handle: FileHandle;
  try {
    handle = await open(resolved, "r");
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    return error(code === "ENOENT" ? "missing" : "unreadable", code === "ENOENT" ? "File not found." : "File could not be read.");
  }

  try {
    const chunks: Buffer[] = [];
    let total = 0;
    let binary = false;
    while (total < MAX_BYTES) {
      const size = Math.min(CHUNK_BYTES, MAX_BYTES - total);
      const chunk = Buffer.allocUnsafe(size);
      const { bytesRead } = await handle.read(chunk, 0, size, total);
      if (!bytesRead) break;
      const used = chunk.subarray(0, bytesRead);
      if (used.includes(0)) binary = true;
      chunks.push(used);
      total += bytesRead;
      if (bytesRead < size) break;
    }
    if (binary) return error("binary", "Binary files are not previewed.");

    const info = await handle.stat();
    const truncated = info.size > total;
    const text = decode(Buffer.concat(chunks));
    const lines = text.split(/\r?\n/);
    if (truncated && requestedEnd !== undefined && lines.length < requestedEnd) {
      return error("too-large", "The requested line range is beyond the preview limit.");
    }
    if (start > lines.length || (requestedEnd !== undefined && start > requestedEnd)) {
      return error("invalid-range", "The requested line is not present in this file.");
    }
    const end = Math.min(requestedEnd ?? lines.length, lines.length);
    const selected = lines.slice(start - 1, end).join("\n");
    return { status: "ok", path: resolved, lineStart: start, lineEnd: end, text: selected, truncated };
  } catch {
    return error("unreadable", "File could not be read.");
  } finally {
    await handle.close().catch(() => {});
  }
}

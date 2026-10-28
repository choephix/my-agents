import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readEmbedFile, type EmbedReadErrorCode } from "../shared/preferences";

/** Most text a card receives. */
const MAX_BYTES = 64 * 1024;
/** How far into a file the reader scans before giving up on reaching the requested lines. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

type Output = RpcOutput<typeof readEmbedFile>;

function error(code: EmbedReadErrorCode, message: string): Output {
  return { status: "error", code, message };
}

function isInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function readFileWindow(
  input: RpcInput<typeof readEmbedFile>,
  { paseo }: PluginHandlerContext,
): Promise<Output> {
  const agent = await paseo.agents.ref(input.agentId).refresh();
  if (!agent) return error("disallowed", "This chat is no longer available.");

  const cwd = path.resolve(agent.agent.cwd);
  const requested = path.resolve(cwd, input.path.replace(/^~(?=$|[\\/])/, homedir()));
  // Checked before touching the disk so "not found" never reveals files outside the chat's folder.
  if (!isInside(requested, cwd)) return error("disallowed", "That file is outside the chat's working directory.");

  const start = input.lineStart ?? 1;
  const end = input.lineEnd;
  if (end !== undefined && end < start) return error("invalid-range", "The requested line range is invalid.");

  let real: string;
  try {
    // Symlinks are resolved on both sides, so a link inside the folder cannot point outside it.
    const [realRoot, realTarget] = await Promise.all([realpath(cwd), realpath(requested)]);
    if (!isInside(realTarget, realRoot)) return error("disallowed", "That file links outside the chat's working directory.");
    // FIFOs, devices and directories would block or never end; only regular files are read.
    if (!(await stat(realTarget)).isFile()) return error("unreadable", "Only regular files are previewed.");
    real = realTarget;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" ? error("missing", "File not found.") : error("unreadable", "File could not be read.");
  }

  const lines: string[] = [];
  let bytes = 0;
  let lineNo = 1;
  let scanned = 0;
  let pending = "";
  let truncated = false;
  let done = false;
  const decoder = new StringDecoder("utf8");

  // Returns true once the window is complete.
  const take = (line: string): boolean => {
    if (lineNo >= start) {
      const text = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (bytes + text.length > MAX_BYTES) {
        truncated = true;
        return true;
      }
      lines.push(text);
      bytes += text.length + 1;
    }
    lineNo++;
    return end !== undefined && lineNo > end;
  };

  try {
    for await (const chunk of createReadStream(real, { highWaterMark: 64 * 1024 }) as AsyncIterable<Buffer>) {
      if (chunk.includes(0)) return error("binary", "Binary files are not previewed.");
      scanned += chunk.length;
      const parts = (pending + decoder.write(chunk)).split("\n");
      pending = parts.pop() ?? "";
      for (const part of parts) {
        if ((done = take(part))) break;
      }
      if (done) break;
      if (lineNo >= start && pending.length > MAX_BYTES) {
        // One endless line (minified file): show its beginning.
        lines.push(pending.slice(0, MAX_BYTES));
        truncated = done = true;
        break;
      }
      if (scanned >= MAX_SCAN_BYTES) {
        if (!lines.length) return error("too-large", "The requested lines are too far into this file to preview.");
        truncated = done = true;
        break;
      }
    }
    if (!done) {
      const last = pending + decoder.end();
      if (last) take(last);
    }
  } catch {
    return error("unreadable", "File could not be read.");
  }

  if (!lines.length) {
    // An empty file previews as empty; a range past its end is an error.
    if (input.lineStart !== undefined || lineNo > 1) return error("invalid-range", "The requested line is not present in this file.");
    return { status: "ok", path: real, lineStart: 1, lineEnd: 1, text: "", truncated: false };
  }
  return { status: "ok", path: real, lineStart: start, lineEnd: start + lines.length - 1, text: lines.join("\n"), truncated };
}

import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { embedKind, IMAGE_TYPES, readEmbedAsset, readEmbedFile, type EmbedReadErrorCode } from "../shared/preferences";

/** Most text a card receives. */
const MAX_BYTES = 64 * 1024;
/** How far into a file the reader scans before giving up on reaching the requested lines. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

type Output = RpcOutput<typeof readEmbedFile>;
type ReadError = Extract<Output, { status: "error" }>;

/** Largest image or HTML page an embed loads; images travel base64-encoded, a third larger. */
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

function error(code: EmbedReadErrorCode, message: string): ReadError {
  return { status: "error", code, message };
}

function isInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Resolves an embed path against the chat's folder; only regular files inside it are returned. */
async function resolveEmbedPath(
  agentId: string,
  requestedPath: string,
  { paseo }: PluginHandlerContext,
): Promise<{ real: string; size: number } | ReadError> {
  const agent = await paseo.agents.ref(agentId).refresh();
  if (!agent) return error("disallowed", "This chat is no longer available.");

  const cwd = path.resolve(agent.agent.cwd);
  const requested = path.resolve(cwd, requestedPath.replace(/^~(?=$|[\\/])/, homedir()));
  // Checked before touching the disk so "not found" never reveals files outside the chat's folder.
  if (!isInside(requested, cwd)) return error("disallowed", "That file is outside the chat's working directory.");

  try {
    // Symlinks are resolved on both sides, so a link inside the folder cannot point outside it.
    const [realRoot, real] = await Promise.all([realpath(cwd), realpath(requested)]);
    if (!isInside(real, realRoot)) return error("disallowed", "That file links outside the chat's working directory.");
    // FIFOs, devices and directories would block or never end; only regular files are read.
    const info = await stat(real);
    if (!info.isFile()) return error("unreadable", "Only regular files are previewed.");
    return { real, size: info.size };
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" ? error("missing", "File not found.") : error("unreadable", "File could not be read.");
  }
}

export async function readAsset(
  input: RpcInput<typeof readEmbedAsset>,
  context: PluginHandlerContext,
): Promise<RpcOutput<typeof readEmbedAsset>> {
  const kind = embedKind(input.path);
  if (kind === "text") return error("unsupported", "Only images and HTML pages load this way.");
  const file = await resolveEmbedPath(input.agentId, input.path, context);
  if ("status" in file) return file;
  if (file.size > MAX_ASSET_BYTES) return error("too-large", `Larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB; open it on the side instead.`);
  try {
    const bytes = await readFile(file.real);
    const extension = path.extname(input.path).slice(1).toLowerCase();
    const body = kind === "image" ? `data:${IMAGE_TYPES[extension]};base64,${bytes.toString("base64")}` : bytes.toString("utf8");
    return { status: "ok", path: file.real, kind, bytes: bytes.length, body };
  } catch {
    return error("unreadable", "File could not be read.");
  }
}

export async function readFileWindow(
  input: RpcInput<typeof readEmbedFile>,
  context: PluginHandlerContext,
): Promise<Output> {
  const start = input.lineStart ?? 1;
  const end = input.lineEnd;
  if (end !== undefined && end < start) return error("invalid-range", "The requested line range is invalid.");
  const file = await resolveEmbedPath(input.agentId, input.path, context);
  if ("status" in file) return file;
  const { real } = file;

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

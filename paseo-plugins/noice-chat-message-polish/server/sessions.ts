import { open, stat } from "node:fs/promises";
import { z } from "zod";
import type { FileMentionRecord, SkillRecord } from "../shared/skills";

// OMP appends one JSON entry per line to its session file. A loaded skill is a top-level
// `custom_message` with customType "skill-prompt" whose content is exactly what the agent got;
// an @file mention is a `message` with role "fileMention" right after the user message.
// Files only grow, so each is read once and then only from where the last read stopped.

type Skill = Omit<SkillRecord, "agentId">;
type Mention = Omit<FileMentionRecord, "agentId">;

interface Parsed {
  size: number;
  offset: number;
  partial: string;
  lastText: string;
  skills: Skill[];
  mentions: Mention[];
  bodies: Map<string, string>;
  fileBodies: Map<string, string[]>;
}

const FILE_BODY_LIMIT = 256 * 1024;
const cache = new Map<string, Parsed>();

const fresh = (): Parsed => ({ size: 0, offset: 0, partial: "", lastText: "", skills: [], mentions: [], bodies: new Map(), fileBodies: new Map() });

const TextContent = z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())]);
const textOf = (content: z.infer<typeof TextContent>): string =>
  typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text ?? "" : "")).join("");

const SkillPrompt = z.object({
  type: z.literal("custom_message"),
  id: z.string().min(1),
  customType: z.literal("skill-prompt"),
  attribution: z.literal("user"),
  content: TextContent,
  details: z.object({ name: z.string().min(1), args: z.string().optional(), prompt: z.string().optional() }),
});
const FileMention = z.object({
  type: z.literal("message"),
  id: z.string().min(1),
  message: z.object({ role: z.literal("fileMention"), files: z.array(z.object({ path: z.string(), content: z.string().optional() })).min(1) }),
});
const UserMessage = z.object({ type: z.literal("message"), message: z.object({ role: z.literal("user"), content: TextContent }) });

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The wrapper without OMP's trailing `User: <args>`: the bubble already shows that text.
 *  OMP's template drops trailing spaces on each line, so compare whitespace-insensitively. */
function wrapperOf(content: string, args: string): string {
  if (!args) return content;
  const at = content.lastIndexOf("\nUser: ");
  return at !== -1 && squash(content.slice(at + 7)) === squash(args) ? content.slice(0, at) : content;
}

function take(parsed: Parsed, line: string) {
  // Substring checks first: most lines are tool output and never need parsing.
  if (line.includes('"skill-prompt"')) {
    const entry = SkillPrompt.safeParse(JSON.parse(line));
    if (!entry.success) return;
    const { id, details, content } = entry.data;
    const args = details.args?.trim() ?? "";
    const prompt = details.prompt ?? (args ? `/skill:${details.name} ${args}` : `/skill:${details.name}`);
    parsed.skills.push({ id, name: details.name, args, prompt });
    parsed.bodies.set(id, wrapperOf(textOf(content), args));
    parsed.lastText = prompt;
  } else if (line.includes('"role":"fileMention"')) {
    const entry = FileMention.safeParse(JSON.parse(line));
    if (!entry.success || !parsed.lastText) return;
    const { id, message } = entry.data;
    const bodies = message.files.map((file) => (file.content ?? "").slice(0, FILE_BODY_LIMIT));
    parsed.mentions.push({ id, after: parsed.lastText, files: message.files.map((file, index) => ({ path: file.path, lines: bodies[index]!.split("\n").length })) });
    parsed.fileBodies.set(id, bodies);
  } else if (line.includes('"role":"user"')) {
    const entry = UserMessage.safeParse(JSON.parse(line));
    if (entry.success) parsed.lastText = textOf(entry.data.message.content);
  }
}

/** Reads what was appended since the last call; a file that shrank (rewritten) is read again. */
export async function readSession(path: string): Promise<Parsed> {
  let parsed = cache.get(path) ?? fresh();
  const info = await stat(path);
  if (info.size < parsed.size) parsed = fresh();
  cache.set(path, parsed);
  if (info.size === parsed.offset) return parsed;
  const handle = await open(path, "r");
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    const decoder = new TextDecoder();
    let position = parsed.offset;
    while (position < info.size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, info.size - position), position);
      if (!bytesRead) break;
      position += bytesRead;
      const lines = (parsed.partial + decoder.decode(chunk.subarray(0, bytesRead), { stream: true })).split("\n");
      parsed.partial = lines.pop() ?? "";
      for (const line of lines) {
        try { take(parsed, line); } catch { /* a malformed line: skip it */ }
      }
    }
    parsed.offset = position;
    parsed.size = info.size;
  } finally {
    await handle.close();
  }
  return parsed;
}

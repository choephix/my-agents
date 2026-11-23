import { defineSettings, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "message-embeds",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(true),
    /** ```svg code blocks drawn as pictures; off by default, and the `enabled` switch overrides it. */
    svgBlocks: z.boolean().default(false),
    /** A plain click on an `app.paseo.sh` agent link switches tabs in place; independent of `enabled`. */
    openLinksInPlace: z.boolean().default(true),
    /**
     * Obsidian's "vault folder": an absolute path (or `~/…`). Other paths (`![[note]]`, `[[shot.png]]`,
     * `![[efforts/x/map]]`) are looked up in it as path endings, and any file inside it embeds from every chat. Empty: off.
     */
    vaultFolder: z.string().default(""),
  }),
});

export type Preferences = z.output<typeof preferences.schema>;
export const DEFAULTS: Preferences = preferences.schema.parse({});
export type EmbedReadErrorCode = "missing" | "unreadable" | "binary" | "disallowed" | "too-large" | "invalid-range" | "unsupported" | "ambiguous";

const readError = z.object({
  status: z.literal("error"),
  code: z.enum(["missing", "unreadable", "binary", "disallowed", "too-large", "invalid-range", "unsupported", "ambiguous"]),
  message: z.string(),
});

/** MIME types of the image files an embed shows as a picture. */
export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/** How an embed previews a file, from its extension: picture, sandboxed page, or text. */
export function embedKind(filePath: string): "image" | "html" | "text" {
  const extension = /\.([a-z0-9]+)$/i.exec(filePath)?.[1].toLowerCase() ?? "";
  if (extension in IMAGE_TYPES) return "image";
  return extension === "html" || extension === "htm" ? "html" : "text";
}

/** Markdown files embed from any folder and preview as formatted Markdown. */
export function isMarkdownPath(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}

/**
 * A target looked up in the vault folder: not absolute, not `~/`, and every `/`-separated part a
 * name (no empty, `.` or `..` part). It names the end of a path inside the vault folder.
 */
export function isVaultName(target: string): boolean {
  if (target.startsWith("/") || target === "~" || target.startsWith("~/")) return false;
  return target.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** The path end a vault name matches: itself when it has an extension, else `<name>.md`. */
export function vaultFileName(name: string): string {
  return /\.[a-z\d]+$/i.test(name) ? name : `${name}.md`;
}

export const readEmbedFile = defineRpc({
  name: "message-embeds.read-file",
  input: z.object({
    agentId: z.string(),
    path: z.string(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    /** A heading's section instead of a line range: the lines under it, up to the next heading of its level or higher. */
    heading: z.string().min(1).optional(),
  }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      path: z.string(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
      text: z.string(),
      truncated: z.boolean(),
      /** Markdown file whose front matter carries a non-empty `settled:` field (a settled slip-box slip). */
      settled: z.boolean().optional(),
    }),
    readError,
  ]),
});

/** Images come back as a data URI, HTML pages as their source text. */
export const readEmbedAsset = defineRpc({
  name: "message-embeds.read-asset",
  input: z.object({ agentId: z.string(), path: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      path: z.string(),
      kind: z.enum(["image", "html"]),
      bytes: z.number().int().nonnegative(),
      body: z.string(),
    }),
    readError,
  ]),
});

/** The chat folder's GitHub repository (`https://github.com/<owner>/<repo>`), for `#123` links. */
export const readChatRepo = defineRpc({
  name: "message-embeds.read-repo",
  input: z.object({ agentId: z.string() }),
  output: z.object({ url: z.string().nullable() }),
});

/** Vault names to the one vault file each names; names with no match or several are left out. */
export const resolveVaultNames = defineRpc({
  name: "message-embeds.resolve-vault-names",
  input: z.object({ names: z.array(z.string()).max(100) }),
  output: z.object({ paths: z.record(z.string(), z.string()) }),
});

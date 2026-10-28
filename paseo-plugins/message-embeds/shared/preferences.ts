import { defineSettings, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "message-embeds",
  scope: "host",
  version: 1,
  schema: z.object({ enabled: z.boolean().default(true) }),
});

export type Preferences = z.output<typeof preferences.schema>;
export const DEFAULTS: Preferences = preferences.schema.parse({});
export type EmbedReadErrorCode = "missing" | "unreadable" | "binary" | "disallowed" | "too-large" | "invalid-range" | "unsupported";

const readError = z.object({
  status: z.literal("error"),
  code: z.enum(["missing", "unreadable", "binary", "disallowed", "too-large", "invalid-range", "unsupported"]),
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

export const readEmbedFile = defineRpc({
  name: "message-embeds.read-file",
  input: z.object({
    agentId: z.string(),
    path: z.string(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  }),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      path: z.string(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
      text: z.string(),
      truncated: z.boolean(),
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

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** `workspace`: this workspace's archived agents; `folder`: its folder; `project`: the whole project. */
export const ScopeSchema = z.enum(["workspace", "folder", "project"]);
export type Scope = z.infer<typeof ScopeSchema>;

export const PastSessionSchema = z.object({
  /** Stable list key: `paseo:<agentId>`, `omp:<sessionId>` or `ext:<provider>:<sessionId>`. */
  key: z.string(),
  /**
   * `paseo`: archived Paseo agent. `omp`: OMP session file never opened in Paseo (file scan).
   * `external`: another provider's session never opened in Paseo (Claude Code, Codex), listed by
   * the daemon on request.
   */
  source: z.enum(["paseo", "omp", "external"]),
  title: z.string(),
  cwd: z.string(),
  /** Last activity, ISO timestamp. Entries are sorted by this, newest first. */
  at: z.string(),
  provider: z.string(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  /** OMP session file, or the transcript an archived agent or Claude Code session was read from. */
  file: z.string().optional(),
  /**
   * Plain text under the title: `memo`, a note an agent left on the session (`bin/memo.mjs`),
   * with `attention` (what needs Stefan: loose ends, open questions) when there is any; else
   * `reply`, the last assistant reply; null when there is neither.
   */
  preview: z
    .object({ text: z.string(), kind: z.enum(["memo", "reply"]), attention: z.string().optional() })
    .nullable(),
});
export type PastSession = z.infer<typeof PastSessionSchema>;

export const listPastSessions = defineRpc({
  name: "past-sessions.list",
  input: z.object({ workspaceId: z.string(), scope: ScopeSchema }),
  output: z.object({
    workspaceName: z.string(),
    /** The daemon user's home, so paths can be shown as `~/…`. */
    home: z.string(),
    folder: z.string(),
    projectRoot: z.string(),
    projectName: z.string(),
    scope: ScopeSchema,
    /** The main list, newest first. */
    entries: z.array(PastSessionSchema),
    /** Workspace scope only: OMP sessions in the folder that Paseo never opened. */
    sameFolder: z.array(PastSessionSchema),
    stats: z.object({
      elapsedMs: z.number(),
      ompDirsScanned: z.number(),
      ompFilesSeen: z.number(),
      ompFilesRead: z.number(),
      hiddenKnownToPaseo: z.number(),
    }),
    warnings: z.array(z.string()),
  }),
});

export type PastSessionsListing = z.output<typeof listPastSessions.output>;

export const ExternalProviderSchema = z.enum(["claude", "codex"]);

/** Claude Code and Codex sessions never opened in Paseo, for the Folder and Project scopes. */
export const listExternalSessions = defineRpc({
  name: "past-sessions.external",
  input: z.object({
    workspaceId: z.string(),
    scope: z.enum(["folder", "project"]),
    /** Ask the daemon again instead of using the plugin's cached listing. */
    refresh: z.boolean(),
  }),
  output: z.object({
    entries: z.array(PastSessionSchema),
    providers: z.array(ExternalProviderSchema),
    /** When the cached daemon listing was taken. */
    fetchedAt: z.string(),
    elapsedMs: z.number(),
    warnings: z.array(z.string()),
  }),
});

export type ExternalSessionsListing = z.output<typeof listExternalSessions.output>;

export const reopenPastSession = defineRpc({
  name: "past-sessions.reopen",
  input: z.discriminatedUnion("source", [
    z.object({ source: z.literal("paseo"), agentId: z.string() }),
    z.object({
      source: z.literal("import"),
      provider: z.string(),
      cwd: z.string(),
      /** What `paseo import` takes: the OMP session file, or the provider's session id. */
      handle: z.string(),
      /** The row's list key; its star moves to the imported agent, and it is no longer hidden. */
      key: z.string(),
    }),
  ]),
  output: z.object({ agentId: z.string() }),
});

/**
 * List keys per mark. Starred rows sort first; hidden rows leave the list (not deleted: "Show
 * hidden" brings them back). Restoring or importing a row clears its hidden mark.
 */
const MarkKeys = z.object({ starred: z.array(z.string()), hidden: z.array(z.string()) });
export type MarkKeys = z.infer<typeof MarkKeys>;
export type Mark = keyof MarkKeys;

export const listMarks = defineRpc({
  name: "past-sessions.marks",
  input: z.object({}),
  output: MarkKeys,
});

export const setMark = defineRpc({
  name: "past-sessions.mark",
  input: z.object({ key: z.string(), mark: z.enum(["starred", "hidden"]), on: z.boolean() }),
  output: MarkKeys,
});

/** Stars a live agent, then archives it: the agent stops and its tab closes. */
export const starAndArchive = defineRpc({
  name: "past-sessions.star-and-archive",
  input: z.object({ agentId: z.string() }),
  output: MarkKeys,
});

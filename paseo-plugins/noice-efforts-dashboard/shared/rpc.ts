import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Ticket state as drawn: `ready` = open and nothing open blocks it; `blocked` = open and a
 * `Blocked by:` ticket is not done; the rest come straight from the `Status:` word.
 */
export const TicketStateSchema = z.enum(["ready", "blocked", "claimed", "parked", "done"]);
export type TicketState = z.infer<typeof TicketStateSchema>;

export const CountsSchema = z.object({
  total: z.number(),
  done: z.number(),
  ready: z.number(),
  claimed: z.number(),
  blocked: z.number(),
  parked: z.number(),
});
export type Counts = z.infer<typeof CountsSchema>;

const TicketRefSchema = z.object({ num: z.string(), title: z.string() });

export const EffortSummarySchema = z.object({
  /** Real path of the effort folder; the effort's identity everywhere. */
  key: z.string(),
  /** Real path of the `.scratch` folder it sits in. */
  root: z.string(),
  slug: z.string(),
  /** The slug without the prefix most efforts in this `.scratch` share (`acme-app-`). */
  short: z.string(),
  /** map.md's `# ` title; without a map, the first `# ` of the biggest top-level Markdown file. */
  title: z.string().nullable(),
  /** First clause of map.md's `Status:` line (`delivery`), else null. */
  mapStatus: z.string().nullable(),
  /** First paragraph of map.md's Destination, one line. */
  destination: z.string().nullable(),
  counts: CountsSchema,
  next: TicketRefSchema.nullable(),
  /** Newest mtime of the map, its top-level files, tickets and first-level folders (ms). */
  touchedMs: z.number(),
  hasMap: z.boolean(),
  /** What the Next column says when there is no ready ticket (`no tickets · map only`). */
  stateWord: z.string(),
});
export type EffortSummary = z.infer<typeof EffortSummarySchema>;

export const RootSchema = z.object({
  root: z.string(),
  /** The folder that holds `.scratch` (`acme-app`). */
  label: z.string(),
  efforts: z.array(EffortSummarySchema),
});
export type Root = z.infer<typeof RootSchema>;

export const BindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("effort"), root: z.string(), slug: z.string(), at: z.string() }),
  /** "No effort": the user said this workspace has none; stop suggesting. */
  z.object({ kind: z.literal("none"), at: z.string() }),
]);
export type Binding = z.infer<typeof BindingSchema>;

export const SuggestionSchema = z.object({
  root: z.string(),
  slug: z.string(),
  /** Shown as is, muted: `why: workspace name “Example” matches`. */
  reason: z.string(),
  source: z.enum(["rules", "transcripts", "name", "newest"]),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const WorkspaceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectName: z.string(),
  dir: z.string(),
  /** Real path of the `.scratch` this workspace sees, null when it has none. */
  root: z.string().nullable(),
  /** Why this workspace's `.scratch` exists but isn't scanned (default exclusion, not listed in the settings). */
  skipped: z.string().nullable(),
  binding: BindingSchema.nullable(),
  /** Only for workspaces with no binding. */
  suggestion: SuggestionSchema.nullable(),
});
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>;

/**
 * Polls send the `etag` of the response they hold; when the new response would be identical the
 * server answers `{ unchanged: true }` instead, and the client keeps what it has.
 */
const UnchangedSchema = z.object({ unchanged: z.literal(true), etag: z.string() });
const SinceSchema = z.object({ since: z.string().optional() });

const OverviewSchema = z.object({
  home: z.string(),
  roots: z.array(RootSchema),
  workspaces: z.array(WorkspaceInfoSchema),
  warnings: z.array(z.string()),
  /** Settings → Show header button. */
  showHeaderButton: z.boolean(),
  /** Settings → Show composer pill. */
  showComposerPill: z.boolean(),
  /** Settings → Commits shown: how many rows Files & commits lists. */
  commitsShown: z.number(),
  etag: z.string(),
});
export type Overview = z.output<typeof OverviewSchema>;

export const overviewRpc = defineRpc({
  name: "efforts.overview",
  input: SinceSchema,
  output: z.union([OverviewSchema, UnchangedSchema]),
});

export const TicketSchema = z.object({
  num: z.string(),
  /** Path inside the effort: `issues/01-example-shape.md`. */
  rel: z.string(),
  title: z.string(),
  type: z.string().nullable(),
  /** What it asks of you: `talk`, `agent`, `hands-on`, `yours` (see `ticketKind`). */
  kind: z.enum(["talk", "agent", "hands-on", "yours"]).nullable(),
  state: TicketStateSchema,
  /** The `Status:` value as written, null when the ticket has none. */
  statusRaw: z.string().nullable(),
  /** The normalised first word (`resolved`, `ready-for-agent`, `in progress`). */
  statusWord: z.string(),
  blockedByRaw: z.string().nullable(),
  /** Own tickets named in `Blocked by:` that are not done. */
  after: z.array(z.string()),
  /** `acme-widgets 08` style blockers in other efforts that are not done. */
  afterElsewhere: z.array(z.string()),
  /** Open tickets of this effort that name this one in `Blocked by:`. */
  blocks: z.array(z.string()),
  question: z.string().nullable(),
  mtimeMs: z.number(),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const SectionItemSchema = z.object({
  /** The bullet with its nested lines, as Markdown; empty for Decisions, whose rows show only the title. */
  markdown: z.string(),
  /** Bold lead or first clause. */
  title: z.string(),
  /** First `YYYY-MM-DD` in the bullet. */
  date: z.string().nullable(),
});
export type SectionItem = z.infer<typeof SectionItemSchema>;

export const SectionSchema = z.object({
  /** Fold label: `Decisions`, `Not yet specified`, `Out of scope`. */
  name: z.string(),
  /** Heading in map.md, for jumping there. */
  heading: z.string(),
  count: z.number(),
  tail: z.string(),
  /** The section body, only when it has no bullets (otherwise `items` is drawn and this is empty). */
  markdown: z.string(),
  /** Bullets in map order. */
  items: z.array(SectionItemSchema),
});
export type Section = z.infer<typeof SectionSchema>;

export const DocFileSchema = z.object({ rel: z.string(), name: z.string(), mtimeMs: z.number() });
export type DocFile = z.infer<typeof DocFileSchema>;

export const DocSchema = z.object({
  name: z.string(),
  /** `artifacts`: the sibling `<repo>/.artifacts/<slug>/` folder; its files' rel start with `.artifacts/`. */
  kind: z.enum(["map", "file", "folder", "artifacts"]),
  rel: z.string(),
  /** Folder: number of files (artifacts: capped, see `more`). */
  count: z.number(),
  more: z.boolean(),
  mtimeMs: z.number(),
  files: z.array(DocFileSchema),
});
export type Doc = z.infer<typeof DocSchema>;

export const RelatedSchema = z.object({
  key: z.string(),
  root: z.string(),
  slug: z.string(),
  short: z.string(),
  why: z.string(),
  counts: CountsSchema,
  next: TicketRefSchema.nullable(),
});
export type Related = z.infer<typeof RelatedSchema>;

export const UncommittedRowSchema = z.object({
  /** `map.md` or `handoffs/`. */
  label: z.string(),
  /** Changed sections or file names: `Decisions +8 · Notes +3`. */
  detail: z.string(),
  /** `+16 −3`, `2 new`, `1 changed`. */
  stat: z.string(),
  rel: z.string(),
  /** Single files: when they changed. */
  mtimeMs: z.number().nullable(),
});
export type UncommittedRow = z.infer<typeof UncommittedRowSchema>;

const EffortDetailSchema = z.object({
  summary: EffortSummarySchema,
  /** `acme-app/.scratch/acme-task`. */
  displayPath: z.string(),
  title: z.string().nullable(),
  mapStatusRaw: z.string().nullable(),
  destination: z.string().nullable(),
  deadline: z.string().nullable(),
  tickets: z.array(TicketSchema),
  sections: z.array(SectionSchema),
  docs: z.array(DocSchema),
  /** Parser-detectable oddities, one line each (duplicate numbers, unknown Status words, foreign blockers). */
  anomalies: z.array(z.string()),
  /** Null when the effort is not inside a git repo. */
  uncommitted: z
    .object({ rows: z.array(UncommittedRowSchema), paths: z.array(z.string()), repo: z.string() })
    .nullable(),
  leansOn: z.array(RelatedSchema),
  commits: z.array(z.object({ hash: z.string(), atMs: z.number(), subject: z.string() })),
  moreCommits: z.boolean(),
  etag: z.string(),
});
export type EffortDetail = z.output<typeof EffortDetailSchema>;

export const detailRpc = defineRpc({
  name: "efforts.detail",
  input: SinceSchema.extend({ root: z.string(), slug: z.string() }),
  output: z.union([EffortDetailSchema, UnchangedSchema]),
});

export const readRpc = defineRpc({
  name: "efforts.read",
  input: z.object({ root: z.string(), slug: z.string(), rel: z.string() }),
  output: z.object({ text: z.string(), abs: z.string(), mtimeMs: z.number(), truncated: z.boolean(), binary: z.boolean() }),
});

export const bindRpc = defineRpc({
  name: "efforts.bind",
  input: z.object({
    workspaceId: z.string(),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("effort"), root: z.string(), slug: z.string() }),
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("clear") }),
    ]),
  }),
  output: z.object({ ok: z.literal(true) }),
});

/**
 * Search over efforts (slug, title, Destination), tickets (number, title, Question) and doc file
 * names. Every word of the query must match. A bare number finds tickets by number, the current
 * effort's first.
 */
export const searchRpc = defineRpc({
  name: "efforts.search",
  input: z.object({
    query: z.string(),
    /** Limit to one `.scratch`; all known ones when omitted. */
    root: z.string().optional(),
    /** Effort to rank first (`key`). */
    current: z.string().optional(),
  }),
  output: z.object({
    efforts: z.array(EffortSummarySchema),
    tickets: z.array(
      z.object({
        root: z.string(),
        slug: z.string(),
        short: z.string(),
        num: z.string(),
        title: z.string(),
        state: TicketStateSchema,
        rel: z.string(),
        mtimeMs: z.number(),
      }),
    ),
    docs: z.array(z.object({ root: z.string(), slug: z.string(), short: z.string(), rel: z.string(), mtimeMs: z.number() })),
  }),
});
export type SearchResult = z.output<typeof searchRpc.output>;

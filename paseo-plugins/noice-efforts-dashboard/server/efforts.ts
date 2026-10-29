import type { PaseoAgentListResult, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type {
  Doc,
  EffortDetail,
  Root,
  Section,
  Ticket,
  UncommittedRow,
  WorkspaceInfo,
  bindRpc,
  detailRpc,
  overviewRpc,
  readRpc,
  searchRpc,
} from "../shared/rpc";
import { MAX_COMMITS, type folderSettings } from "../shared/settings";
import type { BindingStore } from "./bindings";
import { commits, effortChanges, numstat, sectionChanges, type Change } from "./git";
import { firstParagraph, headFields, knownStatus, lead, plain, sections, siblingLinks, topBullets } from "../shared/parse";
import {
  artifactsDir,
  skipReason,
  findSibling,
  listArtifacts,
  readText,
  realOrNull,
  resolveTickets,
  scanEffort,
  scanRoot,
  scratchFor,
  shortsFor,
  summarize,
  type EffortScan,
} from "./scan";
import { suggest, type AgentTranscript } from "./suggest";

type FolderSettings = PluginSettings<(typeof folderSettings)["schema"]>;
type Workspace = PaseoWorkspace;
type AgentEntry = PaseoAgentListResult["entries"][number];

const home = homedir();
/** Agents whose transcripts vote for an unbound workspace's effort: active in the last 3 days. */
const VOTE_WINDOW_MS = 3 * 24 * 3600_000;

/** Map sections shown as folds, by heading (Fog is the old name of Not yet specified). */
const FOLDS: { name: string; headings: RegExp; tail: "last" | "first" | "links" }[] = [
  { name: "Decisions", headings: /^decisions( so far)?$/i, tail: "last" },
  { name: "Not yet specified", headings: /^(not yet specified|fog)$/i, tail: "first" },
  { name: "Out of scope", headings: /^out of scope$/i, tail: "links" },
];

async function listAll<T>(page: (cursor?: string) => Promise<{ entries: T[]; pageInfo: { hasMore: boolean; nextCursor?: string | null } }>) {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const result = await page(cursor);
    all.push(...result.entries);
    cursor = result.pageInfo.hasMore ? (result.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return all;
}

let agentsCache: { at: number; result: Promise<AgentEntry[]> } | null = null;
function listAgents(paseo: PaseoApi): Promise<AgentEntry[]> {
  if (agentsCache && Date.now() - agentsCache.at < 15_000) return agentsCache.result;
  const result = listAll((cursor) =>
    paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 200, ...(cursor ? { cursor } : {}) } }),
  );
  agentsCache = { at: Date.now(), result };
  result.catch(() => (agentsCache = null));
  return result;
}

/** OMP keeps the session file as the native handle; Claude Code under `~/.claude/projects`. */
function transcriptOf(entry: AgentEntry): string | null {
  const { agent } = entry;
  const persistence = agent.persistence as { provider?: string; sessionId?: string; nativeHandle?: string } | null;
  if (!persistence) return null;
  if (persistence.nativeHandle && path.isAbsolute(persistence.nativeHandle) && persistence.nativeHandle.endsWith(".jsonl")) {
    return persistence.nativeHandle;
  }
  if (persistence.provider === "claude" && persistence.sessionId) {
    return path.join(home, ".claude", "projects", agent.cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${persistence.sessionId}.jsonl`);
  }
  return null;
}

function workspaceDir(workspace: Workspace): string {
  return workspace.workspaceDirectory ?? workspace.projectRootPath;
}

async function workspaceRoot(workspace: Workspace): Promise<string | null> {
  const own = await realOrNull(path.join(workspaceDir(workspace), ".scratch"));
  return own ?? (await realOrNull(path.join(workspace.projectRootPath, ".scratch")));
}

/** `~/workspace/acme-app/.scratch` → `acme-app`. */
function rootLabel(root: string): string {
  return path.basename(path.dirname(root));
}

/**
 * The response, or `{ unchanged: true }` when it is identical to the one the client holds
 * (`since`). Idle 5 s polls then carry a few bytes instead of 25–100 KB.
 */
function unlessUnchanged<T extends object>(value: T, since: string | undefined): (T & { etag: string }) | { unchanged: true; etag: string } {
  const etag = createHash("sha1").update(JSON.stringify(value)).digest("base64url");
  return etag === since ? { unchanged: true, etag } : { ...value, etag };
}

/** An effort is one folder directly inside `.scratch`. */
function checkSlug(slug: string): void {
  if (!slug || slug === "." || slug === ".." || slug.includes("/") || slug.includes(path.sep)) throw new Error(`Not an effort folder: ${slug}`);
}

export class EffortsService {
  constructor(
    private readonly bindings: BindingStore,
    private readonly settings: FolderSettings,
  ) {}

  /** Roots this service has listed; reads are refused anywhere else. */
  private knownRoots = new Set<string>();

  async overview({ since }: RpcInput<typeof overviewRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof overviewRpc>> {
    const warnings: string[] = [];
    const [workspaces, bindings, settings] = await Promise.all([
      listAll((cursor) => paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } })),
      this.bindings.all(),
      this.settings.read(),
    ]);
    const live = workspaces.filter((workspace) => !workspace.archivingAt && !workspace.internal);
    const roots = await Promise.all(live.map(workspaceRoot));
    const rootSet = new Set<string>();
    const excludedFolders = settings.status === "ready" ? settings.values.excludedFolders : [];
    roots.forEach((root) => root && !skipReason(root, home, excludedFolders) && rootSet.add(root));
    if (settings.status === "ready") {
      for (const folder of settings.values.extraFolders) {
        const root = await scratchFor(folder, home);
        if (root) rootSet.add(root);
        else warnings.push(`Extra folder ${folder} has no .scratch folder (Settings → Plugins → noice-efforts-dashboard → Efforts)`);
      }
    } else {
      warnings.push(`Efforts settings unreadable: ${settings.error}`);
    }

    const scansByRoot = new Map<string, EffortScan[]>();
    await Promise.all([...rootSet].map(async (root) => scansByRoot.set(root, await scanRoot(root))));
    const out: Root[] = [];
    for (const [root, scans] of scansByRoot) {
      if (!scans.length) continue;
      const shorts = shortsFor(scans);
      const efforts = await Promise.all(scans.map((scan) => summarize(scan, scans, shorts)));
      efforts.sort((a, b) => b.touchedMs - a.touchedMs);
      out.push({ root, label: rootLabel(root), efforts });
    }
    out.sort((a, b) => (b.efforts[0]?.touchedMs ?? 0) - (a.efforts[0]?.touchedMs ?? 0));
    this.knownRoots = new Set(out.map((root) => root.root));

    const sharedCount = new Map<string, number>();
    roots.forEach((root) => root && sharedCount.set(root, (sharedCount.get(root) ?? 0) + 1));
    let agents: AgentEntry[] | null = null;
    const infos: WorkspaceInfo[] = await Promise.all(
      live.map(async (workspace, index): Promise<WorkspaceInfo> => {
        const root = roots[index] && scansByRoot.get(roots[index]!)?.length ? roots[index] : null;
        const skipped = roots[index] && !rootSet.has(roots[index]!) ? skipReason(roots[index]!, home, excludedFolders) : null;
        const binding = bindings[workspace.id] ?? null;
        let suggestion = null;
        if (!binding && root) {
          if (!agents) {
            agents = await listAgents(paseo).catch((error: unknown) => {
              warnings.push(`Agent list unavailable, so no suggestions from chats: ${String(error)}`);
              return [];
            });
          }
          const since = Date.now() - VOTE_WINDOW_MS;
          const transcripts: AgentTranscript[] = agents
            .filter(({ agent }) => agent.workspaceId === workspace.id && Date.parse(agent.updatedAt) >= since)
            .map((entry) => ({ title: entry.agent.title, file: transcriptOf(entry) }))
            .filter((entry): entry is AgentTranscript => entry.file !== null);
          suggestion = await suggest({
            workspace: { name: workspace.title || workspace.name, dir: workspaceDir(workspace) },
            root,
            scans: scansByRoot.get(root) ?? [],
            transcripts,
            rootShared: (sharedCount.get(root) ?? 0) > 1,
          }).catch(() => null);
        }
        return {
          id: workspace.id,
          name: workspace.title || workspace.name,
          projectName: workspace.projectDisplayName,
          dir: workspaceDir(workspace),
          root,
          skipped,
          binding,
          suggestion,
        };
      }),
    );
    const showHeaderButton = settings.status === "ready" ? settings.values.showHeaderButton : true;
    const showComposerPill = settings.status === "ready" ? settings.values.showComposerPill : false;
    const commitsShown = settings.status === "ready" ? settings.values.commitsShown : 30;
    return unlessUnchanged({ home, roots: out, workspaces: infos, warnings, showHeaderButton, showComposerPill, commitsShown }, since);
  }

  private async guardRoot(root: string): Promise<void> {
    if (this.knownRoots.has(root)) return;
    if (path.basename(root) !== ".scratch" || (await realOrNull(root)) !== root) throw new Error(`Not a .scratch folder: ${root}`);
  }

  async detail({ root, slug, since }: RpcInput<typeof detailRpc>): Promise<RpcOutput<typeof detailRpc>> {
    checkSlug(slug);
    await this.guardRoot(root);
    const [scan, siblings] = await Promise.all([scanEffort(root, slug), scanRoot(root)]);
    if (!scan) throw new Error(`No effort ${slug} in ${root}`);
    const shorts = shortsFor(siblings);
    const summary = await summarize(scan, siblings, shorts);
    const resolved = resolveTickets(scan, siblings, shorts);
    const mapFile = path.join(scan.key, "map.md");
    const mapText = scan.hasMap ? await readText(mapFile).then((read) => read.text, () => "") : "";
    const head = headFields(mapText);
    const mapSections = sections(mapText);

    const git = await effortChanges(scan.key, root);
    const changes = git?.changes ?? [];
    const stats = git ? await numstat(git.top, scan.key, changes) : new Map<string, { added: number; removed: number }>();

    const tickets: Ticket[] = scan.tickets.map((ticket) => ({
      num: ticket.num,
      rel: ticket.rel,
      title: ticket.title,
      type: ticket.type,
      kind: ticket.kind,
      state: resolved.state.get(ticket.rel) ?? "ready",
      statusRaw: ticket.statusRaw,
      statusWord: ticket.statusWord,
      blockedByRaw: ticket.blockedByRaw,
      after: resolved.after.get(ticket.rel) ?? [],
      afterElsewhere: resolved.afterElsewhere.get(ticket.rel) ?? [],
      blocks: resolved.blocks.get(ticket.num) ?? [],
      question: ticket.question,
      mtimeMs: ticket.mtimeMs,
    }));

    const anomalies: string[] = [];
    const byNum = new Map<string, string[]>();
    scan.tickets.forEach((ticket) => byNum.set(ticket.num, [...(byNum.get(ticket.num) ?? []), path.basename(ticket.rel)]));
    for (const [num, files] of byNum) if (files.length > 1) anomalies.push(`${files.length} tickets numbered ${num}: ${files.join(", ")}`);
    for (const ticket of scan.tickets) {
      if (ticket.statusRaw && !knownStatus(ticket.statusWord)) {
        anomalies.push(`${ticket.num}: Status word “${ticket.statusWord}” is not a known one; counted as open`);
      }
      const missing = ticket.blockedBy.own.filter((num) => !byNum.has(num));
      if (missing.length) anomalies.push(`${ticket.num}: Blocked by names ${missing.join(", ")}, not a ticket here`);
      for (const ref of ticket.blockedBy.elsewhere) {
        const other = findSibling(siblings, shorts, ref.effort);
        anomalies.push(
          other
            ? `${ticket.num}: Blocked by names ${ref.effort} ${ref.num}, a ticket of ${other.slug}`
            : `${ticket.num}: Blocked by names ${ref.effort} ${ref.num}, which matches no effort`,
        );
      }
    }

    const outOfScope = mapSections.find((section) => /^out of scope$/i.test(section.heading));
    const linkedFrom = (markdown: string) =>
      [...new Set(siblingLinks(markdown).map((link) => link.slug))]
        .filter((other) => other !== slug && siblings.some((sibling) => sibling.slug === other))
        .map((other) => shorts.get(other) ?? other);
    const folds: Section[] = [];
    for (const fold of FOLDS) {
      const section = mapSections.find((candidate) => fold.headings.test(candidate.heading));
      if (!section) continue;
      const bullets = topBullets(section.body);
      const links = fold.tail === "links" ? linkedFrom(section.body) : [];
      const tail =
        fold.tail === "links" && links.length
          ? `→ ${links.join(", ")}`
          : bullets.length
            ? lead(fold.tail === "last" ? bullets[bullets.length - 1].text : bullets[0].text)
            : (firstParagraph(section.body) ?? "");
      folds.push({
        name: fold.name,
        heading: section.heading,
        count: bullets.length,
        tail,
        // Folds with bullets draw `items`; the body is only drawn when there are none.
        markdown: bullets.length ? "" : section.body.trim(),
        items: bullets.map((bullet) => ({
          // Decisions rows show the title and open map.md there; the bullet body isn't drawn.
          markdown: fold.name === "Decisions" ? "" : bullet.markdown,
          title: lead(bullet.text, 120),
          date: /\b(20\d\d-\d\d-\d\d)\b/.exec(bullet.markdown)?.[1] ?? null,
        })),
      });
    }

    const docs: Doc[] = [];
    const newest = (files: { mtimeMs: number }[]) => Math.max(0, ...files.map((file) => file.mtimeMs));
    for (const file of scan.topFiles) {
      if (file.name !== "map.md" && !/\.(md|markdown|txt)$/i.test(file.name)) continue;
      const doc: Doc = {
        name: file.name,
        kind: file.name === "map.md" ? "map" : "file",
        rel: file.name,
        count: 0,
        more: false,
        mtimeMs: file.mtimeMs,
        files: [],
      };
      if (doc.kind === "map") docs.unshift(doc);
      else docs.push(doc);
    }
    const folders = [...scan.folders]
      .filter((folder) => folder.files.length)
      .sort((a, b) => (a.name === "issues" ? 1 : b.name === "issues" ? -1 : newest(b.files) - newest(a.files)));
    for (const folder of folders) {
      docs.push({
        name: folder.name,
        kind: "folder",
        rel: folder.name,
        count: folder.files.length,
        more: false,
        mtimeMs: newest(folder.files),
        files: [...folder.files]
          .sort((a, b) => (folder.name === "issues" ? a.name.localeCompare(b.name) : b.mtimeMs - a.mtimeMs))
          .map((file) => ({ rel: `${folder.name}/${file.name}`, name: file.name, mtimeMs: file.mtimeMs })),
      });
    }
    const artifacts = listArtifacts(artifactsDir(root, slug));
    if (artifacts.count) {
      docs.push({
        name: ".artifacts",
        kind: "artifacts",
        rel: ".artifacts",
        count: artifacts.count,
        more: artifacts.more,
        mtimeMs: newest(artifacts.files),
        files: artifacts.files.map((file) => ({ rel: `.artifacts/${file.rel}`, name: file.rel, mtimeMs: file.mtimeMs })),
      });
    }

    const why = new Map<string, string>();
    const leanText = mapSections
      .filter((section) => section !== outOfScope)
      .map((section) => section.body)
      .join("\n\n");
    for (const link of siblingLinks(leanText)) {
      if (link.slug === slug || why.has(link.slug)) continue;
      if (!siblings.some((sibling) => sibling.slug === link.slug)) continue;
      why.set(link.slug, lead(link.context, 80));
    }
    const leansOn = await Promise.all(
      [...why].map(async ([other, reason]) => {
        const sibling = siblings.find((candidate) => candidate.slug === other)!;
        const related = await summarize(sibling, siblings, shorts);
        return { key: related.key, root, slug: other, short: related.short, why: reason, counts: related.counts, next: related.next };
      }),
    );

    const log = git ? await commits(git.top, scan.key) : [];
    const rows = git ? await this.uncommittedRows(git.top, scan.key, changes, stats) : [];
    return unlessUnchanged(
      {
        summary,
        displayPath: path.join(rootLabel(root), ".scratch", slug),
        title: summary.title,
        mapStatusRaw: head.fields.get("status") ?? null,
        destination: summary.destination,
        deadline: head.fields.get("deadline") ? plain(head.fields.get("deadline")!) : null,
        tickets,
        sections: folds,
        docs,
        anomalies,
        uncommitted: git ? { rows, paths: changes.map((change) => path.join(scan.key, change.rel)), repo: git.top } : null,
        leansOn,
        commits: log.slice(0, MAX_COMMITS),
        moreCommits: log.length > MAX_COMMITS,
      } satisfies Omit<EffortDetail, "etag">,
      since,
    );
  }

  /**
   * One row per changed top-level file, one per first-level folder: `map.md · Decisions +8 ·
   * Notes +3  +16 −3`, `handoffs/ a.md, b.md  2 new`.
   */
  private async uncommittedRows(
    top: string,
    effortDir: string,
    changes: Change[],
    stats: Map<string, { added: number; removed: number }>,
  ): Promise<UncommittedRow[]> {
    const groups = new Map<string, Change[]>();
    for (const change of changes) {
      const first = change.rel.split("/")[0];
      const key = change.rel.includes("/") ? `${first}/` : change.rel;
      groups.set(key, [...(groups.get(key) ?? []), change]);
    }
    const rows: UncommittedRow[] = [];
    for (const [label, group] of groups) {
      if (!label.endsWith("/")) {
        const change = group[0];
        const stat = stats.get(change.rel);
        const sectionsChanged =
          change.kind === "modified" && change.rel.endsWith(".md") ? (await sectionChanges(top, path.join(effortDir, change.rel), change.sig)).sections : [];
        let mtimeMs: number | null = null;
        if (change.kind !== "deleted") mtimeMs = await readText(path.join(effortDir, change.rel)).then((read) => read.mtimeMs, () => null);
        rows.push({
          label,
          detail: sectionsChanged.map(([heading, added]) => `${heading.replace(/^decisions so far$/i, "Decisions")} +${added}`).join(" · "),
          stat: change.kind === "modified" && stat ? `+${stat.added} −${stat.removed}` : change.kind === "new" ? "new" : change.kind,
          rel: change.rel,
          mtimeMs,
        });
        continue;
      }
      const counts = { new: 0, modified: 0, deleted: 0 };
      group.forEach((change) => counts[change.kind]++);
      rows.push({
        label,
        detail: group.map((change) => change.rel.slice(label.length)).join(", "),
        stat: [
          counts.new ? `${counts.new} new` : "",
          counts.modified ? `${counts.modified} changed` : "",
          counts.deleted ? `${counts.deleted} deleted` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        rel: label.slice(0, -1),
        mtimeMs: null,
      });
    }
    // map.md, then other files, then folders.
    const rank = (row: UncommittedRow) => (row.label === "map.md" ? 0 : row.label.endsWith("/") ? 2 : 1);
    return rows.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  }

  async search({ query, root, current }: RpcInput<typeof searchRpc>, context: PluginHandlerContext): Promise<RpcOutput<typeof searchRpc>> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const empty = { efforts: [], tickets: [], docs: [] };
    if (!words.length) return empty;
    if (root) await this.guardRoot(root);
    // Right after a plugin restart nothing is known yet: list the roots first, instead of finding nothing.
    else if (!this.knownRoots.size) await this.overview({}, context);
    const roots = root ? [root] : [...this.knownRoots];
    const number = words.length === 1 && /^#?\d{1,3}$/.test(words[0]) ? words[0].replace("#", "").padStart(2, "0") : null;
    const hits = (text: string) => {
      const lower = text.toLowerCase();
      return words.every((word) => lower.includes(word));
    };
    const efforts: RpcOutput<typeof searchRpc>["efforts"] = [];
    const tickets: RpcOutput<typeof searchRpc>["tickets"] = [];
    const docs: RpcOutput<typeof searchRpc>["docs"] = [];
    for (const scratch of roots) {
      const scans = await scanRoot(scratch);
      const shorts = shortsFor(scans);
      for (const scan of scans) {
        const summary = await summarize(scan, scans, shorts);
        const short = summary.short;
        if (!number && hits(`${scan.slug}\n${summary.title ?? ""}\n${summary.destination ?? ""}`)) efforts.push(summary);
        const resolved = resolveTickets(scan, scans, shorts);
        for (const ticket of scan.tickets) {
          const match = number ? ticket.num === number : hits(`${ticket.num} ${ticket.title}\n${ticket.question ?? ""}`);
          if (!match) continue;
          tickets.push({
            root: scratch,
            slug: scan.slug,
            short,
            num: ticket.num,
            title: ticket.title,
            state: resolved.state.get(ticket.rel) ?? "ready",
            rel: ticket.rel,
            mtimeMs: ticket.mtimeMs,
          });
        }
        if (number) continue;
        for (const file of scan.topFiles) if (hits(file.name)) docs.push({ root: scratch, slug: scan.slug, short, rel: file.name, mtimeMs: file.mtimeMs });
        for (const folder of scan.folders) {
          if (folder.name === "issues") continue;
          for (const file of folder.files) {
            const rel = `${folder.name}/${file.name}`;
            if (hits(rel)) docs.push({ root: scratch, slug: scan.slug, short, rel, mtimeMs: file.mtimeMs });
          }
        }
      }
    }
    const mine = (item: { root: string; slug: string }) => (current && path.join(item.root, item.slug) === current ? 0 : 1);
    efforts.sort((a, b) => b.touchedMs - a.touchedMs);
    tickets.sort((a, b) => mine(a) - mine(b) || b.mtimeMs - a.mtimeMs);
    docs.sort((a, b) => mine(a) - mine(b) || b.mtimeMs - a.mtimeMs);
    return { efforts: efforts.slice(0, 8), tickets: tickets.slice(0, 20), docs: docs.slice(0, 12) };
  }

  async read({ root, slug, rel }: RpcInput<typeof readRpc>): Promise<RpcOutput<typeof readRpc>> {
    checkSlug(slug);
    await this.guardRoot(root);
    const artifacts = artifactsDir(root, slug);
    const abs = rel.startsWith(".artifacts/") ? path.resolve(artifacts, rel.slice(".artifacts/".length)) : path.resolve(root, slug, rel);
    if (!abs.startsWith(root + path.sep) && !abs.startsWith(artifacts + path.sep)) throw new Error(`Outside ${root}: ${rel}`);
    const { text, mtimeMs, truncated } = await readText(abs);
    const binary = text.slice(0, 8192).includes("\0");
    return { text: binary ? "" : text, abs, mtimeMs, truncated, binary };
  }

  async bind({ workspaceId, target }: RpcInput<typeof bindRpc>): Promise<RpcOutput<typeof bindRpc>> {
    const at = new Date().toISOString();
    if (target.kind === "clear") await this.bindings.set(workspaceId, null);
    else if (target.kind === "none") await this.bindings.set(workspaceId, { kind: "none", at });
    else {
      checkSlug(target.slug);
      await this.guardRoot(target.root);
      await this.bindings.set(workspaceId, { kind: "effort", root: target.root, slug: target.slug, at });
    }
    return { ok: true };
  }
}

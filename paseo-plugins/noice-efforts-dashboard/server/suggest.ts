import { statSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import type { Suggestion } from "../shared/rpc";
import { nameMatch } from "../shared/parse";
import type { EffortScan } from "./scan";
import { Lru } from "./lru";

export interface AgentTranscript {
  title: string | null;
  file: string;
}

const TAIL_BYTES = 256 * 1024;
/** One per transcript of the last 3 days in an unbound workspace: 57 on 2026-10-21. */
const tails = new Lru<string, { mtimeMs: number; size: number; counts: Map<string, number> }>(500);

/** `.scratch/<slug>/` mentions in the last 256 KB of a transcript, cached by mtime and size. */
async function mentions(file: string): Promise<Map<string, number>> {
  const info = statSync(file);
  const cached = tails.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.counts;
  const handle = await open(file, "r");
  let text: string;
  try {
    const length = Math.min(info.size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, info.size - length);
    text = buffer.toString("utf8");
  } finally {
    await handle.close();
  }
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/\.scratch\/([A-Za-z0-9._-]+)\//g)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  tails.set(file, { mtimeMs: info.mtimeMs, size: info.size, counts });
  return counts;
}

async function rulesSlug(dir: string): Promise<string | null> {
  try {
    const text = await readFile(path.join(dir, ".omp", "RULES.md"), "utf8");
    return (
      /serves the effort [`*]*([A-Za-z0-9._-]+)/i.exec(text)?.[1] ?? /\.scratch\/([A-Za-z0-9._-]+)\//.exec(text)?.[1] ?? null
    );
  } catch {
    return null;
  }
}

/**
 * The effort a workspace without a binding probably serves, with the evidence in words.
 * Order: the folder's `.omp/RULES.md` → `.scratch/<slug>/` mentions in this workspace's recent
 * transcripts (3+ and twice the runner-up) → workspace name → newest files, only when no
 * other workspace uses this `.scratch`. Null when nothing points anywhere.
 */
export async function suggest(input: {
  workspace: { name: string; dir: string };
  root: string;
  scans: readonly EffortScan[];
  transcripts: readonly AgentTranscript[];
  rootShared: boolean;
}): Promise<Suggestion | null> {
  const { workspace, root, scans } = input;
  const slugs = new Set(scans.map((scan) => scan.slug));

  const fromRules = await rulesSlug(workspace.dir);
  if (fromRules && slugs.has(fromRules)) {
    return { root, slug: fromRules, reason: "why: this folder's .omp/RULES.md names it", source: "rules" };
  }

  const total = new Map<string, number>();
  const byChat = new Map<string, { title: string | null; count: number }[]>();
  for (const transcript of input.transcripts) {
    let counts: Map<string, number>;
    try {
      counts = await mentions(transcript.file);
    } catch {
      continue;
    }
    for (const [slug, count] of counts) {
      if (!slugs.has(slug)) continue;
      total.set(slug, (total.get(slug) ?? 0) + count);
      byChat.set(slug, [...(byChat.get(slug) ?? []), { title: transcript.title, count }]);
    }
  }
  const ranked = [...total].sort((a, b) => b[1] - a[1]);
  if (ranked[0] && ranked[0][1] >= 3 && ranked[0][1] >= 2 * (ranked[1]?.[1] ?? 0)) {
    const [slug, count] = ranked[0];
    const chats = byChat.get(slug) ?? [];
    const where =
      chats.length === 1 && chats[0].title ? `“${chats[0].title}” chat` : `${chats.length === 1 ? "its chat" : `${chats.length} of its chats`}`;
    return { root, slug, reason: `why: named ${count}× in ${where}`, source: "transcripts" };
  }

  const byName = scans
    .map((scan) => ({ scan, score: nameMatch(workspace.name, scan.slug) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.scan.touchedMs - a.scan.touchedMs);
  if (byName[0] && (byName.length === 1 || byName[0].score > byName[1].score)) {
    return { root, slug: byName[0].scan.slug, reason: `why: workspace name “${workspace.name}” matches`, source: "name" };
  }

  if (!input.rootShared && scans.length) {
    const newest = [...scans].sort((a, b) => b.touchedMs - a.touchedMs)[0];
    return { root, slug: newest.slug, reason: "why: newest files in this workspace's .scratch", source: "newest" };
  }
  return null;
}

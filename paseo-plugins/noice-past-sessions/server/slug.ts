import { createHash } from "node:crypto";
import path from "node:path";

/**
 * OMP's per-folder session directory names, ported from omp 18.x
 * `packages/coding-agent/src/session/session-paths.ts` (read from the installed binary).
 * `home` and `tmp` must be resolved the way OMP resolves them (realpath).
 *
 * - under tmp:  `-tmp-<rel>` (`/tmp/a/b` → `-tmp-a-b`), checked before home
 * - under home: `-<rel>` (`~/workspace/acme-app` → `-workspace-acme-app`, `~` → `-`)
 * - elsewhere:  `--<abs>--` (`/mnt/vault` → `--mnt-vault--`)
 * Legacy names OMP still migrates on next use, so they can hold old sessions:
 * the `--<abs>--` form for every path, the home form for tmp paths inside home,
 * and `<home|tmp|abs>-<basename>-<sha256(path)>`.
 */
export interface PathRoots {
  home: string;
  tmp: string;
}

export interface OmpDirNames {
  /** The name OMP writes new sessions to today. */
  current: string;
  /** Every name that can hold this folder's sessions, current first. */
  all: string[];
}

function relativeInside(root: string, target: string): string | null {
  const rel = path.relative(root, target);
  if (rel === "") return "";
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

function withSuffix(prefix: string, rel: string): string {
  const encoded = rel.replace(/[/\\:]/g, "-");
  if (!encoded) return prefix;
  return prefix.endsWith("-") ? `${prefix}${encoded}` : `${prefix}-${encoded}`;
}

function absoluteName(resolved: string): string {
  return `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function hashedName(resolved: string, kind: "home" | "tmp" | "abs"): string {
  const base = path
    .basename(resolved)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80);
  const digest = createHash("sha256").update(resolved.replaceAll("\\", "/")).digest("hex");
  return `${kind}-${base || "project"}-${digest}`;
}

export function ompDirNames(resolvedCwd: string, roots: PathRoots): OmpDirNames {
  const underTmp = relativeInside(roots.tmp, resolvedCwd);
  const underHome = relativeInside(roots.home, resolvedCwd);
  let current: string;
  let kind: "home" | "tmp" | "abs";
  const legacy: string[] = [];
  if (underTmp !== null) {
    current = withSuffix("-tmp", underTmp);
    kind = "tmp";
    if (underHome !== null) legacy.push(withSuffix("-", underHome));
  } else if (underHome !== null) {
    current = withSuffix("-", underHome);
    kind = "home";
  } else {
    current = absoluteName(resolvedCwd);
    kind = "abs";
  }
  legacy.push(absoluteName(resolvedCwd), hashedName(resolvedCwd, kind));
  return { current, all: [...new Set([current, ...legacy])] };
}

const HASHED_NAME = /^(home|tmp|abs)-.*-[0-9a-f]{64}$/;

/**
 * Builds a test for session directory names that can hold sessions for any of `resolvedRoots`
 * or folders below them. Over-inclusive by design: slugs are lossy (`-` in names), so callers
 * must confirm each session's recorded cwd. Hashed legacy names cannot be matched by prefix
 * and are always candidates.
 */
export function subtreeDirMatcher(resolvedRoots: string[], roots: PathRoots): (dirName: string) => boolean {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  const absolutePrefixes: string[] = [];
  for (const name of resolvedRoots.flatMap((root) => ompDirNames(root, roots).all)) {
    exact.add(name);
    if (HASHED_NAME.test(name)) continue;
    // `--mnt-vault--` → children look like `--mnt-vault-sub--`.
    if (name.endsWith("--")) absolutePrefixes.push(`${name.slice(0, -2)}-`);
    else prefixes.push(name.endsWith("-") ? name : `${name}-`);
  }
  return (dirName) =>
    exact.has(dirName) ||
    HASHED_NAME.test(dirName) ||
    prefixes.some((prefix) => dirName.startsWith(prefix)) ||
    (dirName.endsWith("--") && absolutePrefixes.some((prefix) => dirName.startsWith(prefix)));
}

/**
 * Whether `target` is `root` or inside it. Both must be resolved absolute paths. A string prefix
 * check: the scan calls this files × scope folders times (≈130,000 on a large project), where
 * `path.relative` cost 67 ms and this 0.6 ms.
 */
export function isSameOrInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

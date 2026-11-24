import { type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import path from "node:path";
import { gitDir, invalidateGit, repoTop } from "./git";

/** Same exclusions as `scan.ts` so watched directories match scanned directories. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage"]);
const NOT_EFFORTS = new Set(["_to_organize_", "node_modules"]);
const GIT_WATCH_FILES = new Set(["index", "HEAD", "COMMIT_EDITMSG", "MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "packed-refs"]);

function isIgnoredName(name: string | null | undefined): boolean {
  if (!name) return false;
  if (name.startsWith(".")) return true;
  return name.endsWith(".tmp") || name.endsWith("~") || name.endsWith(".swp") || name.endsWith(".swx");
}

function readSubdirs(dir: string, skip: ReadonlySet<string>): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
    if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
    const abs = path.join(dir, entry.name);
    try {
      if (statSync(abs).isDirectory()) out.push(abs);
    } catch {
      // Vanished or broken symlink.
    }
  }
  return out;
}

interface WatchedRoot {
  /** Absolute directory path -> FSWatcher (root, its efforts, and first-level subfolders). */
  watchers: Map<string, FSWatcher>;
  timer?: ReturnType<typeof setTimeout>;
}

interface WatchedGit {
  top: string;
  watchers: FSWatcher[];
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
}

interface DetailSub {
  root: string;
  slug: string;
  listener: () => void;
  gitDir?: string;
  top?: string;
  closed: boolean;
}

export interface EffortsWatcherOptions {
  /** Debounce window for `.scratch` filesystem bursts (ms). */
  debounceMs?: number;
  /** Debounce window for `.git` index/HEAD events (ms). */
  gitDebounceMs?: number;
  onRootChange?: (root: string) => void;
  onGitChange?: (top: string) => void;
}

/**
 * Watches active `.scratch` roots (two levels deep, matching `scanRoot`/`scanEffort`) and, while
 * any `detailWatch` subscriber is open, the owning repo's `.git` directory (`index`/`HEAD`/`logs/HEAD`).
 *
 * Holds zero `FSWatcher`s and zero timers whenever no client is subscribed.
 */
export class EffortsWatcher {
  readonly #debounceMs: number;
  readonly #gitDebounceMs: number;
  readonly #onRootChange: (root: string) => void;
  readonly #onGitChange: (top: string) => void;

  readonly #overviewListeners = new Set<() => void>();
  readonly #detailSubs = new Set<DetailSub>();
  /** Roots discovered by `overview()` (kept even when paused so resuming re-attaches them). */
  #overviewRoots = new Set<string>();
  /** Active `.scratch` root watchers. */
  readonly #roots = new Map<string, WatchedRoot>();
  /** Active gitdir watchers (keyed by absolute gitDir), only while a detail sub is open. */
  readonly #gits = new Map<string, WatchedGit>();
  #overviewTimer?: ReturnType<typeof setTimeout>;
  #closed = false;

  constructor(options: EffortsWatcherOptions = {}) {
    this.#debounceMs = options.debounceMs ?? 120;
    this.#gitDebounceMs = options.gitDebounceMs ?? 200;
    this.#onRootChange = options.onRootChange ?? ((root) => invalidateGit({ root }));
    this.#onGitChange = options.onGitChange ?? ((top) => invalidateGit({ top }));
  }

  /** Number of live `FSWatcher` handles across `.scratch` and `.git` directories (for tests/diagnostics). */
  get watcherCount(): number {
    let count = 0;
    for (const entry of this.#roots.values()) count += entry.watchers.size;
    for (const entry of this.#gits.values()) count += entry.watchers.length;
    return count;
  }

  /** Subscribes to overview changes; starts `.scratch` watchers on the first subscriber. */
  onOverview(listener: () => void): () => void {
    if (this.#closed) return () => {};
    this.#overviewListeners.add(listener);
    this.#syncRoots();
    return () => {
      this.#overviewListeners.delete(listener);
      this.#syncRoots();
    };
  }

  /**
   * Subscribes to changes affecting one effort (any change in its `.scratch` root, including
   * sibling efforts that can resolve cross-effort blockers, plus git index/HEAD updates in its repo).
   */
  onDetail(root: string, slug: string, listener: () => void): () => void {
    if (this.#closed) return () => {};
    const sub: DetailSub = { root, slug, listener, closed: false };
    this.#detailSubs.add(sub);
    this.#syncRoots();

    const effortDir = path.join(root, slug);
    void Promise.all([gitDir(effortDir), repoTop(effortDir)])
      .then(([foundGitDir, foundTop]) => {
        if (sub.closed || this.#closed || !foundGitDir || !foundTop) return;
        sub.gitDir = foundGitDir;
        sub.top = foundTop;
        this.#acquireGit(foundGitDir, foundTop);
      })
      .catch(() => undefined);

    return () => {
      if (sub.closed) return;
      sub.closed = true;
      this.#detailSubs.delete(sub);
      if (sub.gitDir) this.#releaseGit(sub.gitDir);
      this.#syncRoots();
    };
  }

  /** Updates the set of `.scratch` roots discovered by `overview()`. */
  setRoots(roots: Iterable<string>): void {
    if (this.#closed) return;
    this.#overviewRoots = new Set(roots);
    this.#syncRoots();
  }

  /** Immediately notifies overview subscribers (e.g., after `bindRpc` or a settings save). */
  notifyOverview(): void {
    if (this.#closed || this.#overviewListeners.size === 0) return;
    if (this.#overviewTimer) {
      clearTimeout(this.#overviewTimer);
      this.#overviewTimer = undefined;
    }
    for (const listener of this.#overviewListeners) listener();
  }

  /** Schedules a debounced overview notification (e.g., workspace lifecycle or unbound chat turn). */
  scheduleOverview(): void {
    if (this.#closed || this.#overviewListeners.size === 0 || this.#overviewTimer) return;
    this.#overviewTimer = setTimeout(() => {
      this.#overviewTimer = undefined;
      for (const listener of this.#overviewListeners) listener();
    }, this.#debounceMs);
  }

  /** Stops all watchers, clears all timers and listeners. */
  close(): void {
    this.#closed = true;
    this.#overviewListeners.clear();
    for (const sub of this.#detailSubs) sub.closed = true;
    this.#detailSubs.clear();
    if (this.#overviewTimer) {
      clearTimeout(this.#overviewTimer);
      this.#overviewTimer = undefined;
    }
    for (const root of [...this.#roots.keys()]) this.#unwatchRoot(root);
    for (const dir of [...this.#gits.keys()]) this.#closeGit(dir);
  }

  #desiredRoots(): Set<string> {
    const desired = new Set<string>();
    if (this.#overviewListeners.size > 0) {
      for (const root of this.#overviewRoots) desired.add(root);
    }
    for (const sub of this.#detailSubs) desired.add(sub.root);
    return desired;
  }

  #syncRoots(): void {
    const desired = this.#desiredRoots();
    for (const root of [...this.#roots.keys()]) {
      if (!desired.has(root)) this.#unwatchRoot(root);
    }
    for (const root of desired) {
      if (!this.#roots.has(root)) this.#watchRoot(root);
    }
    if (this.#overviewListeners.size === 0 && this.#overviewTimer) {
      clearTimeout(this.#overviewTimer);
      this.#overviewTimer = undefined;
    }
  }

  #watchRoot(root: string): void {
    const entry: WatchedRoot = { watchers: new Map() };
    this.#roots.set(root, entry);
    this.#syncRootDirs(root, entry);
  }

  #unwatchRoot(root: string): void {
    const entry = this.#roots.get(root);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    for (const watcher of entry.watchers.values()) watcher.close();
    entry.watchers.clear();
    this.#roots.delete(root);
  }

  /** Keeps watchers in sync with `<root>`, `<root>/<slug>`, and `<root>/<slug>/<subfolder>`. */
  #syncRootDirs(root: string, entry: WatchedRoot): void {
    if (this.#roots.get(root) !== entry) return;
    const dirs = new Map<string, 0 | 1 | 2>();
    dirs.set(root, 0);
    for (const effortDir of readSubdirs(root, NOT_EFFORTS)) {
      dirs.set(effortDir, 1);
      for (const subDir of readSubdirs(effortDir, SKIP_DIRS)) {
        dirs.set(subDir, 2);
      }
    }
    for (const [dir, watcher] of entry.watchers) {
      if (dirs.has(dir)) continue;
      watcher.close();
      entry.watchers.delete(dir);
    }
    for (const [dir, depth] of dirs) {
      if (entry.watchers.has(dir)) continue;
      try {
        const watcher = watch(dir, (_event, filename) => {
          const name = filename?.toString();
          if (isIgnoredName(name)) return;
          if (depth < 2) this.#syncRootDirs(root, entry);
          this.#scheduleRootEmit(root, entry);
        });
        watcher.on("error", () => {
          watcher.close();
          entry.watchers.delete(dir);
        });
        entry.watchers.set(dir, watcher);
      } catch {
        // Directory vanished or unreadable; parent watcher will re-sync if it returns.
      }
    }
  }

  #scheduleRootEmit(root: string, entry: WatchedRoot): void {
    if (this.#closed || entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (this.#closed) return;
      this.#onRootChange(root);
      for (const listener of this.#overviewListeners) listener();
      for (const sub of this.#detailSubs) {
        if (sub.root === root) sub.listener();
      }
    }, this.#debounceMs);
  }

  #acquireGit(dir: string, top: string): void {
    const existing = this.#gits.get(dir);
    if (existing) {
      existing.refs++;
      return;
    }
    const entry: WatchedGit = { top, watchers: [], refs: 1 };
    const schedule = () => {
      if (this.#closed || entry.timer) return;
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        if (this.#closed) return;
        this.#onGitChange(entry.top);
        for (const sub of this.#detailSubs) {
          if (sub.top === entry.top) sub.listener();
        }
      }, this.#gitDebounceMs);
    };
    const attach = (target: string, filter: (name: string | undefined) => boolean) => {
      try {
        const watcher = watch(target, (_event, filename) => {
          const name = filename?.toString();
          if (name && !filter(name)) return;
          schedule();
        });
        watcher.on("error", () => {
          watcher.close();
          const idx = entry.watchers.indexOf(watcher);
          if (idx >= 0) entry.watchers.splice(idx, 1);
        });
        entry.watchers.push(watcher);
      } catch {
        // Missing optional dir (e.g. unborn repo without logs/).
      }
    };
    attach(dir, (name) => !name || GIT_WATCH_FILES.has(name));
    attach(path.join(dir, "logs"), (name) => !name || name === "HEAD");
    if (entry.watchers.length > 0) this.#gits.set(dir, entry);
  }

  #releaseGit(dir: string): void {
    const existing = this.#gits.get(dir);
    if (!existing) return;
    existing.refs--;
    if (existing.refs <= 0) this.#closeGit(dir);
  }

  #closeGit(dir: string): void {
    const entry = this.#gits.get(dir);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    for (const watcher of entry.watchers) watcher.close();
    this.#gits.delete(dir);
  }
}

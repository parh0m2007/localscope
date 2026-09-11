import { watch, type FSWatcher, type WatchEventType } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface WatcherOptions {
  readonly rootDir: string;
  readonly debounceMs?: number;
  readonly onChange: (changedPaths: readonly string[]) => void;
  readonly onIgnoredDir?: (dir: string) => void;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".vercel",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  "coverage",
  ".idea",
  ".vscode",
  ".cache",
  "tmp",
]);

const DEFAULT_DEBOUNCE_MS = 300;

export interface RepoWatcher {
  readonly close: () => void;
  readonly isClosed: () => boolean;
}

function isInsideIgnoredDir(relPath: string): boolean {
  const parts = relPath.split(path.sep);
  return parts.some((p) => IGNORED_DIRS.has(p) || (p.startsWith(".") && p !== ".github"));
}

function shouldWatch(relPath: string): boolean {
  if (relPath === "") return true;
  return !isInsideIgnoredDir(relPath);
}

/**
 * Watches a repository for file changes. Uses recursive fs.watch where
 * supported (macOS, Windows); on Linux falls back to per-directory watchers
 * on the top-level subdirectories that matter.
 */
export function createRepoWatcher(options: WatcherOptions): RepoWatcher {
  const { rootDir, onChange } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let closed = false;
  const watchers: FSWatcher[] = [];
  const pending = new Map<string, number>(); // relPath -> timestamp
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    timer = null;
    if (closed) return;
    if (pending.size === 0) return;
    const changed = [...pending.keys()];
    pending.clear();
    onChange(changed);
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const handleEvent = (
    eventType: WatchEventType,
    filename: string | null,
    watchedDir: string,
  ): void => {
    if (closed) return;
    let absPath: string | null = null;
    if (typeof filename === "string" && filename.length > 0) {
      // fs.watch reports filename relative to the watched directory —
      // resolve against it, never process.cwd().
      absPath = path.resolve(watchedDir, filename);
    }
    if (!absPath) {
      schedule();
      return;
    }
    const rel = path.relative(rootDir, absPath);
    if (!shouldWatch(rel)) return;
    // rename covers create+delete; the updater re-walks and stats, so just
    // recording the path is enough.
    void eventType;
    pending.set(rel, Date.now());
    schedule();
  };

  const attach = (dir: string, recursive: boolean): FSWatcher => {
    const w = watch(dir, { recursive }, (eventType, filename) => {
      handleEvent(eventType, filename, dir);
    });
    return w;
  };

  const tryWatchRecursive = (): FSWatcher | null => {
    try {
      return attach(rootDir, true);
    } catch {
      return null;
    }
  };

  const listTopLevelDirs = async (): Promise<string[]> => {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .filter((e) => shouldWatch(e.name))
      .map((e) => path.join(rootDir, e.name));
  };

  const watchPerDir = async (): Promise<void> => {
    try {
      watchers.push(attach(rootDir, false));
    } catch {
      // root unwatchable — nothing we can do
    }
    let dirs: string[] = [];
    try {
      dirs = await listTopLevelDirs();
    } catch {
      dirs = [];
    }
    for (const dir of dirs) {
      try {
        watchers.push(attach(dir, false));
      } catch {
        // skip unwatchable dir
      }
    }
  };

  const recursiveWatcher = tryWatchRecursive();
  if (recursiveWatcher) {
    watchers.push(recursiveWatcher);
  } else {
    void watchPerDir();
  }

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // watcher already invalidated (e.g. during process teardown)
        }
      }
      watchers.length = 0;
      pending.clear();
    },
    isClosed: () => closed,
  };
}

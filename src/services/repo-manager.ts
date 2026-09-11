import * as path from "node:path";
import { promises as fs } from "node:fs";
import type { IndexResult } from "../services/indexer.js";
import { buildIndex } from "../services/indexer.js";
import { semanticSearch } from "../services/indexer.js";
import {
  getOnnxEmbedder,
  lexicalEmbedder,
  type Embedder,
} from "../services/embedder.js";
import {
  analyzeFileImpact,
  analyzeSymbolImpact,
} from "../services/impact.js";
import type { ImpactReport } from "../types.js";
import {
  loadIndex,
  saveIndex,
  resolveCacheDir,
} from "../services/persister.js";
import { updateIndex } from "../services/incremental.js";
import {
  createRepoWatcher,
  type RepoWatcher,
} from "../services/watcher.js";

const DEFAULT_MAX_FILES = 50_000;

export interface IndexOutcome {
  readonly index: IndexResult;
  readonly mode: "fresh" | "incremental" | "restored";
  readonly changedFiles: number;
  readonly addedFiles: number;
  readonly removedFiles: number;
}

export class RepoManager {
  private indexes = new Map<string, IndexResult>();
  private embedder: Embedder = lexicalEmbedder;
  private watchers = new Map<string, RepoWatcher>();
  private reindexInFlight = new Map<string, Promise<void>>();

  async resolveRoot(input: string): Promise<string> {
    const resolved = path.isAbsolute(input)
      ? input
      : path.resolve(process.cwd(), input);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(
        `Directory not found: ${resolved}. Pass the repository root directory.`,
      );
    }
    return resolved;
  }

  async ensureEmbedder(): Promise<Embedder> {
    const onnx = await getOnnxEmbedder();
    if (onnx) this.embedder = onnx;
    return this.embedder;
  }

  private startWatcher(root: string): void {
    if (this.watchers.has(root)) return;
    const watcher = createRepoWatcher({
      rootDir: root,
      onChange: () => {
        void this.reindexInBackground(root);
      },
    });
    this.watchers.set(root, watcher);
  }

  private async reindexInBackground(root: string): Promise<void> {
    const existing = this.reindexInFlight.get(root);
    if (existing) return existing;

    const task = (async () => {
      const current = this.indexes.get(root);
      if (!current) return;
      try {
        const embedder = await this.ensureEmbedder();
        const { index } = await updateIndex(current, {
          embedder,
          maxFiles: DEFAULT_MAX_FILES,
        });
        this.indexes.set(root, index);
        await saveIndex(index).catch(() => undefined);
      } catch {
        // Background refresh is best-effort; next explicit index() will fix.
      }
    })().finally(() => {
      this.reindexInFlight.delete(root);
    });

    this.reindexInFlight.set(root, task);
    void task;
  }

  async index(root: string, maxFiles: number): Promise<IndexOutcome> {
    const embedder = await this.ensureEmbedder();

    const persisted = await loadIndex(root);
    let index: IndexResult;
    let mode: IndexOutcome["mode"];
    let delta = { changed: 0, added: 0, removed: 0 };

    if (persisted.loaded) {
      const update = await updateIndex(persisted.index, {
        embedder,
        maxFiles,
      });
      index = update.index;
      mode = "incremental";
      delta = {
        changed: update.changedFiles.length,
        added: update.addedFiles.length,
        removed: update.removedFiles.length,
      };
    } else {
      index = await buildIndex({ rootDir: root, embedder, maxFiles });
      mode = "fresh";
    }

    this.indexes.set(root, index);
    await saveIndex(index).catch(() => undefined);
    this.startWatcher(root);

    return {
      index,
      mode,
      changedFiles: delta.changed,
      addedFiles: delta.added,
      removedFiles: delta.removed,
    };
  }

  async ensureIndex(root: string): Promise<IndexResult | undefined> {
    const inMemory = this.indexes.get(root);
    if (inMemory) {
      this.startWatcher(root);
      return inMemory;
    }
    const persisted = await loadIndex(root);
    if (persisted.loaded) {
      this.indexes.set(root, persisted.index);
      this.startWatcher(root);
      return persisted.index;
    }
    return undefined;
  }

  getIndex(root: string): IndexResult | undefined {
    return this.indexes.get(root);
  }

  async search(
    root: string,
    query: string,
    limit: number,
  ): Promise<ReturnType<typeof semanticSearch>> {
    const index = await this.ensureIndex(root);
    if (!index) {
      throw new Error(
        `No index for ${root}. Call localscope_index first, then search.`,
      );
    }
    return semanticSearch(index, this.embedder, query, limit);
  }

  async impact(root: string, target: string, maxDepth: number): Promise<ImpactReport> {
    const index = await this.ensureIndex(root);
    if (!index) {
      throw new Error(
        `No index for ${root}. Call localscope_index first, then analyze impact.`,
      );
    }

    const asPath = path.isAbsolute(target) ? target : path.resolve(root, target);
    const fileExists = index.files.some(
      (f) => f.filePath === asPath,
    );
    const relExists = index.files.some(
      (f) => f.filePath === path.join(root, target),
    );

    if (fileExists || relExists) {
      return analyzeFileImpact(index, relExists ? path.join(root, target) : asPath, {
        maxDepth,
      });
    }

    const symbolsMatching = index.symbols.filter((s) => s.name === target);
    if (symbolsMatching.length > 0) {
      return analyzeSymbolImpact(index, target, { maxDepth });
    }

    const fuzzy = index.symbols
      .filter((s) => s.name.toLowerCase().includes(target.toLowerCase()))
      .slice(0, 5)
      .map((s) => `${s.name} (${s.kind} in ${path.relative(root, s.filePath)})`);

    throw new Error(
      `Target '${target}' not found as a file or symbol in ${root}.` +
        (fuzzy.length > 0
          ? ` Did you mean one of: ${fuzzy.join(", ")}?`
          : " Call localscope_index first if the codebase changed."),
    );
  }

  async references(
    root: string,
    symbolName: string,
  ): Promise<
    {
      filePath: string;
      lines: readonly number[];
      count: number;
    }[]
  > {
    const index = await this.ensureIndex(root);
    if (!index) {
      throw new Error(
        `No index for ${root}. Call localscope_index first, then ask for references.`,
      );
    }
    const uses = new Map<string, number[]>();
    for (const ref of index.references) {
      if (ref.name !== symbolName) continue;
      const merged = [...(uses.get(ref.filePath) ?? []), ...(ref.lines ?? [])];
      merged.sort((a, b) => a - b);
      uses.set(ref.filePath, merged);
    }
    return [...uses.entries()]
      .map(([filePath, lines]) => ({ filePath, lines, count: lines.length }))
      .sort(
        (a, b) =>
          b.count - a.count || a.filePath.localeCompare(b.filePath),
      );
  }

  async definition(
    root: string,
    symbolName: string,
  ): Promise<
    {
      name: string;
      kind: string;
      filePath: string;
      line: number;
      endLine: number;
      exported: boolean;
    }[]
  > {
    const index = await this.ensureIndex(root);
    if (!index) {
      throw new Error(
        `No index for ${root}. Call localscope_index first, then ask for the definition.`,
      );
    }
    return index.symbols
      .filter((s) => s.name === symbolName)
      .map((s) => ({
        name: s.name,
        kind: s.kind,
        filePath: s.filePath,
        line: s.line,
        endLine: s.endLine,
        exported: s.exported,
      }));
  }

  async status(root: string): Promise<Record<string, unknown>> {
    const index = await this.ensureIndex(root);
    if (!index) {
      return {
        indexed: false,
        root,
        hint: "Call localscope_index to build a local index. Nothing leaves your machine.",
      };
    }
    const { cacheDir } = resolveCacheDir(root);
    return {
      indexed: true,
      root,
      files: index.files.length,
      chunks: index.chunks.length,
      symbols: index.symbols.length,
      references: index.references.length,
      extraction: index.astActive
        ? "tree-sitter AST (accurate symbols + references)"
        : "regex fallback (grammars unavailable)",
      embedder:
        index.embedder.type === "onnx"
          ? `onnx:${index.embedder.model} (semantic search active)`
          : `lexical (${index.embedder.note})`,
      indexedAt: new Date(index.indexedAt).toISOString(),
      watching: this.watchers.has(root),
      cacheDir,
    };
  }

  close(): void {
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        // best-effort teardown
      }
    }
    this.watchers.clear();
  }
}

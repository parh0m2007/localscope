import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as crypto from "node:crypto";
import * as path from "node:path";
import type { CodeChunk, FileEntry, FileNode, SourceSymbol } from "../types.js";
import type { IndexResult } from "./indexer.js";
import type { LexicalIndexEntry } from "./embedder.js";
import { buildLexicalTf } from "./embedder.js";

/**
 * Bump when the on-disk layout changes. Persisted caches with an older
 * schemaVersion are discarded and rebuilt from scratch.
 */
const SCHEMA_VERSION = 2;

interface SerializedIndex {
  schemaVersion: number;
  rootDir: string;
  files: FileEntry[];
  chunks: (Omit<CodeChunk, "embedding"> & { embedding: number[] | null })[];
  fileGraph: { path: string; imports: string[]; importedBy: string[] }[];
  symbols: SourceSymbol[];
  indexedAt: number;
  embedder: IndexResult["embedder"];
}

export interface CacheDirInfo {
  readonly cacheDir: string;
  readonly override: boolean;
}

export function resolveCacheDir(rootDir: string): CacheDirInfo {
  const override = process.env.LOCALSCOPE_CACHE_DIR;
  const digest = crypto
    .createHash("sha256")
    .update(rootDir)
    .digest("hex")
    .slice(0, 16);
  if (override && override.length > 0) {
    // The override is a base dir; per-root digests keep repos from colliding.
    return { cacheDir: path.join(override, digest), override: true };
  }
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return { cacheDir: path.join(base, "localscope", digest), override: false };
}

export function cacheFilePath(rootDir: string): string {
  return path.join(resolveCacheDir(rootDir).cacheDir, "index.json");
}

export type LoadResult =
  | { readonly loaded: true; readonly index: IndexResult }
  | {
      readonly loaded: false;
      readonly reason: "missing" | "corrupt" | "stale-schema" | "wrong-root";
    };

function rebuildLexicalIndex(chunks: readonly CodeChunk[]): LexicalIndexEntry[] {
  return chunks.map((c) => buildLexicalTf(c.id, c.content, c.symbolName));
}

export async function loadIndex(rootDir: string): Promise<LoadResult> {
  const file = cacheFilePath(rootDir);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return { loaded: false, reason: "missing" };
  }

  let parsed: SerializedIndex;
  try {
    parsed = JSON.parse(raw) as SerializedIndex;
  } catch {
    return { loaded: false, reason: "corrupt" };
  }

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    return { loaded: false, reason: "stale-schema" };
  }
  if (parsed.rootDir !== rootDir) {
    return { loaded: false, reason: "wrong-root" };
  }

  const fileGraph = new Map<string, FileNode>();
  for (const node of parsed.fileGraph) {
    fileGraph.set(node.path, {
      path: node.path,
      imports: node.imports,
      importedBy: node.importedBy,
    });
  }

  const index: IndexResult = {
    rootDir: parsed.rootDir,
    files: parsed.files,
    chunks: parsed.chunks,
    fileGraph,
    symbols: parsed.symbols,
    indexedAt: parsed.indexedAt,
    embedder: parsed.embedder,
    lexicalIndex: rebuildLexicalIndex(parsed.chunks),
  };
  return { loaded: true, index };
}

export async function saveIndex(index: IndexResult): Promise<void> {
  const { cacheDir } = resolveCacheDir(index.rootDir);
  const file = path.join(cacheDir, "index.json");

  const serialized: SerializedIndex = {
    schemaVersion: SCHEMA_VERSION,
    rootDir: index.rootDir,
    files: index.files.map((f) => ({ ...f })),
    chunks: index.chunks.map((c) => ({
      ...c,
      embedding: c.embedding ? [...c.embedding] : null,
    })),
    fileGraph: [...index.fileGraph.values()].map((n) => ({
      path: n.path,
      imports: [...n.imports],
      importedBy: [...n.importedBy],
    })),
    symbols: index.symbols.map((s) => ({ ...s })),
    indexedAt: index.indexedAt,
    embedder: index.embedder,
  };

  await fs.mkdir(cacheDir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(serialized), "utf8");
  await fs.rename(tmp, file);
}

export async function clearCache(rootDir: string): Promise<void> {
  await fs.rm(cacheFilePath(rootDir), { force: true });
}

export { SCHEMA_VERSION };

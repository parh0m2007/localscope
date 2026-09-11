import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as crypto from "node:crypto";
import * as path from "node:path";
import type { CodeChunk, FileEntry, FileNode, SourceSymbol, SymbolReference } from "../types.js";
import type { IndexResult } from "./indexer.js";
import type { LexicalIndexEntry } from "./embedder.js";
import { buildLexicalTf } from "./embedder.js";

/**
 * Bump when the on-disk layout changes. Persisted caches with an older
 * schemaVersion are discarded and rebuilt from scratch.
 */
const SCHEMA_VERSION = 4;

interface SerializedIndex {
  schemaVersion: number;
  rootDir: string;
  files: FileEntry[];
  chunks: Omit<CodeChunk, "embedding">[];
  fileGraph: { path: string; imports: string[]; importedBy: string[] }[];
  symbols: SourceSymbol[];
  references: SymbolReference[];
  indexedAt: number;
  astActive: boolean;
  embedder: IndexResult["embedder"];
  /**
   * Embeddings live in a sibling binary file (embeddings.b64), one base64
   * Float32 blob per chunk, offsets aligned with `chunks`. Keeping dense
   * vectors out of the JSON keeps the cache small and the stringify cheap
   * (JSON floats are ~20 bytes each; base64 f32 is ~5.3).
   */
  embeddingsFile: "embeddings.b64";
  embeddingDim: number;
}

export interface CacheDirInfo {
  readonly cacheDir: string;
  readonly override: boolean;
}

export function resolveCacheDir(rootDir: string): CacheDirInfo {
  const digest = digestOf(rootDir);
  const override = process.env.LOCALSCOPE_CACHE_DIR;
  if (override && override.length > 0) {
    // The override is a base dir; per-root digests keep repos from colliding.
    return { cacheDir: path.join(override, digest), override: true };
  }
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return { cacheDir: path.join(base, "localscope", digest), override: false };
}

function digestOf(rootDir: string): string {
  return crypto.createHash("sha256").update(rootDir).digest("hex").slice(0, 16);
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

function encodeEmbeddings(
  chunks: readonly CodeChunk[],
): { b64: string; dim: number } | null {
  let dim = 0;
  for (const c of chunks) {
    if (c.embedding && c.embedding.length > 0) {
      dim = c.embedding.length;
      break;
    }
  }
  if (dim === 0) return null;

  const buf = Buffer.allocUnsafe(chunks.length * dim * 4);
  chunks.forEach((c, i) => {
    const vec = c.embedding;
    if (vec && vec.length === dim) {
      for (let j = 0; j < dim; j++) {
        buf.writeFloatLE(vec[j], (i * dim + j) * 4);
      }
    } else {
      // Missing/short vector: zero-fill (cosine with zeros = 0, harmless).
      buf.fill(0, i * dim * 4, (i + 1) * dim * 4);
    }
  });
  return { b64: buf.toString("base64"), dim };
}

function decodeEmbeddings(
  b64: string,
  dim: number,
  count: number,
): (readonly number[] | null)[] {
  const buf = Buffer.from(b64, "base64");
  const out: (readonly number[] | null)[] = new Array(count).fill(null);
  const expected = count * dim * 4;
  if (buf.length < expected) return out; // corrupt tail: leave nulls
  for (let i = 0; i < count; i++) {
    const vec = new Array<number>(dim);
    let nonzero = false;
    for (let j = 0; j < dim; j++) {
      vec[j] = buf.readFloatLE((i * dim + j) * 4);
      if (vec[j] !== 0) nonzero = true;
    }
    out[i] = nonzero ? vec : null;
  }
  return out;
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

  // Dense vectors (if any) load from the sibling binary file.
  let embeddings: (readonly number[] | null)[] | null = null;
  if (parsed.embeddingDim > 0) {
    try {
      const b64 = await fs.readFile(
        path.join(path.dirname(file), "embeddings.b64"),
        "utf8",
      );
      embeddings = decodeEmbeddings(b64, parsed.embeddingDim, parsed.chunks.length);
    } catch {
      embeddings = null; // missing file: search falls back to lexical
    }
  }

  const chunks: CodeChunk[] = parsed.chunks.map((c, i) => ({
    ...c,
    embedding: embeddings ? embeddings[i] ?? null : null,
  }));

  const index: IndexResult = {
    rootDir: parsed.rootDir,
    files: parsed.files,
    chunks,
    fileGraph,
    symbols: parsed.symbols,
    references: parsed.references ?? [],
    astActive: parsed.astActive ?? false,
    indexedAt: parsed.indexedAt,
    embedder: parsed.embedder,
    lexicalIndex: rebuildLexicalIndex(chunks),
  };
  return { loaded: true, index };
}

export async function saveIndex(index: IndexResult): Promise<void> {
  const { cacheDir } = resolveCacheDir(index.rootDir);
  const file = path.join(cacheDir, "index.json");

  const encoded = encodeEmbeddings(index.chunks);
  const serialized: SerializedIndex = {
    schemaVersion: SCHEMA_VERSION,
    rootDir: index.rootDir,
    files: index.files.map((f) => ({ ...f })),
    chunks: index.chunks.map((c) => ({
      id: c.id,
      filePath: c.filePath,
      language: c.language,
      kind: c.kind,
      symbolName: c.symbolName,
      symbolKind: c.symbolKind,
      startLine: c.startLine,
      endLine: c.endLine,
      content: c.content,
    })),
    fileGraph: [...index.fileGraph.values()].map((n) => ({
      path: n.path,
      imports: [...n.imports],
      importedBy: [...n.importedBy],
    })),
    symbols: index.symbols.map((s) => ({ ...s })),
    references: index.references.map((r) => ({ ...r })),
    indexedAt: index.indexedAt,
    astActive: index.astActive,
    embedder: index.embedder,
    embeddingsFile: "embeddings.b64",
    embeddingDim: encoded?.dim ?? 0,
  };

  await fs.mkdir(cacheDir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(serialized), "utf8");
  await fs.rename(tmp, file);

  if (encoded) {
    const embFile = path.join(cacheDir, "embeddings.b64");
    const embTmp = `${embFile}.tmp-${process.pid}`;
    await fs.writeFile(embTmp, encoded.b64, "utf8");
    await fs.rename(embTmp, embFile);
  }
}

export async function clearCache(rootDir: string): Promise<void> {
  await fs.rm(cacheFilePath(rootDir), { force: true });
  await fs.rm(
    path.join(path.dirname(cacheFilePath(rootDir)), "embeddings.b64"),
    { force: true },
  );
}

export { SCHEMA_VERSION };

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { IGNORED_FILE_PATTERNS } from "../constants.js";
import { walkRepository, clearGitignoreCache } from "./walker.js";
import { extractFromFile } from "./extractor.js";
import {
  buildLexicalTf,
  type Embedder,
} from "./embedder.js";
import type {
  CodeChunk,
  FileEntry,
  SourceSymbol,
} from "../types.js";
import type { IndexResult } from "./indexer.js";

export interface IncrementalUpdate {
  readonly index: IndexResult;
  readonly changedFiles: string[];
  readonly removedFiles: string[];
  readonly addedFiles: string[];
}

function isIgnored(relPath: string): boolean {
  const base = path.basename(relPath);
  for (const re of IGNORED_FILE_PATTERNS) {
    if (re.test(base)) return true;
  }
  return false;
}

export async function updateIndex(
  previous: IndexResult,
  options: {
    embedder: Embedder;
    maxFiles?: number;
  },
): Promise<IncrementalUpdate> {
  const rootDir = previous.rootDir;
  clearGitignoreCache();
  const { files } = await walkRepository({
    rootDir,
    maxFiles: options.maxFiles,
  });

  const oldByPath = new Map(previous.files.map((f) => [f.filePath, f]));
  const newByPath = new Map(files.map((f) => [f.filePath, f]));
  const allFiles = new Set(files.map((f) => f.filePath));
  const fileMapByRel = new Map<string, string>();
  for (const f of files) {
    fileMapByRel.set(path.relative(rootDir, f.filePath), f.filePath);
  }

  const added: string[] = [];
  const changed: string[] = [];
  for (const [filePath, walked] of newByPath) {
    const old = oldByPath.get(filePath);
    if (!old) {
      added.push(filePath);
      continue;
    }
    if (
      old.mtimeMs !== walked.mtimeMs ||
      old.sizeBytes !== walked.sizeBytes
    ) {
      changed.push(filePath);
    }
  }
  const removed = [...oldByPath.keys()].filter(
    (p) => !newByPath.has(p),
  );

  // Any file whose imports may have changed still needs re-extraction of its
  // *edges*. Cheaper approach: re-extract imports for every surviving source
  // file is expensive; instead we only re-extract changed/added files, then
  // rebuild the graph edges from stored imports plus new extractions.
  // Stored per-file imports are kept in the graph node itself.
  const touched = new Set([...added, ...changed]);

  // Files removed from disk drop out of the walk; files no longer in
  // allFiles also can't be import targets. Re-resolve imports for touched
  // files only, and keep previous edges for untouched files.
  const importsByFile = new Map<string, string[]>();
  for (const [nodePath, node] of previous.fileGraph) {
    if (removed.includes(nodePath) || !allFiles.has(nodePath)) continue;
    importsByFile.set(nodePath, [...node.imports].filter((t) => allFiles.has(t)));
  }

  // Symbols/chunks for untouched files are reused as-is.
  const symbols: SourceSymbol[] = previous.symbols.filter(
    (s) => !touched.has(s.filePath) && allFiles.has(s.filePath),
  );
  const chunks: CodeChunk[] = previous.chunks.filter(
    (c) => !touched.has(c.filePath) && allFiles.has(c.filePath),
  );

  // Extract touched files. Import resolution needs the language from walk.
  const {
    extractImportsForFile,
    buildFileGraph,
  } = await import("./indexer-internals.js");
  const embedder = options.embedder;

  const newChunkIds = new Set(chunks.map((c) => c.id));
  const embedded: CodeChunk[] = [];
  for (const filePath of touched) {
    const walked = newByPath.get(filePath);
    if (!walked) continue;
    if (isIgnored(path.relative(rootDir, filePath))) continue;

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    if (content.length === 0) continue;

    const extraction = extractFromFile(content, filePath, walked.language);
    symbols.push(...extraction.symbols);
    for (const chunk of extraction.chunks) {
      if (newChunkIds.has(chunk.id)) continue; // dedupe safety
      embedded.push(chunk);
    }
    importsByFile.set(
      filePath,
      await extractImportsForFile(content, walked.language, filePath, allFiles, fileMapByRel),
    );
  }

  let embeddedChunks = embedded;
  if (embedder.kind.type === "onnx" && embedded.length > 0) {
    const texts = embedded.map((c) => `${c.symbolName ?? ""}\n${c.content}`);
    const vectors = await embedder.embed(texts);
    embeddedChunks = embedded.map((c, i) => ({
      ...c,
      embedding: vectors[i] ?? null,
    }));
  }

  const allChunks = [...chunks, ...embeddedChunks];
  const fileGraph = buildFileGraph(importsByFile);
  const chunkCountByFile = new Map<string, number>();
  for (const c of allChunks) {
    chunkCountByFile.set(c.filePath, (chunkCountByFile.get(c.filePath) ?? 0) + 1);
  }

  const fileEntries: FileEntry[] = files.map((f) => ({
    filePath: f.filePath,
    language: f.language,
    mtimeMs: f.mtimeMs,
    sizeBytes: f.sizeBytes,
    chunkCount: chunkCountByFile.get(f.filePath) ?? 0,
  }));

  const lexicalIndex = allChunks.map((c) =>
    buildLexicalTf(c.id, c.content, c.symbolName),
  );

  const index: IndexResult = {
    rootDir,
    files: fileEntries,
    chunks: allChunks,
    fileGraph,
    symbols,
    indexedAt: Date.now(),
    embedder: embedder.kind,
    lexicalIndex,
  };

  return {
    index,
    changedFiles: changed,
    removedFiles: removed,
    addedFiles: added,
  };
}

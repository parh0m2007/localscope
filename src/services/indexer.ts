import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  CodeChunk,
  RepoIndex,
  SourceSymbol,
  SymbolKind,
} from "../types.js";
import { extractFromFile } from "./extractor.js";
import {
  buildLexicalTf,
  cosineSimilarity,
  lexicalEmbedder,
  lexicalScore,
  tokenize,
  type Embedder,
  type LexicalIndexEntry,
} from "./embedder.js";
import { walkRepository } from "./walker.js";
import { extractImports, buildFileGraph } from "./indexer-internals.js";

export { buildFileGraph };

export interface IndexResult extends RepoIndex {
  readonly lexicalIndex: readonly LexicalIndexEntry[];
}

export interface IndexOptions {
  readonly rootDir: string;
  readonly embedder?: Embedder;
  readonly maxFiles?: number;
}

export async function buildIndex(options: IndexOptions): Promise<IndexResult> {
  const rootDir = path.resolve(options.rootDir);
  const { files } = await walkRepository({ rootDir, maxFiles: options.maxFiles });

  const embedder = options.embedder ?? lexicalEmbedder;
  const allFiles = new Set(files.map((f) => f.filePath));
  const fileMapByRel = new Map<string, string>();
  for (const f of files) {
    fileMapByRel.set(path.relative(rootDir, f.filePath), f.filePath);
  }

  const chunks: CodeChunk[] = [];
  const symbols: SourceSymbol[] = [];
  const importsByFile = new Map<string, string[]>();

  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file.filePath, "utf8");
    } catch {
      continue;
    }
    if (content.length === 0) continue;

    const extraction = extractFromFile(content, file.filePath, file.language);
    symbols.push(...extraction.symbols);
    chunks.push(...extraction.chunks);
    importsByFile.set(
      file.filePath,
      extractImports(
        content,
        file.language,
        file.filePath,
        allFiles,
        fileMapByRel,
      ),
    );
  }

  const fileGraph = buildFileGraph(importsByFile);

  let embeddedChunks = chunks;
  if (embedder.kind.type === "onnx" && chunks.length > 0) {
    const texts = chunks.map((c) => `${c.symbolName ?? ""}\n${c.content}`);
    const vectors = await embedder.embed(texts);
    embeddedChunks = chunks.map((c, i) => ({
      ...c,
      embedding: vectors[i] ?? null,
    }));
  }

  const lexicalIndex = embeddedChunks.map((c) =>
    buildLexicalTf(c.id, c.content, c.symbolName),
  );

  return {
    rootDir,
    files: files.map((f) => ({
      filePath: f.filePath,
      language: f.language,
      mtimeMs: f.mtimeMs,
      sizeBytes: f.sizeBytes,
      chunkCount: embeddedChunks.filter((c) => c.filePath === f.filePath).length,
    })),
    chunks: embeddedChunks,
    fileGraph,
    symbols,
    indexedAt: Date.now(),
    embedder: embedder.kind,
    lexicalIndex,
  };
}

export interface SearchHitInternal {
  readonly chunkId: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly symbolName: string | null;
  readonly symbolKind: SymbolKind | null;
  readonly score: number;
  readonly snippet: string;
  readonly matchedBy: "semantic" | "lexical" | "symbol";
}

export function searchIndex(
  index: IndexResult,
  query: string,
  limit: number,
): { readonly hits: SearchHitInternal[] } {
  const queryTokens = tokenize(query);
  const scored: SearchHitInternal[] = [];

  for (let i = 0; i < index.chunks.length; i++) {
    const chunk = index.chunks[i];
    const lexicalEntry = index.lexicalIndex[i];
    if (!lexicalEntry) continue;

    let score = lexicalScore(queryTokens, lexicalEntry);
    let matchedBy: "semantic" | "lexical" | "symbol" = "lexical";

    if (
      chunk.symbolName &&
      queryTokens.some(
        (t) =>
          chunk.symbolName?.toLowerCase().includes(t) ||
          chunk.symbolName === query,
      )
    ) {
      score += 2;
      matchedBy = "symbol";
    }

    scored.push({
      chunkId: chunk.id,
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      symbolName: chunk.symbolName,
      symbolKind: chunk.symbolKind,
      score,
      snippet: firstLines(chunk.content, 6),
      matchedBy,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).filter((s) => s.score > 0);
  return { hits: top };
}

export async function semanticSearch(
  index: IndexResult,
  embedder: Embedder,
  query: string,
  limit: number,
): Promise<SearchHitInternal[]> {
  if (embedder.kind.type !== "onnx") {
    return searchIndex(index, query, limit).hits;
  }
  const queryVec = await embedder.query(query);
  const queryTokens = tokenize(query);

  const hits = index.chunks
    .map((chunk, i) => {
      const lexEntry = index.lexicalIndex[i];
      const lexScore = lexEntry ? lexicalScore(queryTokens, lexEntry) : 0;
      const semScore = chunk.embedding
        ? cosineSimilarity(queryVec, chunk.embedding)
        : 0;
      let score = 0.7 * semScore + 0.3 * lexScore;
      let matchedBy: "semantic" | "lexical" | "symbol" = semScore >= lexScore
        ? "semantic"
        : "lexical";

      if (
        chunk.symbolName &&
        queryTokens.some((t) => chunk.symbolName?.toLowerCase().includes(t))
      ) {
        score += 2;
        matchedBy = "symbol";
      }

      return {
        chunkId: chunk.id,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbolName: chunk.symbolName,
        symbolKind: chunk.symbolKind,
        score,
        snippet: firstLines(chunk.content, 6),
        matchedBy,
      };
    })
    .filter((h) => h.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return hits;
}

function firstLines(content: string, count: number): string {
  return content
    .split("\n")
    .slice(0, count)
    .join("\n")
    .slice(0, 800);
}

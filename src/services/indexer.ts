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
import { astExtractFromFile } from "./ast.js";
import type { SymbolReference } from "../types.js";

export { buildFileGraph };

export interface IndexResult extends RepoIndex {
  readonly lexicalIndex: readonly LexicalIndexEntry[];
  readonly references: readonly SymbolReference[];
  readonly astActive: boolean;
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
  const references: SymbolReference[] = [];
  let usedAst = false;

  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file.filePath, "utf8");
    } catch {
      continue;
    }
    if (content.length === 0) continue;

    // AST extraction first (accurate symbols + identifier uses); regex
    // extractor as zero-config fallback.
    const ast = await astExtractFromFile(file.filePath, file.language);
    if (ast) {
      usedAst = true;
      symbols.push(...ast.symbols);
      for (const [name, count] of ast.identifierUses) {
        references.push({
          name,
          filePath: file.filePath,
          line: 0,
          kind: "usage",
          count,
        });
      }
      chunks.push(...astChunks(ast.symbols, content, file.filePath, file.language));
    } else {
      const extraction = extractFromFile(content, file.filePath, file.language);
      symbols.push(...extraction.symbols);
      chunks.push(...extraction.chunks);
    }

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
    references,
    astActive: usedAst,
    indexedAt: Date.now(),
    embedder: embedder.kind,
    lexicalIndex,
  };
}

export function astChunks(
  symbols: readonly SourceSymbol[],
  content: string,
  filePath: string,
  language: CodeChunk["language"],
): CodeChunk[] {
  if (symbols.length === 0) {
    return blockChunks(content, filePath, language);
  }
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];
  for (const symbol of symbols) {
    const start = symbol.line - 1;
    const end = Math.min(symbol.endLine, lines.length);
    const body = lines.slice(start, end).join("\n");
    if (body.trim().length === 0) continue;
    chunks.push({
      id: `${filePath}#${symbol.name}@${symbol.line}`,
      filePath,
      language,
      kind: "symbol",
      symbolName: symbol.name,
      symbolKind: symbol.kind,
      startLine: symbol.line,
      endLine: end,
      content: body,
      embedding: null,
    });
  }
  return chunks;
}

function blockChunks(
  content: string,
  filePath: string,
  language: CodeChunk["language"],
): CodeChunk[] {
  const lines = content.split("\n");
  const size = 60;
  const chunks: CodeChunk[] = [];
  for (let start = 0; start < lines.length; start += size) {
    const end = Math.min(start + size, lines.length);
    const body = lines.slice(start, end).join("\n");
    if (body.trim().length === 0) continue;
    chunks.push({
      id: `${filePath}#block@${start + 1}`,
      filePath,
      language,
      kind: "block",
      symbolName: null,
      symbolKind: null,
      startLine: start + 1,
      endLine: end,
      content: body,
      embedding: null,
    });
  }
  return chunks;
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

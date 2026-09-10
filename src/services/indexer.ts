import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  CodeChunk,
  FileNode,
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

const IMPORT_RESOLVERS: Readonly<Record<string, RegExp>> = {
  typescript: /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  javascript: /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  python: /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g,
  go: /"([\w./-]+)"/g,
  rust: /\buse\s+([\w:]+)/g,
};

function resolveRelativeImport(
  fromFile: string,
  importPath: string,
  allFiles: ReadonlySet<string>,
): string | null {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return null;
  const base = path.resolve(path.dirname(fromFile), importPath);

  const tsSwap = (candidate: string): string[] => {
    if (candidate.endsWith(".js")) {
      const stem = candidate.slice(0, -3);
      return [`${stem}.ts`, `${stem}.tsx`, candidate];
    }
    if (candidate.endsWith(".jsx")) {
      const stem = candidate.slice(0, -4);
      return [`${stem}.tsx`, candidate];
    }
    return [candidate];
  };

  const bases = tsSwap(base);
  const candidates: string[] = [];
  for (const b of bases) {
    candidates.push(
      b,
      `${b}.ts`,
      `${b}.tsx`,
      `${b}.js`,
      `${b}.jsx`,
      `${b}.mjs`,
      `${b}/index.ts`,
      `${b}/index.tsx`,
      `${b}/index.js`,
      `${b}/index.jsx`,
      `${b}.py`,
      `${b}/__init__.py`,
    );
  }
  for (const candidate of candidates) {
    if (allFiles.has(candidate)) return candidate;
  }
  return null;
}

function resolvePythonImport(
  importPath: string,
  fileMapByRel: ReadonlyMap<string, string>,
): string | null {
  const parts = importPath.split(".");
  for (let i = parts.length; i > 0; i--) {
    const rel = parts.slice(0, i).join("/");
    const direct = fileMapByRel.get(`${rel}.py`);
    if (direct) return direct;
    const init = fileMapByRel.get(`${rel}/__init__.py`);
    if (init) return init;
  }
  return null;
}

function extractImports(
  content: string,
  language: string,
  fromFile: string,
  allFiles: ReadonlySet<string>,
  fileMapByRel: ReadonlyMap<string, string>,
): string[] {
  const re = IMPORT_RESOLVERS[language];
  if (!re) return [];
  const imports = new Set<string>();
  const globalRe = new RegExp(re.source, "g");
  let match: RegExpExecArray | null;
  while ((match = globalRe.exec(content)) !== null) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    if (language === "typescript" || language === "javascript") {
      const resolved = resolveRelativeImport(fromFile, raw, allFiles);
      if (resolved) imports.add(resolved);
    } else if (language === "python") {
      const resolved = resolvePythonImport(raw, fileMapByRel);
      if (resolved) imports.add(resolved);
    }
  }
  return [...imports];
}

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

function buildFileGraph(
  importsByFile: ReadonlyMap<string, readonly string[]>,
): Map<string, FileNode> {
  const graph = new Map<string, FileNode>();
  for (const [filePath] of importsByFile) {
    graph.set(filePath, { path: filePath, imports: [], importedBy: [] });
  }
  for (const [filePath, imports] of importsByFile) {
    for (const target of imports) {
      if (target === filePath) continue;
      if (!graph.has(target)) {
        graph.set(target, { path: target, imports: [], importedBy: [] });
      }
      const fromNode = graph.get(filePath);
      const toNode = graph.get(target);
      if (!fromNode || !toNode) continue;
      if (!fromNode.imports.includes(target)) {
        graph.set(filePath, {
          ...fromNode,
          imports: [...fromNode.imports, target],
        });
      }
      if (!toNode.importedBy.includes(filePath)) {
        graph.set(target, {
          ...toNode,
          importedBy: [...toNode.importedBy, filePath],
        });
      }
    }
  }
  return graph;
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

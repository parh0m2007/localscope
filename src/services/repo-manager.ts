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

export class RepoManager {
  private indexes = new Map<string, IndexResult>();
  private embedder: Embedder = lexicalEmbedder;

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

  async index(root: string, maxFiles: number): Promise<IndexResult> {
    const embedder = await this.ensureEmbedder();
    const index = await buildIndex({ rootDir: root, embedder, maxFiles });
    this.indexes.set(root, index);
    return index;
  }

  getIndex(root: string): IndexResult | undefined {
    return this.indexes.get(root);
  }

  async search(
    root: string,
    query: string,
    limit: number,
  ): Promise<IndexResult["chunks"] extends readonly unknown[] ? ReturnType<typeof semanticSearch> : never> {
    const index = this.indexes.get(root);
    if (!index) {
      throw new Error(
        `No index for ${root}. Call localscope_index first, then search.`,
      );
    }
    return semanticSearch(index, this.embedder, query, limit);
  }

  impact(root: string, target: string, maxDepth: number): ImpactReport {
    const index = this.indexes.get(root);
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

  status(root: string): Record<string, unknown> {
    const index = this.indexes.get(root);
    if (!index) {
      return {
        indexed: false,
        root,
        hint: "Call localscope_index to build a local index. Nothing leaves your machine.",
      };
    }
    return {
      indexed: true,
      root,
      files: index.files.length,
      chunks: index.chunks.length,
      symbols: index.symbols.length,
      embedder:
        index.embedder.type === "onnx"
          ? `onnx:${index.embedder.model} (semantic search active)`
          : `lexical (${index.embedder.note})`,
      indexedAt: new Date(index.indexedAt).toISOString(),
    };
  }
}

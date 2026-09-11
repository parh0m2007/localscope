import * as path from "node:path";
import type { ImpactReport, SourceSymbol } from "../types.js";
import type { IndexResult } from "../services/indexer.js";
import { analyzeFileImpact, analyzeSymbolImpact } from "../services/impact.js";

export interface ExploreCandidate {
  readonly name: string;
  readonly detail: string;
  readonly kind: "symbol" | "file";
  readonly impact: () => ImpactReport;
}

export function buildCandidates(
  index: IndexResult,
  rootDir: string,
): ExploreCandidate[] {
  const symbols = new Map<string, SourceSymbol>();
  for (const symbol of index.symbols) {
    if (symbol.exported && !symbols.has(symbol.name)) {
      symbols.set(symbol.name, symbol);
    }
  }

  const candidates: ExploreCandidate[] = [];

  for (const [name, symbol] of symbols) {
    candidates.push({
      name,
      detail: `${symbol.kind} · ${path.relative(rootDir, symbol.filePath)}:${symbol.line}`,
      kind: "symbol",
      impact: () => analyzeSymbolImpact(index, name, { maxDepth: 5 }),
    });
  }

  for (const file of index.files) {
    const rel = path.relative(rootDir, file.filePath);
    if (rel.startsWith("..")) continue;
    candidates.push({
      name: rel,
      detail: `${file.language} · ${file.chunkCount} chunks`,
      kind: "file",
      impact: () => analyzeFileImpact(index, file.filePath, { maxDepth: 5 }),
    });
  }

  // Recently indexed symbols first — exported ones are what people rename.
  candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "symbol" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return candidates;
}

export function filterCandidates(
  candidates: readonly ExploreCandidate[],
  query: string,
  limit: number,
): ExploreCandidate[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return candidates.slice(0, limit);

  const scored: { candidate: ExploreCandidate; score: number }[] = [];
  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    let score = 0;

    const exact = name === q;
    const startsWith = name.startsWith(q);
    const includes = name.includes(q);
    const detailMatch = candidate.detail.toLowerCase().includes(q);

    if (exact) score = 100;
    else if (startsWith) score = 60;
    else if (includes) score = 30;
    else if (detailMatch) score = 10;
    else {
      // Subsequence match, fzf-style: chars of the query in order.
      let qi = 0;
      for (const ch of name) {
        if (qi < q.length && ch === q[qi]) qi++;
      }
      if (qi === q.length) score = 5;
      else continue;
    }

    scored.push({ candidate, score });
  }

  scored.sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
  return scored.slice(0, limit).map((s) => s.candidate);
}

/** Chars of the candidate name that make up the query subsequence. */
export function matchPositions(
  name: string,
  query: string,
): Set<number> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return new Set();
  const positions = new Set<number>();
  let qi = 0;
  const lower = name.toLowerCase();
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      positions.add(i);
      qi++;
    }
  }
  return positions;
}

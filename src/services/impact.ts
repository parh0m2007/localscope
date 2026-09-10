import * as path from "node:path";
import type {
  GraphLike,
  ImpactOptions,
  IndexResultLike,
} from "./impact-types.js";
import type { ImpactReport, SymbolBreakage } from "../types.js";

export type { IndexResultLike };

export function analyzeFileImpact(
  index: GraphLike,
  targetPath: string,
  options: ImpactOptions = {},
): ImpactReport {
  const maxDepth = options.maxDepth ?? 5;
  const direct = index.fileGraph.get(targetPath)?.importedBy ?? [];

  const transitive = new Set<string>();
  const visited = new Set<string>([targetPath]);
  let frontier = [...direct];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const next: string[] = [];
    for (const file of frontier) {
      if (visited.has(file)) continue;
      visited.add(file);
      transitive.add(file);
      const deps = index.fileGraph.get(file)?.importedBy ?? [];
      next.push(...deps);
    }
    frontier = next;
    depth++;
  }

  for (const d of direct) transitive.delete(d);

  return {
    target: targetPath,
    targetKind: "file",
    directDependents: [...direct].sort(),
    transitiveDependents: [...transitive].sort(),
    symbolBreakages: findSymbolBreakages(index, targetPath),
    maxDepth,
    totalFilesAffected: direct.length + transitive.size,
  };
}

function findSymbolBreakages(
  index: GraphLike,
  targetPath: string,
): SymbolBreakage[] {
  const exported = index.symbols.filter(
    (s) => s.filePath === targetPath && s.exported,
  );
  const breakages: SymbolBreakage[] = [];

  const dependents = index.fileGraph.get(targetPath)?.importedBy ?? [];
  for (const symbol of exported) {
    for (const dep of dependents) {
      breakages.push({
        symbol: symbol.name,
        kind: symbol.kind as SymbolBreakage["kind"],
        filePath: dep,
        line: 0,
        reason: `imports ${symbol.name} (exported ${symbol.kind})`,
      });
    }
  }
  return breakages;
}

export function analyzeSymbolImpact(
  index: GraphLike,
  symbolName: string,
  options: ImpactOptions = {},
): ImpactReport {
  const maxDepth = options.maxDepth ?? 5;
  const definitions = index.symbols.filter((s) => s.name === symbolName);

  if (definitions.length === 0) {
    const fuzzy = index.symbols
      .filter((s) =>
        s.name.toLowerCase().includes(symbolName.toLowerCase().slice(0, 4)),
      )
      .slice(0, 5)
      .map((s) => `${s.name} (${s.kind})`);
    throw new Error(
      `Symbol '${symbolName}' not found in the index.` +
        (fuzzy.length > 0
          ? ` Did you mean: ${fuzzy.join(", ")}?`
          : " Re-index if the codebase changed."),
    );
  }

  const breakages: SymbolBreakage[] = [];
  const affectedFiles = new Set<string>();

  for (const def of definitions) {
    affectedFiles.add(def.filePath);
    breakages.push({
      symbol: def.name,
      kind: def.kind as SymbolBreakage["kind"],
      filePath: def.filePath,
      line: def.line,
      reason: `defined here (${def.kind}${def.exported ? ", exported" : ""})`,
    });

    const fileReport = analyzeFileImpact(index, def.filePath, { maxDepth });
    for (const dep of fileReport.directDependents) {
      affectedFiles.add(dep);
      breakages.push({
        symbol: def.name,
        kind: def.kind as SymbolBreakage["kind"],
        filePath: dep,
        line: 0,
        reason: `file imports from ${path.basename(def.filePath)}; renaming ${def.name} breaks this file`,
      });
    }
  }

  const direct = [...affectedFiles].filter(
    (f) => !definitions.some((d) => d.filePath === f),
  );

  return {
    target: symbolName,
    targetKind: "symbol",
    directDependents: direct.sort(),
    transitiveDependents: [],
    symbolBreakages: breakages,
    maxDepth,
    totalFilesAffected: direct.length,
  };
}

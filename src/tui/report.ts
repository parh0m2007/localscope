import * as path from "node:path";
import type { ImpactReport } from "../types.js";

export function plainImpactReport(
  report: ImpactReport,
  rootDir: string,
): string[] {
  const rel = (p: string): string => path.relative(rootDir, p);
  const lines: string[] = [];

  const target =
    report.targetKind === "file" ? rel(report.target) : report.target;
  lines.push(`Impact of changing ${target}`);
  lines.push(
    `Files affected: ${report.totalFilesAffected} (direct: ${report.directDependents.length}, transitive: ${report.transitiveDependents.length})`,
  );
  lines.push("");

  if (report.directDependents.length > 0) {
    lines.push("Breaks first:");
    for (const f of report.directDependents) lines.push(`  ${rel(f)}`);
  } else {
    lines.push("Nothing references this target. Safe to change.");
  }

  if (report.transitiveDependents.length > 0) {
    lines.push("");
    lines.push("May break indirectly:");
    for (const f of report.transitiveDependents) lines.push(`  ${rel(f)}`);
  }

  if (report.symbolBreakages.length > 0) {
    lines.push("");
    lines.push("Symbols at risk:");
    for (const b of report.symbolBreakages) {
      const where = `${rel(b.filePath)}${b.line ? `:${b.line}` : ""}`;
      lines.push(`  ${b.symbol} (${b.kind ?? "?"}) — ${where} — ${b.reason}`);
    }
  }

  return lines;
}

export function plainIndexSummary(summary: {
  files: number;
  symbols: number;
  references: number;
  astActive: boolean;
  durationMs: number;
}): string[] {
  return [
    `Indexed ${summary.files} files`,
    `${summary.symbols} symbols · ${summary.references} references`,
    `Extraction: ${summary.astActive ? "tree-sitter AST" : "regex fallback"}`,
    `Took ${summary.durationMs}ms`,
  ];
}

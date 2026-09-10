import type { FileNode, SourceSymbol, SymbolKind } from "../types.js";

export interface SymbolBreakage {
  readonly symbol: string;
  readonly kind: SymbolKind | null;
  readonly filePath: string;
  readonly line: number;
  readonly reason: string;
}

export interface ImpactReport {
  readonly target: string;
  readonly targetKind: "file" | "symbol";
  readonly directDependents: readonly string[];
  readonly transitiveDependents: readonly string[];
  readonly symbolBreakages: readonly SymbolBreakage[];
  readonly maxDepth: number;
  readonly totalFilesAffected: number;
}

export interface IndexResultLike {
  readonly rootDir: string;
  readonly fileGraph: ReadonlyMap<string, FileNode>;
  readonly symbols: readonly SourceSymbol[];
}

export interface ImpactOptions {
  readonly maxDepth?: number;
}

export interface GraphLike {
  readonly fileGraph: ReadonlyMap<
    string,
    { readonly importedBy: readonly string[] }
  >;
  readonly symbols: readonly {
    readonly name: string;
    readonly kind: string | null;
    readonly filePath: string;
    readonly line: number;
    readonly exported: boolean;
  }[];
}

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "ruby"
  | "php"
  | "c"
  | "cpp"
  | "csharp"
  | "shell"
  | "markdown"
  | "json"
  | "yaml"
  | "html"
  | "css"
  | "other";

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "method"
  | "constant"
  | "variable"
  | "struct"
  | "trait"
  | "enum"
  | "component";

export interface SourceSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly filePath: string;
  readonly line: number;
  readonly endLine: number;
  readonly exported: boolean;
}

export interface SymbolReference {
  readonly name: string;
  readonly filePath: string;
  readonly line: number;
  readonly kind: "import" | "usage" | "definition";
}

export interface FileEntry {
  readonly filePath: string;
  readonly language: Language;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly chunkCount: number;
}

export type ChunkKind = "symbol" | "prose" | "block";

export interface CodeChunk {
  readonly id: string;
  readonly filePath: string;
  readonly language: Language;
  readonly kind: ChunkKind;
  readonly symbolName: string | null;
  readonly symbolKind: SymbolKind | null;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly embedding: readonly number[] | null;
}

export interface FileNode {
  readonly path: string;
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
}

export interface SymbolNode {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly definedIn: string;
  readonly referencedBy: readonly string[];
}

export interface RepoIndex {
  readonly rootDir: string;
  readonly files: readonly FileEntry[];
  readonly chunks: readonly CodeChunk[];
  readonly fileGraph: ReadonlyMap<string, FileNode>;
  readonly symbols: readonly SourceSymbol[];
  readonly indexedAt: number;
  readonly embedder: EmbedderKind;
}

export type EmbedderKind =
  | { readonly type: "onnx"; readonly model: string }
  | { readonly type: "lexical"; readonly note: string };

export interface SearchHit {
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

export interface ImpactReport {
  readonly target: string;
  readonly targetKind: "file" | "symbol";
  readonly directDependents: readonly string[];
  readonly transitiveDependents: readonly string[];
  readonly symbolBreakages: readonly SymbolBreakage[];
  readonly maxDepth: number;
  readonly totalFilesAffected: number;
}

export interface SymbolBreakage {
  readonly symbol: string;
  readonly kind: SymbolKind | null;
  readonly filePath: string;
  readonly line: number;
  readonly reason: string;
}

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = { readonly ok: false; readonly error: string };
export type Result<T> = Ok<T> | Err;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = (error: string): Err => ({ ok: false, error });

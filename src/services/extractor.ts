import { DEFAULT_CHUNK_LINES } from "../constants.js";
import type {
  CodeChunk,
  Language,
  SourceSymbol,
  SymbolKind,
} from "../types.js";
import { isSourceFile } from "./language.js";

interface SymbolPattern {
  readonly kind: SymbolKind;
  readonly re: RegExp;
}

const TS_PATTERNS: readonly SymbolPattern[] = [
  {
    kind: "interface",
    re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "type",
    re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/,
  },
  {
    kind: "class",
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "enum",
    re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "function",
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "constant",
    re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>/,
  },
  {
    kind: "constant",
    re: /^\s*(?:export\s+)?const\s+([A-Z_$][A-Z0-9_$]*)\s*=/,
  },
  {
    kind: "method",
    re: /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*(?:async\s+|get\s+|set\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
  },
];

const PY_PATTERNS: readonly SymbolPattern[] = [
  { kind: "class", re: /^\s*class\s+([A-Za-z_][\w]*)/ },
  { kind: "function", re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/ },
  { kind: "constant", re: /^([A-Z_][A-Z0-9_]*)\s*=/ },
];

const GO_PATTERNS: readonly SymbolPattern[] = [
  { kind: "function", re: /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)\s*\(/ },
  { kind: "type", re: /^type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/ },
  { kind: "constant", re: /^const\s+([A-Za-z_][\w]*)/ },
];

const RUST_PATTERNS: readonly SymbolPattern[] = [
  { kind: "function", re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-z_][\w]*)/ },
  {
    kind: "struct",
    re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/,
  },
  { kind: "trait", re: /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/ },
  {
    kind: "enum",
    re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/,
  },
];

const JAVA_PATTERNS: readonly SymbolPattern[] = [
  {
    kind: "class",
    re: /^\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+|static\s+)*class\s+([A-Za-z_][\w]*)/,
  },
  {
    kind: "interface",
    re: /^\s*(?:public\s+)?interface\s+([A-Za-z_][\w]*)/,
  },
  {
    kind: "enum",
    re: /^\s*(?:public\s+)?enum\s+([A-Za-z_][\w]*)/,
  },
];

const RUBY_PATTERNS: readonly SymbolPattern[] = [
  { kind: "class", re: /^\s*class\s+([A-Za-z_][\w]*)/ },
  { kind: "method", re: /^\s*def\s+([a-z_][\w]*[?!]?)/ },
  { kind: "constant", re: /^\s*([A-Z][A-Z0-9_]*)\s*=/ },
];

function patternsFor(language: Language): readonly SymbolPattern[] {
  switch (language) {
    case "typescript":
    case "javascript":
      return TS_PATTERNS;
    case "python":
      return PY_PATTERNS;
    case "go":
      return GO_PATTERNS;
    case "rust":
      return RUST_PATTERNS;
    case "java":
      return JAVA_PATTERNS;
    case "ruby":
      return RUBY_PATTERNS;
    default:
      return [];
  }
}

export interface ExtractionResult {
  readonly symbols: readonly SourceSymbol[];
  readonly chunks: readonly CodeChunk[];
}

export function extractFromFile(
  content: string,
  filePath: string,
  language: Language,
): ExtractionResult {
  const lines = content.split("\n");
  const patterns = patternsFor(language);
  const symbols: SourceSymbol[] = [];
  const chunks: CodeChunk[] = [];

  if (patterns.length === 0) {
    chunks.push(...chunkPlain(lines, filePath, language));
    return { symbols, chunks };
  }

  const symbolStarts: { line: number; name: string; kind: SymbolKind }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { kind, re } of patterns) {
      const match = re.exec(line);
      if (!match) continue;
      const name = match[1];
      if (!name || name.length < 2) continue;
      const key = `${filePath}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbolStarts.push({ line: i, name, kind });
      break;
    }
  }

  const exportedNames = new Set<string>();
  const exportRe =
    /^\s*export\s+(?:\{[^}]*\}|(?:default\s+)?(?:const|function|class|interface|type|enum|abstract\s+class)\s+)?/;

  for (let i = 0; i < lines.length; i++) {
    if (exportRe.test(lines[i])) {
      const names = lines[i].match(/([A-Za-z_$][\w$]*)/g) ?? [];
      for (const n of names) exportedNames.add(n);
      if (lines[i].includes("export {")) {
        const inner = lines[i].match(/\{([^}]*)\}/)?.[1] ?? "";
        for (const part of inner.split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (name) exportedNames.add(name);
        }
      }
    }
  }

  if (symbolStarts.length === 0) {
    chunks.push(...chunkPlain(lines, filePath, language));
    return { symbols, chunks };
  }

  for (let s = 0; s < symbolStarts.length; s++) {
    const start = symbolStarts[s].line;
    const end =
      s + 1 < symbolStarts.length
        ? Math.min(symbolStarts[s + 1].line, start + DEFAULT_CHUNK_LINES * 4)
        : lines.length;

    const { name, kind } = symbolStarts[s];
    const body = lines.slice(start, end).join("\n");
    if (body.trim().length === 0) continue;

    symbols.push({
      name,
      kind,
      filePath,
      line: start + 1,
      endLine: end,
      exported: exportedNames.has(name),
    });

    chunks.push({
      id: `${filePath}#${name}@${start + 1}`,
      filePath,
      language,
      kind: "symbol",
      symbolName: name,
      symbolKind: kind,
      startLine: start + 1,
      endLine: end,
      content: body,
      embedding: null,
    });
  }

  return { symbols, chunks };
}

function chunkPlain(
  lines: readonly string[],
  filePath: string,
  language: Language,
): CodeChunk[] {
  const result: CodeChunk[] = [];
  const isMd = language === "markdown";

  if (isMd) {
    const headings: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,3}\s/.test(lines[i])) headings.push(i);
    }
    if (headings.length > 0) {
      for (let h = 0; h < headings.length; h++) {
        const start = headings[h];
        const end = h + 1 < headings.length ? headings[h + 1] : lines.length;
        const body = lines.slice(start, end).join("\n").trim();
        if (body.length === 0) continue;
        const title = lines[start].replace(/^#+\s*/, "").slice(0, 80);
        result.push({
          id: `${filePath}#md@${start + 1}`,
          filePath,
          language,
          kind: "prose",
          symbolName: title || null,
          symbolKind: null,
          startLine: start + 1,
          endLine: end,
          content: body,
          embedding: null,
        });
      }
      return result;
    }
  }

  for (let start = 0; start < lines.length; start += DEFAULT_CHUNK_LINES) {
    const end = Math.min(start + DEFAULT_CHUNK_LINES, lines.length);
    const body = lines.slice(start, end).join("\n");
    if (body.trim().length === 0) continue;
    result.push({
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
  return result;
}

export { isSourceFile };

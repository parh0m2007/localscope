import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { Language, SourceSymbol, SymbolKind } from "../types.js";

/**
 * AST-based symbol and reference extraction via tree-sitter (WASM).
 *
 * Zero native builds: web-tree-sitter runs precompiled grammar WASMs.
 * Grammars resolve from, in order: LOCALSCOPE_GRAMMAR_DIR, ./grammars,
 * the tree-sitter-wasms package (if installed), dist/grammars (vendored
 * at publish time). If nothing resolves, extraction returns null and
 * callers fall back to the regex extractor — zero-config stays intact.
 */

interface TSPoint {
  readonly row: number;
  readonly column: number;
}

interface TSNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: TSPoint;
  readonly endPosition: TSPoint;
  readonly startIndex: number;
  readonly parent: TSNode | null;
  readonly namedChildren: readonly TSNode[];
  childForFieldName(name: string): TSNode | null;
}

interface TSTree {
  readonly rootNode: TSNode;
}

interface TSLanguageHandle {
  readonly __opaqueLanguageHandle: unique symbol;
}

interface TSParser {
  parse(input: string): TSTree;
  setLanguage(lang: TSLanguageHandle): void;
  delete(): void;
}

type WebTreeSitterModule = {
  init(options?: { locateFile?: (basename: string) => string }): Promise<void>;
  Language: { load(wasmPath: string): Promise<TSLanguageHandle> };
  new (): TSParser;
};

const require = createRequire(import.meta.url);

const GRAMMAR_BY_LANGUAGE: Readonly<Partial<Record<Language, string>>> = {
  typescript: "tree-sitter-typescript.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
  ruby: "tree-sitter-ruby.wasm",
  php: "tree-sitter-php.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  csharp: "tree-sitter-c_sharp.wasm",
};

const TSX_GRAMMAR = "tree-sitter-tsx.wasm";

function grammarFor(filePath: string, language: Language): string | null {
  if (language === "typescript" && filePath.endsWith(".tsx")) {
    return TSX_GRAMMAR;
  }
  return GRAMMAR_BY_LANGUAGE[language] ?? null;
}

function grammarDirs(): string[] {
  const dirs: string[] = [];
  const env = process.env.LOCALSCOPE_GRAMMAR_DIR;
  if (env) {
    // Explicit override wins exclusively — no probing of defaults.
    return [path.resolve(env)];
  }
  // Vendored grammars shipped with the package: ./grammars relative to
  // the package root (cwd when run via npx from the package dir, or the
  // repo root during development).
  dirs.push(path.resolve(process.cwd(), "grammars"));
  try {
    dirs.push(
      path.join(
        path.dirname(require.resolve("tree-sitter-wasms/package.json")),
        "out",
      ),
    );
  } catch {
    // tree-sitter-wasms not installed; vendored dir may still work
  }
  return dirs;
}

const RUNTIME_WASM_BASENAMES = ["tree-sitter.wasm", "web-tree-sitter.wasm"];

function locateRuntimeWasm(): string | null {
  for (const dir of grammarDirs()) {
    for (const base of RUNTIME_WASM_BASENAMES) {
      const candidate = path.join(dir, base);
      if (existsSync(candidate)) return candidate;
    }
  }
  try {
    const wtsDir = path.dirname(require.resolve("web-tree-sitter/package.json"));
    for (const base of RUNTIME_WASM_BASENAMES) {
      const candidate = path.join(wtsDir, base);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // web-tree-sitter not resolvable; shouldn't happen since it's a dep
  }
  return null;
}

let wtsModule: WebTreeSitterModule | null = null;
let wtsModulePromise: Promise<WebTreeSitterModule | null> | null = null;
let wtsFailed = false;
const languageCache = new Map<string, TSLanguageHandle>();

async function getWtsModule(): Promise<WebTreeSitterModule | null> {
  if (wtsModule) return wtsModule;
  if (wtsFailed) return null;
  if (wtsModulePromise) return wtsModulePromise;

  wtsModulePromise = (async () => {
    try {
      const imported = (await import("web-tree-sitter")) as unknown as {
        default?: WebTreeSitterModule;
      } & Record<string, unknown>;
      const mod =
        imported.default ?? (imported as unknown as WebTreeSitterModule);
      const runtimeWasm = locateRuntimeWasm();
      await mod.init({
        locateFile: (basename: string) => runtimeWasm ?? basename,
      });
      wtsModule = mod;
      return mod;
    } catch {
      wtsFailed = true;
      return null;
    }
  })();
  return wtsModulePromise;
}

async function getLanguage(
  grammarFile: string,
): Promise<TSLanguageHandle | null> {
  const mod = await getWtsModule();
  if (!mod) return null;

  const dir = grammarDirs().find((d) => existsSync(path.join(d, grammarFile)));
  if (!dir) return null;
  const full = path.join(dir, grammarFile);

  const cached = languageCache.get(full);
  if (cached) return cached;
  try {
    const lang = await mod.Language.load(full);
    languageCache.set(full, lang);
    return lang;
  } catch {
    return null;
  }
}

export interface AstExtraction {
  readonly symbols: SourceSymbol[];
  /**
   * Identifier usages in the file — call targets and type/identifier
   * reads: name -> ascending line numbers of each occurrence. Powers
   * the symbol-level graph and editor jumps.
   */
  readonly identifierUses: ReadonlyMap<string, readonly number[]>;
}

/**
 * tree-sitter node type -> symbol kind. Grammar node types are unique
 * enough across languages for a single table (function_declaration in
 * TS and Go means the same thing).
 */
const DEFINITIONS: ReadonlyMap<string, SymbolKind> = new Map([
  // TypeScript / JavaScript / TSX
  ["function_declaration", "function"],
  ["generator_function_declaration", "function"],
  ["method_definition", "method"],
  ["class_declaration", "class"],
  ["abstract_class_declaration", "class"],
  ["interface_declaration", "interface"],
  ["type_alias_declaration", "type"],
  ["enum_declaration", "enum"],
  ["variable_declarator", "variable"],
  // Python
  ["class_definition", "class"],
  ["function_definition", "function"],
  // Go
  ["type_spec", "type"],
  ["method_declaration", "method"],
  // Rust
  ["function_item", "function"],
  ["struct_item", "struct"],
  ["enum_item", "enum"],
  ["trait_item", "trait"],
  ["const_item", "constant"],
  ["type_item", "type"],
  // Java / PHP / C# / C / C++
  ["constructor_declaration", "method"],
  ["field_declaration", "variable"],
  ["enum_specifier", "enum"],
  ["struct_specifier", "struct"],
  ["union_specifier", "struct"],
  ["class_specifier", "class"],
]);

const NAME_NODE_TYPES = new Set([
  "identifier",
  "type_identifier",
  "property_identifier",
  "field_identifier",
  "const_identifier",
  "statement_identifier",
  "package_identifier",
]);

/** Non-symbol name-holding nodes to skip as symbols. */
const NOISE_NAMES = new Set(["constructor", "new", "this"]);

function symbolNameOf(node: TSNode): string | null {
  const byField = node.childForFieldName("name");
  if (byField && NAME_NODE_TYPES.has(byField.type)) return byField.text;
  const fallback = node.namedChildren.find((c) => NAME_NODE_TYPES.has(c.type));
  return fallback ? fallback.text : null;
}

/** Body nodes: crossing one means we left the declaration prefix scope. */
const BODY_NODES = new Set([
  "statement_block",
  "class_body",
  "block",
  "function_body",
  "declaration_list",
  "compound_statement",
]);

function isExportedNode(node: TSNode, source: string): boolean {
  // TS/JS: exported if wrapped in export_statement without crossing a
  // function/class body (locals inside exported functions are NOT exports).
  let cursor: TSNode | null = node;
  while (cursor) {
    if (cursor.type === "export_statement") return true;
    if (BODY_NODES.has(cursor.type)) break;
    cursor = cursor.parent;
  }
  // Rust: `pub` directly prefixes item declarations.
  if (node.type.endsWith("_item")) {
    const prefix = source.slice(
      Math.max(0, node.startIndex - 4),
      node.startIndex,
    );
    if (prefix === "pub ") return true;
  }
  return false;
}

function collectExportedListNames(root: TSNode): Set<string> {
  // `export { a, b as c }` — mark listed names as exported. A real export
  // list has an export_clause child; `export function f() { ... }` does not.
  const names = new Set<string>();
  const visit = (node: TSNode): void => {
    if (
      node.type === "export_statement" &&
      node.namedChildren.some((c) => c.type === "export_clause")
    ) {
      collectIdentifiers(node, names);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return names;
}

function collectIdentifiers(node: TSNode, into: Set<string>): void {
  if (node.type === "identifier") into.add(node.text);
  for (const child of node.namedChildren) collectIdentifiers(child, into);
}

function calleeName(node: TSNode | null): string | null {
  if (!node) return null;
  if (node.type === "identifier") return node.text;
  if (node.type === "member_expression" || node.type === "attribute") {
    const property = node.namedChildren[node.namedChildren.length - 1];
    return property ? property.text : null;
  }
  return null;
}

interface WalkState {
  readonly source: string;
  readonly filePath: string;
  readonly symbols: SourceSymbol[];
  readonly identifierUses: Map<string, number[]>;
}

function recordUse(state: WalkState, name: string, line: number): void {
  const lines = state.identifierUses.get(name);
  if (lines) {
    if (lines[lines.length - 1] !== line) lines.push(line);
  } else {
    state.identifierUses.set(name, [line]);
  }
}

function walk(node: TSNode, state: WalkState): void {
  const kind = DEFINITIONS.get(node.type);
  if (kind) {
    const name = symbolNameOf(node);
    if (name && name.length >= 2 && !NOISE_NAMES.has(name)) {
      state.symbols.push({
        name,
        kind,
        filePath: state.filePath,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        exported: isExportedNode(node, state.source),
      });
    }
  } else if (node.type === "identifier" || node.type === "type_identifier") {
    // Identifier read in a non-defining position (call argument, type
    // reference, member object). The parent link lets us skip the name
    // child of declarations — those are definitions, handled above.
    const parent = node.parent;
    const parentUsesNameField =
      parent &&
      DEFINITIONS.has(parent.type) &&
      parent.childForFieldName("name") === node;
    if (!parentUsesNameField && node.text.length >= 2) {
      recordUse(state, node.text, node.startPosition.row + 1);
    }
  } else if (node.type === "call_expression" || node.type === "call") {
    const callee = node.childForFieldName("function") ?? node.namedChildren[0];
    const name = calleeName(callee);
    if (name && name !== "this") {
      recordUse(state, name, callee!.startPosition.row + 1);
    }
  }

  for (const child of node.namedChildren) walk(child, state);
}

function dedupeSymbols(symbols: SourceSymbol[]): SourceSymbol[] {
  const seen = new Set<string>();
  const out: SourceSymbol[] = [];
  for (const s of symbols) {
    const key = `${s.filePath}:${s.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export async function astExtractFromFile(
  filePath: string,
  language: Language,
): Promise<AstExtraction | null> {
  const grammar = grammarFor(filePath, language);
  if (!grammar) return null;

  const lang = await getLanguage(grammar);
  if (!lang) return null;
  const mod = await getWtsModule();
  if (!mod) return null;

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  if (source.trim().length === 0) return null;

  let tree: TSTree;
  try {
    const parser = new mod();
    parser.setLanguage(lang);
    tree = parser.parse(source);
    parser.delete();
  } catch {
    return null;
  }

  const state: WalkState = {
    source,
    filePath,
    symbols: [],
    identifierUses: new Map(),
  };
  walk(tree.rootNode, state);

  const exportedList = collectExportedListNames(tree.rootNode);
  if (exportedList.size > 0) {
    for (let i = 0; i < state.symbols.length; i++) {
      if (exportedList.has(state.symbols[i].name)) {
        state.symbols[i] = { ...state.symbols[i], exported: true };
      }
    }
  }

  return {
    symbols: dedupeSymbols(state.symbols),
    identifierUses: state.identifierUses,
  };
}

export function astAvailableFor(language: Language): boolean {
  if (wtsFailed) return false;
  const grammar = GRAMMAR_BY_LANGUAGE[language];
  if (!grammar) return false;
  return grammarDirs().some((d) => existsSync(path.join(d, grammar)));
}

export function resetAstState(): void {
  languageCache.clear();
  wtsModule = null;
  wtsModulePromise = null;
  wtsFailed = false;
}

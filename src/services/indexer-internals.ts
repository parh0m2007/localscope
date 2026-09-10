import * as path from "node:path";
import type { FileNode } from "../types.js";

const IMPORT_RESOLVERS: Readonly<Record<string, RegExp>> = {
  typescript: /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  javascript: /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  python: /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g,
  go: /"([\w./-]+)"/g,
  rust: /\buse\s+([\w:]+)/g,
};

export function resolveRelativeImport(
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

export function resolvePythonImport(
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

export function extractImports(
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

export async function extractImportsForFile(
  content: string,
  language: string,
  fromFile: string,
  allFiles: ReadonlySet<string>,
  fileMapByRel: ReadonlyMap<string, string>,
): Promise<string[]> {
  return extractImports(content, language, fromFile, allFiles, fileMapByRel);
}

export function buildFileGraph(
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

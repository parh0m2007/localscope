import { describe, expect, it, beforeAll } from "vitest";
import * as path from "node:path";
import { buildIndex, searchIndex } from "../src/services/indexer.js";
import { analyzeFileImpact, analyzeSymbolImpact } from "../src/services/impact.js";
import { clearGitignoreCache } from "../src/services/walker.js";
import { lexicalEmbedder } from "../src/services/embedder.js";
import type { IndexResult } from "../src/services/indexer.js";

const ROOT = path.resolve(__dirname, "fixtures/sample");

let index: IndexResult;

beforeAll(async () => {
  clearGitignoreCache();
  index = await buildIndex({ rootDir: ROOT, embedder: lexicalEmbedder });
});

describe("walker + gitignore", () => {
  it("indexes source files and respects .gitignore", () => {
    const paths = index.files.map((f) => path.relative(ROOT, f.filePath));
    expect(paths).toContain("src/utils/config.ts");
    expect(paths).toContain("src/services/server.ts");
    expect(paths).toContain("src/main.ts");
    expect(paths.some((p) => p.startsWith("secret/"))).toBe(false);
  });
});

describe("symbol extraction", () => {
  it("finds functions, classes, interfaces, constants", () => {
    const names = index.symbols.map((s) => s.name);
    expect(names).toContain("parseConfig");
    expect(names).toContain("AppConfig");
    expect(names).toContain("Server");
    expect(names).toContain("DEFAULT_TIMEOUT_MS");
  });

  it("marks exported symbols", () => {
    const parse = index.symbols.find((s) => s.name === "parseConfig");
    expect(parse?.exported).toBe(true);
    const serverCls = index.symbols.find((s) => s.name === "Server");
    expect(serverCls?.exported).toBe(true);
  });

  it("records file and line", () => {
    const parse = index.symbols.find((s) => s.name === "parseConfig");
    expect(parse?.filePath.endsWith("src/utils/config.ts")).toBe(true);
    expect(parse?.line).toBeGreaterThan(0);
  });
});

describe("import graph", () => {
  it("resolves relative TypeScript imports", () => {
    const configPath = index.files.find((f) =>
      f.filePath.endsWith("src/utils/config.ts"),
    )?.filePath;
    expect(configPath).toBeDefined();
    const node = index.fileGraph.get(configPath!);
    expect(node?.importedBy.length).toBe(2);
    const importers = node?.importedBy.map((p) => path.relative(ROOT, p));
    expect(importers).toContain("src/services/server.ts");
    expect(importers).toContain("src/main.ts");
  });
});

describe("search", () => {
  it("finds by symbol name", () => {
    const { hits } = searchIndex(index, "parseConfig", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.symbolName).toBe("parseConfig");
    expect(hits[0]?.matchedBy).toBe("symbol");
  });

  it("finds by natural language lexically", () => {
    const { hits } = searchIndex(index, "parse config json", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.some((h) => h.filePath.endsWith("src/utils/config.ts")),
    ).toBe(true);
  });

  it("finds markdown headings as prose chunks", () => {
    const { hits } = searchIndex(index, "configuration app", 10);
    expect(hits.some((h) => h.filePath.endsWith("docs/README.md"))).toBe(true);
  });
});

describe("impact analysis", () => {
  it("file impact: who breaks when config.ts changes", () => {
    const configPath = path.join(ROOT, "src/utils/config.ts");
    const report = analyzeFileImpact(index, configPath);
    expect(report.targetKind).toBe("file");
    expect(report.directDependents.length).toBe(2);
    const deps = report.directDependents.map((p) => path.relative(ROOT, p));
    expect(deps).toContain("src/services/server.ts");
    expect(deps).toContain("src/main.ts");
    expect(report.symbolBreakages.length).toBeGreaterThan(0);
  });

  it("transitive impact: main.ts is a leaf", () => {
    const report = analyzeFileImpact(index, path.join(ROOT, "src/main.ts"));
    expect(report.totalFilesAffected).toBe(0);
  });

  it("symbol impact: parseConfig used in two files", () => {
    const report = analyzeSymbolImpact(index, "parseConfig");
    expect(report.targetKind).toBe("symbol");
    const affected = report.directDependents.map((p) => path.relative(ROOT, p));
    expect(affected).toContain("src/services/server.ts");
    expect(affected).toContain("src/main.ts");
  });

  it("gives fuzzy suggestions for unknown symbols", () => {
    expect(() => analyzeSymbolImpact(index, "parConfig")).toThrow();
  });
});

describe("chunking", () => {
  it("creates symbol chunks with ids", () => {
    expect(index.chunks.length).toBeGreaterThan(0);
    const chunk = index.chunks.find((c) => c.symbolName === "parseConfig");
    expect(chunk?.kind).toBe("symbol");
    expect(chunk?.content).toContain("JSON.parse");
  });
});

describe("embedder fallback", () => {
  it("lexical embedder reports its kind", () => {
    expect(lexicalEmbedder.kind.type).toBe("lexical");
  });

  it("index built without onnx still completes", () => {
    expect(index.embedder.type).toBe("lexical");
    expect(index.chunks.length).toBeGreaterThan(0);
  });
});

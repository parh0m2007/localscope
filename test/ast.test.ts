import { describe, expect, it, beforeAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { astExtractFromFile, astAvailableFor } from "../src/services/ast.js";
import { analyzeSymbolImpact } from "../src/services/impact.js";
import type { IndexResult } from "../src/services/indexer.js";
import { buildIndex } from "../src/services/indexer.js";
import { lexicalEmbedder } from "../src/services/embedder.js";
import { clearGitignoreCache } from "../src/services/walker.js";

const SAMPLE = path.resolve(__dirname, "fixtures/sample");

describe("AST availability", () => {
  it("reports typescript as available when grammars are vendored", () => {
    expect(astAvailableFor("typescript")).toBe(true);
  });

  it("reports markdown as unavailable (no grammar)", () => {
    expect(astAvailableFor("markdown")).toBe(false);
  });
});

describe("AST symbol extraction", () => {
  it("extracts precise symbols with kinds, lines, and export flags", async () => {
    const ext = await astExtractFromFile(
      path.join(SAMPLE, "src/utils/config.ts"),
      "typescript",
    );
    expect(ext).not.toBeNull();
    if (!ext) return;

    const byName = new Map(ext.symbols.map((s) => [s.name, s]));
    expect(byName.get("AppConfig")).toMatchObject({
      kind: "interface",
      line: 1,
      exported: true,
    });
    expect(byName.get("parseConfig")).toMatchObject({
      kind: "function",
      line: 6,
      exported: true,
    });
    // Local variable inside a function is NOT exported.
    expect(byName.get("parsed")).toMatchObject({ exported: false });
    expect(byName.get("DEFAULT_TIMEOUT_MS")).toBeDefined();
  });

  it("does not emit constructor as a symbol", async () => {
    const ext = await astExtractFromFile(
      path.join(SAMPLE, "src/services/server.ts"),
      "typescript",
    );
    expect(ext).not.toBeNull();
    if (!ext) return;
    const names = ext.symbols.map((s) => s.name);
    expect(names).toContain("Server");
    expect(names).toContain("start");
    expect(names).not.toContain("constructor");
  });

  it("handles export { name } lists", async () => {
    const ext = await astExtractFromFile(
      path.join(SAMPLE, "src/services/server.ts"),
      "typescript",
    );
    expect(ext).not.toBeNull();
    if (!ext) return;
    // server.ts re-exports parseConfig via `export { parseConfig }`
    const names = ext.symbols.map((s) => s.name);
    expect(names).not.toContain("parseConfig"); // not defined here, only re-exported
  });

  it("returns null for languages without grammars", async () => {
    const ext = await astExtractFromFile(
      path.join(SAMPLE, "docs/README.md"),
      "markdown",
    );
    expect(ext).toBeNull();
  });

  it("extracts python classes and functions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "localscope-py-"));
    const file = path.join(dir, "app.py");
    await fs.writeFile(
      file,
      [
        "class Worker:",
        "    def run(self):",
        "        return self.boot()",
        "",
        "async def main():",
        "    pass",
        "",
      ].join("\n"),
      "utf8",
    );
    const ext = await astExtractFromFile(file, "python");
    expect(ext).not.toBeNull();
    if (!ext) return;
    const names = ext.symbols.map((s) => s.name);
    expect(names).toContain("Worker");
    expect(names).toContain("run");
    expect(names).toContain("main");
    expect([...ext.identifierUses.keys()]).toContain("boot");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("extracts go functions and struct types", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "localscope-go-"));
    const file = path.join(dir, "main.go");
    await fs.writeFile(
      file,
      [
        "package main",
        "",
        "func Boot() error {",
        "\treturn nil",
        "}",
        "",
        "type Server struct {",
        "\tport int",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const ext = await astExtractFromFile(file, "go");
    expect(ext).not.toBeNull();
    if (!ext) return;
    const byName = new Map(ext.symbols.map((s) => [s.name, s]));
    expect(byName.get("Boot")).toMatchObject({ kind: "function" });
    expect(byName.get("Server")).toBeDefined();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("AST reference graph powers impact", () => {
  let index: IndexResult;

  beforeAll(async () => {
    clearGitignoreCache();
    index = await buildIndex({ rootDir: SAMPLE, embedder: lexicalEmbedder });
  });

  it("index reports AST active for the TS fixture", () => {
    expect(index.astActive).toBe(true);
    expect(index.references.length).toBeGreaterThan(0);
  });

  it("symbol impact finds files that actually use the symbol", () => {
    const report = analyzeSymbolImpact(index, "parseConfig");
    const affected = report.directDependents.map((p) =>
      path.relative(SAMPLE, p),
    );
    expect(affected).toContain("src/main.ts");
    expect(affected).toContain("src/services/server.ts");

    // Precise: breakages cite actual usage counts and line numbers.
    const usageBreakage = report.symbolBreakages.find(
      (b) => b.reason.includes("AST reference"),
    );
    expect(usageBreakage).toBeDefined();
    expect(usageBreakage?.reason).toMatch(/uses parseConfig \d+×/);
    expect(usageBreakage?.reason).toMatch(/\(line[s]? \d+/);
    expect(usageBreakage?.line).toBeGreaterThan(0);
  });

  it("symbol impact on a leaf symbol reports zero dependents", () => {
    // `server` is a local variable in main.ts, used nowhere else.
    const report = analyzeSymbolImpact(index, "server");
    expect(report.totalFilesAffected).toBe(0);
  });
});

describe("regex fallback", () => {
  it("extracts symbols when AST is unavailable", async () => {
    // Force AST failure: an existing but empty grammar dir shadows the
    // vendored grammars (first match wins in the resolver).
    const shadow = await fs.mkdtemp(path.join(os.tmpdir(), "ls-no-grammars-"));
    const prev = process.env.LOCALSCOPE_GRAMMAR_DIR;
    process.env.LOCALSCOPE_GRAMMAR_DIR = shadow;
    const { resetAstState } = await import("../src/services/ast.js");
    resetAstState();

    try {
      const ext = await astExtractFromFile(
        path.join(SAMPLE, "src/utils/config.ts"),
        "typescript",
      );
      expect(ext).toBeNull(); // AST unavailable

      // The regex extractor still works — buildIndex falls back to it.
      clearGitignoreCache();
      const index = await buildIndex({
        rootDir: SAMPLE,
        embedder: lexicalEmbedder,
      });
      expect(index.astActive).toBe(false);
      const names = index.symbols.map((s) => s.name);
      expect(names).toContain("parseConfig");
      expect(names).toContain("AppConfig");
    } finally {
      if (prev === undefined) delete process.env.LOCALSCOPE_GRAMMAR_DIR;
      else process.env.LOCALSCOPE_GRAMMAR_DIR = prev;
      const { resetAstState } = await import("../src/services/ast.js");
      resetAstState();
      await fs.rm(shadow, { recursive: true, force: true });
    }
  });
});

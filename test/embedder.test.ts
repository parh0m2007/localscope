import { describe, expect, it } from "vitest";
import {
  splitIdentifier,
  tokenize,
  lexicalScore,
  buildLexicalTf,
  cosineSimilarity,
} from "../src/services/embedder.js";
import { detectLanguage, isSourceFile } from "../src/services/language.js";
import { compileGitignore } from "./gitignore-test-helper.js";

describe("tokenizer", () => {
  it("splits camelCase identifiers", () => {
    expect(splitIdentifier("parseConfig")).toEqual(["parse", "config"]);
    expect(splitIdentifier("HTTPServer")).toEqual(["http", "server"]);
  });

  it("drops stop words", () => {
    expect(tokenize("the parser for the config")).toEqual([
      "parser",
      "config",
    ]);
  });
});

describe("lexical scoring", () => {
  it("scores relevant chunks higher", () => {
    const relevant = buildLexicalTf("c1", "parse config json settings", "parseConfig");
    const irrelevant = buildLexicalTf("c2", "render button animation frames", "drawFrame");
    const q = tokenize("parse config");
    expect(lexicalScore(q, relevant)).toBeGreaterThan(
      lexicalScore(q, irrelevant),
    );
  });

  it("cosine similarity of identical vectors is 1", () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});

describe("language detection", () => {
  it("maps extensions", () => {
    expect(detectLanguage("a.ts")).toBe("typescript");
    expect(detectLanguage("a.py")).toBe("python");
    expect(detectLanguage("a.rs")).toBe("rust");
    expect(detectLanguage("a.md")).toBe("markdown");
    expect(detectLanguage("Makefile")).toBe("other");
  });

  it("identifies source files", () => {
    expect(isSourceFile("typescript")).toBe(true);
    expect(isSourceFile("markdown")).toBe(false);
  });
});

describe("gitignore compiler", () => {
  it("respects simple dir and file patterns", () => {
    const match = compileGitignore(["node_modules/", "*.log", "build"]);
    expect(match("node_modules")).toBe(true);
    expect(match("foo/node_modules")).toBe(true);
    expect(match("debug.log")).toBe(true);
    expect(match("build")).toBe(true);
    expect(match("src/index.ts")).toBe(false);
  });

  it("supports negation", () => {
    const match = compileGitignore(["*.log", "!important.log"]);
    expect(match("debug.log")).toBe(true);
    expect(match("important.log")).toBe(false);
  });
});

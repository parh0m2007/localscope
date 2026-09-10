import type { Language } from "../types.js";

const EXTENSION_MAP: Readonly<Record<string, Language>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  md: "markdown",
  mdx: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  less: "css",
};

export function detectLanguage(filePath: string): Language {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? "other";
}

export function isSourceFile(language: Language): boolean {
  return (
    language === "typescript" ||
    language === "javascript" ||
    language === "python" ||
    language === "go" ||
    language === "rust" ||
    language === "java" ||
    language === "ruby" ||
    language === "php" ||
    language === "c" ||
    language === "cpp" ||
    language === "csharp"
  );
}

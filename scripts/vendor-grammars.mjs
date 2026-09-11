// Copies tree-sitter grammar WASMs and the web-tree-sitter runtime WASM
// into ./grammars so the published npm package works fully offline.
// Skips gracefully when tree-sitter-wasms isn't installed (e.g. in CI
// cache-only installs) — extraction then falls back to regex.
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

const GRAMMARS = [
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-go.wasm",
  "tree-sitter-rust.wasm",
  "tree-sitter-java.wasm",
  "tree-sitter-ruby.wasm",
  "tree-sitter-php.wasm",
  "tree-sitter-c.wasm",
  "tree-sitter-cpp.wasm",
  "tree-sitter-c_sharp.wasm",
];

const outDir = path.resolve("grammars");
mkdirSync(outDir, { recursive: true });

let srcDir;
try {
  srcDir = path.join(
    path.dirname(require.resolve("tree-sitter-wasms/package.json")),
    "out",
  );
} catch {
  console.error("vendor:grammars: tree-sitter-wasms not installed; skipping");
  process.exit(0);
}

let copied = 0;
for (const file of GRAMMARS) {
  const src = path.join(srcDir, file);
  if (existsSync(src)) {
    copyFileSync(src, path.join(outDir, file));
    copied++;
  } else {
    console.error(`vendor:grammars: missing ${file}`);
  }
}

// Runtime WASM for web-tree-sitter — needed once at Parser.init().
try {
  const wtsDir = path.dirname(require.resolve("web-tree-sitter/package.json"));
  copyFileSync(
    path.join(wtsDir, 'tree-sitter.wasm'),
    path.join(outDir, "web-tree-sitter.wasm"),
  );
  copied++;
} catch {
  console.error("vendor:grammars: web-tree-sitter.wasm not found; skipping");
}

console.log(`vendor:grammars: ${copied} files copied to ${outDir}`);

# localscope

[![CI](https://github.com/parh0m2007/localscope/actions/workflows/ci.yml/badge.svg)](https://github.com/parh0m2007/localscope/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/localscope-mcp)](https://www.npmjs.com/package/localscope-mcp)

**A local code analyst for your AI assistant — and for you.**

localscope is an [MCP](https://modelcontextprotocol.io) server that indexes your repository on your machine — files, symbols, imports, references, optional embeddings — and lets Claude, Cursor, Codex, Windsurf, or any MCP client answer questions like:

> "Where does X break if I change Y?"

without a single byte of your code leaving your machine. And when there's no AI client around, `localscope explore` puts the same graph in your terminal.

```
$ localscope explore

  change what? parseConfig
    parseConfig   function · src/utils/config.ts:6
    AppConfig     interface · src/utils/config.ts:1
    … 4 more

  [enter]

  Impact of changing parseConfig
  2 files affected · 2 direct · 0 transitive

  Breaks first
    src/main.ts
    src/services/server.ts

  Esc back to search · Ctrl-C exit
```

## Commands

| Command | What it does |
|---|---|
| `localscope explore` | Interactive impact browser: type a symbol or file, see what breaks — fzf-style, in your terminal. `↑/↓` highlights a victim, `o` opens it in your `$EDITOR` at the first call site |
| `localscope report --target X` | The same impact analysis, plain text to stdout — pipe it, grep it, put it in CI |
| `localscope index` | Build or refresh the local index (incremental — unchanged files are skipped) |

No AI client, no network, no leaving the repo. The MCP server and the CLI share one index.

## Why

Cloud code-search tools are great — until the repo is under NDA, on an air-gapped machine, or you simply don't want your code on someone else's servers. localscope gives assistants *codebase vision* with a hard guarantee: **zero network calls, zero telemetry, zero config.**

| | localscope | cloud tools |
|---|---|---|
| Code leaves machine | never | yes |
| Setup | `npx localscope-mcp` | API key, upload |
| Works offline | yes | no |
| Impact analysis | AST symbols + call graph | varies |

## Quickstart

Requirements: Node 18+.

**Claude Code:**
```bash
claude mcp add localscope -- npx localscope-mcp
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "localscope": { "command": "npx", "args": ["localscope-mcp"] }
  }
}
```

**Any MCP client** — stdio server, one command:
```bash
npx localscope-mcp
```

Optional: semantic search with local ONNX embeddings (still offline — the model runs on your CPU):
```bash
npm install -g @huggingface/transformers
```
Not installed? localscope automatically falls back to lexical + symbol search. No error, no setup step.

## Tools

### `localscope_index`
Build the local index: files, symbols, import graph, embeddings if available. Respects `.gitignore` and skips `node_modules`, `dist`, lockfiles, binaries. Typical repo indexes in well under a second.

**Persistent and incremental.** The index is cached on disk (under `~/.cache/localscope/<repo-digest>/`) and reused across sessions: re-running `localscope_index` only re-extracts files whose mtime/size changed, and `localscope_search` / `localscope_impact` load the persisted index automatically — no full re-index in every session. While the server runs, a file watcher keeps the index fresh: edit a file, and the update lands in the background within ~300ms. Set `LOCALSCOPE_CACHE_DIR` to relocate the cache.

### `localscope_search`
Find code by meaning ("retry with backoff"), by symbol name ("parseConfig"), or by fragment. Each hit shows file, lines, symbol, score, and *how* it matched — semantic, lexical, or symbol. Identifiers are split camelCase-aware, so "parse config" finds `parseConfig`.

### `localscope_impact`
The headline tool. Give it a file path or a symbol name and it walks the reverse dependency graph:

- **Direct dependents** — files importing the target; these break first
- **Transitive dependents** — everything downstream, up to `max_depth` hops
- **Symbols at risk** — exported functions/classes in the target and why each is fragile
- **Fuzzy suggestions** — typo in the name? It suggests what you meant

### `localscope_references`
A local "find all usages": every call site and read of a symbol, with exact line numbers per file. `where is parseConfig called?` → `src/main.ts:4` and friends — from the AST reference graph, offline.

### `localscope_definition`
A local "go to definition": file, line span, kind, and export status of a symbol.

### `localscope_status`
Index stats: files, chunks, symbols, embedder mode, timestamp.

## Privacy guarantee

localscope makes **no outbound network calls** — not for search, not for models, not for updates. The ONNX embedder (if you install it) downloads its model once from Hugging Face into your local cache, then runs fully offline. You can verify it yourself: [src/services/embedder.ts](src/services/embedder.ts) is the only module that touches `@huggingface/transformers`, and only when you've installed it.

Air-gap friendly. NDA friendly. Paranoia friendly.

## Star it

If localscope saved you a refactor-induced bug, [⭐ star the repo](https://github.com/parh0m2007/localscope) — it helps others find it.

## How impact analysis works

1. **Parse** each file with tree-sitter (WASM — no native builds, no language servers). Accurate symbols — functions, classes, interfaces, types, methods, constants — with real line spans and export status. Grammars ship inside the package: TypeScript/TSX, JavaScript, Python, Go, Rust, Java, Ruby, PHP, C, C++, C#. No grammar available (exotic file, pruned install)? localscope falls back to regex extraction — zero-config either way.
2. **Record references**, not just imports: every identifier use (call sites, type references) goes into the symbol graph, so impact analysis answers "who *actually calls* this", not just "who imports the file it lives in".
3. **Resolve imports** into a file graph. TypeScript-style `.js` → `.ts` mapping included (ESM-style imports resolve correctly).
4. **Answer** "who breaks?" by traversing the reverse graph and cross-referencing the symbol table.

No LSP server. No language server per language. No daemon. Just reading files fast and getting the graph right.

## HTTP mode (optional)

stdio is the default and right for local use. If you need HTTP (e.g. a shared dev-machine setup):

```bash
LOCALSCOPE_TRANSPORT=http LOCALSCOPE_PORT=3000 npx localscope-mcp
# MCP endpoint: http://127.0.0.1:3000/mcp
```

Binds to `127.0.0.1` only, rejects non-local origins. Do not expose it to the network.

## Configuration

Zero required. Everything is optional:

| Env var | Default | Purpose |
|---|---|---|
| `LOCALSCOPE_TRANSPORT` | `stdio` | `stdio` or `http` |
| `LOCALSCOPE_PORT` | `3000` | HTTP port |
| `LOCALSCOPE_RG_PATH` | auto-detect | Path to ripgrep binary, if you have one |
| `LOCALSCOPE_CACHE_DIR` | `~/.cache/localscope` | Base dir for persisted indexes |

## Development

```bash
git clone <repo> && cd localscope
npm install
npm test        # 62 tests
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

CI runs typecheck, lint, and tests on Node 18/20/22 across Linux, macOS, and Windows.

## License

MIT

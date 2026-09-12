# mcp.directory submission

Status: 2026-09-12, draft — fill in at https://mcp.directory/ (submit form) after npm 0.4.3 is live.

The site may ask to log in via GitHub first. Fields below follow their submission form.

## Name

localscope

## Short description (one-liner)

Local-first code analyst for Claude/Cursor: offline repo indexing + "what breaks if I change Y?" impact analysis. Zero cloud, zero config.

## Full description

localscope is an MCP server that gives your AI assistant codebase vision without any code leaving your machine. It indexes your repository locally — files, tree-sitter symbols, references, imports, and optional local ONNX embeddings — then answers questions like:

- "Where does X break if I change Y?" (reverse dependency graph: direct + transitive victims, symbols at risk)
- "Where is parseConfig called?" (line-precise references from the AST)
- "Go to definition of UserService"
- "Find retry logic" (semantic, lexical, or symbol match — camelCase-aware)

Key properties:

- **Local-first**: zero network calls, zero telemetry, zero config. Works fully offline, air-gap friendly.
- **Persistent + incremental index**: cached on disk, re-extracts only changed files; a file watcher keeps it fresh while the server runs.
- **No LSP/daemon**: WASM tree-sitter grammars ship in the package (TS/TSX, JS, Python, Go, Rust, Java, Ruby, PHP, C, C++, C#) with a regex fallback.
- **CLI included**: `localscope explore` is a fzf-style terminal impact browser with `$EDITOR` jump — no AI client needed.

Performance (measured on the ripgrep repo, M1 MacBook Air): cold index with ONNX ~2 min / lexical-only ~2 s; warm re-open 1.3 s; impact & references < 10 ms.

## Install command

```bash
claude mcp add localscope -- npx localscope-mcp
```

Any MCP client: `npx localscope-mcp` (Node 18+, stdio; optional HTTP on 127.0.0.1).

## GitHub repo URL

https://github.com/parh0m2007/localscope

## npm package

https://www.npmjs.com/package/localscope-mcp

## Category / tags

Code analysis, impact analysis, code search, developer tools, privacy, local-first

## Transport

stdio (default), HTTP (localhost only, opt-in)

## License

MIT

## Pricing

Free, open source (MIT)

## Screenshot / media

docs/demo.gif — 9-second demo of `localscope explore` (search → impact view → editor jump). Use as the preview asset if the form accepts a GIF.

## Notes for submitter

- Verify every claim against the README before submitting; don't add numbers that aren't there.
- If the site requires a logo, use the repo social preview or a plain square with the name — decide with the owner.
- Submit only once; wait for moderation. No resubmits.

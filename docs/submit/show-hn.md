# Show HN draft

Status: 2026-09-12, DRAFT — publish after npm 0.4.3 and the awesome-mcp-servers PR are live. Do not submit twice.

## Rules reminder

- One thread per project, ever. No "Show HN" reposts.
- No self-upvotes/asking friends to upvote.
- Title ≤ 80 chars, no clickbait, name in title.
- Submit between 8–10 am ET on a Tue–Thu for a fair shot.

## Title (122 chars? no — pick one, all under 80)

Primary (78 chars):

    Show HN: Localscope – local-first MCP server for "what breaks if I change Y?"

Alternates:

    Show HN: Localscope – give Claude/Cursor offline codebase vision (72 chars)
    Show HN: Localscope – private, offline code analyst for your AI assistant (75 chars)

## Text

    Hi HN, I built a tool that gives AI coding assistants (Claude, Cursor, Codex, Windsurf — anything speaking MCP) codebase vision without a single byte of code leaving your machine.

    The question I wanted answered was simple: "Where does X break if I change Y?" Cloud code-search tools answer it well, but for NDA'd repos, air-gapped machines, or plain "I don't want my code on someone else's server", there wasn't a good local option.

    So localscope indexes the repo locally: files, symbols (via WASM tree-sitter — no LSP, no language servers, no daemon), references, and the import graph. From that it answers impact analysis ("who breaks first if I touch this file"), line-precise references, and go-to-definition. Optionally it adds local ONNX embeddings for "find code by meaning" — model runs on your CPU, still zero network.

    How to try it (Node 18+):

        claude mcp add localscope -- npx localscope-mcp

    or with any MCP client: `npx localscope-mcp`. Zero config; it respects .gitignore, skips node_modules, and persists an incremental index on disk so the second run is warm (1.3 s on the ripgrep repo vs ~2 min cold with embeddings).

    There's also a terminal UI, `localscope explore` — fzf-style impact browsing with a jump to $EDITOR — for when there's no AI client around.

    Tech notes for the curious:

    - Tree-sitter WASM grammars ship inside the npm package (TS/JS/Python/Go/Rust/Java/Ruby/PHP/C/C++/C#), with a regex fallback for anything exotic.
    - The index is a persisted symbol + reference graph; impact analysis walks the reverse import graph and cross-references the symbol table. Measured <10 ms on ripgrep's codebase.
    - Embeddings are optional: no transformers installed → it silently falls back to lexical + symbol search. No error, no setup step.
    - Actually zero-network: no telemetry, no update pings. Auditable in one file (src/services/embedder.ts is the only module that can touch the network, and only during the one-time model download if you opt in).

    Would love feedback, especially on: (1) does the impact heuristic feel right in real refactors, (2) which languages/grammars to add next, (3) whether HTTP mode is worth expanding for shared dev machines.

    Repo: https://github.com/parh0m2007/localscope
    npm: https://www.npmjs.com/package/localscope-mcp

## First comment (from the submitter, post immediately after submitting)

    Some context on the numbers, since "benchmarks" showed up in the thread already: cold index on ripgrep (233 source files) is ~2 min with ONNX embeddings over 3,277 chunks, ~2 s lexical-only, warm re-open 1.3 s, impact/references under 10 ms. The index lives under ~/.cache/localscope and is incremental — only changed files re-extract. Also: we found and fixed a real OOM doing this benchmark (embeddings were serialized as JSON numbers, now a binary format), which is a decent reminder to benchmark on repos bigger than your own.

## Prep checklist

- [ ] npm 0.4.3 published (the OOM fix must be live before HN traffic)
- [ ] README performance table visible from the repo root
- [ ] demo.gif renders on GitHub (linked in README already)
- [ ] awesome-mcp-servers PR merged or at least open
- [ ] Be around to answer comments for the first 2–3 hours

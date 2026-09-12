# PR: Add localscope

**Для:** `punkpeye/awesome-mcp-servers` — fork, branch `add-localscope`, edit `README.md` (one line in the closed-source section) + `servers/README.md` (full entry), open PR against `main`.

**Branch base:** `main` of the upstream repo.

## One-line entry for `README.md` (closed-source section, keep alphabetical order by name)

```
- [localscope](https://github.com/parh0m2007/localscope) 🇺🇦 - A local-first code analyst that indexes your repository offline (tree-sitter symbols, references, import graph) and answers "where does X break if I change Y?" without your code leaving your machine.
```

Note: check the repo's actual flag rules — if 🇺🇸/-only server locations are used and localscope has none (it's fully local), use no flag or `-`. localscope is 100% local/no server, so the closed-source section fits only if their taxonomy expects local tools there; otherwise the **uncategorized/local** section is more accurate. Read the section headers first and place accordingly.

## Full entry for `servers/README.md` (in the appropriate section, alphabetical)

```
### localscope

A local-first MCP code analyst. Indexes your repository on your machine — files, tree-sitter symbols, references, imports, optional local ONNX embeddings — and gives Claude/Cursor/Codex/Windsurf tools to answer questions like "where does X break if I change Y?", "who calls parseConfig?", and "where is parseConfig defined?" with exact file:line answers. Zero network calls, zero telemetry, zero config. Ships with an interactive terminal impact browser (`localscope explore`) that works without any AI client.

- **Type:** `stdio`, optional `http` (localhost only)
- **Tags:** `code-analysis`, `impact-analysis`, `code-search`, `privacy`, `local-first`
- **Install:**
  ```bash
  claude mcp add localscope -- npx localscope-mcp
  ```
  or any MCP client: `npx localscope-mcp` (Node 18+, no config; installs offline)
- **Repo:** <https://github.com/parh0m2007/localscope>
- **npm:** <https://www.npmjs.com/package/localscope-mcp>
- **License:** MIT
```

## PR title

```
Add localscope: local-first code analyst with impact analysis
```

## PR body

```markdown
Adds localscope — a local-first MCP code analyst. It indexes a repository offline (tree-sitter symbols, references, import graph, optional local ONNX embeddings) and exposes search / impact / references / definition tools, so an assistant can answer "where does X break if I change Y?" without the code ever leaving the machine. No LSP, no daemon, no cloud; stdio by default, works via `npx localscope-mcp` with zero config.

- Repo: https://github.com/parh0m2007/localscope
- npm: https://www.npmjs.com/package/localscope-mcp
- License: MIT, TypeScript, tests + CI on Node 18/20/22 across Linux/macOS/Windows

Happy to adjust the entry format or section if I've placed it wrong.
```

## Submission checklist

- [ ] Fork punkpeye/awesome-mcp-servers
- [ ] Branch `add-localscope` from upstream `main`
- [ ] README.md: one-liner (correct section, alphabetical)
- [ ] servers/README.md: full entry
- [ ] Open PR to punkpeye:awesome-mcp-servers `main`
- [ ] PR title/body as above

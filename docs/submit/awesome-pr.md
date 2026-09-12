# PR: Add localscope to awesome-mcp-servers

**Target:** `punkpeye/awesome-mcp-servers` — fork, branch `add-localscope`, one edit to `README.md` only (this repo keeps everything in the single README; there is no `servers/README.md` with this format), open PR against `main`.

Verified against the live upstream `main` README (2026-09-12):

- Section: **`### 💻 <a name="developer-tools"></a>Developer Tools`** (heading at ~line 1215, not 🛠️ — that's only in the TOC). This section already hosts near-identical servers (mcp-code-indexer with blast-radius analysis, trace-mcp, bumpguard-mcp, kivgraph) — clearly the right home. Code Execution is for sandboxed *execution*, not analysis; don't use it.
- Ordering is alphabetical **by owner/repo string**, so `parh0m2007/localscope` goes into the "p" cluster, NOT into the "lo*" run (that cluster is sorted by owner, and `parh0m2007` doesn't belong there).
- Insert after `paracetamol951/P-Link-MCP` (~line 1534) and before `mcpware/pagecast` (an out-of-order append) / strictly before `Perseus-Computing-LLC/perseus`.
- Format: `[owner/repo](url)` + optional glama.ai score badge + flags `📇 🏠 🍎 🪟 🐧` (TypeScript, Local, macOS/Windows/Linux) + ` - ` + one-liner, install command in backticks.
- Glama badge is optional (appears only once the server is indexed on glama.ai) — for the PR, include it; if the badge 404s at review time, the maintainer may drop it or it renders blank. Alternative: submit without the badge first, add later.

## Exact line to add (README.md, Developer Tools section, after paracetamol951/P-Link-MCP)

```
- [parh0m2007/localscope](https://github.com/parh0m2007/localscope) [![parh0m2007/localscope MCP server](https://glama.ai/mcp/servers/parh0m2007/localscope/badges/score.svg)](https://glama.ai/mcp/servers/parh0m2007/localscope) 📇 🏠 🍎 🪟 🐧 - Local-first code analyst: indexes your repo offline (tree-sitter symbols, references, import graph, optional ONNX embeddings) and answers "where does X break if I change Y?" with line-precise references and go-to-definition. No LSP, no daemon, zero network. Install: `npx localscope-mcp`.
```

Without-badge fallback (if glama hasn't indexed it yet):

```
- [parh0m2007/localscope](https://github.com/parh0m2007/localscope) 📇 🏠 🍎 🪟 🐧 - Local-first code analyst: indexes your repo offline (tree-sitter symbols, references, import graph, optional ONNX embeddings) and answers "where does X break if I change Y?" with line-precise references and go-to-definition. No LSP, no daemon, zero network. Install: `npx localscope-mcp`.
```

## PR title

```
Add localscope
```

(Upstream examples use plain `Add <name>`; CONTRIBUTING.md's example commit message is "Add new XYZ server". Note: upstream offers fast-tracked merges for agent PRs marked 🤖🤖🤖 — do NOT use that, this is a human submission.)

## PR body

```markdown
Adds localscope to the Developer Tools section (alphabetical position in the parh0m2007 cluster).

localscope is a local-first MCP code analyst: it indexes a repository offline — tree-sitter symbols (WASM grammars, no LSP/daemon), references, import graph, optional local ONNX embeddings — and gives AI coding assistants tools for impact analysis ("where does X break if I change Y?"), line-precise find-all-usages, and go-to-definition. Zero network calls, zero telemetry, zero config; stdio by default. Also ships a terminal impact browser (`localscope explore`) that works without any AI client.

- Repo: https://github.com/parh0m2007/localscope
- npm: https://www.npmjs.com/package/localscope-mcp
- License: MIT · TypeScript · Node 18+ · CI on Linux/macOS/Windows

Happy to adjust wording, flags, or section if anything's off.
```

## Submission checklist (gh commands)

```bash
# 1. Fork + clone
gh repo fork punkpeye/awesome-mcp-servers --clone
cd awesome-mcp-servers
git checkout -b add-localscope

# 2. Edit README.md: insert the entry in Developer Tools after paracetamol951/P-Link-MCP
#    (verify the current line position with: rg -n "paracetamol951|Perseus-Computing" README.md)

# 3. Verify format locally renders (optional): glow README.md or view on GitHub preview

# 4. Commit + push + PR
git add README.md
git commit -m "Add localscope"
git push -u origin add-localscope
gh pr create \
  --repo punkpeye/awesome-mcp-servers \
  --base main \
  --head parh0m2007:add-localscope \
  --title "Add localscope" \
  --body-file <(cat <<'EOF'
Adds localscope to the Developer Tools section (alphabetical position in the parh0m2007 cluster).

localscope is a local-first MCP code analyst: it indexes a repository offline — tree-sitter symbols (WASM grammars, no LSP/daemon), references, import graph, optional local ONNX embeddings — and gives AI coding assistants tools for impact analysis ("where does X break if I change Y?"), line-precise find-all-usages, and go-to-definition. Zero network calls, zero telemetry, zero config; stdio by default. Also ships a terminal impact browser (`localscope explore`) that works without any AI client.

- Repo: https://github.com/parh0m2007/localscope
- npm: https://www.npmjs.com/package/localscope-mcp
- License: MIT · TypeScript · Node 18+ · CI on Linux/macOS/Windows

Happy to adjust wording, flags, or section if anything's off.
EOF
)
```

## Before opening the PR

- [ ] npm 0.4.3 published (OOM fix live — first impression matters)
- [ ] Check glama.ai has indexed localscope (badge link: https://glama.ai/mcp/servers/parh0m2007/localscope) — if not, use the no-badge variant
- [ ] Re-verify insertion point against the then-current main (the "p" cluster may have moved): `rg -n "paracetamol951|Perseus-Computing" README.md`

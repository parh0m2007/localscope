import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ImpactToolSchema,
  IndexToolSchema,
  SearchToolSchema,
  StatusToolSchema,
  ReferencesToolSchema,
  DefinitionToolSchema,
} from "../schemas/tools.js";
import type { RepoManager } from "../services/repo-manager.js";
import type { ImpactReport } from "../types.js";
import type { SearchHitInternal } from "../services/indexer.js";
import { CHARACTER_LIMIT } from "../constants.js";

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return `${text.slice(0, CHARACTER_LIMIT)}\n…(truncated; use a narrower query or lower limit)`;
}

function formatSearchHits(
  hits: readonly SearchHitInternal[],
  root: string,
  format: "markdown" | "json",
): string {
  if (format === "json") {
    return truncate(
      JSON.stringify(
        {
          total: hits.length,
          hits: hits.map((h) => ({
            file: path.relative(root, h.filePath),
            lines: `${h.startLine}-${h.endLine}`,
            symbol: h.symbolName,
            symbolKind: h.symbolKind,
            score: Number(h.score.toFixed(4)),
            matchedBy: h.matchedBy,
          })),
        },
        null,
        2,
      ),
    );
  }
  const lines: string[] = [`# Search results (${hits.length})`, ""];
  for (const hit of hits) {
    const rel = path.relative(root, hit.filePath);
    const symbol = hit.symbolName ? ` — ${hit.symbolName} (${hit.symbolKind})` : "";
    lines.push(`## ${rel}:${hit.startLine}${symbol}`);
    lines.push(`score ${hit.score.toFixed(3)} · matched by ${hit.matchedBy}`);
    lines.push("");
    lines.push("```");
    lines.push(hit.snippet);
    lines.push("```");
    lines.push("");
  }
  return truncate(lines.join("\n"));
}

function formatImpact(
  report: ImpactReport,
  root: string,
  format: "markdown" | "json",
): string {
  const rel = (p: string) => path.relative(root, p);
  if (format === "json") {
    return truncate(
      JSON.stringify(
        {
          target: report.targetKind === "file" ? rel(report.target) : report.target,
          targetKind: report.targetKind,
          directDependents: report.directDependents.map(rel),
          transitiveDependents: report.transitiveDependents.map(rel),
          totalFilesAffected: report.totalFilesAffected,
          symbolBreakages: report.symbolBreakages.map((b) => ({
            symbol: b.symbol,
            kind: b.kind,
            file: rel(b.filePath),
            line: b.line || undefined,
            reason: b.reason,
          })),
        },
        null,
        2,
      ),
    );
  }

  const lines: string[] = [];
  const title =
    report.targetKind === "file"
      ? `Impact of changing ${rel(report.target)}`
      : `Impact of changing ${report.target}`;
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Files affected: ${report.totalFilesAffected} (direct: ${report.directDependents.length}, transitive: ${report.transitiveDependents.length})`);
  lines.push("");

  if (report.directDependents.length > 0) {
    lines.push("## Direct dependents (break first)");
    for (const f of report.directDependents) lines.push(`- ${rel(f)}`);
    lines.push("");
  } else {
    lines.push("No direct dependents. This target is a leaf.");
    lines.push("");
  }

  if (report.transitiveDependents.length > 0) {
    lines.push("## Transitive dependents (may break indirectly)");
    for (const f of report.transitiveDependents) lines.push(`- ${rel(f)}`);
    lines.push("");
  }

  if (report.symbolBreakages.length > 0) {
    lines.push("## Symbols at risk");
    for (const b of report.symbolBreakages) {
      lines.push(
        `- **${b.symbol}** (${b.kind ?? "?"}) — ${rel(b.filePath)}${b.line ? `:${b.line}` : ""} — ${b.reason}`,
      );
    }
    lines.push("");
  }

  if (report.totalFilesAffected === 0) {
    lines.push(
      "Nothing references this target inside the index. Safe to change locally.",
    );
  }

  return truncate(lines.join("\n"));
}

export function registerTools(server: McpServer, manager: RepoManager): void {
  server.registerTool(
    "localscope_index",
    {
      title: "Index repository locally",
      description: `Build or refresh a local, private index of a repository: files, symbols (functions/classes/types), import graph, and optional embeddings. Zero network calls — the index never leaves the machine.

The index is persisted on disk and updated incrementally: repeated calls only re-extract files that changed since the last index (by mtime), and a file watcher keeps it fresh while the server runs.

Args:
  - path (string): repository root, default "."
  - max_files (number): safety cap, default 50000
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  File/chunk/symbol counts, update mode (fresh/incremental/restored), embedder mode (onnx or lexical), duration.

Use when: the user asks to index/analyze the codebase, or before localscope_search / localscope_impact on a repo not indexed yet in this session.`,
      inputSchema: IndexToolSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const root = await manager.resolveRoot(params.path);
        const started = Date.now();
        const outcome = await manager.index(root, params.max_files);
        const index = outcome.index;
        const durationMs = Date.now() - started;
        const summary = {
          root,
          mode: outcome.mode,
          files: index.files.length,
          chunks: index.chunks.length,
          symbols: index.symbols.length,
          changedFiles: outcome.changedFiles,
          addedFiles: outcome.addedFiles,
          removedFiles: outcome.removedFiles,
          embedder:
            index.embedder.type === "onnx"
              ? `onnx:${index.embedder.model} (semantic)`
              : `lexical (install @huggingface/transformers for semantic)`,
          durationMs,
        };
        const text =
          params.response_format === "json"
            ? JSON.stringify(summary, null, 2)
            : [
                `# Indexed ${path.basename(root) || root}`,
                "",
                `- Files: ${summary.files}`,
                `- Chunks: ${summary.chunks}`,
                `- Symbols: ${summary.symbols}`,
                `- Update: ${outcome.mode}${outcome.mode === "incremental" ? ` (+${outcome.addedFiles} added, ~${outcome.changedFiles} changed, -${outcome.removedFiles} removed)` : ""}`,
                `- Embedder: ${summary.embedder}`,
                `- Took: ${durationMs}ms`,
                "",
                "Index is local-only. No code left this machine.",
              ].join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: summary,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}. Check the path is a directory inside this machine.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "localscope_search",
    {
      title: "Search code semantically",
      description: `Search the local index for code or docs by meaning, symbol name, or fragment. Combines embeddings (if installed) with lexical identifier matching — all offline.

Args:
  - query (string): what to find, e.g. "retry with backoff", "parseConfig", "where do we validate webhooks"
  - path (string): repo root previously indexed, default "."
  - limit (number): max results 1-100, default 20
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  Hits with file, line range, symbol, score, snippet, and how it matched (semantic/lexical/symbol).

Use when: "where is X handled?", "find code that does Y". If the repo was indexed in a previous session, the persisted index is loaded automatically — no re-index needed.`,
      inputSchema: SearchToolSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const root = await manager.resolveRoot(params.path);
        const hits = await manager.search(root, params.query, params.limit);
        const text = formatSearchHits(hits, root, params.response_format);
        return {
          content: [{ type: "text", text }],
          structuredContent: {
            total: hits.length,
            hits: hits.map((h) => ({
              file: path.relative(root, h.filePath),
              startLine: h.startLine,
              endLine: h.endLine,
              symbol: h.symbolName,
              score: Number(h.score.toFixed(4)),
              matchedBy: h.matchedBy,
            })),
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "localscope_impact",
    {
      title: "Analyze change impact",
      description: `Answer "where does X break if I change Y?" from the local import graph and symbol table — entirely offline.

Args:
  - target (string): file path relative to repo root (e.g. 'src/utils/parse.ts') OR a symbol name (e.g. 'parseConfig')
  - path (string): repo root previously indexed, default "."
  - max_depth (number): reverse-dependency walk depth 1-10, default 5
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  Direct dependents (files importing the target), transitive dependents, and exported symbols at risk.

Use when: "what breaks if I refactor/delete this?", "who uses this function?". If the repo was indexed in a previous session, the persisted index is loaded automatically.`,
      inputSchema: ImpactToolSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const root = await manager.resolveRoot(params.path);
        const report = await manager.impact(root, params.target, params.max_depth);
        const text = formatImpact(report, root, params.response_format);
        return {
          content: [{ type: "text", text }],
          structuredContent: {
            target: params.target,
            targetKind: report.targetKind,
            directDependents: report.directDependents.map((p) =>
              path.relative(root, p),
            ),
            transitiveDependents: report.transitiveDependents.map((p) =>
              path.relative(root, p),
            ),
            totalFilesAffected: report.totalFilesAffected,
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "localscope_status",
    {
      title: "Show index status",
      description: `Show whether a repository root has a local index, its stats (files/chunks/symbols), and the active embedder mode. Read-only, offline.

Args:
  - path (string): repo root, default "."
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  Indexed state, counts, embedder mode, indexedAt timestamp.`,
      inputSchema: StatusToolSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const root = await manager.resolveRoot(params.path);
        const status = await manager.status(root);
        const text =
          params.response_format === "json"
            ? JSON.stringify(status, null, 2)
            : [
                `# localscope status`,
                "",
                ...Object.entries(status).map(
                  ([k, v]) => `- **${k}**: ${String(v)}`,
                ),
              ].join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: status,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "localscope_references",
    {
      title: "Find symbol call sites",
      description: `Find every call site and read of a symbol across the repo, with exact line numbers — a local "find all usages". Works from the AST reference graph, entirely offline.

Args:
  - symbol (string): symbol name, e.g. "parseConfig"
  - path (string): repo root previously indexed, default "."
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  Files that use the symbol, with line numbers per file and total count.

Use when: "where is X called?", "show me all usages of X". Requires localscope_index first.`,
      inputSchema: ReferencesToolSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const root = await manager.resolveRoot(params.path);
        const uses = await manager.references(root, params.symbol);
        if (uses.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No references to '${params.symbol}' in the index. Check the name, or re-index if the codebase changed.`,
              },
            ],
          };
        }
        const total = uses.reduce((sum, u) => sum + u.count, 0);
        const text =
          params.response_format === "json"
            ? JSON.stringify(
                {
                  symbol: params.symbol,
                  total,
                  files: uses.map((u) => ({
                    file: path.relative(root, u.filePath),
                    lines: u.lines,
                    count: u.count,
                  })),
                },
                null,
                2,
              )
            : [
                `# ${params.symbol} — ${total} reference${total === 1 ? "" : "s"} in ${uses.length} file${uses.length === 1 ? "" : "s"}`,
                "",
                ...uses.map(
                  (u) =>
                    `- ${path.relative(root, u.filePath)}:${u.lines.join(", ")} (${u.count}×)`,
                ),
              ].join("\n");
        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: {
            symbol: params.symbol,
            total,
            files: uses.map((u) => ({
              file: path.relative(root, u.filePath),
              lines: u.lines,
              count: u.count,
            })),
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "localscope_definition",
    {
      title: "Locate symbol definition",
      description: `Find where a symbol is defined: file, line span, kind, and whether it is exported. A local "go to definition". Entirely offline.

Args:
  - symbol (string): symbol name, e.g. "parseConfig"
  - path (string): repo root previously indexed, default "."
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  Definition sites (usually one; more if the name is defined in several files).

Use when: "where is X defined?", "show me the definition of X". Requires localscope_index first.`,
      inputSchema: DefinitionToolSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const root = await manager.resolveRoot(params.path);
        const defs = await manager.definition(root, params.symbol);
        if (defs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `'${params.symbol}' is not defined in the index. Check the name, or re-index if the codebase changed.`,
              },
            ],
          };
        }
        const text =
          params.response_format === "json"
            ? JSON.stringify(
                {
                  symbol: params.symbol,
                  definitions: defs.map((d) => ({
                    file: path.relative(root, d.filePath),
                    line: d.line,
                    endLine: d.endLine,
                    kind: d.kind,
                    exported: d.exported,
                  })),
                },
                null,
                2,
              )
            : [
                `# ${params.symbol}`,
                "",
                ...defs.map(
                  (d) =>
                    `- ${path.relative(root, d.filePath)}:${d.line}-${d.endLine} — ${d.kind}${d.exported ? " (exported)" : ""}`,
                ),
              ].join("\n");
        return {
          content: [{ type: "text", text: truncate(text) }],
          structuredContent: {
            symbol: params.symbol,
            definitions: defs.map((d) => ({
              file: path.relative(root, d.filePath),
              line: d.line,
              endLine: d.endLine,
              kind: d.kind,
              exported: d.exported,
            })),
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

export { z };

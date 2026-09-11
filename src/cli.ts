import * as path from "node:path";
import { RepoManager } from "./services/repo-manager.js";
import { runExplore } from "./tui/explore.js";
import { plainImpactReport, plainIndexSummary } from "./tui/report.js";
import { analyzeFileImpact, analyzeSymbolImpact } from "./services/impact.js";

export async function runCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags.set(arg.slice(2), next);
        i++;
      } else {
        flags.set(arg.slice(2), "true");
      }
    }
  }
  const repoPath = path.resolve(flags.get("path") ?? process.cwd());

  const manager = new RepoManager();

  try {
    if (command === "explore") {
      await runExplore(manager, repoPath);
      return 0;
    }

    if (command === "report") {
      const target = flags.get("target");
      if (!target) {
        console.error(
          "usage: localscope report --target <symbol-or-file> [--path <repo>]",
        );
        return 2;
      }

      const root = await manager.resolveRoot(repoPath);
      const index = await manager.ensureIndex(root);
      if (!index) {
        console.error(
          `No index for ${root}. Run 'localscope explore' once, or localscope_index in MCP.`,
        );
        return 1;
      }

      let report;
      const asFile = path.isAbsolute(target)
        ? target
        : path.resolve(root, target);
      if (index.files.some((f) => f.filePath === asFile)) {
        report = analyzeFileImpact(index, asFile, { maxDepth: 5 });
      } else {
        report = analyzeSymbolImpact(index, target, { maxDepth: 5 });
      }

      for (const line of plainImpactReport(report, root)) {
        console.log(line);
      }
      return 0;
    }

    if (command === "index") {
      const root = await manager.resolveRoot(repoPath);
      const started = Date.now();
      const outcome = await manager.index(root, 50_000);
      for (const line of plainIndexSummary({
        files: outcome.index.files.length,
        symbols: outcome.index.symbols.length,
        references: outcome.index.references.length,
        astActive: outcome.index.astActive,
        durationMs: Date.now() - started,
      })) {
        console.log(line);
      }
      return 0;
    }
  } finally {
    manager.close();
  }

  console.error(
    [
      "localscope — local code analyst",
      "",
      "  localscope explore             interactive impact browser",
      "  localscope report --target X   impact report to stdout (pipe-friendly)",
      "  localscope index               build or refresh the local index",
      "",
      "Options: --path <repo> (default: current directory)",
    ].join("\n"),
  );
  return command === "help" || command === undefined ? 0 : 2;
}

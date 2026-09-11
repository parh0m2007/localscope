#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RepoManager } from "./services/repo-manager.js";
import { registerTools } from "./tools/register.js";
import { runCli } from "./cli.js";

const VERSION = "0.4.0";

async function main(): Promise<void> {
  // CLI passthrough: `localscope-mcp explore`, `report`, `index` run the
  // local tools; anything else (including no args) starts the MCP server.
  const argv = process.argv.slice(2);
  const cliCommands = new Set(["explore", "report", "index", "help"]);
  if (argv.length > 0 && cliCommands.has(argv[0])) {
    // Set the exit code and return rather than hard-exiting: optional
    // native deps (onnxruntime) own worker threads that crash on
    // process.exit() while holding locks.
    process.exitCode = await runCli(argv);
    return;
  }

  const server = new McpServer({
    name: "localscope-mcp",
    version: VERSION,
  });

  const manager = new RepoManager();
  registerTools(server, manager);

  const transportMode = process.env.LOCALSCOPE_TRANSPORT ?? "stdio";

  if (transportMode === "http") {
    const { startHttp } = await import("./http.js");
    const port = Number(process.env.LOCALSCOPE_PORT ?? 3000);
    await startHttp(server, port);
    console.error(`localscope-mcp ${VERSION} listening on http://127.0.0.1:${port}/mcp`);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const shutdown = (): void => {
    manager.close();
    void server.close();
  };
  process.once("exit", shutdown);
  process.once("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });
  console.error(`localscope-mcp ${VERSION} ready (stdio, local-only)`);
}

main().catch((error: unknown) => {
  console.error("fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});

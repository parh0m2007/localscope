#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RepoManager } from "./services/repo-manager.js";
import { registerTools } from "./tools/register.js";

const VERSION = "0.1.1";

const server = new McpServer({
  name: "localscope-mcp",
  version: VERSION,
});

const manager = new RepoManager();
registerTools(server, manager);

async function main(): Promise<void> {
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
  console.error(`localscope-mcp ${VERSION} ready (stdio, local-only)`);
}

main().catch((error: unknown) => {
  console.error("fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});

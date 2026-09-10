import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RepoManager } from "../src/services/repo-manager.js";
import { registerTools } from "../src/tools/register.js";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "fixtures/sample");

async function setup(): Promise<Client> {
  const server = new McpServer({ name: "localscope-test", version: "0.1.0" });
  const manager = new RepoManager();
  registerTools(server, manager);

  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);

  const clientSide = new Client({ name: "test-client", version: "0.1.0" });
  await clientSide.connect(client);
  return clientSide;
}

describe("MCP tools integration", () => {
  it("lists all four localscope tools", async () => {
    const client = await setup();
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "localscope_index",
        "localscope_search",
        "localscope_impact",
        "localscope_status",
      ]),
    );
  });

  it("index → search → impact workflow via MCP", async () => {
    const client = await setup();

    const indexed = await client.callTool({
      name: "localscope_index",
      arguments: { path: ROOT, response_format: "json" },
    });
    expect(indexed.content[0]).toMatchObject({ type: "text" });
    const text = (indexed.content[0] as { text: string }).text;
    const parsedIndex = JSON.parse(text) as {
      files: number;
      symbols: number;
    };
    expect(parsedIndex.files).toBeGreaterThan(0);
    expect(parsedIndex.symbols).toBeGreaterThan(0);

    const search = await client.callTool({
      name: "localscope_search",
      arguments: { query: "parseConfig", path: ROOT, response_format: "json" },
    });
    const searchText = (search.content[0] as { text: string }).text;
    expect(searchText).toContain("parseConfig");

    const impact = await client.callTool({
      name: "localscope_impact",
      arguments: {
        target: "src/utils/config.ts",
        path: ROOT,
        response_format: "json",
      },
    });
    const impactText = (impact.content[0] as { text: string }).text;
    const parsed = JSON.parse(impactText) as {
      directDependents: string[];
      totalFilesAffected: number;
    };
    expect(parsed.totalFilesAffected).toBe(2);
    expect(parsed.directDependents.length).toBe(2);

    const status = await client.callTool({
      name: "localscope_status",
      arguments: { path: ROOT, response_format: "json" },
    });
    const statusText = (status.content[0] as { text: string }).text;
    const parsedStatus = JSON.parse(statusText) as { indexed: boolean };
    expect(parsedStatus.indexed).toBe(true);
  });

  it("returns isError for bad path", async () => {
    const client = await setup();
    const result = await client.callTool({
      name: "localscope_index",
      arguments: { path: "/definitely/not/a/real/dir" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/error/i);
  });
});

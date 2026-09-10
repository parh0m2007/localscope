import { describe, expect, it } from "vitest";
import { RepoManager } from "../src/services/repo-manager.js";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "fixtures/sample");

describe("RepoManager", () => {
  it("resolveRoot accepts relative fixture path", async () => {
    const manager = new RepoManager();
    const root = await manager.resolveRoot(ROOT);
    expect(root).toBe(ROOT);
  });

  it("resolveRoot rejects missing directory", async () => {
    const manager = new RepoManager();
    await expect(
      manager.resolveRoot(path.join(ROOT, "does-not-exist")),
    ).rejects.toThrow(/not found/i);
  });

  it("full flow: index → status → search → impact", async () => {
    const manager = new RepoManager();

    const statusBefore = manager.status(ROOT);
    expect(statusBefore.indexed).toBe(false);

    const index = await manager.index(ROOT, 1000);
    expect(index.files.length).toBeGreaterThan(0);

    const status = manager.status(ROOT) as Record<string, unknown>;
    expect(status.indexed).toBe(true);
    expect(status.symbols).toBeGreaterThan(0);

    const hits = await manager.search(ROOT, "parseConfig", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.symbolName).toBe("parseConfig");

    const report = manager.impact(
      ROOT,
      "src/utils/config.ts",
      5,
    );
    expect(report.directDependents.length).toBe(2);

    const symbolReport = manager.impact(ROOT, "parseConfig", 5);
    expect(symbolReport.targetKind).toBe("symbol");
  });

  it("impact on unknown target throws with suggestions", async () => {
    const manager = new RepoManager();
    await manager.index(ROOT, 1000);
    expect(() => manager.impact(ROOT, "nonexistentThing", 5)).toThrow(
      /not found|Did you mean/i,
    );
  });

  it("search without index throws actionable error", async () => {
    const manager = new RepoManager();
    await expect(manager.search(ROOT, "test", 5)).rejects.toThrow(
      /localscope_index first/,
    );
  });
});

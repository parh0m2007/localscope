import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { RepoManager } from "../src/services/repo-manager.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

const ROOT = path.resolve(__dirname, "fixtures/sample");

let cacheDir: string;

beforeAll(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "localscope-rm-cache-"));
  process.env.LOCALSCOPE_CACHE_DIR = cacheDir;
});

afterAll(async () => {
  delete process.env.LOCALSCOPE_CACHE_DIR;
  await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("RepoManager", () => {
  it("resolveRoot accepts relative fixture path", async () => {
    const manager = new RepoManager();
    const root = await manager.resolveRoot(ROOT);
    expect(root).toBe(ROOT);
    manager.close();
  });

  it("resolveRoot rejects missing directory", async () => {
    const manager = new RepoManager();
    await expect(
      manager.resolveRoot(path.join(ROOT, "does-not-exist")),
    ).rejects.toThrow(/not found/i);
    manager.close();
  });

  it("full flow: index → status → search → impact", async () => {
    const manager = new RepoManager();

    const statusBefore = await manager.status(ROOT);
    expect(statusBefore.indexed).toBe(false);

    const outcome = await manager.index(ROOT, 1000);
    expect(outcome.index.files.length).toBeGreaterThan(0);

    const status = (await manager.status(ROOT)) as Record<string, unknown>;
    expect(status.indexed).toBe(true);
    expect(status.symbols).toBeGreaterThan(0);

    const hits = await manager.search(ROOT, "parseConfig", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.symbolName).toBe("parseConfig");

    const report = await manager.impact(
      ROOT,
      "src/utils/config.ts",
      5,
    );
    expect(report.directDependents.length).toBe(2);

    const symbolReport = await manager.impact(ROOT, "parseConfig", 5);
    expect(symbolReport.targetKind).toBe("symbol");

    manager.close();
  });

  it("impact on unknown target throws with suggestions", async () => {
    const manager = new RepoManager();
    await manager.index(ROOT, 1000);
    await expect(manager.impact(ROOT, "nonexistentThing", 5)).rejects.toThrow(
      /not found|Did you mean/i,
    );
    manager.close();
  });

  it("search without index throws actionable error", async () => {
    const neverIndexed = await fs.mkdtemp(
      path.join(os.tmpdir(), "localscope-empty-"),
    );
    try {
      const manager = new RepoManager();
      await expect(
        manager.search(neverIndexed, "test", 5),
      ).rejects.toThrow(/localscope_index first/);
      manager.close();
    } finally {
      await fs.rm(neverIndexed, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });
});

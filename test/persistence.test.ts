import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RepoManager } from "../src/services/repo-manager.js";
import {
  loadIndex,
  saveIndex,
  cacheFilePath,
  clearCache,
} from "../src/services/persister.js";
import { buildIndex } from "../src/services/indexer.js";
import { lexicalEmbedder } from "../src/services/embedder.js";
import { clearGitignoreCache } from "../src/services/walker.js";

let tmpRoot: string;
let cacheDir: string;

const SAMPLE = path.resolve(__dirname, "fixtures/sample");

async function makeTmpRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "localscope-test-"));
  await fs.mkdir(path.join(dir, "src/utils"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "src/utils/config.ts"),
    [
      "export interface AppConfig {",
      "  timeoutMs: number;",
      "}",
      "",
      "export function parseConfig(raw: string): AppConfig {",
      "  return { timeoutMs: JSON.parse(raw).timeoutMs ?? 5000 };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "src/main.ts"),
    [
      'import { parseConfig } from "./utils/config.js";',
      "",
      "export function boot(raw: string): void {",
      "  const cfg = parseConfig(raw);",
      "  console.log(cfg.timeoutMs);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return dir;
}

beforeAll(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "localscope-cache-"));
  process.env.LOCALSCOPE_CACHE_DIR = cacheDir;
  clearGitignoreCache();
});

afterAll(async () => {
  delete process.env.LOCALSCOPE_CACHE_DIR;
  await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("persister", () => {
  it("save + load round-trips the index", async () => {
    const index = await buildIndex({
      rootDir: SAMPLE,
      embedder: lexicalEmbedder,
    });
    await saveIndex(index);

    const result = await loadIndex(SAMPLE);
    expect(result.loaded).toBe(true);
    if (!result.loaded) throw new Error("unreachable");
    expect(result.index.rootDir).toBe(index.rootDir);
    expect(result.index.files.length).toBe(index.files.length);
    expect(result.index.chunks.length).toBe(index.chunks.length);
    expect(result.index.symbols.length).toBe(index.symbols.length);
    expect(result.index.indexedAt).toBe(index.indexedAt);

    const configPath = path.join(SAMPLE, "src/utils/config.ts");
    expect(result.index.fileGraph.get(configPath)?.importedBy.length).toBe(2);
    const names = result.index.symbols.map((s) => s.name);
    expect(names).toContain("parseConfig");
  });

  it("load on missing cache returns missing", async () => {
    const result = await loadIndex("/definitely/not/a/repo");
    expect(result).toEqual({ loaded: false, reason: "missing" });
  });

  it("load on corrupt cache returns corrupt", async () => {
    const index = await buildIndex({
      rootDir: SAMPLE,
      embedder: lexicalEmbedder,
    });
    await saveIndex(index);
    await fs.writeFile(cacheFilePath(SAMPLE), "{not json", "utf8");
    const result = await loadIndex(SAMPLE);
    expect(result).toEqual({ loaded: false, reason: "corrupt" });
  });

  it("clearCache removes the persisted file", async () => {
    const index = await buildIndex({
      rootDir: SAMPLE,
      embedder: lexicalEmbedder,
    });
    await saveIndex(index);
    await clearCache(SAMPLE);
    const result = await loadIndex(SAMPLE);
    expect(result).toEqual({ loaded: false, reason: "missing" });
  });
});

describe("incremental updates", () => {
  it("index() fresh then incremental after a file change", async () => {
    tmpRoot = await makeTmpRepo();
    const manager = new RepoManager();

    const fresh = await manager.index(tmpRoot, 1000);
    expect(fresh.mode).toBe("fresh");
    expect(fresh.index.symbols.map((s) => s.name)).toContain("parseConfig");

    const persisted = await loadIndex(tmpRoot);
    expect(persisted.loaded).toBe(true);

    // Change config.ts: rename parseConfig -> loadConfig
    await fs.writeFile(
      path.join(tmpRoot, "src/utils/config.ts"),
      [
        "export interface AppConfig {",
        "  timeoutMs: number;",
        "}",
        "",
        "export function loadConfig(raw: string): AppConfig {",
        "  return { timeoutMs: JSON.parse(raw).timeoutMs ?? 5000 };",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const second = await manager.index(tmpRoot, 1000);
    expect(second.mode).toBe("incremental");
    expect(second.changedFiles).toBe(1);
    expect(second.index.symbols.map((s) => s.name)).toContain("loadConfig");
    expect(
      second.index.symbols.map((s) => s.name),
    ).not.toContain("parseConfig");

    manager.close();
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("a new RepoManager instance restores the persisted index", async () => {
    tmpRoot = await makeTmpRepo();
    const first = new RepoManager();
    await first.index(tmpRoot, 1000);
    first.close();

    const second = new RepoManager();
    const restored = await second.ensureIndex(tmpRoot);
    expect(restored).toBeDefined();
    expect(restored?.symbols.map((s) => s.name)).toContain("parseConfig");
    second.close();

    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("search works from a restored index without explicit re-index", async () => {
    tmpRoot = await makeTmpRepo();
    const first = new RepoManager();
    await first.index(tmpRoot, 1000);
    first.close();

    const second = new RepoManager();
    const hits = await second.search(tmpRoot, "parseConfig", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.symbolName).toBe("parseConfig");
    second.close();

    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });
});

describe("watcher", () => {
  it("triggers a background reindex when a file changes", async () => {
    tmpRoot = await makeTmpRepo();
    const manager = new RepoManager();
    const outcome = await manager.index(tmpRoot, 1000);
    expect(outcome.mode).toBe("fresh");
    expect(manager.status(tmpRoot) instanceof Promise).toBe(true);

    // status is async now; verify watching flag
    const status = (await manager.status(tmpRoot)) as Record<string, unknown>;
    expect(status.watching).toBe(true);

    // Trigger a change and wait for the debounce + background update.
    await fs.writeFile(
      path.join(tmpRoot, "src/utils/config.ts"),
      [
        "export interface AppConfig {",
        "  timeoutMs: number;",
        "}",
        "",
        "export function loadConfig(raw: string): AppConfig {",
        "  return { timeoutMs: JSON.parse(raw).timeoutMs ?? 5000 };",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const updated = manager.getIndex(tmpRoot);
    expect(updated).toBeDefined();
    expect(updated?.symbols.map((s) => s.name)).toContain("loadConfig");

    manager.close();
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });
});

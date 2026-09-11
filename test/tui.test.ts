import { describe, expect, it } from "vitest";
import { decodeKeys } from "../src/tui/terminal.js";
import {
  buildCandidates,
  filterCandidates,
  matchPositions,
} from "../src/tui/candidates.js";
import { plainImpactReport } from "../src/tui/report.js";
import { buildIndex } from "../src/services/indexer.js";
import { lexicalEmbedder } from "../src/services/embedder.js";
import { analyzeSymbolImpact } from "../src/services/impact.js";
import * as path from "node:path";
import { clearGitignoreCache } from "../src/services/walker.js";

const SAMPLE = path.resolve(__dirname, "fixtures/sample");

describe("key decoding", () => {
  it("decodes printable runs as one text event", () => {
    const events = decodeKeys(Buffer.from("par", "utf8"));
    expect(events).toEqual([{ kind: "printable", text: "par" }]);
  });

  it("decodes arrows, enter, backspace, ctrl-c", () => {
    expect(decodeKeys(Buffer.from([0x1b, 0x5b, 0x41]))).toEqual([{ kind: "up" }]);
    expect(decodeKeys(Buffer.from([0x1b, 0x5b, 0x42]))).toEqual([{ kind: "down" }]);
    expect(decodeKeys(Buffer.from([0x0d]))).toEqual([{ kind: "enter" }]);
    expect(decodeKeys(Buffer.from([0x7f]))).toEqual([{ kind: "backspace" }]);
    expect(decodeKeys(Buffer.from([0x03]))).toEqual([{ kind: "interrupt" }]);
  });

  it("decodes bare escape", () => {
    expect(decodeKeys(Buffer.from([0x1b]))).toEqual([{ kind: "escape" }]);
  });

  it("skips unknown CSI sequences without misreading the next key", () => {
    // ESC [ 2 0 0 ~ then Enter
    const events = decodeKeys(Buffer.from([0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e, 0x0d]));
    expect(events).toEqual([{ kind: "enter" }]);
  });
});

describe("candidate filtering", () => {
  it("ranks exact, prefix, then subsequence matches in order", () => {
    const mk = (name: string) => ({
      name,
      detail: "",
      kind: "symbol" as const,
      impact: () => {
        throw new Error("unused");
      },
    });
    const ranked = filterCandidates(
      [mk("configParser"), mk("parseConfig"), mk("parseConfigDeep"), mk("zebra")],
      "parseconfig",
      10,
    );
    expect(ranked.map((c) => c.name)).toEqual([
      "parseConfig",
      "parseConfigDeep",
    ]);
    // zebra and configParser (subsequence fails: 'p' after 'g' has no 'a')
    // don't match at all.
  });

  it("empty query returns the first candidates unfiltered", () => {
    const mk = (name: string) => ({
      name,
      detail: "",
      kind: "symbol" as const,
      impact: () => {
        throw new Error("unused");
      },
    });
    const ranked = filterCandidates([mk("a"), mk("b")], "", 10);
    expect(ranked.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("match positions mark the subsequence chars", () => {
    const positions = matchPositions("parseConfig", "pc");
    expect([...positions]).toEqual([0, 5]);
  });
});

describe("candidate building", () => {
  it("offers exported symbols and repo files", async () => {
    clearGitignoreCache();
    const index = await buildIndex({
      rootDir: SAMPLE,
      embedder: lexicalEmbedder,
    });
    const candidates = buildCandidates(index, SAMPLE);
    const names = candidates.map((c) => c.name);
    expect(names).toContain("parseConfig");
    expect(names).toContain("src/utils/config.ts");
    expect(names).toContain("src/main.ts");
    // non-exported symbols are not candidates
    expect(names).not.toContain("server");
  });
});

describe("plain report", () => {
  it("renders impact without ANSI codes", async () => {
    clearGitignoreCache();
    const index = await buildIndex({
      rootDir: SAMPLE,
      embedder: lexicalEmbedder,
    });
    const report = analyzeSymbolImpact(index, "parseConfig", { maxDepth: 5 });
    const lines = plainImpactReport(report, SAMPLE);
    const text = lines.join("\n");
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\x1b\[/);
    expect(text).toContain("Impact of changing parseConfig");
    expect(text).toContain("src/main.ts");
    expect(text).toContain("src/services/server.ts");
  });
});

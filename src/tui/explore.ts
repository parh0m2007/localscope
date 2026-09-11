import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ImpactReport } from "../types.js";
import type { RepoManager } from "../services/repo-manager.js";
import {
  bold,
  dim,
  enterAltScreen,
  exitAltScreen,
  homeClear,
  inverse,
} from "./styles.js";
import {
  buildCandidates,
  filterCandidates,
  matchPositions,
  type ExploreCandidate,
} from "./candidates.js";
import {
  decodeKeys,
  isInteractive,
  setRawMode,
  terminalSize,
} from "./terminal.js";

const MAX_VISIBLE = 12;

interface ExploreState {
  query: string;
  cursor: number;
  view: "search" | "impact";
  candidates: ExploreCandidate[];
  report: ImpactReport | null;
  reportRoot: string;
  scroll: number;
  notice: string | null;
  /** Cursor over the "Breaks first" file list in the impact view. */
  victimCursor: number;
}

export async function runExplore(
  manager: RepoManager,
  rootDir: string,
): Promise<void> {
  if (!isInteractive()) {
    throw new Error(
      "explore needs an interactive terminal. Pipe mode: localscope report --target <name>",
    );
  }

  // First run: build the index right here — explore should never demand a
  // prerequisite; it loads a persisted one if it exists, otherwise builds.
  let index = await manager.ensureIndex(rootDir);
  if (!index) {
    process.stderr.write("Indexing for the first time…\n");
    const outcome = await manager.index(rootDir, 50_000);
    index = outcome.index;
  }

  const allCandidates = buildCandidates(index, rootDir);
  const state: ExploreState = {
    query: "",
    cursor: 0,
    view: "search",
    candidates: filterCandidates(allCandidates, "", 200),
    report: null,
    reportRoot: rootDir,
    scroll: 0,
    notice: null,
    victimCursor: 0,
  };

  const raw = setRawMode();
  process.stdout.write(enterAltScreen);
  render(state);

  let suspended = false;

  const dataListener = (chunk: Buffer): void => {
    if (suspended) return;
    for (const key of decodeKeys(chunk)) {
      const done = handleKey(state, key, allCandidates, {
        openInEditor: (filePath, line) =>
          openInEditor(filePath, line, {
            suspend: () => {
              suspended = true;
            },
            resume: () => {
              suspended = false;
            },
          }),
      });
      if (done) {
        cleanup();
        process.exit(0);
      }
    }
    render(state);
  };
  process.stdin.on("data", dataListener);

  const offResize = () => process.stdout.off("resize", resizeListener);
  const resizeListener = (): void => {
    if (!suspended) render(state);
  };
  process.stdout.on("resize", resizeListener);

  const cleanup = (): void => {
    process.stdin.off("data", dataListener);
    offResize();
    raw?.restore();
    process.stdout.write(exitAltScreen);
  };

  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

/**
 * Open a file in $EDITOR (Vim/VS Code/etc.) at a line. Leaves the alt
 * screen while the editor runs, then returns and lets the caller redraw.
 */
async function openInEditor(
  filePath: string,
  line: number,
  hooks: { suspend: () => void; resume: () => void },
): Promise<void> {
  const editorCommand = process.env.EDITOR || process.env.VISUAL || "vi";
  const editor = path.basename(editorCommand.split(" ")[0] ?? "vi");
  const at = Math.max(1, line);

  // Line-argument convention per editor family.
  const args: string[] = [];
  if (/^(vi|vim|nvim|view)$/.test(editor)) {
    args.push(`+${at}`, filePath);
  } else if (editor === "emacs" || editor === "emacsclient") {
    args.push(`+${at}`, filePath);
  } else if (editor === "nano") {
    args.push(`+${at}`, filePath);
  } else if (editor === "code" || editor === "code-insiders") {
    args.push("--goto", `${filePath}:${at}`, "--wait");
  } else if (editor === "cursor" || editor === "zed") {
    args.push(`${filePath}:${at}`, "--wait");
  } else if (editor === "subl") {
    args.push(`${filePath}:${at}`, "--wait");
  } else {
    // Unknown editor: safest common form is vim's +line — widely honored.
    args.push(`+${at}`, filePath);
  }

  hooks.suspend();
  process.stdout.write(exitAltScreen);

  const child = spawn(editorCommand, args, {
    stdio: "inherit",
    shell: false,
  });
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });

  process.stdout.write(enterAltScreen);
  hooks.resume();
}

function handleKey(
  state: ExploreState,
  key: ReturnType<typeof decodeKeys>[number],
  allCandidates: readonly ExploreCandidate[],
  hooks: { openInEditor: (filePath: string, line: number) => Promise<void> },
): boolean {
  switch (key.kind) {
    case "interrupt":
    case "escape":
      if (state.view === "impact") {
        state.view = "search";
        state.scroll = 0;
        state.notice = null;
        return false;
      }
      return true;
    case "enter": {
      if (state.view === "impact") {
        // Enter in the impact view opens the highlighted victim, like `o`.
        void openVictim(state, hooks);
        return false;
      }
      const selected = state.candidates[state.cursor];
      if (!selected) return false;
      try {
        state.report = selected.impact();
        state.view = "impact";
        state.scroll = 0;
        state.victimCursor = 0;
        state.notice = null;
      } catch (error) {
        state.notice = error instanceof Error ? error.message : String(error);
      }
      return false;
    }
    case "printable": {
      const text = key.text.toLowerCase();
      if (state.view === "impact" && (text === "o" || text === "oo")) {
        void openVictim(state, hooks);
        return false;
      }
      if (state.view === "impact") return false;
      state.query += key.text;
      state.cursor = 0;
      refreshCandidates(state, allCandidates);
      return false;
    }
    case "backspace":
      if (state.view === "impact") return false;
      state.query = state.query.slice(0, -1);
      state.cursor = 0;
      refreshCandidates(state, allCandidates);
      return false;
    case "up":
      if (state.view === "impact") {
        state.victimCursor = Math.max(0, state.victimCursor - 1);
      } else {
        state.cursor = Math.max(0, state.cursor - 1);
      }
      return false;
    case "down":
      if (state.view === "impact") {
        const max = victimCount(state) - 1;
        state.victimCursor = Math.min(max, state.victimCursor + 1);
      } else {
        state.cursor = Math.min(
          state.candidates.length - 1,
          state.cursor + 1,
        );
      }
      return false;
    default:
      return false;
  }
}

function victimCount(state: ExploreState): number {
  return state.report ? state.report.directDependents.length : 0;
}

function currentVictim(
  state: ExploreState,
): { filePath: string; line: number } | null {
  if (!state.report) return null;
  const file = state.report.directDependents[state.victimCursor];
  if (!file) return null;
  const breakage = state.report.symbolBreakages.find(
    (b) => b.filePath === file && b.line > 0,
  );
  return { filePath: file, line: breakage?.line ?? 1 };
}

async function openVictim(
  state: ExploreState,
  hooks: { openInEditor: (filePath: string, line: number) => Promise<void> },
): Promise<void> {
  const victim = currentVictim(state);
  if (!victim) return;
  try {
    await hooks.openInEditor(victim.filePath, victim.line);
  } catch (error) {
    state.notice = error instanceof Error ? error.message : String(error);
  }
}

function refreshCandidates(state: ExploreState, all: readonly ExploreCandidate[]): void {
  state.candidates = filterCandidates(all, state.query, 200);
}

function render(state: ExploreState): void {
  const size = terminalSize();
  const out: string[] = [];

  const rel = (p: string): string => path.relative(state.reportRoot, p);

  if (state.view === "search") {
    out.push(renderPrompt(state, size.cols));
    out.push("");
    const visible = state.candidates.slice(0, MAX_VISIBLE);
    if (visible.length === 0) {
      out.push(dim("  Nothing matches. Try fewer characters."));
      out.push("");
    }
    visible.forEach((candidate, i) => {
      const selected = i === state.cursor;
      const positions = matchPositions(candidate.name, state.query);
      const highlighted = highlightMatch(candidate.name, positions);
      const line = `  ${highlighted}  ${dim(candidate.detail)}`;
      out.push(selected ? inverse(pad(line, size.cols)) : line);
    });
    if (state.candidates.length > MAX_VISIBLE) {
      out.push(
        dim(`  … ${state.candidates.length - MAX_VISIBLE} more (keep typing to narrow)`),
      );
    }
  } else if (state.report) {
    const report = state.report;
    const target =
      report.targetKind === "file" ? rel(report.target) : report.target;
    out.push(bold(`Impact of changing ${target}`));
    out.push(
      `${report.totalFilesAffected} files affected · ${report.directDependents.length} direct · ${report.transitiveDependents.length} transitive`,
    );
    out.push("");

    if (report.directDependents.length > 0) {
      out.push(bold("Breaks first"));
      report.directDependents.forEach((f, i) => {
        const line = `  ${rel(f)}`;
        if (i === state.victimCursor) {
          out.push(inverse(pad(line, size.cols)));
        } else {
          out.push(line);
        }
      });
    } else {
      out.push("Nothing references this target. Safe to change.");
    }

    if (report.transitiveDependents.length > 0) {
      out.push("");
      out.push(dim("May break indirectly"));
      const tree = report.transitiveDependents;
      tree.forEach((f, i) => {
        const branch = i + 1 < tree.length ? "├──" : "└──";
        out.push(dim(`  ${branch} ${rel(f)}`));
      });
    }

    if (report.symbolBreakages.length > 0) {
      out.push("");
      out.push(bold("Why"));
      const list = report.symbolBreakages;
      list.forEach((b, i) => {
        const branch = i + 1 < list.length ? "├──" : "└──";
        const where = `${rel(b.filePath)}${b.line ? `:${b.line}` : ""}`;
        out.push(`  ${branch} ${b.symbol} ${dim(`(${b.kind ?? "?"}) ${where} — ${b.reason}`)}`);
      });
    }

    out.push("");
    const openHint =
      report.directDependents.length > 0
        ? " · enter/o opens it in your editor"
        : "";
    out.push(dim(`Esc back to search · Ctrl-C exit${openHint}`));
  }

  if (state.notice) {
    out.push("");
    out.push(dim(`  ${state.notice}`));
  }

  const body = out.join("\n").split("\n");
  const visibleRows = Math.max(size.rows - 1, 1);
  const start =
    state.view === "impact"
      ? Math.max(0, Math.min(state.victimCursor, Math.max(0, body.length - visibleRows)))
      : 0;
  const end = start + visibleRows;
  const frame = body.slice(start, end).join("\n");

  process.stdout.write(homeClear + frame + "\n");
}

function renderPrompt(state: ExploreState, cols: number): string {
  const hint = dim("  (enter to analyze · esc to clear · ctrl-c to quit)");
  const promptLine = `  ${bold("change what?")} ${state.query}`;
  void cols;
  return `${promptLine}${state.query.length === 0 ? hint : ""}`;
}

function highlightMatch(name: string, positions: ReadonlySet<number>): string {
  if (positions.size === 0) return name;
  let result = "";
  for (let i = 0; i < name.length; i++) {
    result += positions.has(i) ? bold(name[i]) : name[i];
  }
  return result;
}

function pad(text: string, cols: number): string {
  if (text.length >= cols) return text.slice(0, cols - 1);
  return text + " ".repeat(cols - text.length);
}

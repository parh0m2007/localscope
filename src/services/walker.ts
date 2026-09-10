import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_BYTES,
  IGNORED_DIRS,
  IGNORED_FILE_PATTERNS,
} from "../constants.js";
import { detectLanguage } from "./language.js";
import type { Language } from "../types.js";

const execFileAsync = promisify(execFile);

export interface WalkedFile {
  readonly filePath: string;
  readonly language: Language;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
}

export interface WalkOptions {
  readonly rootDir: string;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly respectGitignore?: boolean;
}

interface WalkContext {
  readonly rootDir: string;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly files: WalkedFile[];
  truncated: boolean;
}

let gitignoreCache: {
  readonly root: string;
  readonly matchers: readonly ((p: string) => boolean)[];
} | null = null;

export interface GitignoreRule {
  readonly negated: boolean;
  readonly dirOnly: boolean;
  readonly anchored: boolean;
  readonly re: RegExp;
}

export function compileGitignorePatterns(
  rootDir: string,
  lines: readonly string[],
): ((p: string) => boolean)[] {
  const rules = compileGitignoreRules(lines);
  const matchOne = (relPath: string): boolean => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly && !rule.re.test(`${relPath}/`)) {
        if (rule.re.test(relPath)) continue;
      }
      if (rule.re.test(relPath) || (!rule.anchored && rule.re.test(path.basename(relPath)))) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  };
  void rootDir;
  return [matchOne];
}

export function compileGitignoreRules(
  lines: readonly string[],
): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "" || line.startsWith("#")) continue;

    const negated = line.startsWith("!");
    let pattern = negated ? line.slice(1) : line;

    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.slice(0, -1);

    const anchored = pattern.startsWith("/");
    if (anchored) pattern = pattern.slice(1);

    const placeholder = "LOCALSCOPE_GLOBSTAR";
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, placeholder)
      .replace(/\*/g, "[^/]*")
      .replaceAll(placeholder, ".*")
      .replace(/\?/g, ".");

    const regex = anchored
      ? `^${escaped}`
      : `(^|/)${escaped}`;

    try {
      rules.push({
        negated,
        dirOnly,
        anchored,
        re: new RegExp(regex),
      });
    } catch {
      // Malformed gitignore line; skip it
    }
  }
  return rules;
}

async function loadGitignore(
  rootDir: string,
): Promise<((p: string) => boolean)[]> {
  if (gitignoreCache && gitignoreCache.root === rootDir) {
    return [...gitignoreCache.matchers];
  }
  let matchers: ((p: string) => boolean)[] = [];
  try {
    const content = await fs.readFile(path.join(rootDir, ".gitignore"), "utf8");
    matchers = compileGitignorePatterns(rootDir, content.split(/\r?\n/));
  } catch {
    matchers = [];
  }
  gitignoreCache = { root: rootDir, matchers };
  return [...matchers];
}

function isGitignored(
  relPath: string,
  matchers: readonly ((p: string) => boolean)[],
): boolean {
  for (const match of matchers) {
    if (match(relPath)) return true;
  }
  return false;
}

function shouldSkipFile(
  filePath: string,
  ctx: WalkContext,
  gitignoreMatchers: readonly ((p: string) => boolean)[],
): boolean {
  const base = path.basename(filePath);
  for (const re of IGNORED_FILE_PATTERNS) {
    if (re.test(base)) return true;
  }
  const rel = path.relative(ctx.rootDir, filePath);
  return isGitignored(rel, gitignoreMatchers);
}

export function clearGitignoreCache(): void {
  gitignoreCache = null;
}

async function walkDir(
  dir: string,
  ctx: WalkContext,
  gitignoreMatchers: readonly ((p: string) => boolean)[],
): Promise<void> {
  if (ctx.files.length >= ctx.maxFiles) {
    ctx.truncated = true;
    return;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sorted) {
    if (ctx.files.length >= ctx.maxFiles) {
      ctx.truncated = true;
      return;
    }
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(ctx.rootDir, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.includes(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (isGitignored(rel, gitignoreMatchers)) continue;
      await walkDir(fullPath, ctx, gitignoreMatchers);
      continue;
    }

    if (!entry.isFile()) continue;
    if (shouldSkipFile(fullPath, ctx, gitignoreMatchers)) continue;

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    if (stat.size === 0 || stat.size > ctx.maxFileBytes) continue;
    if (stat.size > 512 && (await isBinaryShebang(fullPath))) continue;

    ctx.files.push({
      filePath: fullPath,
      language: detectLanguage(entry.name),
      mtimeMs: Math.round(stat.mtimeMs),
      sizeBytes: stat.size,
    });
  }
}

async function isBinaryShebang(fullPath: string): Promise<boolean> {
  try {
    const handle = await fs.open(fullPath, "r");
    try {
      const buf = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buf, 0, 512, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0) return true;
      }
      return false;
    } finally {
      await handle.close();
    }
  } catch {
    return true;
  }
}

export interface WalkResult {
  readonly files: readonly WalkedFile[];
  readonly truncated: boolean;
}

export async function walkRepository(options: WalkOptions): Promise<WalkResult> {
  const rootDir = path.resolve(options.rootDir);
  const ctx: WalkContext = {
    rootDir,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    files: [],
    truncated: false,
  };

  let gitignoreMatchers: ((p: string) => boolean)[] = [];
  if (options.respectGitignore !== false) {
    gitignoreMatchers = await loadGitignore(rootDir);
  }

  await walkDir(rootDir, ctx, gitignoreMatchers);
  return { files: ctx.files, truncated: ctx.truncated };
}

export async function tryRipgrepAvailable(): Promise<boolean> {
  try {
    const rgPath = await resolveRipgrepPath();
    if (!rgPath) return false;
    await execFileAsync(rgPath, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRipgrepPath(): Promise<string | null> {
  const candidates = [
    process.env.LOCALSCOPE_RG_PATH,
    "rg",
    "/opt/homebrew/bin/rg",
    "/usr/local/bin/rg",
    "/usr/bin/rg",
  ].filter((c): c is string => typeof c === "string" && c.length > 0);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  try {
    const mod = (await import("@vscode/ripgrep")) as unknown as {
      rgPath: string;
    };
    return mod.rgPath;
  } catch {
    return null;
  }
}

export async function isGitAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

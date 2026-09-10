import { compileGitignorePatterns } from "../src/services/walker.js";

export function compileGitignore(
  lines: readonly string[],
): (p: string) => boolean {
  const matchers = compileGitignorePatterns("", lines);
  return (p: string) => matchers[0]?.(p) ?? false;
}

export const CHARACTER_LIMIT = 25_000;

export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

export const DEFAULT_CHUNK_LINES = 60;

export const DEFAULT_MAX_FILES = 50_000;

export const DEFAULT_SEARCH_LIMIT = 20;

export const DEFAULT_MAX_IMPACT_DEPTH = 5;

export const IGNORED_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".vercel",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  "coverage",
  ".idea",
  ".vscode",
  ".cache",
  "tmp",
];

export const IGNORED_FILE_PATTERNS: readonly RegExp[] = [
  /\.(lock|log|min\.js|min\.map)$/i,
  /package-lock\.json$/i,
  /pnpm-lock\.yaml$/i,
  /yarn\.lock$/i,
  /\.env(\..+)?$/i,
];

export const DEFAULT_SEMANTIC_MODEL = "Xenova/all-MiniLM-L6-v2";

export const SEMANTIC_ACTIVATION_HINT =
  'Semantic search disabled. For better results: npm install -g @huggingface/transformers or add it as a dependency, then restart. Falling back to lexical search.';
